import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ACTORS, EDGE_NODES, SCENARIOS, type ActorId, type FlowStep, type NodeId, type Rating } from './flowData';

const parseHop = (entry: string) => (entry.startsWith('-') ? { id: entry.slice(1), reverse: true } : { id: entry, reverse: false });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_STEPS = Math.max(...SCENARIOS.map((s) => s.steps.length));
/** Long enough to read the caption: about 230 words a minute, never under 3.5 s. */
const readingTime = (step: FlowStep) => Math.max(3500, step.text.split(/\s+/).length * 260);
const RATING_WORD: Record<Rating, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', CRITICAL: 'Critical' };

function prefersReducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : true;
}

export interface Highlight {
  nodes: Set<NodeId>;
  edges: Set<string>;
  down: Set<NodeId>;
  off: Set<NodeId>;
  healthy: Set<NodeId>;
  frame: boolean;
}

export function highlightFor(step: Pick<FlowStep, 'path' | 'nodes' | 'down' | 'off' | 'healthy' | 'frame'>): Highlight {
  const nodes = new Set<NodeId>(step.nodes ?? []);
  const edges = new Set<string>();
  for (const entry of step.path) {
    const { id } = parseHop(entry);
    edges.add(id);
    EDGE_NODES[id].forEach((n) => nodes.add(n));
  }
  const down = new Set<NodeId>(step.down ?? []);
  const off = new Set<NodeId>(step.off ?? []);
  down.forEach((n) => nodes.delete(n));
  off.forEach((n) => nodes.delete(n));
  return { nodes, edges, down, off, healthy: new Set(step.healthy ?? []), frame: step.frame ?? false };
}

/** The small tag in a box's top-right corner, if any. */
const statusOf = (h: Highlight, id: NodeId) =>
  h.down.has(id) ? 'STOPPED' : h.off.has(id) ? 'WAITING' : h.healthy.has(id) ? 'HEALTHY' : null;

function Avatar({ actor }: { actor: ActorId }) {
  const a = ACTORS[actor];
  return (
    <span className={`walk-avatar walk-avatar--${actor}`} aria-hidden="true">
      {a.person ? a.name.charAt(0) : '⟳'}
    </span>
  );
}

/**
 * The platform diagram. Shared by the walkthrough and the pieces view; `highlight` decides what is lit.
 */
