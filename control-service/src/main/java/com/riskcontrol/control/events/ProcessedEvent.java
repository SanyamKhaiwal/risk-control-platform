package com.riskcontrol.control.events;

import java.time.Instant;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

/** Ids of consumed events, saved in the same transaction as their effect so a redelivery is skipped. */
@Document("processed_events")
public class ProcessedEvent {

    @Id
    private String eventId;

    private String topic;

    private Instant processedAt;

    protected ProcessedEvent() {
    }

    ProcessedEvent(String eventId, String topic, Instant processedAt) {
        this.eventId = eventId;
        this.topic = topic;
        this.processedAt = processedAt;
    }

    public String getEventId() {
        return eventId;
    }
}
