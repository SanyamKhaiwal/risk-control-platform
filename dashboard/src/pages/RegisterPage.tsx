import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useCreateRisk, useRisks } from '../api/queries';
import type { Rating, RiskStatus } from '../api/types';
import { useCurrentUser, useSession } from '../auth/session';
import { RiskTable } from '../components/RiskTable';
import { Button, Empty, ErrorNotice, Pager, Segmented } from '../components/ui';
import { RATING_LABEL, STATUS_LABEL } from '../format';
import { RiskForm } from './RiskForm';

const PAGE_SIZE = 20;
type StatusFilter = RiskStatus | 'ALL';

export function RegisterPage() {
  const { hasRole } = useSession();
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [rating, setRating] = useState<Rating | ''>('');
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const create = useCreateRisk();
  const canCreate = hasRole('RISK_OWNER');

  const risks = useRisks(
    {
      status: status === 'ALL' ? undefined : status,
      rating: rating || undefined,
      owner: mine ? user.username : undefined,
      page,
      size: PAGE_SIZE,
    },
    { live: true },
  );
  const filtered = status !== 'ALL' || rating !== '' || mine;
  const resetPage = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setPage(0);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head__text">
          <h1>Risks</h1>
          <p className="page-head__meta">Everything that could go wrong, riskiest first. Click a risk to see why it scores what it does.</p>
        </div>
        {canCreate && !creating ? (
          <div className="page-head__actions">
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={15} strokeWidth={2} aria-hidden="true" />
              New risk
            </Button>
          </div>
        ) : null}
      </div>

      {creating ? (
        <section className="sheet" aria-labelledby="new-risk-title">
          <div className="sheet__head">
            <div className="sheet__title">
              <h2 id="new-risk-title">New risk</h2>
              <span className="sheet__sub">You will own it. After saving, link controls that protect it to bring the score down.</span>
            </div>
          </div>
          <div className="sheet__body">
            <RiskForm
              submitLabel="Add to register"
              busy={create.isPending}
              error={create.error}
              onCancel={() => {
                setCreating(false);
                create.reset();
              }}
              onSubmit={(input) => create.mutate(input, { onSuccess: (risk) => navigate(`/risks/${risk.id}`) })}
            />
          </div>
        </section>
      ) : null}

      <section className="sheet" aria-label="Risks">
        <div className="toolbar">
          <Segmented<StatusFilter>
            label="Status"
            value={status}
            onChange={resetPage(setStatus)}
            options={[{ value: 'ALL', label: 'All' }, ...(Object.keys(STATUS_LABEL) as RiskStatus[]).map((value) => ({ value, label: STATUS_LABEL[value] }))]}
          />
          <label className="visually-hidden" htmlFor="rating-filter">
            Rating
          </label>
          <select
            id="rating-filter"
            className="select"
            value={rating}
            onChange={(event) => resetPage(setRating)(event.target.value as Rating | '')}
          >
            <option value="">Any rating</option>
            {(Object.keys(RATING_LABEL) as Rating[]).map((value) => (
              <option key={value} value={value}>
                {RATING_LABEL[value]}
              </option>
            ))}
          </select>
          <label className="check">
            <input type="checkbox" checked={mine} onChange={(event) => resetPage(setMine)(event.target.checked)} />
            Owned by me
          </label>
        </div>
        {risks.error ? (
          <div className="sheet__body">
            <ErrorNotice error={risks.error} />
          </div>
        ) : (
          <>
            <RiskTable
              risks={risks.data?.content}
              loading={risks.isPending}
              empty={
                filtered ? (
                  <Empty title="No risks match these filters">Clear a filter to see more of the register.</Empty>
                ) : (
                  <Empty
                    title="The register is empty"
                    action={
                      canCreate ? (
                        <Button variant="primary" onClick={() => setCreating(true)}>
                          Add the first risk
                        </Button>
                      ) : undefined
                    }
                  >
                    Risk owners record risks here, scored by likelihood and impact.
                  </Empty>
                )
              }
            />
            {risks.data && risks.data.totalElements > 0 ? (
              <Pager
                page={risks.data.page}
                totalPages={risks.data.totalPages}
                totalElements={risks.data.totalElements}
                onPage={setPage}
                noun="risk"
              />
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
