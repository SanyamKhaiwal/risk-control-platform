import { AlertTriangle, ArrowRight, CheckCircle2, Info, Link2, Pencil, Unlink } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import {
  useChangeStatus,
  useControls,
  useLinkControl,
  useRisk,
  useRiskHistory,
  useRiskLinks,
  useUnlinkControl,
  useUpdateRisk,
} from '../api/queries';
import type { Control, HistoryEntry, Risk, RiskLink, RiskStatus } from '../api/types';
import { useCurrentUser, useSession } from '../auth/session';
import { PostedNumber } from '../components/Posted';
import { ResultBadge } from '../components/ResultBadge';
import { MiniMatrix } from '../components/RiskMatrix';
import { Button, Empty, ErrorNotice, Notice, RatingBadge, SkeletonRows, StatusBadge } from '../components/ui';
import {
  CATEGORY_LABEL,
  CONTROL_TYPE_SHORT,
  IMPACT_WORD,
  LIKELIHOOD_WORD,
  RATING_LABEL,
  RESULT_LABEL,
  STATUS_LABEL,
  formatDateTime,
  formatRelative,
  percent,
} from '../format';
import { RiskForm } from './RiskForm';

export function RiskDetailPage() {
  const { id = '' } = useParams();
  const risk = useRisk(id);

  if (risk.error) {
    return (
      <div className="page">
        <Crumbs title="Risk" />
        <ErrorNotice error={risk.error} />
      </div>
    );
  }
  if (!risk.data) {
    return (
      <div className="page" aria-busy="true">
        <Crumbs title="Loading…" />
        <span className="skeleton" style={{ width: 320, height: 28 }} />
      </div>
    );
  }
  return <RiskDetail risk={risk.data} />;
}

function Crumbs({ title }: { title: string }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <Link to="/register">Risks</Link>
      <span aria-hidden="true">/</span>
      <span aria-current="page">{title}</span>
    </nav>
  );
}

function RiskDetail({ risk }: { risk: Risk }) {
  const user = useCurrentUser();
  const { hasRole } = useSession();
  const isOwner = hasRole('RISK_OWNER') && risk.owner === user.username;
  const [editing, setEditing] = useState(false);
  const update = useUpdateRisk(risk.id);
  const links = useRiskLinks(risk.id);
  const controls = useControls({ size: 100 }, { live: true });
  const byId = useMemo(() => new Map((controls.data?.content ?? []).map((c) => [c.id, c])), [controls.data]);

  return (
    <div className="page">
      <Crumbs title={risk.title} />
      <div className="page-head">
        <div className="page-head__text">
          <h1>{risk.title}</h1>
          <p className="page-head__meta">
            <span>{CATEGORY_LABEL[risk.category]}</span>
            <span aria-hidden="true">·</span>
            <span>Owned by {risk.owner}</span>
            <span aria-hidden="true">·</span>
            <StatusBadge status={risk.status} />
          </p>
        </div>
        {isOwner && !editing ? (
          <div className="page-head__actions">
            <StatusControl risk={risk} />
            <Button onClick={() => setEditing(true)} disabled={risk.status === 'CLOSED'} title={risk.status === 'CLOSED' ? 'Reopen the risk to edit it' : undefined}>
              <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
              Edit
            </Button>
          </div>
        ) : null}
      </div>

      {!isOwner ? (
        <Notice>
          {hasRole('RISK_OWNER')
            ? `Only the owner, ${risk.owner}, can change this risk. You can view it.`
            : `You can view this risk. Its owner, ${risk.owner}, decides which controls protect it.`}
        </Notice>
      ) : null}

      {editing ? (
        <section className="sheet" aria-labelledby="edit-title">
          <div className="sheet__head">
            <h2 id="edit-title">Edit risk</h2>
          </div>
          <div className="sheet__body">
            <RiskForm
              initial={{ ...risk, description: risk.description ?? '' }}
              submitLabel="Save changes"
              busy={update.isPending}
              error={update.error}
              onCancel={() => {
                setEditing(false);
                update.reset();
              }}
              onSubmit={(input) => update.mutate({ ...input, version: risk.version }, { onSuccess: () => setEditing(false) })}
            />
          </div>
        </section>
      ) : null}

      <ScoreSheet risk={risk} links={links.data} byId={byId} />

      <div className="grid-detail">
        <div className="stack">
          <LinkedControls risk={risk} isOwner={isOwner} links={links.data} loading={links.isPending} byId={byId} controls={controls.data?.content} />
        </div>
        <div className="stack">
          {risk.description ? (
            <section className="sheet" aria-labelledby="desc-title">
              <div className="sheet__head">
                <h2 id="desc-title">What could happen</h2>
              </div>
              <div className="sheet__body">
                <p style={{ maxWidth: '68ch', color: 'var(--ink-2)' }}>{risk.description}</p>
              </div>
            </section>
          ) : null}
          <History riskId={risk.id} byId={byId} />
        </div>
      </div>
    </div>
  );
}

