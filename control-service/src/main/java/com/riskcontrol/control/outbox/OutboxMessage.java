package com.riskcontrol.control.outbox;

import java.time.Instant;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.mapping.Document;

/** An event waiting to be published. Written in the same transaction as the change it describes. */
@Document("outbox")
@CompoundIndex(name = "unpublished", def = "{'publishedAt': 1, 'createdAt': 1}")
public class OutboxMessage {

    /** Same as the event's eventId. */
    @Id
    private String id;

    private String topic;

    private String key;

    private String payload;
    /** Ed25519 signature of the payload, made when the document was written (EventSignatures). */
    private String signature;
    /** W3C traceparent of the request that wrote it, so the trace continues across Kafka (OutboxTracing). */
    private String traceParent;

    private Instant createdAt;

    private Instant publishedAt;

    protected OutboxMessage() {
    }

    OutboxMessage(String id, String topic, String key, String payload, String signature, String traceParent,
                  Instant createdAt) {
        this.id = id;
        this.topic = topic;
        this.key = key;
        this.payload = payload;
        this.signature = signature;
        this.traceParent = traceParent;
        this.createdAt = createdAt;
    }

    public String getId() {
        return id;
    }

    public String getTopic() {
        return topic;
    }

    public String getKey() {
        return key;
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

    public Instant getPublishedAt() {
        return publishedAt;
    }
}
