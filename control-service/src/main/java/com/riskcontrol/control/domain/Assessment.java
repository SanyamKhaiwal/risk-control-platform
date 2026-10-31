package com.riskcontrol.control.domain;

import java.time.Instant;
import java.util.UUID;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.mapping.Document;

/**
 * Append-only and hash-chained per control. {@code sequence} numbers a control's assessments
 * 1, 2, 3…; the unique index keeps the chain linear even under concurrent writes.
 */
@Document("assessments")
@CompoundIndex(name = "control_sequence", def = "{'controlId': 1, 'sequence': 1}", unique = true)
public class Assessment {

    @Id
    private String id;

    private String controlId;

    private long sequence;

    private AssessmentResult result;

    private double effectiveness;

    private String tester;

    private String evidence;

    private String comments;

    private Instant assessedAt;

    private String prevHash;

    private String hash;

    protected Assessment() {
    }

    /** {@code assessedAt} must already be truncated to milliseconds, MongoDB's precision, or the hash won't verify. */
    public Assessment(Control control, AssessmentResult result, String tester, String evidence, String comments,
                      Instant assessedAt, AssessmentHasher hasher) {
        this.id = UUID.randomUUID().toString();
        this.controlId = control.getId();
        this.sequence = control.nextSequence();
        this.result = result;
        this.effectiveness = result.effectiveness();
        this.tester = tester;
        this.evidence = evidence;
        this.comments = comments;
        this.assessedAt = assessedAt;
        this.prevHash = control.chainHead();
        this.hash = hasher.hash(this);
    }

    /** Re-links and re-hashes this record with the current key (one-time migration, see ChainResealer). */
    public void reseal(String prevHash, AssessmentHasher hasher) {
        this.prevHash = prevHash;
        this.hash = hasher.hash(this);
    }

    public String getId() {
        return id;
    }

    public String getControlId() {
        return controlId;
    }

    public long getSequence() {
        return sequence;
    }

    public AssessmentResult getResult() {
        return result;
    }

    public double getEffectiveness() {
        return effectiveness;
    }

    public String getTester() {
        return tester;
    }

    public String getEvidence() {
        return evidence;
    }

    public String getComments() {
        return comments;
    }

    public Instant getAssessedAt() {
        return assessedAt;
    }

    public String getPrevHash() {
        return prevHash;
    }

    public String getHash() {
        return hash;
    }
}
