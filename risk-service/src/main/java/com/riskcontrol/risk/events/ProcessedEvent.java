package com.riskcontrol.risk.events;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import org.springframework.data.domain.Persistable;

/** Ids of consumed events, saved in the same transaction as their effect so a redelivery is skipped. */
@Entity
@Table(name = "processed_event")
public class ProcessedEvent implements Persistable<UUID> {

    @Id
    private UUID eventId;

    private String topic;

    private Instant processedAt;

    protected ProcessedEvent() {
    }

    ProcessedEvent(UUID eventId, String topic, Instant processedAt) {
        this.eventId = eventId;
        this.topic = topic;
        this.processedAt = processedAt;
    }

    @Override
    public UUID getId() {
        return eventId;
    }

    @Override
    public boolean isNew() {
        return true;
    }
}