function StatusControl({ risk }: { risk: Risk }) {
  const change = useChangeStatus(risk.id);
  const options = (Object.keys(STATUS_LABEL) as RiskStatus[]).filter((status) => status !== risk.status);
  return (
    <>
      <label className="visually-hidden" htmlFor="status-change">
        Change status
      </label>
      <select
        id="status-change"
        className="select"
        style={{ width: 'auto' }}
        value=""
        disabled={change.isPending}
        onChange={(event) => {
          const status = event.target.value as RiskStatus;
          if (status) change.mutate({ status, version: risk.version });
        }}
      >
        <option value="" disabled>
          {change.isPending ? 'Updating…' : 'Change status'}
        </option>
        {options.map((status) => (
          <option key={status} value={status}>
            {status === 'OPEN' && risk.status === 'CLOSED' ? 'Reopen' : `Mark ${STATUS_LABEL[status].toLowerCase()}`}
          </option>
        ))}
      </select>
      {change.error ? <ErrorNotice error={change.error} /> : null}
    </>
  );
}

function ScoreSheet({ risk, links, byId }: { risk: Risk; links: RiskLink[] | undefined; byId: Map<string, Control> }) {
  return (
    <section className="sheet" aria-labelledby="scores-title">
      <div className="sheet__head">
        <div className="sheet__title">
          <h2 id="scores-title">How risky is this?</h2>
          <span className="sheet__sub">Score = how likely × how bad, each from 1 to 5. Tested controls that work bring it down.</span>
        </div>
      </div>
      <div className="sheet__body" style={{ display: 'grid', gap: 'var(--s-4)' }}>
        <div className="scores">
          <div className="score">
            <span className="score__label">Before controls</span>
            <span className="score__equation">
              {risk.likelihood}
              <span className="score__op">×</span>
              {risk.impact}
              <span className="score__op">=</span>
              {risk.inherentScore}
            </span>
            <span className="score__parts">
              {LIKELIHOOD_WORD[risk.likelihood]} × {IMPACT_WORD[risk.impact].toLowerCase()}
            </span>
            <span>
              <RatingBadge rating={risk.inherentRating} />
            </span>
          </div>
          <ArrowRight className="scores__arrow" size={22} strokeWidth={1.5} aria-hidden="true" />
          <div className="score">
            <span className="score__label">Risk now</span>
            <span className="score__equation" aria-live="polite">
              <PostedNumber value={risk.residualLikelihood} />
              <span className="score__op">×</span>
              <PostedNumber value={risk.residualImpact} />
              <span className="score__op">=</span>
              <PostedNumber value={risk.residualScore} />
            </span>
            <span className="score__parts">
              {LIKELIHOOD_WORD[risk.residualLikelihood]} × {IMPACT_WORD[risk.residualImpact].toLowerCase()}
            </span>
            <span>
              <RatingBadge rating={risk.rating} />
            </span>
          </div>
          <figure style={{ margin: 0, display: 'grid', gap: 6, justifyItems: 'center' }}>
            <MiniMatrix
              inherent={{ likelihood: risk.likelihood, impact: risk.impact }}
              residual={{ likelihood: risk.residualLikelihood, impact: risk.residualImpact }}
            />
            <figcaption className="field__hint">○ before · ● now</figcaption>
          </figure>
        </div>
        <Explanation risk={risk} links={links} byId={byId} />
      </div>
    </section>
  );
}

