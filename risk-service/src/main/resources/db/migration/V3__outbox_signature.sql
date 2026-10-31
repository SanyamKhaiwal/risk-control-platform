-- Event signing (docs/security-review.md SEC-07): the payload is signed when written, so it must be stored
-- byte for byte (jsonb would reorder keys and break the signature), and the signature is stored with it.
alter table outbox alter column payload type text using payload::text;
alter table outbox add column signature text;
