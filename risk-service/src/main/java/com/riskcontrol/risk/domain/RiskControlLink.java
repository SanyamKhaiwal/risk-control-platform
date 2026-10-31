package com.riskcontrol.risk.domain;

import com.riskcontrol.risk.scoring.ControlEffectiveness;
import com.riskcontrol.risk.scoring.ControlType;
import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.io.Serializable;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * A risk-to-control link (owned by this service) plus a local copy of the control's type and
 * latest effectiveness, so scoring never needs to call the Control Service.
 */
@Entity
@Table(name = "risk_control_link")
public class RiskControlLink {

    @EmbeddedId
    private Key id;

    @Enumerated(EnumType.STRING)
    private ControlType controlType;

    @Column(precision = 3, scale = 2)
    private BigDecimal latestEffectiveness;

    private Instant lastAssessedAt;

    private Instant linkedAt;

    protected RiskControlLink() {
    }

    public RiskControlLink(UUID riskId, UUID controlId, ControlType controlType,
                           BigDecimal latestEffectiveness, Instant lastAssessedAt, Instant linkedAt) {
        this.id = new Key(riskId, controlId);
        this.controlType = controlType;
        this.latestEffectiveness = latestEffectiveness;
        this.lastAssessedAt = lastAssessedAt;
        this.linkedAt = linkedAt;
    }

    /**
     * Updates the local copy of the control's effectiveness, unless this assessment is not newer than
     * the one already applied (a retried or replayed old event). Returns whether anything changed.
     */
    public boolean applyAssessment(BigDecimal effectiveness, Instant assessedAt) {
        if (lastAssessedAt != null && !assessedAt.isAfter(lastAssessedAt)) {
            return false;
        }
        this.latestEffectiveness = effectiveness;
        this.lastAssessedAt = assessedAt;
        return true;
    }

    public ControlEffectiveness toEffectiveness() {
        return new ControlEffectiveness(controlType, latestEffectiveness);
    }

    public UUID getRiskId() {
        return id.riskId;
    }

    public UUID getControlId() {
        return id.controlId;
    }

    public ControlType getControlType() {
        return controlType;
    }

    public BigDecimal getLatestEffectiveness() {
        return latestEffectiveness;
    }

    public Instant getLastAssessedAt() {
        return lastAssessedAt;
    }

    public Instant getLinkedAt() {
        return linkedAt;
    }

    @Embeddable
    public static class Key implements Serializable {

        private UUID riskId;

        private UUID controlId;

        protected Key() {
        }

        public Key(UUID riskId, UUID controlId) {
            this.riskId = riskId;
            this.controlId = controlId;
        }

        @Override
        public boolean equals(Object o) {
            return o instanceof Key other && riskId.equals(other.riskId) && controlId.equals(other.controlId);
        }

        @Override
        public int hashCode() {
            return Objects.hash(riskId, controlId);
        }
    }
}
