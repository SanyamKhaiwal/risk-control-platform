package com.riskcontrol.risk.events;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.riskcontrol.risk.scoring.ControlType;
import java.time.Instant;
import java.util.UUID;

/** Published by the Control Service when a control is assessed. Key: controlId. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record ControlAssessedEvent(UUID eventId, int schemaVersion, UUID controlId, ControlType controlType,
                                   UUID assessmentId, String result, Double effectiveness, Instant assessedAt)
        implements VersionedEvent {

    @Override
    public boolean hasRequiredFields() {
        return eventId != null && controlId != null && effectiveness != null && assessedAt != null
                && effectiveness >= 0 && effectiveness <= 1;
    }
}
