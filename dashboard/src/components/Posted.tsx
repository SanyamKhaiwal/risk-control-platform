import { useEffect, useRef, useState } from 'react';

const POSTED_MS = 2100;

/**
 * True for a moment after `value` changes (never on first render). Lets a row or cell mark that a
 * new figure was just posted.
 */
export function useJustChanged(value: unknown): boolean {
  const key = JSON.stringify(value);
  const previous = useRef(key);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    if (previous.current === key) return;
    previous.current = key;
    setChanged(true);
    const timer = window.setTimeout(() => setChanged(false), POSTED_MS);
    return () => window.clearTimeout(timer);
  }, [key]);

  return changed;
}

/** Which direction of change is adverse, so red ink marks only adverse movement. */
export type Worse = 'up' | 'down' | 'neither';

/**
 * A figure that is never overwritten silently: when it changes, the old value is struck through
 * (in red when the change is adverse, in ink otherwise) and the new one is posted beside it.
 */
export function PostedNumber({ value, className, worse = 'up' }: { value: number; className?: string; worse?: Worse }) {
  const previous = useRef(value);
  const [posting, setPosting] = useState<{ was: number; id: number } | null>(null);

  useEffect(() => {
    if (previous.current === value) return;
    const was = previous.current;
    previous.current = value;
    setPosting((current) => ({ was, id: (current?.id ?? 0) + 1 }));
    const timer = window.setTimeout(() => setPosting(null), POSTED_MS);
    return () => window.clearTimeout(timer);
  }, [value]);

  if (!posting) {
    return <span className={`num ${className ?? ''}`}>{value}</span>;
  }
  const adverse = (worse === 'up' && value > posting.was) || (worse === 'down' && value < posting.was);
  return (
    <span className={`posted ${adverse ? 'posted--adverse' : ''} ${className ?? ''}`} key={posting.id}>
      <s className="posted__was" aria-hidden="true">
        {posting.was}
      </s>
      <span className="posted__now">{value}</span>
      <span className="visually-hidden">(was {posting.was})</span>
    </span>
  );
}
