import { ArrowRight, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useControls, useRisks } from '../api/queries';
import { useCurrentUser, useSession } from '../auth/session';
import { RATING_LABEL } from '../format';
import { Button } from './ui';

const STEPS = [
  { title: 'Record a risk', text: 'A risk owner writes down what could go wrong and scores it: how likely × how bad.' },
  { title: 'Add controls', text: 'Controls are safeguards. The risk owner links the ones that protect the risk.' },
  { title: 'Test the controls', text: 'A tester checks each control really works and records the result.' },
  { title: 'The score updates', text: 'Working controls lower the risk at once. If one fails, it goes back up and other controls are flagged for re-testing.' },
];

const DISMISS_KEY = 'rcp.howItWorks.hidden';

function readHidden() {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/** A four-step explanation of the whole product, for first-time users. Can be hidden and shown again. */
export function HowItWorks() {
  const [hidden, setHidden] = useState(readHidden);

  function toggle(next: boolean) {
    setHidden(next);
    try {
      localStorage.setItem(DISMISS_KEY, next ? '1' : '0');
    } catch {
      // Not remembered; it simply shows again next time.
    }
  }

  if (hidden) {
    return (
      <button type="button" className="link-button" onClick={() => toggle(false)}>
        How does this work?
      </button>
    );
  }
  return (
    <section className="how" aria-labelledby="how-title">
      <div className="how__head">
        <h2 id="how-title">How it works</h2>
        <Button variant="ghost" size="sm" onClick={() => toggle(true)} aria-label="Hide how it works">
          <X size={14} strokeWidth={1.75} aria-hidden="true" />
          Hide
        </Button>
      </div>
      <ol className="how__steps">
        {STEPS.map((step) => (
          <li key={step.title}>
            <span className="how__title">{step.title}</span>
            <span className="how__text">{step.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

interface Task {
  text: string;
  to: string;
  action: string;
}

/** The few things this user should do next, worked out from their role and the live data. */
export function NextSteps() {
  const user = useCurrentUser();
  const { hasRole } = useSession();
  // Only the lists this person's tasks use: a viewer needs neither, a risk owner only their own risks.
  const ownsRisks = hasRole('RISK_OWNER');
  const usesControls = hasRole('CONTROL_TESTER') || hasRole('CONTROL_OWNER');
  const risks = useRisks({ owner: user.username, size: 100 }, { live: true, enabled: ownsRisks });
  const controls = useControls({ size: 100 }, { live: true, enabled: usesControls });
  if ((ownsRisks && !risks.data) || (usesControls && !controls.data)) return null;

  const tasks: Task[] = [];
  const allControls = controls.data?.content ?? [];

  if (hasRole('CONTROL_TESTER')) {
    for (const control of allControls.filter((c) => c.retestRequired && c.owner !== user.username)) {
      tasks.push({
        text: `“${control.name}” needs a fresh test: ${control.retestReason ?? 'a risk it protects got worse'}.`,
        to: `/controls/${control.id}`,
        action: 'Test it',
      });
    }
    const untested = allControls.filter((c) => !c.latestResult && !c.retestRequired && c.owner !== user.username);
    if (untested.length > 0) {
      tasks.push({
        text: `${untested.length} ${untested.length === 1 ? 'control has' : 'controls have'} never been tested, so ${untested.length === 1 ? "it doesn't" : "they don't"} lower any risk yet.`,
        to: `/controls/${untested[0].id}`,
        action: 'Test the first one',
      });
    }
  }

  if (hasRole('RISK_OWNER')) {
    const mine = (risks.data?.content ?? []).filter((r) => r.owner === user.username && r.status !== 'CLOSED');
    for (const risk of mine.filter((r) => r.rating === 'CRITICAL' || r.rating === 'HIGH').slice(0, 3)) {
      tasks.push({
        text: `Your risk “${risk.title}” is ${RATING_LABEL[risk.rating].toLowerCase()} (${risk.residualScore}). Check its controls are linked and tested.`,
        to: `/risks/${risk.id}`,
        action: 'Review',
      });
    }
    if (mine.length === 0) {
      tasks.push({ text: "You don't own any risks yet. Start by recording one.", to: '/register', action: 'Add a risk' });
    }
  }

  if (hasRole('CONTROL_OWNER')) {
    const mine = allControls.filter((c) => c.owner === user.username);
    const failing = mine.filter((c) => c.latestResult === 'INEFFECTIVE');
    const untested = mine.filter((c) => !c.latestResult);
    for (const control of failing.slice(0, 2)) {
      tasks.push({ text: `Your control “${control.name}” failed its last test. Fix it, then ask for a re-test.`, to: `/controls/${control.id}`, action: 'Open' });
    }
    if (untested.length > 0) {
      tasks.push({
        text: `${untested.length} of your controls ${untested.length === 1 ? 'is' : 'are'} waiting for a tester. Owners can't test their own controls.`,
        to: '/controls',
        action: 'See controls',
      });
    }
  }

  const readOnly = !hasRole('RISK_OWNER') && !hasRole('CONTROL_OWNER') && !hasRole('CONTROL_TESTER');

  return (
    <section className="sheet next" aria-labelledby="next-title">
      <div className="sheet__head">
        <div className="sheet__title">
          <h2 id="next-title">Your next steps</h2>
          <span className="sheet__sub">
            {readOnly
              ? 'You can view everything but not change it.'
              : tasks.length > 0
                ? 'Based on your role and what has changed.'
                : 'Nothing needs your attention right now.'}
          </span>
        </div>
      </div>
      {readOnly ? (
        <p className="next__empty">
          Start with the <strong>Risk now</strong> map below: squares towards the top right hold the most dangerous risks. Click a square to see them.
        </p>
      ) : tasks.length > 0 ? (
        <ul className="next__list">
          {tasks.slice(0, 5).map((task) => (
            <li key={task.text}>
              <span>{task.text}</span>
              <Link to={task.to} className="btn btn--sm">
                {task.action}
                <ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="next__empty">All caught up.</p>
      )}
    </section>
  );
}