/** "Why is the score N?" in plain sentences, built from the linked controls and their latest results. */
function Explanation({ risk, links, byId }: { risk: Risk; links: RiskLink[] | undefined; byId: Map<string, Control> }) {
  if (!links) return null;
  const name = (link: RiskLink) => byId.get(link.controlId)?.name ?? 'A linked control';
  const result = (link: RiskLink) => {
    const control = byId.get(link.controlId);
    return control?.latestResult ? RESULT_LABEL[control.latestResult].toLowerCase() : 'untested';
  };
  const tested = links.filter((l) => l.latestEffectiveness !== null);
  const untested = links.filter((l) => l.latestEffectiveness === null);
  const lowersLikelihood = tested.filter((l) => l.controlType === 'PREVENTIVE');
  const lowersImpact = tested.filter((l) => l.controlType !== 'PREVENTIVE');
  const lines: { tone: 'ok' | 'info' | 'warn'; text: ReactNode }[] = [];

  if (links.length === 0) {
    lines.push({
      tone: 'warn',
      text: <>No controls are linked yet, so the risk is still at its starting score of <strong>{risk.inherentScore}</strong>. Link a control below to start lowering it.</>,
    });
  } else {
    const describe = (group: RiskLink[]) => group.map((l) => `“${name(l)}” ${result(l)}`).join(', ');
    lines.push(
      lowersLikelihood.length > 0
        ? {
            tone: risk.residualLikelihood < risk.likelihood ? 'ok' : 'info',
            text: (
              <>
                <strong>How likely</strong>{' '}
                {risk.residualLikelihood < risk.likelihood
                  ? `went from ${LIKELIHOOD_WORD[risk.likelihood]} (${risk.likelihood}) to ${LIKELIHOOD_WORD[risk.residualLikelihood]} (${risk.residualLikelihood})`
                  : `stays ${LIKELIHOOD_WORD[risk.likelihood]} (${risk.likelihood})`}
                , because {describe(lowersLikelihood)}.
              </>
            ),
          }
        : { tone: 'info', text: <><strong>How likely</strong> stays at {risk.likelihood}: no tested control stops this from happening.</> },
    );
    lines.push(
      lowersImpact.length > 0
        ? {
            tone: risk.residualImpact < risk.impact ? 'ok' : 'info',
            text: (
              <>
                <strong>How bad</strong>{' '}
                {risk.residualImpact < risk.impact
                  ? `went from ${IMPACT_WORD[risk.impact]} (${risk.impact}) to ${IMPACT_WORD[risk.residualImpact]} (${risk.residualImpact})`
                  : `stays ${IMPACT_WORD[risk.impact]} (${risk.impact})`}
                , because {describe(lowersImpact)}.
              </>
            ),
          }
        : { tone: 'info', text: <><strong>How bad</strong> stays at {risk.impact}: no tested control spots it quickly or limits the damage.</> },
    );
  }
  for (const link of untested) {
    lines.push({
      tone: 'warn',
      text: <>“{name(link)}” is linked but <strong>not tested yet</strong>, so it doesn't count. A tester needs to record a result first.</>,
    });
  }
  lines.push({
    tone: 'info',
    text: (
      <>
        Result: {risk.residualLikelihood} × {risk.residualImpact} = <strong>{risk.residualScore}</strong>, which is {RATING_LABEL[risk.rating].toLowerCase()} (Low 1–5, Medium 6–11, High 12–19, Critical 20–25).
      </>
    ),
  });

  return (
    <ul className="explain" aria-label="Why the score is what it is">
      {lines.map((line, index) => (
        <li key={index} className={line.tone === 'warn' ? 'is-warning' : undefined}>
          {line.tone === 'warn' ? (
            <AlertTriangle size={15} strokeWidth={1.75} aria-hidden="true" />
          ) : line.tone === 'ok' ? (
            <CheckCircle2 size={15} strokeWidth={1.75} color="var(--accent)" aria-hidden="true" />
          ) : (
            <Info size={15} strokeWidth={1.75} aria-hidden="true" />
          )}
          <span>{line.text}</span>
        </li>
      ))}
    </ul>
  );
}

