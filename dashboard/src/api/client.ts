const BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:8080').replace(/\/$/, '');
export const apiBaseUrl = BASE_URL;

/** An RFC 7807 problem from the API, or a network failure (status 0). */
export class ApiError extends Error {
  readonly status: number;
  readonly title: string;
  readonly fieldErrors: Record<string, string>;

  constructor(status: number, title: string, detail: string, fieldErrors: Record<string, string> = {}) {
    super(detail);
    this.status = status;
    this.title = title;
    this.fieldErrors = fieldErrors;
  }
}

type TokenSource = () => string | null;
let tokenSource: TokenSource = () => null;
let onUnauthorized: () => void = () => {};

/** Wired by the session provider: where the token comes from, and what to do when it is rejected. */
export function configureClient(source: TokenSource, unauthorized: () => void) {
  tokenSource = source;
  onUnauthorized = unauthorized;
}

/** The signed-in user's token, for requests made outside api() (the live-update stream). */
export function currentToken() {
  return tokenSource();
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const token = options.auth === false ? null : tokenSource();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(BASE_URL + path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, 'Unreachable', 'The platform API is not reachable. Check that the gateway is running.');
  }

  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  const json = text ? safeParse(text) : null;
  if (!response.ok) {
    if (response.status === 401 && token) {
      onUnauthorized();
    }
    throw new ApiError(
      response.status,
      json?.title ?? response.statusText,
      json?.detail ?? defaultDetail(response.status),
      json?.errors ?? {},
    );
  }
  return json as T;
}

function safeParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function defaultDetail(status: number) {
  if (status === 429) return 'Too many requests. Wait a moment and try again.';
  if (status === 403) return 'Your role does not allow this action.';
  if (status >= 500) return 'The platform had a problem handling this request. Try again.';
  return 'The request could not be completed.';
}
