package com.riskcontrol.control.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class AssessmentHasherTest {

    private static final Instant AT = Instant.parse("2026-10-28T10:00:00.123Z");
    private static final AssessmentHasher HASHER = new AssessmentHasher("k".repeat(32).getBytes());

    private final Control control = new Control("MFA on admin accounts", null, ControlType.PREVENTIVE, "bob",
            ControlFrequency.QUARTERLY, AT);

    private Assessment assessment(String evidence, String comments) {
        return new Assessment(control, AssessmentResult.PARTIALLY_EFFECTIVE, "carol", evidence, comments, AT, HASHER);
    }

    @Test
    void firstAssessmentStartsFromGenesisAndHashIsHmacSha256Hex() {
        Assessment a = assessment("screenshots", "ok");

        assertThat(a.getSequence()).isEqualTo(1);
        assertThat(a.getPrevHash()).isEqualTo(AssessmentHasher.GENESIS);
        assertThat(a.getHash()).hasSize(64).matches("[0-9a-f]+");
    }

    @Test
    void hashIsDeterministic() {
        Assessment a = assessment("screenshots", "ok");

        assertThat(HASHER.hash(a)).isEqualTo(a.getHash());
    }

    @Test
    void anyFieldChangeChangesTheHash() {
        Assessment a = assessment("screenshots", "ok");
        String original = a.getHash();

        ReflectionTestUtils.setField(a, "evidence", "screenshots ");
        assertThat(HASHER.hash(a)).isNotEqualTo(original);
        ReflectionTestUtils.setField(a, "evidence", "screenshots");

        ReflectionTestUtils.setField(a, "result", AssessmentResult.EFFECTIVE);
        assertThat(HASHER.hash(a)).isNotEqualTo(original);
        ReflectionTestUtils.setField(a, "result", AssessmentResult.PARTIALLY_EFFECTIVE);

        ReflectionTestUtils.setField(a, "prevHash", "1".repeat(64));
        assertThat(HASHER.hash(a)).isNotEqualTo(original);
    }

    @Test
    void valuesCannotBeShiftedBetweenFields() {
        assertThat(assessment("ab", "c").getHash()).isNotEqualTo(assessment("a", "bc").getHash());
    }

    @Test
    void nullAndEmptyAreDifferent() {
        assertThat(assessment(null, "x").getHash()).isNotEqualTo(assessment("", "x").getHash());
    }

    @Test
    void nextAssessmentChainsToThePrevious() {
        Assessment first = assessment("e1", null);
        control.recordAssessment(first);

        Assessment second = assessment("e2", null);

        assertThat(second.getSequence()).isEqualTo(2);
        assertThat(second.getPrevHash()).isEqualTo(first.getHash());
    }

    @Test
    void withoutTheKeyTheHashCannotBeReproduced() {
        Assessment a = assessment("screenshots", "ok");

        assertThat(new AssessmentHasher("x".repeat(32).getBytes()).hash(a)).isNotEqualTo(a.getHash());
    }
}
