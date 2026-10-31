package com.riskcontrol.risk.scoring;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

/**
 * Pure scoring rules (ARCHITECTURE.md §6). No I/O, so every rule is covered by unit tests.
 *
 * <ul>
 *   <li>inherent = likelihood × impact</li>
 *   <li>residual likelihood = max(1, roundHalfUp(likelihood × (1 − average preventive effectiveness)))</li>
 *   <li>residual impact = max(1, roundHalfUp(impact × (1 − average detective/corrective effectiveness)))</li>
 *   <li>residual = residual likelihood × residual impact; rating from the residual score</li>
 * </ul>
 */
public final class ScoringEngine {

    private ScoringEngine() {
    }

    public static Score score(int likelihood, int impact, Collection<ControlEffectiveness> controls) {
        requireScale("likelihood", likelihood);
        requireScale("impact", impact);

        List<BigDecimal> likelihoodControls = new ArrayList<>();
        List<BigDecimal> impactControls = new ArrayList<>();
        for (ControlEffectiveness control : controls) {
            if (!control.isTested()) {
                continue;
            }
            (control.type().reducesLikelihood() ? likelihoodControls : impactControls).add(control.effectiveness());
        }

        int residualLikelihood = reduce(likelihood, likelihoodControls);
        int residualImpact = reduce(impact, impactControls);
        int residualScore = residualLikelihood * residualImpact;
        return new Score(likelihood * impact, residualLikelihood, residualImpact, residualScore, Rating.of(residualScore));
    }

    /**
     * Computes base × (1 − mean) as base × (n − sum) / n so the division happens once and is
     * rounded exactly; averaging first (1/6 = 0.1666…) could turn an exact .5 into .4999….
     */
    static int reduce(int base, List<BigDecimal> effectiveness) {
        if (effectiveness.isEmpty()) {
            return base;
        }
        BigDecimal sum = effectiveness.stream().reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal count = BigDecimal.valueOf(effectiveness.size());
        int reduced = BigDecimal.valueOf(base)
                .multiply(count.subtract(sum))
                .divide(count, 0, RoundingMode.HALF_UP)
                .intValueExact();
        return Math.max(1, reduced);
    }

    private static void requireScale(String name, int value) {
        if (value < 1 || value > 5) {
            throw new IllegalArgumentException(name + " must be between 1 and 5, was " + value);
        }
    }
}
