package com.riskcontrol.risk.domain;

import com.riskcontrol.risk.scoring.Rating;
import com.riskcontrol.risk.scoring.Score;
import com.riskcontrol.risk.scoring.ScoringEngine;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "risk")
public class Risk {

    @Id
    private UUID id;

    private String title;

    private String description;

    @Enumerated(EnumType.STRING)
    private RiskCategory category;

    private String owner;

    private int likelihood;

    private int impact;

    private int inherentScore;

    private int residualLikelihood;

    private int residualImpact;

    private int residualScore;

    @Enumerated(EnumType.STRING)
    private Rating rating;

    @Enumerated(EnumType.STRING)
    private RiskStatus status;

    @Version
    private Integer version;

    private Instant createdAt;

    private Instant updatedAt;

    protected Risk() {
    }

    public Risk(String title, String description, RiskCategory category, String owner,
                int likelihood, int impact, Instant now) {
        this.id = UUID.randomUUID();
        this.title = title;
        this.description = description;
        this.category = category;
        this.owner = owner;
        this.likelihood = likelihood;
        this.impact = impact;
        this.status = RiskStatus.OPEN;
        this.createdAt = now;
        this.updatedAt = now;
        applyScore(ScoringEngine.score(likelihood, impact, List.of()), now);
    }

    public void edit(String title, String description, RiskCategory category, int likelihood, int impact, Instant now) {
        this.title = title;
        this.description = description;
        this.category = category;
        this.likelihood = likelihood;
        this.impact = impact;
        this.updatedAt = now;
    }

    public void changeStatus(RiskStatus status, Instant now) {
        this.status = status;
        this.updatedAt = now;
    }

    /** Stores a recalculated score; returns whether anything changed. */
    public boolean applyScore(Score score, Instant now) {
        if (score.equals(score())) {
            return false;
        }
        this.inherentScore = score.inherentScore();
        this.residualLikelihood = score.residualLikelihood();
        this.residualImpact = score.residualImpact();
        this.residualScore = score.residualScore();
        this.rating = score.rating();
        this.updatedAt = now;
        return true;
    }

    public Score score() {
        return new Score(inherentScore, residualLikelihood, residualImpact, residualScore, rating);
    }

    public boolean isClosed() {
        return status == RiskStatus.CLOSED;
    }

    public UUID getId() {
        return id;
    }

    public String getTitle() {
        return title;
    }

    public String getDescription() {
        return description;
    }

    public RiskCategory getCategory() {
        return category;
    }

    public String getOwner() {
        return owner;
    }

    public int getLikelihood() {
        return likelihood;
    }

    public int getImpact() {
        return impact;
    }

    public int getInherentScore() {
        return inherentScore;
    }

    public int getResidualLikelihood() {
        return residualLikelihood;
    }

    public int getResidualImpact() {
        return residualImpact;
    }

    public int getResidualScore() {
        return residualScore;
    }

    public Rating getRating() {
        return rating;
    }

    public RiskStatus getStatus() {
        return status;
    }

    public Integer getVersion() {
        return version;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
