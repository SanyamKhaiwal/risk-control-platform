package com.riskcontrol.risk.events;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.riskcontrol.risk.domain.RiskStatus;
import com.riskcontrol.risk.scoring.Rating;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Published (via the outbox) whenever a risk's scores or status change. Key: riskId.
 * {@code previousRating} is null for a new risk; {@code causeEventId} is the control.assessed
 * event that caused the change, if any.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record RiskUpdatedEvent(UUID eventId, int schemaVersion, UUID riskId, String title, String cause, RiskStatus status,
                               int inherentScore, int residualScore, Rating rating, Rating previousRating,
                               List<UUID> controlIds, UUID causeEventId, Instant updatedAt) implements VersionedEvent {

    public static final int SCHEMA_VERSION = 1;

    @Override
    public boolean hasRequiredFields() {
        return eventId != null && riskId != null && rating != null && controlIds != null;
    }
}
