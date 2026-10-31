package com.riskcontrol.risk.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.riskcontrol.risk.scoring.ControlType;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** The fields of the Control Service's control response that linking needs. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record ControlSummary(UUID id, ControlType type, BigDecimal latestEffectiveness, Instant lastAssessedAt) {
}
