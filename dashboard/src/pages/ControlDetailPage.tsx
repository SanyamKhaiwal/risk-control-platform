import { Pencil, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useAssessments, useControl, useRecordAssessment, useRisks, useUpdateControl, useVerifyChain } from '../api/queries';
import type { AssessmentResult, Control } from '../api/types';
import { useCurrentUser, useSession } from '../auth/session';
import { PostedNumber, useJustChanged } from '../components/Posted';
import { ResultBadge } from '../components/ResultBadge';
import { Button, Empty, ErrorNotice, Field, Notice, RatingBadge, Segmented, SkeletonRows } from '../components/ui';
import {
  CONTROL_TYPE_EFFECT,
  FREQUENCY_LABEL,
  RESULT_LABEL,
  formatDateTime,
  formatRelative,
  percent,
  shortRef,
} from '../format';
import { ControlForm } from './ControlForm';
import { RetestReason } from './ControlsPage';

export function ControlDetailPage() {
  const { id = '' } = useParams();
  const control = useControl(id);
  if (control.error) {
    return (
      <div className="page">
        <Crumbs title="Control" />
        <ErrorNotice error={control.error} />
      </div>
    );
  }
  if (!control.data) {
    return (
      <div className="page" aria-busy="true">
        <Crumbs title="Loading…" />
        <span className="skeleton" style={{ width: 320, height: 28 }} />
      </div>
    );
  }
  return <ControlDetail control={control.data} />;
}

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function Crumbs({ title }: { title: string }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <Link to="/controls">Controls</Link>
      <span aria-hidden="true">/</span>
      <span aria-current="page">{title}</span>
    </nav>
  );
}

function ControlDetail({ control }: { control: Control }) {
  const user = useCurrentUser();
  const { hasRole } = useSession();
  const isOwner = hasRole('CONTROL_OWNER') && control.owner === user.username;
  const [editing, setEditing] = useState(false);
  const update = useUpdateControl(control.id);

  return (
    <div className="page">
      <Crumbs title={control.name} />
      <div className="page-head">
        <div className="page-head__text">
          <h1>{control.name}</h1>
          <p className="page-head__meta">
            <span>{sentence(CONTROL_TYPE_EFFECT[control.type])}</span>
            <span aria-hidden="true">·</span>
            <span>Owned by {control.owner}</span>
            <span aria-hidden="true">·</span>
            <span>Tested {FREQUENCY_LABEL[control.frequency].toLowerCase()}</span>
          </p>
        </div>
        {isOwner && !editing ? (
          <div className="page-head__actions">
            <Button onClick={() => setEditing(true)}>
              <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
              Edit
            </Button>
          </div>
        ) : null}
      </div>

      {control.retestRequired ? (
        <Notice tone="error" title="This control needs a fresh test">
          <RetestReason control={control} />, and this control hasn't been tested recently. Recording a test result below clears this.
        </Notice>
      ) : null}

      {editing ? (
        <section className="sheet" aria-labelledby="edit-control-title">
          <div className="sheet__head">
            <h2 id="edit-control-title">Edit control</h2>
          </div>
          <div className="sheet__body">
            <ControlForm
              withType={false}
              initial={{ name: control.name, description: control.description ?? '', frequency: control.frequency }}
              submitLabel="Save changes"
              busy={update.isPending}
              error={update.error}
              onCancel={() => {
                setEditing(false);
                update.reset();
              }}
              onSubmit={(input) => update.mutate({ ...input, version: control.version }, { onSuccess: () => setEditing(false) })}
            />
          </div>
        </section>
      ) : null}

      <div className="grid-detail">
        <div className="stack">
          <AssessPanel control={control} />
          <AssessmentHistory controlId={control.id} />
        </div>
        <div className="stack">
          <section className="sheet" aria-labelledby="facts-title">
            <div className="sheet__head">
              <h2 id="facts-title">Latest test</h2>
            </div>
            <div className="sheet__body">
              <dl className="facts">
                <dt>Result</dt>
                <dd>{control.latestResult ? <ResultBadge result={control.latestResult} /> : 'Not tested yet'}</dd>
                <dt>Counts as</dt>
                <dd className="num">{percent(control.latestEffectiveness)}</dd>
                <dt>Tested</dt>
                <dd>{control.lastAssessedAt ? formatDateTime(control.lastAssessedAt) : 'Never'}</dd>
                <dt>Number of tests</dt>
                <dd className="num">{control.assessmentCount}</dd>
              </dl>
              {control.description ? (
                <p style={{ marginTop: 'var(--s-4)', color: 'var(--ink-2)', fontSize: 'var(--t-sm)' }}>{control.description}</p>
              ) : null}
            </div>
          </section>
          <LinkedRisks controlId={control.id} />
        </div>
      </div>
    </div>
  );
}

