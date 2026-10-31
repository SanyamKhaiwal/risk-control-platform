package com.riskcontrol.risk.scoring;

import java.math.BigDecimal;
import java.util.Objects;

/**
 * A linked control's type and latest effectiveness (0.00–1.00). A null effectiveness means the
 * control has not been tested yet; untested controls are left out of the score.
 */
public record ControlEffectiveness(ControlType type, BigDecimal effectiveness) {

    public ControlEffectiveness {
        Objects.requireNonNull(type, "type");
        if (effectiveness != null
                && (effectiveness.compareTo(BigDecimal.ZERO) < 0 || effectiveness.compareTo(BigDecimal.ONE) > 0)) {
            throw new IllegalArgumentException("Effectiveness must be between 0 and 1, was " + effectiveness);
        }
    }

    public boolean isTested() {
        return effectiveness != null;
    }
}
