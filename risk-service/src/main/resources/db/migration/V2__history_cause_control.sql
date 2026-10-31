-- Which control caused a score change (link, unlink or test), so the history can name it.
alter table risk_score_history add column cause_control_id uuid;
