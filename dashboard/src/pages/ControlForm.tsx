import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import type { ControlInput } from '../api/queries';
import type { ControlFrequency, ControlType } from '../api/types';
import { Button, ErrorNotice, Field, Segmented } from '../components/ui';
import { CONTROL_TYPE_EFFECT, CONTROL_TYPE_SHORT, FREQUENCY_LABEL } from '../format';

const TYPES = (Object.keys(CONTROL_TYPE_SHORT) as ControlType[]).map((value) => ({ value, label: CONTROL_TYPE_SHORT[value] }));
const FREQUENCIES = Object.entries(FREQUENCY_LABEL) as [ControlFrequency, string][];

/** Create (with type) or edit (type is fixed once created) a control. */
export function ControlForm({
  initial,
  withType,
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<ControlInput>;
  withType: boolean;
  submitLabel: string;
  busy: boolean;
  error: unknown;
  onSubmit: (input: ControlInput & { type?: ControlType }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [frequency, setFrequency] = useState<ControlFrequency>(initial?.frequency ?? 'QUARTERLY');
  const [type, setType] = useState<ControlType | undefined>();
  const fieldErrors = error instanceof ApiError ? error.fieldErrors : {};

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit({ name: name.trim(), description: description.trim(), frequency, ...(withType ? { type } : {}) });
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      {error && Object.keys(fieldErrors).length === 0 ? <ErrorNotice error={error} /> : null}
      <div className="form-row">
        <Field label="Name" htmlFor="control-name" error={fieldErrors.name}>
          <input id="control-name" className="input" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="How often it is tested" htmlFor="control-frequency">
          <select id="control-frequency" className="select" value={frequency} onChange={(e) => setFrequency(e.target.value as ControlFrequency)}>
            {FREQUENCIES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {withType ? (
        <Field label="What does it do?" hint={type ? `It ${CONTROL_TYPE_EFFECT[type]}. This can't be changed later.` : 'Stopping a risk lowers how likely it is; spotting it or limiting damage lowers how bad it is.'}>
          <Segmented label="Type" value={type} options={TYPES} onChange={setType} />
        </Field>
      ) : null}
      <Field label="Description" htmlFor="control-description" hint="How it works, and what a tester should check.">
        <textarea id="control-description" className="textarea" value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
        <Button type="submit" variant="primary" busy={busy} disabled={!name.trim() || (withType && !type)}>
          {submitLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
