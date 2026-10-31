package com.riskcontrol.risk.outbox;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import org.springframework.data.domain.Persistable;

/** An event waiting to be published. Written in the same transaction as the change it describes. */
@Entity
@Table(name = "outbox")
public class OutboxMessage implements Persistable<UUID> {

    /** Same as the event's eventId. */
    @Id
    private UUID id;

    private String topic;

    private String msgKey;

    /** Stored as text, not jsonb, so the signed bytes come back unchanged. */
    private String payload;
    /** Ed25519 signature of the payload, made when the row was written (EventSignatures). */
    private String signature;
    /** W3C traceparent of the request that wrote it, so the trace continues across Kafka (OutboxTracing). */
    private String traceParent;

    private Instant createdAt;

    private Instant publishedAt;

    protected OutboxMessage() {
    }

    OutboxMessage(UUID id, String topic, String msgKey, String payload, String signature, String traceParent,
                  Instant createdAt) {
        this.id = id;
        this.topic = topic;
        this.msgKey = msgKey;
        this.payload = payload;
        this.signature = signature;
        this.traceParent = traceParent;
        this.createdAt = createdAt;
    }

    @Override
    public UUID getId() {
        return id;
    }

    /** Rows are only ever inserted through the entity; publishing marks them with an update query. */
    @Override
    public boolean isNew() {
        return true;
    }

    public String getTopic() {
        return topic;
    }

    public String getMsgKey() {
        return msgKey;
    }

    public String getPayload() {
        return payload;
    }

    public String getTraceParent() {
        return traceParent;
    }

    public String getSignature() {
        return signature;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getPublishedAt() {
        return publishedAt;
    }
}
