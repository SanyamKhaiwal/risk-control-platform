import { useState, type FormEvent } from 'react';
import { PlayCircle } from 'lucide-react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { ApiError } from '../api/client';
import { useSession } from '../auth/session';
import { Mark } from '../components/AppShell';
import { Button, Field, Notice } from '../components/ui';

/** The seeded demo accounts (gateway application.yml). Listed so a reviewer can try every role. */
const DEMO_ACCOUNTS = [
  { username: 'alice', role: 'Risk owner', can: 'Records risks, links controls' },
  { username: 'bob', role: 'Control owner', can: 'Defines controls' },
  { username: 'carol', role: 'Control tester', can: 'Assesses controls' },
  { username: 'erin', role: 'Owner + tester', can: "Can't assess her own controls" },
  { username: 'dave', role: 'Viewer', can: 'Reads everything' },
];

export function LoginPage() {
  const { session, login, endedReason } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  if (session) return <Navigate to={from} replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError('Enter a username and password, or pick a demo account.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      navigate(from, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Sign-in failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
        <section className="login__intro">
          <div className="login__brand">
            <Mark size={26} />
            Risk &amp; Control Assessment Platform
          </div>
          <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
            <h1 className="login__headline">See how risky things are right now, and exactly what changed it.</h1>
            <p className="login__lede">
              Each risk is scored by how likely it is and how bad it would be. Safeguards that pass their tests bring
              the score down; one that fails pushes it straight back up, within a second.
            </p>
            <Link className="btn how-link" to="/how-it-works">
              <PlayCircle size={16} strokeWidth={1.75} aria-hidden="true" />
              Watch how it works, no sign-in needed
            </Link>
          </div>
          <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
            <h2 className="field__label" id="accounts-title">
              Demo accounts <span className="muted">· password demo123</span>
            </h2>
            <div className="accounts" role="group" aria-labelledby="accounts-title">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.username}
                  type="button"
                  aria-pressed={username === account.username}
                  onClick={() => {
                    setUsername(account.username);
                    setPassword('demo123');
                    // Bring the form into view (it sits above the accounts on small screens).
                    document.getElementById('sign-in')?.focus();
                  }}
                >
                  <span className="accounts__user">{account.username}</span>
                  <span className="accounts__role">{account.role}</span>
                  <span className="accounts__can">{account.can}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="login__panel">
          <form className="login__form" onSubmit={submit} noValidate>
            <h2 style={{ fontSize: 'var(--t-lg)' }}>Sign in</h2>
            {endedReason && !error ? <Notice>{endedReason}</Notice> : null}
            {error ? <Notice tone="error">{error}</Notice> : null}
            <Field label="Username" htmlFor="username">
              <input
                id="username"
                className="input"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </Field>
            <Field label="Password" htmlFor="password">
              <input
                id="password"
                type="password"
                className="input"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </Field>
            <Button type="submit" variant="primary" busy={busy} id="sign-in">
              Sign in
            </Button>
            <p className="field__hint">Demo environment. All data is synthetic.</p>
          </form>
        </section>
    </div>
  );
}
