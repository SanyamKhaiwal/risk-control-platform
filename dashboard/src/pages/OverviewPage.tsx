import { X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useOverview, useRisks } from '../api/queries';
import type { Risk } from '../api/types';
import { HowItWorks, NextSteps } from '../components/Guidance';
import { RatingLegend, RiskMatrix, type Cell } from '../components/RiskMatrix';
import { RiskTable } from '../components/RiskTable';
import { Button, Empty, ErrorNotice } from '../components/ui';
import { formatTime } from '../format';

type Selection = { matrix: 'inherent' | 'residual'; cell: Cell };

export function OverviewPage() {
  // Both maps and the riskiest risks in one request, pushed live by the Gateway (docs/performance.md).
  const overview = useOverview(10);
  const heatmap = { ...overview, data: overview.data?.heatmap };
  const top = { ...overview, data: overview.data?.top };
  const [selection, setSelection] = useState<Selection | null>(null);
  // Cell drill-down filters the open register client-side; fetched only once a square is selected.
  const register = useRisks({ size: 100 }, { live: true, enabled: selection !== null });

  const cellRisks = selection
    ? register.data?.content.filter((risk) => risk.status !== 'CLOSED' && inCell(risk, selection))
    : undefined;

  const select = (matrix: Selection['matrix']) => (cell: Cell | null) => setSelection(cell ? { matrix, cell } : null);
  const updatedAt = heatmap.dataUpdatedAt ? new Date(heatmap.dataUpdatedAt) : null;

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head__text">
          <h1>Risk overview</h1>
          <p className="page-head__meta">
            {heatmap.data ? (
              <span className="num">
                {heatmap.data.totalRisks} open {heatmap.data.totalRisks === 1 ? 'risk' : 'risks'}
              </span>
            ) : (
              <span>Loading…</span>
            )}
            <span aria-hidden="true">·</span>
            <span className={`live ${heatmap.isError ? 'live--stale' : ''}`}>
              <span className="live__dot" aria-hidden="true" />
              {heatmap.isError ? 'Updates paused' : updatedAt ? `Live, updated ${formatTime(updatedAt)}` : 'Live'}
            </span>
          </p>
        </div>
        <div className="page-head__actions">
          <Link to="/register" className="btn">
            See all risks
          </Link>
        </div>
      </div>

      <HowItWorks />
      <NextSteps />

      {heatmap.isError && !heatmap.data ? <ErrorNotice error={heatmap.error} /> : null}

      <div className="grid-2">
        <MatrixSheet
          title="Before controls"
          sub="How risky each risk would be with no protection at all"
          grid={heatmap.data?.inherent}
          selected={selection?.matrix === 'inherent' ? selection.cell : null}
          onSelect={select('inherent')}
        />
        <MatrixSheet
          title="Risk now"
          sub="After the controls that have been tested and work"
          grid={heatmap.data?.residual}
          selected={selection?.matrix === 'residual' ? selection.cell : null}
          onSelect={select('residual')}
        />
      </div>

      <section className="sheet" aria-labelledby="list-title">
        <div className="sheet__head">
          <div className="sheet__title">
            <h2 id="list-title">
              {selection
                ? `${selection.matrix === 'inherent' ? 'Before controls' : 'Risk now'}: how likely ${selection.cell.likelihood}, how bad ${selection.cell.impact}`
                : 'Riskiest right now'}
            </h2>
            <span className="sheet__sub">
              {selection ? 'Risks in the square you selected' : 'Click a square in either map to see the risks in it'}
            </span>
          </div>
          {selection ? (
            <Button variant="ghost" size="sm" onClick={() => setSelection(null)}>
              <X size={14} strokeWidth={1.75} aria-hidden="true" />
              Clear selection
            </Button>
          ) : (
            <Link to="/register" className="btn btn--sm">
              All risks
            </Link>
          )}
        </div>
        {(selection ? register.error : top.error) ? (
          <div className="sheet__body">
            <ErrorNotice error={selection ? register.error : top.error} />
          </div>
        ) : (
          <RiskTable
            risks={selection ? cellRisks : top.data?.risks}
            loading={selection ? register.isPending : top.isPending}
            showStatus={false}
            empty={
              <Empty title={selection ? 'No risks in this cell' : 'No risks yet'}>
                {selection ? 'The count may have just changed.' : 'Risk owners add risks from the register.'}
              </Empty>
            }
          />
        )}
      </section>
    </div>
  );
}

function inCell(risk: Risk, { matrix, cell }: Selection) {
  return matrix === 'inherent'
    ? risk.likelihood === cell.likelihood && risk.impact === cell.impact
    : risk.residualLikelihood === cell.likelihood && risk.residualImpact === cell.impact;
}

function MatrixSheet({
  title,
  sub,
  grid,
  selected,
  onSelect,
}: {
  title: string;
  sub: string;
  grid: number[][] | undefined;
  selected: Cell | null;
  onSelect: (cell: Cell | null) => void;
}) {
  return (
    <section className="sheet matrix-sheet" aria-label={title}>
      <div className="sheet__head">
        <div className="sheet__title">
          <h2>{title}</h2>
          <span className="sheet__sub">{sub}</span>
        </div>
      </div>
      <div className="sheet__body">
        {/* Remount when data arrives, so the first load isn't shown as a movement. */}
        <RiskMatrix
          key={grid ? 'loaded' : 'loading'}
          label={`${title} matrix`}
          grid={grid ?? EMPTY_GRID}
          selected={selected}
          onSelect={grid ? onSelect : undefined}
        />
        <p className="field__hint">
          Each square counts the risks that sit there. The further up and to the right, the more dangerous.
        </p>
        <RatingLegend />
      </div>
    </section>
  );
}

const EMPTY_GRID = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]);
