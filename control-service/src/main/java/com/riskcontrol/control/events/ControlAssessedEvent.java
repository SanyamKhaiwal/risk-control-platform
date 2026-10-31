package com.riskcontrol.control.events;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.riskcontrol.control.domain.AssessmentResult;
import com.riskcontrol.control.domain.ControlType;
import java.time.Instant;
import java.util.UUID;

/** Published (via the outbox) for every recorded assessment. Key: controlId. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record ControlAssessedEvent(UUID eventId, int schemaVersion, String controlId, ControlType controlType,
                                   String assessmentId, AssessmentResult result, double effectiveness,
                                   Instant assessedAt) implements VersionedEvent {

    public static final int SCHEMA_VERSION = 1;

    @Override
    public boolean hasRequiredFields() {
        return eventId != null && controlId != null && assessedAt != null;
    }
}