const RESULTS = (Object.keys(RESULT_LABEL) as AssessmentResult[]).map((value) => ({ value, label: RESULT_LABEL[value] }));
const EFFECT_HINT: Record<AssessmentResult, string> = {
  EFFECTIVE: 'It counts in full: the risks it protects come down as far as this control can take them.',
  PARTIALLY_EFFECTIVE: 'It counts as half: the risks it protects come down part of the way.',
  INEFFECTIVE: "It counts for nothing: the risks it protects go back up as if it weren't there.",
};

function AssessPanel({ control }: { control: Control }) {
  const user = useCurrentUser();
  const { hasRole } = useSession();
  const record = useRecordAssessment(control.id);
  const [result, setResult] = useState<AssessmentResult | undefined>();
  const [evidence, setEvidence] = useState('');
  const [comments, setComments] = useState('');
  const [recorded, setRecorded] = useState<number | null>(null);

  if (!hasRole('CONTROL_TESTER')) {
    return (
      <Notice title="Testers record results here">
        {control.owner === user.username
          ? 'You own this control. A tester checks whether it works, so owners never mark their own work.'
          : 'You can see every test result, but only a tester can record a new one.'}
      </Notice>
    );
  }
  if (control.owner === user.username) {
    return (
      <Notice title="You own this control, so someone else has to test it">
        Owners can't check their own work (this rule is called segregation of duties).
      </Notice>
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!result) return;
    record.mutate(
      { result, evidence: evidence.trim(), comments: comments.trim() },
      {
        onSuccess: (assessment) => {
          setRecorded(assessment.sequence);
          setResult(undefined);
          setEvidence('');
          setComments('');
        },
      },
    );
  }

  return (
    <section className="sheet" aria-labelledby="assess-title">
      <div className="sheet__head">
        <div className="sheet__title">
          <h2 id="assess-title">Record a test result</h2>
          <span className="sheet__sub">Recorded as {user.username}. Every risk this control protects updates within a second.</span>
        </div>
      </div>
      <div className="sheet__body">
        <form className="form" onSubmit={submit} noValidate>
          {record.error ? <ErrorNotice error={record.error} /> : null}
          {recorded !== null && !record.error ? (
            <Notice tone="success" title={`Test #${recorded} recorded`}>
              Watch the risks on the right: their scores update with this result.
            </Notice>
          ) : null}
          <Field label="Did the control work? (required)" hint={result ? EFFECT_HINT[result] : 'Pick what you saw when you tested it.'}>
            <Segmented label="Result" value={result} options={RESULTS} onChange={(value) => { setResult(value); setRecorded(null); }} />
          </Field>
          <Field label="What did you check, and what did you see?" htmlFor="evidence" hint="This is your evidence. It is kept permanently.">
            <textarea id="evidence" className="textarea" value={evidence} maxLength={5000} onChange={(e) => setEvidence(e.target.value)} />
          </Field>
          <Field label="Comments" htmlFor="comments">
            <input id="comments" className="input" value={comments} maxLength={5000} onChange={(e) => setComments(e.target.value)} />
          </Field>
          <div>
            <Button type="submit" variant="primary" busy={record.isPending} disabled={!result}>
              Record test result
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}

function LinkedRisks({ controlId }: { controlId: string }) {
  const risks = useRisks({ controlId, size: 50 }, { live: true });
  return (
    <section className="sheet" aria-labelledby="linked-risks-title">
      <div className="sheet__head">
        <div className="sheet__title">
          <h2 id="linked-risks-title">Risks this control protects</h2>
          <span className="sheet__sub">Their scores update automatically after each test.</span>
        </div>
      </div>
      {risks.error ? (
        <div className="sheet__body">
          <ErrorNotice error={risks.error} />
        </div>
      ) : risks.data?.content.length === 0 ? (
        <Empty title="Not protecting any risk yet">A risk owner can add it from a risk's page.</Empty>
      ) : (
        <table className="ledger">
          <tbody>
            {risks.data?.content.map((risk) => <LinkedRiskRow key={risk.id} id={risk.id} title={risk.title} score={risk.residualScore} rating={risk.rating} />)}
          </tbody>
        </table>
      )}
    </section>
  );
}

function LinkedRiskRow({ id, title, score, rating }: { id: string; title: string; score: number; rating: Parameters<typeof RatingBadge>[0]['rating'] }) {
  const posted = useJustChanged(score);
  return (
    <tr className={posted ? 'was-posted' : ''}>
      <td>
        <Link to={`/risks/${id}`} style={{ fontWeight: 500, textDecoration: 'none' }}>
          {title}
        </Link>
      </td>
      <td className="n">
        <strong>
          <PostedNumber value={score} />
        </strong>
      </td>
      <td style={{ width: 1 }}>
        <RatingBadge rating={rating} />
      </td>
    </tr>
  );
}

function AssessmentHistory({ controlId }: { controlId: string }) {
  const assessments = useAssessments(controlId);
  const verify = useVerifyChain(controlId);
  const items = assessments.data?.content ?? [];

  return (
    <section className="sheet" aria-labelledby="chain-title">
      <div className="sheet__head">
        <div className="sheet__title">
          <h2 id="chain-title">Test history</h2>
          <span className="sheet__sub">Every test is kept permanently. Nobody can edit or delete one.</span>
        </div>
        <Button size="sm" busy={verify.isPending} onClick={() => verify.mutate()} disabled={items.length === 0}>
          <ShieldCheck size={14} strokeWidth={1.75} aria-hidden="true" />
          Check records are intact
        </Button>
      </div>
      {verify.data || verify.error ? (
        <div className="sheet__body" style={{ paddingBottom: 0 }}>
          {verify.error ? (
            <ErrorNotice error={verify.error} />
          ) : verify.data?.valid ? (
            <Notice tone="success" title={`All ${verify.data.checked} test records are intact`}>
              Nothing has been edited or deleted since they were recorded. Each record carries a digital fingerprint of the one before it, so any change would show here.
            </Notice>
          ) : (
            <Notice tone="error" title="These records have been altered">
              {verify.data?.reason}
              {verify.data?.firstBrokenAssessmentId ? ` (at ${shortRef(verify.data.firstBrokenAssessmentId)})` : ''}. {verify.data?.checked} verified before the break.
            </Notice>
          )}
        </div>
      ) : null}
      {verify.data || verify.error ? <div style={{ height: 'var(--s-4)' }} /> : null}
      <div className="table-wrap">
        <table className="ledger">
          <thead>
            <tr>
              <th scope="col" className="n">
                #
              </th>
              <th scope="col">Result</th>
              <th scope="col" className="hide-sm">
                Tested by
              </th>
              <th scope="col">When</th>
            </tr>
          </thead>
          {assessments.isPending ? (
            <SkeletonRows rows={3} columns={4} />
          ) : (
            <tbody>
              {items.map((assessment) => (
                <tr key={assessment.id} title={`Fingerprint ${assessment.hash}`}>
                  <td className="n muted">{assessment.sequence}</td>
                  <td>
                    <div className="primary-cell" style={{ minWidth: 0 }}>
                      <span>
                        <ResultBadge result={assessment.result} />
                      </span>
                      {assessment.evidence ? <span className="sub">{assessment.evidence}</span> : null}
                    </div>
                  </td>
                  <td className="hide-sm">{assessment.tester}</td>
                  <td className="num muted" style={{ whiteSpace: 'nowrap' }} title={formatDateTime(assessment.assessedAt)}>
                    {formatRelative(assessment.assessedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
        {!assessments.isPending && items.length === 0 ? (
          <Empty title="Not tested yet">Until a tester records a result, this control doesn't lower any risk.</Empty>
        ) : null}
      </div>
    </section>
  );
}
