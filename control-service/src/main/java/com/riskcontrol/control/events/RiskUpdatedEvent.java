package com.riskcontrol.control.events;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Published by the Risk Service when a risk's scores or status change. Key: riskId. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record RiskUpdatedEvent(UUID eventId, int schemaVersion, UUID riskId, String title, String cause, String status,
                               int inherentScore, int residualScore, RiskRating rating, RiskRating previousRating,
                               List<String> controlIds, UUID causeEventId, Instant updatedAt) implements VersionedEvent {

    public enum RiskRating {
        LOW,
        MEDIUM,
        HIGH,
        CRITICAL
    }

    /** "Account takeover rose to Critical"; older events without a title fall back to the id. */
    public String retestReason() {
        String rating = this.rating.name().charAt(0) + this.rating.name().substring(1).toLowerCase();
        String name = title == null || title.isBlank() ? "Linked risk " + riskId : title;
        return name + " rose to " + rating;
    }

    @Override
    public boolean hasRequiredFields() {
        return eventId != null && riskId != null && rating != null && controlIds != null;
    }

    /** The risk is now HIGH or CRITICAL and got worse (a new risk counts as worse). Closed risks never qualify. */
    public boolean worsenedToHighOrAbove() {
        return !"CLOSED".equals(status)
                && rating.compareTo(RiskRating.HIGH) >= 0
                && (previousRating == null || rating.compareTo(previousRating) > 0);
    }
}
