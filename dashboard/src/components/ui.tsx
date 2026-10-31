import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { ApiError } from '../api/client';
import type { Rating, RiskStatus } from '../api/types';
import { RATING_LABEL, STATUS_LABEL } from '../format';

export function RatingBadge({ rating, score }: { rating: Rating; score?: number }) {
  return (
    <span className={`badge badge--${rating}`}>
      {RATING_LABEL[rating]}
      {score !== undefined ? <span className="num">{score}</span> : null}
    </span>
  );
}

export function StatusBadge({ status }: { status: RiskStatus }) {
  return <span className={`badge ${status === 'CLOSED' ? 'badge--closed' : 'badge--neutral'}`}>{STATUS_LABEL[status]}</span>;
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'secondary',
  size,
  busy,
  children,
  className,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm'; busy?: boolean }) {
  const classes = ['btn', variant !== 'secondary' ? `btn--${variant}` : '', size === 'sm' ? 'btn--sm' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={classes} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'error' | 'success';
  title?: string;
  children?: ReactNode;
}) {
  const Icon = tone === 'error' ? AlertCircle : tone === 'success' ? CheckCircle2 : Info;
  return (
    <div className={`notice ${tone !== 'info' ? `notice--${tone}` : ''}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
      <div>
        {title ? <p className="notice__title">{title}</p> : null}
        {children ? <div>{children}</div> : null}
      </div>
    </div>
  );
}

/** Shows an API problem (title + detail) or any other failure. */
export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  if (error instanceof ApiError) {
    return (
      <Notice tone="error" title={error.title}>
        {error.message}
      </Notice>
    );
  }
  return <Notice tone="error" title="Something went wrong">Try again in a moment.</Notice>;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export function SkeletonRows({ rows = 5, columns }: { rows?: number; columns: number }) {
  return (
    <tbody aria-hidden="true">
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row}>
          {Array.from({ length: columns }, (_, column) => (
            <td key={column}>
              <span className="skeleton" style={{ width: column === 0 ? '70%' : '50%' }} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <span className="field__error" id={htmlFor ? `${htmlFor}-error` : undefined}>
          {error}
        </span>
      ) : hint ? (
        <span className="field__hint">{hint}</span>
      ) : null}
    </div>
  );
}

/** A single-choice button group (radio semantics). */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  id,
}: {
  label: string;
  value: T | undefined;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  id?: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label} id={id}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          tabIndex={value === option.value || (value === undefined && option === options[0]) ? 0 : -1}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            const index = options.indexOf(option);
            const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
            if (!step) return;
            event.preventDefault();
            const next = options[(index + step + options.length) % options.length];
            onChange(next.value);
            const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button');
            buttons?.[options.indexOf(next)]?.focus();
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Pager({
  page,
  totalPages,
  totalElements,
  onPage,
  noun,
}: {
  page: number;
  totalPages: number;
  totalElements: number;
  onPage: (page: number) => void;
  noun: string;
}) {
  return (
    <div className="pager">
      <span className="num">
        {totalElements} {totalElements === 1 ? noun : `${noun}s`}
        {totalPages > 1 ? ` · page ${page + 1} of ${totalPages}` : ''}
      </span>
      {totalPages > 1 ? (
        <div className="pager__buttons">
          <Button size="sm" disabled={page === 0} onClick={() => onPage(page - 1)}>
            Previous
          </Button>
          <Button size="sm" disabled={page + 1 >= totalPages} onClick={() => onPage(page + 1)}>
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
