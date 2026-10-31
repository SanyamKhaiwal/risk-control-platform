import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Risk } from '../api/types';
import { CATEGORY_LABEL, formatRelative } from '../format';
import { PostedNumber, useJustChanged } from './Posted';
import { RatingBadge, SkeletonRows, StatusBadge } from './ui';

const COLUMNS = 7;

/** The risk register as a ruled ledger. Residual figures are posted, never silently overwritten. */
export function RiskTable({
  risks,
  loading,
  showStatus = true,
  empty,
}: {
  risks: Risk[] | undefined;
  loading: boolean;
  showStatus?: boolean;
  empty?: ReactNode;
}) {
  return (
    <div className="table-wrap">
      <table className="ledger">
        <thead>
          <tr>
            <th scope="col">Risk</th>
            <th scope="col" className="hide-sm">
              Owner
            </th>
            <th scope="col" className="n hide-md">
              Before controls
            </th>
            <th scope="col" className="n">
              Risk now
            </th>
            <th scope="col">Rating</th>
            {showStatus ? (
              <th scope="col" className="hide-sm">
                Status
              </th>
            ) : null}
            <th scope="col" className="n hide-md">
              Updated
            </th>
          </tr>
        </thead>
        {loading && !risks ? (
          <SkeletonRows columns={showStatus ? COLUMNS : COLUMNS - 1} />
        ) : (
          <tbody>
            {risks?.map((risk) => <RiskRow key={risk.id} risk={risk} showStatus={showStatus} />)}
          </tbody>
        )}
      </table>
      {!loading && risks?.length === 0 ? empty : null}
    </div>
  );
}

function RiskRow({ risk, showStatus }: { risk: Risk; showStatus: boolean }) {
  const navigate = useNavigate();
  const posted = useJustChanged(risk.residualScore);
  return (
    <tr className={`is-clickable ${posted ? 'was-posted' : ''}`} onClick={() => navigate(`/risks/${risk.id}`)}>
      <td>
        <div className="primary-cell">
          <Link to={`/risks/${risk.id}`} onClick={(event) => event.stopPropagation()}>
            {risk.title}
          </Link>
          <span className="sub">{CATEGORY_LABEL[risk.category]}</span>
        </div>
      </td>
      <td className="hide-sm">{risk.owner}</td>
      <td className="n hide-md">
        <span className="muted">
          {risk.likelihood}×{risk.impact} ={' '}
        </span>
        {risk.inherentScore}
      </td>
      <td className="n">
        <span className="muted">
          {risk.residualLikelihood}×{risk.residualImpact} ={' '}
        </span>
        <strong>
          <PostedNumber value={risk.residualScore} />
        </strong>
      </td>
      <td>
        <RatingBadge rating={risk.rating} />
      </td>
      {showStatus ? (
        <td className="hide-sm">
          <StatusBadge status={risk.status} />
        </td>
      ) : null}
      <td className="n hide-md muted">{formatRelative(risk.updatedAt)}</td>
    </tr>
  );
}
