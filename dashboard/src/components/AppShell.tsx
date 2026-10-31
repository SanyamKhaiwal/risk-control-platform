import { LogOut } from 'lucide-react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router';
import { useControls } from '../api/queries';
import { useSession } from '../auth/session';
import { ROLE_LABEL } from '../format';
import { Button } from './ui';

export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2.5" y="2.5" width="19" height="19" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.5 9h19M2.5 15h19M9 2.5v19M15 2.5v19" stroke="currentColor" strokeWidth="1" />
      <rect x="15.75" y="3.25" width="5" height="5" rx="0.75" fill="var(--red)" />
      <rect x="3.25" y="15.75" width="5" height="5" rx="0.75" fill="var(--accent)" />
    </svg>
  );
}

/** Everything below requires a signed-in user. */
export function RequireSession() {
  const { session } = useSession();
  const location = useLocation();
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <AppShell />;
}

function AppShell() {
  const { session, logout } = useSession();
  const retest = useControls({ retestRequired: true, size: 1 }, { live: true });
  const retestCount = retest.data?.totalElements ?? 0;
  if (!session) return null;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__inner">
          <NavLink to="/" className="wordmark" aria-label="Risk & Control, overview">
            <Mark />
            <span className="wordmark__text">Risk &amp; Control</span>
          </NavLink>
          <nav className="nav" aria-label="Main">
            <NavLink to="/" end>
              Overview
            </NavLink>
            <NavLink to="/register">Risks</NavLink>
            <NavLink to="/controls">Controls</NavLink>
            <NavLink to="/retest">
              Needs re-test
              {retestCount > 0 ? (
                <span className="nav__count num" aria-label={`${retestCount} controls need re-testing`}>
                  {retestCount}
                </span>
              ) : null}
            </NavLink>
            <NavLink to="/how-it-works">How it works</NavLink>
          </nav>
          <div className="topbar__end">
            <span className="demo-tag" title="All risks, controls and assessments are synthetic demo data.">
              Demo<span className="demo-tag__long"> data</span>
            </span>
            <div className="user">
              <div className="user__who">
                <span className="user__name">{session.username}</span>
                <span className="user__role">{session.roles.map((role) => ROLE_LABEL[role]).join(' · ')}</span>
              </div>
              <span className="avatar" aria-hidden="true">
                {session.username.slice(0, 1)}
              </span>
              <Button variant="ghost" size="sm" onClick={() => logout()} aria-label="Sign out" title="Sign out">
                <LogOut size={15} strokeWidth={1.75} aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
