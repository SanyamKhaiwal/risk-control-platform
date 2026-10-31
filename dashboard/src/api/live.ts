import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { apiBaseUrl, currentToken } from './client';

/**
 * Live updates pushed by the Gateway (POST /api/live, server-sent events) instead of every screen polling every
 * 2 seconds (docs/performance.md). Screens register the addresses they show; one stream carries them all, and each
 * update lands straight in the query cache. While the stream is down, queries fall back to polling, and slow down
 * when nobody has touched the page for a while.
 */

type Status = 'off' | 'connecting' | 'live';

const POLL_MS = 2000;
const IDLE_POLL_MS = 30000;
const IDLE_AFTER_MS = 5 * 60 * 1000;

class LiveUpdates {
  private client: QueryClient | null = null;
  private readonly watchers = new Map<string, Map<string, QueryKey>>();
  private connectedPaths = new Set<string>();
  private status: Status = 'off';
  private abort: AbortController | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private retryMs = 1000;
  private lastActivity = Date.now();

  /** Called once by the app; without it (tests, for example) everything simply polls. */
  attach(client: QueryClient) {
    this.client = client;
    const touch = () => (this.lastActivity = Date.now());
    for (const event of ['pointerdown', 'keydown', 'pointermove', 'focus']) window.addEventListener(event, touch, { passive: true });
  }

  /** A query shows `path`; returns the function to call when it stops. */
  watch(path: string, key: QueryKey): () => void {
    if (!this.client) return () => {};
    const keys = this.watchers.get(path) ?? new Map<string, QueryKey>();
    keys.set(hashKey(key), key);
    this.watchers.set(path, keys);
    this.scheduleReconnect(50);
    return () => {
      keys.delete(hashKey(key));
      if (keys.size === 0) this.watchers.delete(path);
      this.scheduleReconnect(500);
    };
  }

  /** Whether `path` currently arrives by push, so its query needn't poll. */
  covers(path: string) {
    return this.status === 'live' && this.connectedPaths.has(path);
  }

  /** How often a query not covered by the stream polls: 2 s, or 30 s once the page has been idle for 5 minutes. */
  pollInterval() {
    return Date.now() - this.lastActivity > IDLE_AFTER_MS ? IDLE_POLL_MS : POLL_MS;
  }

  stop() {
    this.abort?.abort();
    this.abort = null;
    this.setStatus('off');
  }

  private scheduleReconnect(delayMs: number) {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => void this.connect(), delayMs);
  }

  private setStatus(status: Status) {
    const wasLive = this.status === 'live';
    this.status = status;
    // Leaving push: start polling right away (a query whose interval was off re-evaluates only after a fetch).
    if (wasLive && status !== 'live') void this.client?.refetchQueries({ type: 'active' });
  }

  private async connect() {
    this.abort?.abort();
    const paths = [...this.watchers.keys()].slice(0, 10);
    const token = currentToken();
    if (!this.client || paths.length === 0 || !token) {
      this.setStatus('off');
      return;
    }
    const abort = new AbortController();
    this.abort = abort;
    this.setStatus('connecting');
    try {
      const response = await fetch(`${apiBaseUrl}/api/live`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ paths }),
        signal: abort.signal,
      });
      if (!response.ok || !response.body) throw new Error(`live stream refused: ${response.status}`);
      this.connectedPaths = new Set(paths);
      this.setStatus('live');
      this.retryMs = 1000;
      await this.read(response.body);
    } catch {
      // Network error, refusal, or an abort for a new set of paths: fall back to polling meanwhile.
    }
    if (this.abort !== abort) return; // replaced by a newer connection
    this.connectedPaths = new Set();
    this.setStatus('off');
    this.scheduleReconnect(this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 30000);
  }

  private async read(body: ReadableStream<Uint8Array>) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        this.handle(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
    }
  }

  /** One server-sent event: `event: update` and `data: {"path": …, "body": …}`; comments are heartbeats. */
  private handle(frame: string) {
    const lines = frame.split('\n');
    if (!lines.some((line) => line.startsWith('event:') && line.slice(6).trim() === 'update')) return;
    const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).replace(/^ /, '')).join('\n');
    const update = parseUpdate(data);
    if (!update) return;
    for (const key of this.watchers.get(update.path)?.values() ?? []) this.client?.setQueryData(key, update.body);
  }
}

export function parseUpdate(data: string): { path: string; body: unknown } | null {
  try {
    const parsed = JSON.parse(data) as { path?: unknown; body?: unknown };
    return typeof parsed.path === 'string' ? { path: parsed.path, body: parsed.body } : null;
  } catch {
    return null;
  }
}

export const live = new LiveUpdates();
