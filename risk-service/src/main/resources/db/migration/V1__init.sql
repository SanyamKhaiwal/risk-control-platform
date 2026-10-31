-- Risk Service schema (ARCHITECTURE.md §7.1). Enums are stored as text with CHECK constraints.

create table risk (
    id                  uuid primary key,
    title               varchar(200) not null,
    description         text,
    category            varchar(32)  not null check (category in ('OPERATIONAL', 'CYBER', 'FRAUD', 'COMPLIANCE', 'FINANCIAL', 'THIRD_PARTY')),
    owner               varchar(64)  not null,
    likelihood          int          not null check (likelihood between 1 and 5),
    impact              int          not null check (impact between 1 and 5),
    inherent_score      int          not null check (inherent_score between 1 and 25),
    residual_likelihood int          not null check (residual_likelihood between 1 and 5),
    residual_impact     int          not null check (residual_impact between 1 and 5),
    residual_score      int          not null check (residual_score between 1 and 25),
    rating              varchar(16)  not null check (rating in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    status              varchar(16)  not null check (status in ('OPEN', 'MITIGATED', 'ACCEPTED', 'CLOSED')),
    version             int          not null default 0,
    created_at          timestamptz  not null,
    updated_at          timestamptz  not null
);

create index idx_risk_status on risk (status);
create index idx_risk_rating on risk (rating);
create index idx_risk_owner on risk (owner);
create index idx_risk_residual_score on risk (residual_score desc);

-- The single source of truth for links, plus a local projection of each control's latest effectiveness.
create table risk_control_link (
    risk_id              uuid          not null references risk (id),
    control_id           uuid          not null,
    control_type         varchar(16)   not null check (control_type in ('PREVENTIVE', 'DETECTIVE', 'CORRECTIVE')),
    latest_effectiveness numeric(3, 2) check (latest_effectiveness between 0 and 1),
    last_assessed_at     timestamptz,
    linked_at            timestamptz   not null,
    primary key (risk_id, control_id)
);

create index idx_link_control on risk_control_link (control_id);

create table risk_score_history (
    id             uuid primary key,
    risk_id        uuid        not null references risk (id),
    inherent_score int         not null,
    residual_score int         not null,
    rating         varchar(16) not null,
    cause          varchar(16) not null check (cause in ('CREATED', 'EDITED', 'LINKED', 'UNLINKED', 'ASSESSMENT')),
    cause_event_id uuid,
    changed_at     timestamptz not null
);

create index idx_history_risk on risk_score_history (risk_id, changed_at desc);

-- Used from build step 5 (transactional outbox and idempotent consumers).
create table outbox (
    id           uuid primary key,
    topic        varchar(100) not null,
    msg_key      varchar(100) not null,
    payload      jsonb        not null,
    created_at   timestamptz  not null,
    published_at timestamptz
);

create index idx_outbox_unpublished on outbox (created_at) where published_at is null;

create table processed_event (
    event_id     uuid primary key,
    topic        varchar(100) not null,
    processed_at timestamptz  not null
);
