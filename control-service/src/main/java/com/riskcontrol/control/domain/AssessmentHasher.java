package com.riskcontrol.control.domain;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * HMAC-SHA256, keyed with a secret only the Control Service holds, over a canonical encoding of an assessment
 * and the previous assessment's hash. Each field is written as {@code <utf-8 length>:<value>;} in a fixed order
 * (null as {@code -:;}), so no value can be shifted into a neighbouring field without changing the hash.
 * <p>
 * Keyed, so someone who can write to MongoDB but doesn't have the key can't recompute a consistent chain after
 * editing a record (docs/security-review.md SEC-16). A plain SHA-256 could be recomputed by anyone.
 */
public final class AssessmentHasher {

    /** prevHash of the first assessment of every control. */
    public static final String GENESIS = "0".repeat(64);
    private static final String ALGORITHM = "HmacSHA256";

    private final SecretKeySpec key;

    public AssessmentHasher(byte[] key) {
        if (key == null || key.length < 32) {
            throw new IllegalArgumentException("The assessment chain key must be at least 32 bytes");
        }
        this.key = new SecretKeySpec(key, ALGORITHM);
    }

    public String hash(Assessment a) {
        StringBuilder canonical = new StringBuilder();
        field(canonical, a.getControlId());
        field(canonical, Long.toString(a.getSequence()));
        field(canonical, a.getResult().name());
        field(canonical, Double.toString(a.getEffectiveness()));
        field(canonical, a.getTester());
        field(canonical, a.getEvidence());
        field(canonical, a.getComments());
        field(canonical, a.getAssessedAt().toString());
        field(canonical, a.getPrevHash());
        return hmac(canonical.toString());
    }

    /**
     * Seal of a control's chain head: how many assessments it has and the newest one's hash. Stored on the control
     * and checked by /verify, so deleting the newest assessments and moving the head back to an older one (which
     * needs no key: the older hash is right there in the database) is detected (docs/security-review.md SEC-16).
     */
    public String sealHead(String controlId, long assessmentCount, String headHash) {
        StringBuilder canonical = new StringBuilder("head;");
        field(canonical, controlId);
        field(canonical, Long.toString(assessmentCount));
        field(canonical, headHash);
        return hmac(canonical.toString());
    }

    private static void field(StringBuilder out, String value) {
        if (value == null) {
            out.append("-:;");
            return;
        }
        out.append(value.getBytes(StandardCharsets.UTF_8).length).append(':').append(value).append(';');
    }

    private String hmac(String text) {
        try {
            Mac mac = Mac.getInstance(ALGORITHM);
            mac.init(key);
            return HexFormat.of().formatHex(mac.doFinal(text.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("HmacSHA256 is always available in the JDK", e);
        }
    }
}
