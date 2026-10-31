import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useSession } from '../auth/session';
import { Mark } from '../components/AppShell';
import { FlowDiagram, highlightFor, Walkthrough } from '../components/flow/Walkthrough';
import { EDGE_NODES, PIECES, PROMISES, type NodeId } from '../components/flow/flowData';

type Tab = 'walkthrough' | 'pieces' | 'promises';
const TABS: { id: Tab; label: string }[] = [
  { id: 'walkthrough', label: 'Walkthrough' },
  { id: 'pieces', label: 'The eight pieces' },
  { id: 'promises', label: 'Three promises' },
];

/** Public page (no sign-in): an animated, step-by-step explanation of the whole platform. */
export function HowItWorksPage() {
  const { session } = useSession();
  const [tab, setTab] = useState<Tab>('walkthrough');

  useEffect(() => {
    document.title = 'How it works · Risk & Control';
    return () => {
      document.title = 'Risk & Control';
    };
  }, []);

  return (
    <div className="how-page">
      <header className="how-bar">
        <Link to={session ? '/' : '/login'} className="wordmark">
          <Mark />
          <span className="wordmark__text">Risk &amp; Control</span>
        </Link>
        <h1 className="how-bar__title">How it works</h1>
        <div className="how-tabs" role="tablist" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <Link to={session ? '/' : '/login'} className="btn btn--sm how-bar__back">
          <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
          {session ? 'Back to the app' : 'Sign in'}
        </Link>
      </header>

      <main className="how-main">
        <div role="tabpanel" id="panel-walkthrough" aria-labelledby="tab-walkthrough" hidden={tab !== 'walkthrough'} className="how-panel">
          {tab === 'walkthrough' ? <Walkthrough /> : null}
        </div>
        <div role="tabpanel" id="panel-pieces" aria-labelledby="tab-pieces" hidden={tab !== 'pieces'} className="how-panel">
          {tab === 'pieces' ? <PiecesView /> : null}
        </div>
        <div role="tabpanel" id="panel-promises" aria-labelledby="tab-promises" hidden={tab !== 'promises'} className="how-panel">
          <div className="how-promises">
            {PROMISES.map((p) => (
              <section key={p.title} className="how-promise">
                <h2>{p.title}</h2>
                <p>{p.text}</p>
              </section>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

/** Pick a piece: it lights up with everything it talks to, and its card explains it. */
function PiecesView() {
  const [selected, setSelected] = useState<NodeId>('gateway');
  const piece = PIECES.find((p) => p.node === selected) ?? PIECES[0];
  // Light the piece and every line that touches it.
  const highlight = highlightFor({ path: [], nodes: [selected] });
  Object.entries(EDGE_NODES).forEach(([id, ends]) => {
    if (ends.includes(selected)) highlight.edges.add(id);
  });

  return (
    <div className="pieces">
      <div className="pieces__list" role="listbox" aria-label="Pieces">
        {PIECES.map((p) => (
          <button key={p.node} type="button" role="option" aria-selected={p.node === selected} onClick={() => setSelected(p.node)}>
            <span className="pieces__kind">{p.kind}</span>
            <strong>{p.name}</strong>
          </button>
        ))}
      </div>
      <figure className="pieces__diagram">
        <FlowDiagram highlight={highlight} />
      </figure>
      <article className="pieces__card" aria-live="polite">
        <div className="pieces__top">
          <span className="pieces__kind">{piece.kind}</span>
          <span className="pieces__port">{piece.port}</span>
        </div>
        <h2>{piece.name}</h2>
        <p className="pieces__tech">{piece.tech}</p>
        <dl>
          <div>
            <dt>What it does here</dt>
            <dd>{piece.does}</dd>
          </div>
          <div>
            <dt>Why this one</dt>
            <dd>{piece.why}</dd>
          </div>
          <div>
            <dt>If it stops</dt>
            <dd>{piece.down}</dd>
          </div>
        </dl>
      </article>
    </div>
  );
}
