import { Link } from 'react-router';
import { useControls } from '../api/queries';
import { Empty, ErrorNotice } from '../components/ui';
import { ControlTable } from './ControlsPage';

export function RetestPage() {
  const controls = useControls({ retestRequired: true, size: 100 }, { live: true });
  const count = controls.data?.totalElements ?? 0;
  const empty = controls.data !== undefined && count === 0;

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head__text">
          <h1>Needs re-test</h1>
          <p className="page-head__meta">
            When a risk gets worse (High or Critical), the platform flags the controls protecting it that haven't been tested in the last 30 days. Testing one again clears the flag.
          </p>
        </div>
      </div>
      <section className="sheet" aria-label="Controls to re-test">
        {controls.error ? (
          <div className="sheet__body">
            <ErrorNotice error={controls.error} />
          </div>
        ) : empty ? (
          <Empty title="Nothing needs re-testing">
            When a risk worsens, its stale <Link to="/controls">controls</Link> appear here. A fresh test clears the flag.
          </Empty>
        ) : (
          <>
            <div className="sheet__head">
              <h2 className="num">{controls.data ? `${count} ${count === 1 ? 'control' : 'controls'} waiting for a fresh test` : 'Loading…'}</h2>
            </div>
            <ControlTable controls={controls.data?.content} loading={controls.isPending} showReason />
          </>
        )}
      </section>
    </div>
  );
}
