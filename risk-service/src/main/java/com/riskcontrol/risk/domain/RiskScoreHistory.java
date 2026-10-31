package com.riskcontrol.risk.domain;

import com.riskcontrol.risk.scoring.Rating;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import org.springframework.data.domain.Persistable;

/** One row per score change. Rows are never updated, so they are always inserted without a lookup. */
@Entity
@Table(name = "risk_score_history")
public class RiskScoreHistory implements Persistable<UUID> {

    @Id
    private UUID id;

    private UUID riskId;

    private int inherentScore;

    private int residualScore;

    @Enumerated(EnumType.STRING)
    private Rating rating;

    @Enumerated(EnumType.STRING)
    private ScoreChangeCause cause;

    private UUID causeEventId;

    /** The control whose link, unlink or test caused the change, if any. */
    private UUID causeControlId;

    private Instant changedAt;

    protected RiskScoreHistory() {
    }

    public RiskScoreHistory(Risk risk, ScoreChangeCause cause, UUID causeEventId, UUID causeControlId, Instant changedAt) {
        this.id = UUID.randomUUID();
        this.riskId = risk.getId();
        this.inherentScore = risk.getInherentScore();
        this.residualScore = risk.getResidualScore();
        this.rating = risk.getRating();
        this.cause = cause;
        this.causeEventId = causeEventId;
        this.causeControlId = causeControlId;
        this.changedAt = changedAt;
    }

    @Override
    public UUID getId() {
        return id;
    }

    @Override
    public boolean isNew() {
        return true;
    }

    public UUID getRiskId() {
        return riskId;
    }

    public int getInherentScore() {
        return inherentScore;
    }

    public int getResidualScore() {
        return residualScore;
    }

    public Rating getRating() {
        return rating;
    }

    public ScoreChangeCause getCause() {
        return cause;
    }

    public UUID getCauseEventId() {
        return causeEventId;
    }

    public UUID getCauseControlId() {
        return causeControlId;
    }

    public Instant getChangedAt() {
        return changedAt;
    }
}
