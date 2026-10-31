import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import type { RiskInput } from '../api/queries';
import type { RiskCategory } from '../api/types';
import { Button, ErrorNotice, Field, Segmented } from '../components/ui';
import { CATEGORY_LABEL, IMPACT_WORD, LIKELIHOOD_WORD, ratingOf } from '../format';
import { RatingBadge } from '../components/ui';

const SCALE = [1, 2, 3, 4, 5].map((value) => ({ value, label: String(value) }));
const CATEGORIES = Object.entries(CATEGORY_LABEL) as [RiskCategory, string][];

/** Create or edit a risk. The inherent score previews as the owner picks likelihood and impact. */
export function RiskForm({
  initial,
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<RiskInput>;
  submitLabel: string;
  busy: boolean;
  error: unknown;
  onSubmit: (input: RiskInput) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [category, setCategory] = useState<RiskCategory>(initial?.category ?? 'OPERATIONAL');
  const [likelihood, setLikelihood] = useState<number | undefined>(initial?.likelihood);
  const [impact, setImpact] = useState<number | undefined>(initial?.impact);
  const fieldErrors = error instanceof ApiError ? error.fieldErrors : {};
  const inherent = likelihood && impact ? likelihood * impact : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!likelihood || !impact) return;
    onSubmit({ title: title.trim(), description: description.trim(), category, likelihood, impact });
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      {error && Object.keys(fieldErrors).length === 0 ? <ErrorNotice error={error} /> : null}
      <div className="form-row">
        <Field label="Title" htmlFor="risk-title" error={fieldErrors.title}>
          <input
            id="risk-title"
            className="input"
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            aria-invalid={Boolean(fieldErrors.title)}
            required
          />
        </Field>
        <Field label="Category" htmlFor="risk-category">
          <select id="risk-category" className="select" value={category} onChange={(event) => setCategory(event.target.value as RiskCategory)}>
            {CATEGORIES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="What could happen?" htmlFor="risk-description" hint="Describe the event and who or what it would hurt." error={fieldErrors.description}>
        <textarea
          id="risk-description"
          className="textarea"
          value={description}
          maxLength={5000}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <div className="form-row" style={{ alignItems: 'end' }}>
        <Field label="How likely is it?" hint={likelihood ? `${likelihood} = ${LIKELIHOOD_WORD[likelihood]}` : '1 = rare … 5 = almost certain'}>
          <Segmented label="How likely" value={likelihood} options={SCALE} onChange={setLikelihood} />
        </Field>
        <Field label="How bad would it be?" hint={impact ? `${impact} = ${IMPACT_WORD[impact]}` : '1 = minor … 5 = severe'}>
          <Segmented label="How bad" value={impact} options={SCALE} onChange={setImpact} />
        </Field>
        <div className="field" aria-live="polite">
          <span className="field__label">Starting score</span>
          {inherent ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 34 }}>
              <strong className="num" style={{ fontSize: 'var(--t-lg)' }}>
                {likelihood} × {impact} = {inherent}
              </strong>
              <RatingBadge rating={ratingOf(inherent)} />
            </span>
          ) : (
            <span className="field__hint" style={{ minHeight: 34, display: 'flex', alignItems: 'center' }}>
              Pick likelihood and impact
            </span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
        <Button type="submit" variant="primary" busy={busy} disabled={!title.trim() || !likelihood || !impact}>
          {submitLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
