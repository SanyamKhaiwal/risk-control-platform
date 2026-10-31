-- Monitoring: the W3C traceparent of the request that wrote the event, so its trace continues across Kafka.
alter table outbox add column trace_parent varchar(64);
