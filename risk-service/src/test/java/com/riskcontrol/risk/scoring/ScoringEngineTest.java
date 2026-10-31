package com.riskcontrol.risk.scoring;

import static com.riskcontrol.risk.scoring.ControlType.CORRECTIVE;
import static com.riskcontrol.risk.scoring.ControlType.DETECTIVE;
import static com.riskcontrol.risk.scoring.ControlType.PREVENTIVE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class ScoringEngineTest {

    private static ControlEffectiveness control(ControlType type, String effectiveness) {
        return new ControlEffectiveness(type, effectiveness == null ? null : new BigDecimal(effectiveness));
    }

    @Test
    void riskWithoutControlsHasResidualEqualToInherent() {
        Score score = ScoringEngine.score(4, 5, List.of());

        assertThat(score).isEqualTo(new Score(20, 4, 5, 20, Rating.CRITICAL));
    }

    @Test
    void workedExampleFromArchitectureDoc() {
        // Account takeover: MFA (preventive) partially effective, SIEM alerting (detective) untested.
        Score before = ScoringEngine.score(4, 5, List.of(control(PREVENTIVE, "0.5"), control(DETECTIVE, null)));
        assertThat(before).isEqualTo(new Score(20, 2, 5, 10, Rating.MEDIUM));

        // The tester marks MFA ineffective: the risk moves from cell (2,5) to (4,5).
        Score after = ScoringEngine.score(4, 5, List.of(control(PREVENTIVE, "0.0"), control(DETECTIVE, null)));
        assertThat(after).isEqualTo(new Score(20, 4, 5, 20, Rating.CRITICAL));
    }

    @Test
    void preventiveControlsReduceLikelihoodAndOthersReduceImpact() {
        Score preventiveOnly = ScoringEngine.score(4, 4, List.of(control(PREVENTIVE, "0.5")));
        assertThat(preventiveOnly.residualLikelihood()).isEqualTo(2);
        assertThat(preventiveOnly.residualImpact()).isEqualTo(4);

        Score detectiveOnly = ScoringEngine.score(4, 4, List.of(control(DETECTIVE, "0.5")));
        assertThat(detectiveOnly.residualLikelihood()).isEqualTo(4);
        assertThat(detectiveOnly.residualImpact()).isEqualTo(2);

        Score correctiveOnly = ScoringEngine.score(4, 4, List.of(control(CORRECTIVE, "0.5")));
        assertThat(correctiveOnly.residualImpact()).isEqualTo(2);
    }

    @Test
    void detectiveAndCorrectiveControlsAreAveragedTogether() {
        // Impact group average = (1.0 + 0.0) / 2 = 0.5 → 4 × 0.5 = 2.
        Score score = ScoringEngine.score(3, 4, List.of(control(DETECTIVE, "1.0"), control(CORRECTIVE, "0.0")));

        assertThat(score.residualImpact()).isEqualTo(2);
        assertThat(score.residualLikelihood()).isEqualTo(3);
    }

    @Test
    void untestedControlsAreExcludedSoLinkingNeverMakesARiskWorse() {
        Score tested = ScoringEngine.score(4, 5, List.of(control(PREVENTIVE, "1.0")));
        Score withUntested = ScoringEngine.score(4, 5, List.of(control(PREVENTIVE, "1.0"), control(PREVENTIVE, null)));

        assertThat(withUntested).isEqualTo(tested);
    }

    @Test
    void fullyEffectiveControlsFloorAtOneInsteadOfZero() {
        Score score = ScoringEngine.score(5, 5, List.of(control(PREVENTIVE, "1.0"), control(DETECTIVE, "1.0")));

        assertThat(score).isEqualTo(new Score(25, 1, 1, 1, Rating.LOW));
    }

    @ParameterizedTest(name = "{0} × (1 − {1}) rounds half up to {2}")
    @CsvSource({
            "3, 0.5, 2",   // 1.5 → 2
            "5, 0.5, 3",   // 2.5 → 3
            "4, 0.4, 2",   // 2.4 → 2
            "4, 0.6, 2",   // 1.6 → 2
            "2, 0.8, 1",   // 0.4 → floor of 1
    })
    void roundsHalfUp(int likelihood, String effectiveness, int expected) {
        Score score = ScoringEngine.score(likelihood, 1, List.of(control(PREVENTIVE, effectiveness)));

        assertThat(score.residualLikelihood()).isEqualTo(expected);
    }

    @Test
    void exactHalfIsNotLostToRepeatingDecimals() {
        // Mean of {0.5, 0, 0} is 1/6, so 3 × 5/6 = 2.5 exactly, which must round to 3, not 2.
        Score score = ScoringEngine.score(3, 1, List.of(
                control(PREVENTIVE, "0.5"), control(PREVENTIVE, "0.0"), control(PREVENTIVE, "0.0")));

        assertThat(score.residualLikelihood()).isEqualTo(3);
    }

    @ParameterizedTest(name = "score {0} is {1}")
    @CsvSource({"1, LOW", "5, LOW", "6, MEDIUM", "11, MEDIUM", "12, HIGH", "19, HIGH", "20, CRITICAL", "25, CRITICAL"})
    void ratingBandEdges(int score, Rating expected) {
        assertThat(Rating.of(score)).isEqualTo(expected);
    }

    @Test
    void rejectsOutOfRangeInput() {
        assertThatIllegalArgumentException().isThrownBy(() -> ScoringEngine.score(0, 3, List.of()));
        assertThatIllegalArgumentException().isThrownBy(() -> ScoringEngine.score(3, 6, List.of()));
        assertThatIllegalArgumentException().isThrownBy(() -> Rating.of(0));
        assertThatIllegalArgumentException().isThrownBy(() -> Rating.of(26));
        assertThatIllegalArgumentException().isThrownBy(() -> control(PREVENTIVE, "1.01"));
        assertThatIllegalArgumentException().isThrownBy(() -> control(PREVENTIVE, "-0.1"));
    }
}
