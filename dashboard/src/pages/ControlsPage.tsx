import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useControls, useCreateControl } from '../api/queries';
import type { Control, ControlType } from '../api/types';
import { useCurrentUser, useSession } from '../auth/session';
import { ResultBadge } from '../components/ResultBadge';
import { Button, Empty, ErrorNotice, Pager, Segmented, SkeletonRows } from '../components/ui';
import { CONTROL_TYPE_SHORT, FREQUENCY_LABEL, formatRelative } from '../format';
import { ControlForm } from './ControlForm';

type TypeFilter = ControlType | 'ALL';

export function ControlsPage() {
  const { hasRole } = useSession();
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [type, setType] = useState<TypeFilter>('ALL');
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const create = useCreateControl();
  const canCreate = hasRole('CONTROL_OWNER');
  const controls = useControls(
    { type: type === 'ALL' ? undefined : type, owner: mine ? user.username : undefined, page, size: 20 },
    { live: true },
  );

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head__text">
          <h1>Controls</h1>
          <p className="page-head__meta">Controls are the safeguards that protect against risks. A control only counts once a tester has checked it works.</p>
        </div>
        {canCreate && !creating ? (
          <div className="page-head__actions">
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={15} strokeWidth={2} aria-hidden="true" />
              New control
            </Button>
          </div>
        ) : null}
      </div>

      {creating ? (
        <section className="sheet" aria-labelledby="new-control-title">
          <div className="sheet__head">
            <div className="sheet__title">
              <h2 id="new-control-title">New control</h2>
              <span className="sheet__sub">You will own it. Someone else has to test it, because owners can't check their own work.</span>
            </div>
          </div>
          <div className="sheet__body">
            <ControlForm
              withType
              submitLabel="Create control"
              busy={create.isPending}
              error={create.error}
              onCancel={() => {
                setCreating(false);
                create.reset();
              }}
              onSubmit={(input) =>
                input.type && create.mutate({ ...input, type: input.type }, { onSuccess: (control) => navigate(`/controls/${control.id}`) })
              }
            />
          </div>
        </section>
      ) : null}

      <section className="sheet" aria-label="Controls">
        <div className="toolbar">
          <Segmented<TypeFilter>
            label="Type"
            value={type}
            onChange={(value) => {
              setType(value);
              setPage(0);
            }}
            options={[{ value: 'ALL', label: 'All' }, ...(Object.keys(CONTROL_TYPE_SHORT) as ControlType[]).map((value) => ({ value, label: CONTROL_TYPE_SHORT[value] }))]}
          />
          {canCreate ? (
            <label className="check">
              <input
                type="checkbox"
                checked={mine}
                onChange={(event) => {
                  setMine(event.target.checked);
                  setPage(0);
                }}
              />
              Owned by me
            </label>
          ) : null}
        </div>
        {controls.error ? (
          <div className="sheet__body">
            <ErrorNotice error={controls.error} />
          </div>
        ) : (
          <>
            <ControlTable controls={controls.data?.content} loading={controls.isPending} />
            {controls.data?.content.length === 0 ? (
              <Empty title={type !== 'ALL' || mine ? 'No controls match these filters' : 'No controls yet'}>
                {canCreate ? 'Create a control, then a tester can assess it.' : 'Control owners define controls here.'}
              </Empty>
            ) : null}
            {controls.data && controls.data.totalElements > 0 ? (
              <Pager
                page={controls.data.page}
                totalPages={controls.data.totalPages}
                totalElements={controls.data.totalElements}
                onPage={setPage}
                noun="control"
              />
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

/** "Account takeover rose to Critical", with the risk's name linking to it. */
export function RetestReason({ control }: { control: Control }) {
  const reason = control.retestReason ?? '';
  const marker = ' rose to ';
  const at = reason.lastIndexOf(marker);
  if (!control.retestRiskId || at < 0) return <>{reason}</>;
  return (
    <>
      <Link to={`/risks/${control.retestRiskId}`} onClick={(event) => event.stopPropagation()}>
        {reason.slice(0, at)}
      </Link>
      {reason.slice(at)}
    </>
  );
}

export function ControlTable({ controls, loading, showReason }: { controls: Control[] | undefined; loading: boolean; showReason?: boolean }) {
  const navigate = useNavigate();
  return (
    <div className="table-wrap">
      <table className="ledger">
        <thead>
          <tr>
            <th scope="col">Control</th>
            <th scope="col" className="hide-sm">
              Owner
            </th>
            <th scope="col">Last test</th>
            <th scope="col" className="n hide-sm">
              Tested
            </th>
            {showReason ? <th scope="col">Why it needs a re-test</th> : (
              <th scope="col" className="hide-md">
                Tested every
              </th>
            )}
          </tr>
        </thead>
        {loading && !controls ? (
          <SkeletonRows columns={5} />
        ) : (
          <tbody>
            {controls?.map((control) => (
              <tr key={control.id} className="is-clickable" onClick={() => navigate(`/controls/${control.id}`)}>
                <td>
                  <div className="primary-cell">
                    <Link to={`/controls/${control.id}`} onClick={(event) => event.stopPropagation()}>
                      {control.name}
                    </Link>
                    <span className="sub">{CONTROL_TYPE_SHORT[control.type]}</span>
                  </div>
                </td>
                <td className="hide-sm">{control.owner}</td>
                <td>
                  <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                    {control.latestResult ? <ResultBadge result={control.latestResult} /> : <span className="badge badge--neutral">Not tested yet</span>}
                    {control.retestRequired && !showReason ? <span className="badge badge--alert">Re-test</span> : null}
                  </span>
                </td>
                <td className="n hide-sm muted">{formatRelative(control.lastAssessedAt)}</td>
                {showReason ? (
                  <td className="muted">
                    <RetestReason control={control} />
                  </td>
                ) : (
                  <td className="hide-md muted">{FREQUENCY_LABEL[control.frequency]}</td>
                )}
              </tr>
            ))}
          </tbody>
        )}
      </table>
    </div>
  );
}
