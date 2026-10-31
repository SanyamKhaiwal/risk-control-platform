import type { Rating } from '../api/types';
import { RATING_LABEL, RATING_RANGE, ratingOf } from '../format';
import { PostedNumber, useJustChanged } from './Posted';

export interface Cell {
  likelihood: number;
  impact: number;
}

const SCALE = [1, 2, 3, 4, 5];
const RATINGS: Rating[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/**
 * A 5×5 likelihood × impact matrix. `grid[likelihood - 1][impact - 1]` is the number of risks in
 * that cell; likelihood 5 is drawn at the top, as risk committees read it.
 */
export function RiskMatrix({
  label,
  grid,
  selected,
  onSelect,
}: {
  label: string;
  grid: number[][];
  selected?: Cell | null;
  onSelect?: (cell: Cell | null) => void;
}) {
  return (
    <figure className="matrix" aria-label={label} style={{ margin: 0 }}>
      <div className="matrix__y-title" aria-hidden="true">
        How likely
      </div>
      <div className="matrix__grid">
        {[...SCALE].reverse().map((likelihood) => (
          <MatrixRow
            key={likelihood}
            likelihood={likelihood}
            counts={grid[likelihood - 1] ?? [0, 0, 0, 0, 0]}
            selected={selected}
            onSelect={onSelect}
          />
        ))}
        <span />
        {SCALE.map((impact) => (
          <span key={impact} className="matrix__axis" aria-hidden="true">
            {impact}
          </span>
        ))}
      </div>
      <span />
      <div className="matrix__x-title" aria-hidden="true">
        How bad
      </div>
    </figure>
  );
}

function MatrixRow({
  likelihood,
  counts,
  selected,
  onSelect,
}: {
  likelihood: number;
  counts: number[];
  selected?: Cell | null;
  onSelect?: (cell: Cell | null) => void;
}) {
  return (
    <>
      <span className="matrix__axis" aria-hidden="true">
        {likelihood}
      </span>
      {SCALE.map((impact) => (
        <MatrixCell
          key={impact}
          likelihood={likelihood}
          impact={impact}
          count={counts[impact - 1] ?? 0}
          isSelected={selected?.likelihood === likelihood && selected?.impact === impact}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

function MatrixCell({
  likelihood,
  impact,
  count,
  isSelected,
  onSelect,
}: {
  likelihood: number;
  impact: number;
  count: number;
  isSelected: boolean;
  onSelect?: (cell: Cell | null) => void;
}) {
  const score = likelihood * impact;
  const rating = ratingOf(score);
  const changed = useJustChanged(count);
  const interactive = Boolean(onSelect) && (count > 0 || isSelected);
  const description = `Likelihood ${likelihood}, impact ${impact}, score ${score} ${RATING_LABEL[rating].toLowerCase()}: ${
    count === 1 ? '1 risk' : `${count} risks`
  }`;

  const className = [
    'cell',
    `cell--${rating}`,
    count === 0 ? 'is-empty' : '',
    interactive ? 'is-interactive' : '',
    isSelected ? 'is-selected' : '',
    changed ? 'was-posted' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      <span className="cell__score" aria-hidden="true">
        {score}
      </span>
      {count > 0 || changed ? (
        // More risks in a High or Critical cell is adverse; elsewhere a count change is neutral.
        <PostedNumber value={count} className="cell__count" worse={rating === 'HIGH' || rating === 'CRITICAL' ? 'up' : 'neither'} />
      ) : null}
    </>
  );

  if (!interactive) {
    return (
      <div className={className} role="img" aria-label={description}>
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={className}
      aria-label={description}
      aria-pressed={isSelected}
      onClick={() => onSelect?.(isSelected ? null : { likelihood, impact })}
    >
      {content}
    </button>
  );
}

export function RatingLegend() {
  return (
    <ul className="legend" aria-label="Rating bands">
      {RATINGS.map((rating) => (
        <li key={rating}>
          <span className={`legend__swatch legend__swatch--${rating}`} aria-hidden="true" />
          {RATING_LABEL[rating]} <span className="num">{RATING_RANGE[rating]}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * One risk's journey on the matrix: a ring at its inherent position, a filled mark at its residual
 * position, and the line controls moved it along.
 */
export function MiniMatrix({
  inherent,
  residual,
  size = 152,
}: {
  inherent: Cell;
  residual: Cell;
  size?: number;
}) {
  const gap = 3;
  const cell = (size - gap * 4) / 5;
  const centre = ({ likelihood, impact }: Cell) => ({
    x: (impact - 1) * (cell + gap) + cell / 2,
    y: (5 - likelihood) * (cell + gap) + cell / 2,
  });
  const from = centre(inherent);
  const to = centre(residual);
  const moved = from.x !== to.x || from.y !== to.y;
  const tints: Record<Rating, string> = {
    LOW: 'var(--low-bg)',
    MEDIUM: 'var(--medium-bg)',
    HIGH: 'var(--high-bg)',
    CRITICAL: 'var(--critical-bg)',
  };

  return (
    <svg
      className="mini-matrix"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Inherent position likelihood ${inherent.likelihood}, impact ${inherent.impact}; residual position likelihood ${residual.likelihood}, impact ${residual.impact}`}
    >
      {SCALE.map((likelihood) =>
        SCALE.map((impact) => (
          <rect
            key={`${likelihood}-${impact}`}
            x={(impact - 1) * (cell + gap)}
            y={(5 - likelihood) * (cell + gap)}
            width={cell}
            height={cell}
            rx={3}
            fill={tints[ratingOf(likelihood * impact)]}
          />
        )),
      )}
      {moved ? (
        <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="var(--ink)" strokeWidth={1.5} strokeDasharray="3 3" />
      ) : null}
      <circle cx={from.x} cy={from.y} r={cell * 0.26} fill="var(--sheet)" stroke="var(--ink)" strokeWidth={1.5} />
      <circle cx={to.x} cy={to.y} r={cell * 0.2} fill="var(--ink)" />
    </svg>
  );
}