export function FlowDiagram({
  highlight,
  actor,
  score,
  hit,
  svgRef,
  packetRef,
}: {
  highlight: Highlight;
  actor?: ActorId;
  score?: FlowStep['score'];
  hit?: { node: NodeId; n: number } | null;
  svgRef?: React.Ref<SVGSVGElement>;
  packetRef?: React.Ref<SVGCircleElement>;
}) {
  const nodeClass = (id: NodeId, data: boolean) =>
    [
      'flow-node',
      data ? 'is-data' : '',
      highlight.nodes.has(id) ? 'is-active' : '',
      highlight.down.has(id) ? 'is-down' : '',
      highlight.off.has(id) ? 'is-off' : '',
      highlight.healthy.has(id) && !highlight.down.has(id) ? 'is-healthy' : '',
      hit?.node === id ? `is-hit-${hit.n % 2}` : '',
    ]
      .filter(Boolean)
      .join(' ');

  const edge = (id: string, d: string, dashed = false) => {
    const active = highlight.edges.has(id);
    return (
      <path
        key={id}
        id={`flow-e-${id}`}
        className={`flow-edge ${active ? 'is-active' : ''} ${dashed ? 'is-dashed' : ''}`}
        d={d}
        markerEnd={active ? 'url(#flow-arrow-active)' : 'url(#flow-arrow)'}
      />
    );
  };

  const label = (edgeId: string, x: number, y: number, text: string, anchor: 'start' | 'middle' = 'middle') => (
    <text key={`l-${edgeId}`} className={`flow-label ${highlight.edges.has(edgeId) ? 'is-active' : ''}`} x={x} y={y} textAnchor={anchor}>
      {text}
    </text>
  );

  const node = (id: NodeId, x: number, y: number, w: number, h: number, kind: string, title: string, lines: string[], data = false, mono = false) => (
    <g key={id} className={nodeClass(id, data)}>
      <rect x={x} y={y} width={w} height={h} rx={6} />
      <text className="flow-kind" x={x + 14} y={y + 23}>
        {kind}
      </text>
      {statusOf(highlight, id) ? (
        <text className="flow-status" x={x + w - 14} y={y + 23} textAnchor="end">
          {statusOf(highlight, id)}
        </text>
      ) : null}
      <text className="flow-title" x={x + 14} y={y + 47}>
        {title}
      </text>
      {lines.map((line, i) => (
        <text key={i} className={mono ? 'flow-topic' : 'flow-sub'} x={x + 14} y={y + 67 + i * 17}>
          {line}
        </text>
      ))}
    </g>
  );

  const person = actor && ACTORS[actor].person ? ACTORS[actor] : null;

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 1000 510"
      role="img"
      aria-label="The dashboard talks to the Gateway, which routes to the Risk Service and the Control Service. Each service owns a database: PostgreSQL and MongoDB. The services exchange messages through Kafka; the Gateway and Risk Service use Redis."
    >
      <defs>
        <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path className="flow-arrowhead" d="M0,0 L10,5 L0,10 z" />
        </marker>
        <marker id="flow-arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path className="flow-arrowhead is-active" d="M0,0 L10,5 L0,10 z" />
        </marker>
      </defs>

      {/* Every box is a container; Docker Compose runs all eight. */}
      <g className={`flow-frame ${highlight.frame ? 'is-active' : ''}`}>
        <rect x={6} y={4} width={988} height={502} rx={10} />
        <text x={20} y={498}>
          DOCKER COMPOSE · 8 CONTAINERS, EACH WITH A HEALTH CHECK
        </text>
      </g>

      {edge('browser-gateway', 'M160 265 L240 265')}
      {edge('gateway-redis', 'M315 215 L315 120')}
      {edge('gateway-risk', 'M390 245 C432 245 428 105 470 105')}
      {edge('gateway-control', 'M390 285 C432 285 428 435 470 435')}
      {edge('risk-redis', 'M470 80 L390 80')}
      {edge('risk-postgres', 'M650 105 L780 105')}
      {edge('control-mongo', 'M650 435 L780 435')}
      {edge('control-kafka', 'M535 385 L535 310')}
      {edge('kafka-risk', 'M535 220 L535 155')}
      {edge('risk-kafka', 'M585 155 L585 220')}
      {edge('kafka-control', 'M585 310 L585 385')}
      {edge('risk-control', 'M650 140 C720 140 720 400 650 400', true)}

      {label('browser-gateway', 200, 256, 'HTTPS')}
      {label('gateway-redis', 323, 172, 'rate limits', 'start')}
      {label('gateway-risk', 430, 178, 'risks')}
      {label('gateway-control', 430, 362, 'controls')}
      {label('risk-redis', 430, 72, 'cache')}
      {label('risk-postgres', 715, 97, 'SQL')}
      {label('control-mongo', 715, 427, 'documents')}
      {label('risk-control', 712, 274, 'check control', 'start')}

      {node('browser', 20, 215, 140, 100, 'BROWSER', 'Dashboard', ['React · port 5173', person ? `${person.name} is using it` : 'what people use'])}
      {node('gateway', 240, 215, 150, 100, 'FRONT DOOR', 'Gateway', ['port 8080', 'sign-in · checks · limits'])}
      {node('redis', 240, 30, 150, 90, 'CACHE', 'Redis', ['port 6379'], true)}
      {node('risk', 470, 55, 180, 100, 'SERVICE', 'Risk Service', ['Java · port 8081', 'scores · history · links'])}
      {node('kafka', 470, 220, 180, 90, 'MESSAGE BUS', 'Kafka · port 9092', ['↑ control.assessed', '↓ risk.updated'], true, true)}
      {node('control', 470, 385, 180, 100, 'SERVICE', 'Control Service', ['Java · port 8082', 'controls · tests · flags'])}
      {node('postgres', 780, 55, 200, 100, 'DATABASE', 'PostgreSQL', ['port 5432', 'risks · history · outbox'], true)}
      {node('mongo', 780, 385, 200, 100, 'DATABASE', 'MongoDB', ['port 27017', 'controls · tests · outbox'], true)}

      {actor ? (
        <g key={actor} className={`flow-actor flow-actor--${actor}`}>
          {ACTORS[actor].person ? <path className="flow-actor__line" d="M90 192 L90 215" /> : null}
          <rect x={20} y={140} width={140} height={52} rx={26} />
          <circle cx={46} cy={166} r={15} />
          <text className="flow-actor__initial" x={46} y={171} textAnchor="middle">
            {ACTORS[actor].person ? ACTORS[actor].name.charAt(0) : '⟳'}
          </text>
          <text className="flow-actor__name" x={70} y={162}>
            {ACTORS[actor].name}
          </text>
          <text className="flow-actor__role" x={70} y={179}>
            {ACTORS[actor].person ? ACTORS[actor].role : 'no one clicks'}
          </text>
        </g>
      ) : null}

      {score ? (
        <g className={`flow-score flow-score--${score.rating}`} aria-label={`Example risk score ${score.now}, ${RATING_WORD[score.rating]}`}>
          <rect x={780} y={8} width={200} height={38} rx={19} />
          <text x={796} y={32} className="flow-score__label">
            Risk score
          </text>
          <text x={964} y={32} textAnchor="end" className="flow-score__value">
            {score.was !== undefined ? (
              <tspan className="flow-score__was" textDecoration="line-through">
                {score.was}
              </tspan>
            ) : null}
            {score.was !== undefined ? ' ' : ''}
            <tspan>{score.now}</tspan>
            <tspan className="flow-score__word"> {RATING_WORD[score.rating]}</tspan>
          </text>
        </g>
      ) : null}

      <circle ref={packetRef} className="flow-packet" r={7} cx={-50} cy={-50} />
    </svg>
  );
}

