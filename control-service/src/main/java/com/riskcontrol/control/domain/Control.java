package com.riskcontrol.control.domain;

import java.time.Instant;
import java.util.UUID;
import org.springframework.data.annotation.Id;
import org.springframework.data.annotation.Version;
import org.springframework.data.mongodb.core.mapping.Document;

@Document("controls")
public class Control {

    @Id
    private String id;

    private String name;

    private String description;

    private ControlType type;

    private String owner;

    private ControlFrequency frequency;

    private AssessmentResult latestResult;

    private Double latestEffectiveness;

    private Instant lastAssessedAt;

    /** Head of this control's hash chain; null until the first assessment. */
    private String lastAssessmentHash;

    private long assessmentCount;
    /** Keyed seal of (assessmentCount, lastAssessmentHash); see AssessmentHasher#sealHead. */
    private String headSeal;

    private boolean retestRequired;

    private String retestReason;

    /** The risk whose worsening raised the re-test flag. */
    private String retestRiskId;

    @Version
    private Long version;

    private Instant createdAt;

    private Instant updatedAt;

    protected Control() {
    }

    public Control(String name, String description, ControlType type, String owner, ControlFrequency frequency,
                   Instant now) {
        this.id = UUID.randomUUID().toString();
        this.name = name;
        this.description = description;
        this.type = type;
        this.owner = owner;
        this.frequency = frequency;
        this.createdAt = now;
        this.updatedAt = now;
    }

    /** {@code type} and {@code owner} are fixed at creation. */
    public void edit(String name, String description, ControlFrequency frequency, Instant now) {
        this.name = name;
        this.description = description;
        this.frequency = frequency;
        this.updatedAt = now;
    }

    /** Moves the chain head to the new assessment; a fresh assessment also satisfies any re-test request. */
    public void recordAssessment(Assessment assessment) {
        this.latestResult = assessment.getResult();
        this.latestEffectiveness = assessment.getEffectiveness();
        this.lastAssessedAt = assessment.getAssessedAt();
        this.lastAssessmentHash = assessment.getHash();
        this.assessmentCount = assessment.getSequence();
        this.retestRequired = false;
        this.retestReason = null;
        this.retestRiskId = null;
        this.updatedAt = assessment.getAssessedAt();
    }

    public long nextSequence() {
        return assessmentCount + 1;
    }

    /** Moves the chain head after the chain has been re-hashed (one-time migration, see ChainResealer). */
    public void resealHead(String hash) {
        this.lastAssessmentHash = hash;
    }

    public void sealHead(String seal) {
        this.headSeal = seal;
    }

    public String getHeadSeal() {
        return headSeal;
    }

    public String chainHead() {
        return lastAssessmentHash == null ? AssessmentHasher.GENESIS : lastAssessmentHash;
    }

    public String getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public String getDescription() {
        return description;
    }

    public ControlType getType() {
        return type;
    }

    public String getOwner() {
        return owner;
    }

    public ControlFrequency getFrequency() {
        return frequency;
    }

    public AssessmentResult getLatestResult() {
        return latestResult;
    }

    public Double getLatestEffectiveness() {
        return latestEffectiveness;
    }

    public Instant getLastAssessedAt() {
        return lastAssessedAt;
    }

    public String getLastAssessmentHash() {
        return lastAssessmentHash;
    }

    public long getAssessmentCount() {
        return assessmentCount;
    }

    public boolean isRetestRequired() {
        return retestRequired;
    }

    public String getRetestReason() {
        return retestReason;
    }

    public String getRetestRiskId() {
        return retestRiskId;
    }

    public Long getVersion() {
        return version;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