function LinkedControls({
  risk,
  isOwner,
  links,
  loading,
  byId,
  controls,
}: {
  risk: Risk;
  isOwner: boolean;
  links: RiskLink[] | undefined;
  loading: boolean;
  byId: Map<string, Control>;
  controls: Control[] | undefined;
}) {
  const link = useLinkControl(risk.id);
  const unlink = useUnlinkControl(risk.id);
  const [choice, setChoice] = useState('');
  const [justLinked, setJustLinked] = useState<Control | null>(null);
  const linkedIds = new Set(links?.map((l) => l.controlId));
  const available = (controls ?? []).filter((c) => !linkedIds.has(c.id));
  const canChange = isOwner && risk.status !== 'CLOSED';

  return (
    <section className="sheet" aria-labelledby="controls-title">
      <div className="sheet__head">
        <div className="sheet__title">
          <h2 id="controls-title">Controls protecting this risk</h2>
          <span className="sheet__sub">Only controls that have been tested count towards the score.</span>
        </div>
      </div>
      {canChange ? (
        <div className="toolbar">
          <label className="visually-hidden" htmlFor="link-control">
            Control to link
          </label>
          <select id="link-control" className="select" style={{ flex: '1 1 260px' }} value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">{available.length ? 'Choose a control to add…' : 'All controls are already linked'}</option>
            {available.map((control) => (
              <option key={control.id} value={control.id}>
                {control.name} ({CONTROL_TYPE_SHORT[control.type].toLowerCase()}, {control.latestResult ? RESULT_LABEL[control.latestResult].toLowerCase() : 'not tested yet'})
              </option>
            ))}
          </select>
          <Button
            variant="primary"
            disabled={!choice}
            busy={link.isPending}
            onClick={() =>
              link.mutate(choice, {
                onSuccess: () => {
                  setJustLinked(controls?.find((c) => c.id === choice) ?? null);
                  setChoice('');
                },
              })
            }
          >
            <Link2 size={14} strokeWidth={1.75} aria-hidden="true" />
            Link control
          </Button>
        </div>
      ) : null}
      {justLinked || link.error || unlink.error ? (
        <div className="sheet__body" style={{ paddingBottom: 0 }}>
          {link.error || unlink.error ? (
            <ErrorNotice error={link.error ?? unlink.error} />
          ) : justLinked && !justLinked.latestResult ? (
            <Notice title={`“${justLinked.name}” is linked`}>It won't lower the score until a tester records a result for it.</Notice>
          ) : justLinked ? (
            <Notice tone="success" title={`“${justLinked.name}” is linked`}>Its latest test result now counts towards the score above.</Notice>
          ) : null}
        </div>
      ) : null}
      {justLinked || link.error || unlink.error ? <div style={{ height: 'var(--s-4)' }} /> : null}
      <div className="table-wrap">
        <table className="ledger">
          <thead>
            <tr>
              <th scope="col">Control</th>
              <th scope="col">Last test</th>
              <th scope="col" className="n">
                Counts as
              </th>
              <th scope="col" className="n hide-sm">
                Tested
              </th>
              {canChange ? (
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          {loading ? (
            <SkeletonRows rows={2} columns={canChange ? 5 : 4} />
          ) : (
            <tbody>
              {links?.map((entry) => (
                <LinkRow
                  key={entry.controlId}
                  link={entry}
                  control={byId.get(entry.controlId)}
                  onUnlink={canChange ? () => unlink.mutate(entry.controlId) : undefined}
                  busy={unlink.isPending && unlink.variables === entry.controlId}
                />
              ))}
            </tbody>
          )}
        </table>
        {links?.length === 0 ? (
          <Empty title="No controls yet">
            {canChange ? 'Choose a control above. Once it has been tested, it will lower the score.' : 'Until controls are linked and tested, the risk stays at its starting score.'}
          </Empty>
        ) : null}
      </div>
    </section>
  );
}

function LinkRow({ link, control, onUnlink, busy }: { link: RiskLink; control: Control | undefined; onUnlink?: () => void; busy: boolean }) {
  return (
    <tr>
      <td>
        <div className="primary-cell">
          <Link to={`/controls/${link.controlId}`}>{control?.name ?? 'Control'}</Link>
          <span className="sub">
            {CONTROL_TYPE_SHORT[link.controlType]}
            {control?.retestRequired ? ' · needs re-test' : ''}
          </span>
        </div>
      </td>
      <td>{control?.latestResult ? <ResultBadge result={control.latestResult} /> : <span className="badge badge--neutral">Not tested yet</span>}</td>
      <td className="n">
        {link.latestEffectiveness === null ? (
          <span className="muted">Nothing yet</span>
        ) : (
          <>
            <PostedNumber value={Math.round(link.latestEffectiveness * 100)} worse="down" />%
          </>
        )}
        <span className="visually-hidden">{percent(link.latestEffectiveness)}</span>
      </td>
      <td className="n hide-sm muted">{formatRelative(link.lastAssessedAt)}</td>
      {onUnlink ? (
        <td className="n">
          <Button variant="ghost" size="sm" busy={busy} onClick={onUnlink} aria-label={`Unlink ${control?.name ?? 'control'}`}>
            <Unlink size={14} strokeWidth={1.75} aria-hidden="true" />
            Unlink
          </Button>
        </td>
      ) : null}
    </tr>
  );
}

/** The risk's story, newest first, in sentences. */
function History({ riskId, byId }: { riskId: string; byId: Map<string, Control> }) {
  const history = useRiskHistory(riskId);
  const entries = history.data ?? [];
  const describe = (entry: HistoryEntry) => {
    const control = entry.causeControlId ? byId.get(entry.causeControlId) : undefined;
    const name = control ? `“${control.name}”` : 'A control';
    switch (entry.cause) {
      case 'CREATED':
        return 'Risk recorded';
      case 'EDITED':
        return 'Risk details changed';
      case 'LINKED':
        return `Linked ${control ? name : 'a control'}`;
      case 'UNLINKED':
        return `Removed ${control ? name : 'a control'}`;
      case 'ASSESSMENT':
        return `${name} was tested`;
    }
  };

  return (
    <section className="sheet" aria-labelledby="history-title">
      <div className="sheet__head">
        <div className="sheet__title">
          <h2 id="history-title">What changed the score</h2>
          <span className="sheet__sub">Every change, newest first. Records can't be edited.</span>
        </div>
      </div>
      {history.error ? (
        <div className="sheet__body">
          <ErrorNotice error={history.error} />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="ledger">
            <thead>
              <tr>
                <th scope="col">What happened</th>
                <th scope="col" className="n">
                  Score
                </th>
                <th scope="col">Rating</th>
              </tr>
            </thead>
            {history.isPending ? (
              <SkeletonRows rows={3} columns={3} />
            ) : (
              <tbody>
                {entries.map((entry, index) => {
                  const previous = entries[index + 1];
                  const moved = previous && previous.residualScore !== entry.residualScore;
                  const worse = moved && entry.residualScore > previous.residualScore;
                  return (
                    <tr key={`${entry.changedAt}-${index}`} title={entry.causeEventId ? `Event ${entry.causeEventId}` : undefined}>
                      <td>
                        <div className="primary-cell" style={{ minWidth: 0 }}>
                          <span>{describe(entry)}</span>
                          <span className="sub num">
                            {formatDateTime(entry.changedAt)}
                            {moved ? ` · score ${worse ? 'rose' : 'fell'}` : ''}
                          </span>
                        </div>
                      </td>
                      <td className="n">
                        {moved ? (
                          <>
                            <s className="muted" style={{ textDecorationColor: worse ? 'var(--red)' : 'var(--ink-2)' }}>
                              {previous.residualScore}
                            </s>{' '}
                          </>
                        ) : null}
                        <strong>{entry.residualScore}</strong>
                      </td>
                      <td>
                        <RatingBadge rating={entry.rating} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            )}
          </table>
        </div>
      )}
    </section>
  );
}