/**
 * An animated walk through the platform. The diagram explains each step itself: who acts, what moves,
 * what the score is now. Arrow keys step through; it starts playing on open.
 */
export function Walkthrough() {
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [runId, setRunId] = useState(1);
  const [hit, setHit] = useState<{ node: NodeId; n: number } | null>(null);
  const playingRef = useRef(true);
  const tokenRef = useRef(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const packetRef = useRef<SVGCircleElement>(null);
  const reduceMotion = useMemo(prefersReducedMotion, []);

  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
  const step = scenario.steps[index];
  const last = scenario.steps.length - 1;
  const highlight = highlightFor(step);

  const setPlay = useCallback((value: boolean) => {
    playingRef.current = value;
    setPlaying(value);
  }, []);

  const go = useCallback(
    (nextScenario: string, nextIndex: number, play: boolean) => {
      setScenarioId(nextScenario);
      setIndex(nextIndex);
      setPlay(play);
      setRunId((r) => r + 1);
    },
    [setPlay],
  );

  const togglePlay = useCallback(() => {
    if (playingRef.current) {
      setPlay(false);
      return;
    }
    go(scenario.id, index === last ? 0 : index, true);
  }, [go, index, last, scenario.id, setPlay]);

  // Arrow keys step through, space plays and pauses (unless typing somewhere).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key === 'ArrowRight' && index < last) go(scenario.id, index + 1, false);
      else if (event.key === 'ArrowLeft' && index > 0) go(scenario.id, index - 1, false);
      else if (event.key === ' ' && target?.tagName !== 'BUTTON') {
        event.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, index, last, scenario.id, togglePlay]);

  // Animate the current step's hops, wait long enough to read it, then advance if playing.
  useEffect(() => {
    const token = ++tokenRef.current;
    const packet = packetRef.current;
    const svg = svgRef.current;
    const hidePacket = () => {
      packet?.setAttribute('cx', '-50');
      packet?.setAttribute('cy', '-50');
    };

    const hop = (entry: string) =>
      new Promise<boolean>((resolve) => {
        const { id, reverse } = parseHop(entry);
        const path = svg?.querySelector<SVGPathElement>(`#flow-e-${id}`);
        if (!path || !packet || typeof path.getTotalLength !== 'function') return resolve(true);
        const total = path.getTotalLength();
        const duration = Math.max(520, Math.min(1100, total * 4));
        const start = performance.now();
        const frame = (now: number) => {
          if (token !== tokenRef.current) return resolve(false);
          const t = Math.min(1, (now - start) / duration);
          const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          const point = path.getPointAtLength((reverse ? 1 - eased : eased) * total);
          packet.setAttribute('cx', String(point.x));
          packet.setAttribute('cy', String(point.y));
          if (t < 1) {
            requestAnimationFrame(frame);
            return;
          }
          setHit((h) => ({ node: EDGE_NODES[id][reverse ? 0 : 1], n: (h?.n ?? 0) + 1 }));
          resolve(true);
        };
        requestAnimationFrame(frame);
      });

    (async () => {
      const started = performance.now();
      if (!reduceMotion) {
        for (const entry of step.path) {
          if (!(await hop(entry))) return;
        }
      }
      hidePacket();
      if (!playingRef.current) return;
      await sleep(Math.max(1200, readingTime(step) - (performance.now() - started)));
      if (token !== tokenRef.current || !playingRef.current) return;
      if (index < last) {
        setIndex(index + 1);
        setRunId((r) => r + 1);
      } else {
        setPlay(false);
      }
    })();

    return () => {
      tokenRef.current++;
      hidePacket();
    };
    // runId drives every run; the other values are read for that run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  return (
    <div className="walk">
      <section className="walk__stage" aria-label="Walkthrough">
        <figure className="walk__diagram">
          <FlowDiagram highlight={highlight} actor={step.actor} score={step.score} hit={hit} svgRef={svgRef} packetRef={packetRef} />
        </figure>

        {/* Every caption shares one grid cell, so the strip never changes height. */}
        <div className="walk__caption flow-stack">
          {SCENARIOS.flatMap((s) =>
            s.steps.map((st, i) => {
              const current = s.id === scenario.id && i === index;
              const actor = ACTORS[st.actor];
              return (
                <div key={`${s.id}-${i}`} className={current ? 'is-current' : undefined} aria-hidden={!current}>
                  <div className="walk__who">
                    <Avatar actor={st.actor} />
                    <span>
                      <strong>{actor.name}</strong> · {actor.role}
                    </span>
                    <span className="walk__stepno">
                      Step {i + 1} of {s.steps.length}
                    </span>
                  </div>
                  <h3>{st.title}</h3>
                  <p>{st.text}</p>
                </div>
              );
            }),
          )}
        </div>
        <p className="visually-hidden" aria-live="polite">
          Step {index + 1} of {scenario.steps.length}, {ACTORS[step.actor].name}: {step.title}. {step.text}
        </p>

        <div className="walk__controls">
          <button type="button" className="walk__btn" disabled={index === 0} onClick={() => go(scenario.id, index - 1, false)} aria-label="Previous step">
            <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" />
          </button>
          <button type="button" className="walk__btn walk__btn--play" onClick={togglePlay}>
            {playing ? <Pause size={16} strokeWidth={2} aria-hidden="true" /> : index === last ? <RotateCcw size={16} strokeWidth={2} aria-hidden="true" /> : <Play size={16} strokeWidth={2} aria-hidden="true" />}
            {playing ? 'Pause' : index === last ? 'Watch again' : 'Play'}
          </button>
          <button type="button" className="walk__btn" disabled={index === last} onClick={() => go(scenario.id, index + 1, false)} aria-label="Next step">
            <ChevronRight size={18} strokeWidth={2} aria-hidden="true" />
          </button>
          <ol className="walk__dots" aria-label="Steps">
            {scenario.steps.map((s, i) => (
              <li key={s.title}>
                <button
                  type="button"
                  aria-label={`Step ${i + 1}: ${s.title}`}
                  aria-current={i === index ? 'step' : undefined}
                  className={`walk__dot walk__dot--${s.actor} ${i < index ? 'is-done' : ''}`}
                  onClick={() => go(scenario.id, i, false)}
                />
              </li>
            ))}
          </ol>
          <span className="walk__keys">← → to step · space to play</span>
        </div>
      </section>

      <aside className="walk__panel" aria-label="Walkthroughs and steps">
        <section>
          <h3 className="walk__panel-title">Walkthroughs</h3>
          <div className="walk__scenarios">
            {SCENARIOS.map((s) => (
              <button key={s.id} type="button" aria-pressed={s.id === scenario.id} onClick={() => go(s.id, 0, true)}>
                <strong>{s.name}</strong>
                <span>{s.intro}</span>
              </button>
            ))}
          </div>
        </section>
        <section>
          <h3 className="walk__panel-title">Steps in “{scenario.name}”</h3>
          <ol className="walk__steps" style={{ minHeight: `${MAX_STEPS * 34}px` }}>
            {scenario.steps.map((s, i) => (
              <li key={s.title}>
                <button type="button" aria-current={i === index ? 'step' : undefined} className={i < index ? 'is-done' : undefined} onClick={() => go(scenario.id, i, false)}>
                  <Avatar actor={s.actor} />
                  <span>{s.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
        <section>
          <h3 className="walk__panel-title">Under the hood</h3>
          <p className="walk__tech">{step.tech ?? 'Nothing technical to add for this step.'}</p>
        </section>
      </aside>
    </div>
  );
}
