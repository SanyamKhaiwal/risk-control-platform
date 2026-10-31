import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { live } from '../api/live';
import { api, configureClient } from '../api/client';
import type { LoginResponse, Role } from '../api/types';

export interface Session {
  username: string;
  roles: Role[];
  token: string;
  expiresAt: number;
}

interface SessionContextValue {
  session: Session | null;
  /** Why the last session ended, shown on the login screen. */
  endedReason: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: (reason?: string) => void;
  hasRole: (role: Role) => boolean;
}

const STORAGE_KEY = 'rcp.session';
const SessionContext = createContext<SessionContextValue | null>(null);

// sessionStorage can throw (private mode, blocked storage); the app works without it.
function readStored(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const stored = raw ? (JSON.parse(raw) as Session) : null;
    return stored && stored.expiresAt > Date.now() ? stored : null;
  } catch {
    return null;
  }
}

function writeStored(session: Session | null) {
  try {
    if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Not persisted; the session lasts until the tab reloads.
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(readStored);
  const [endedReason, setEndedReason] = useState<string | null>(null);

  const logout = useCallback((reason?: string) => {
    live.stop();
    writeStored(null);
    setSession(null);
    setEndedReason(reason ?? null);
  }, []);

  // The client reads the token at request time through a ref that is current from the first render,
  // so the requests a page fires on load (e.g. after a reload restores the session) carry it.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  useState(() => {
    configureClient(() => sessionRef.current?.token ?? null, () => logout('Your session expired. Sign in again.'));
    return null;
  });

  // Tokens last 30 minutes and are not refreshed; end the session when the token does.
  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(() => logout('Your session expired. Sign in again.'), session.expiresAt - Date.now());
    return () => window.clearTimeout(timer);
  }, [session, logout]);

  const login = useCallback(async (username: string, password: string) => {
    const response = await api<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: { username, password },
      auth: false,
    });
    const next: Session = {
      username: response.username,
      roles: response.roles,
      token: response.accessToken,
      expiresAt: Date.now() + response.expiresIn * 1000,
    };
    writeStored(next);
    setEndedReason(null);
    setSession(next);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      endedReason,
      login,
      logout,
      hasRole: (role) => session?.roles.includes(role) ?? false,
    }),
    [session, endedReason, login, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

/** The signed-in session; only use below the authenticated route. */
export function useCurrentUser() {
  const { session } = useSession();
  if (!session) throw new Error('No signed-in user');
  return session;
}
