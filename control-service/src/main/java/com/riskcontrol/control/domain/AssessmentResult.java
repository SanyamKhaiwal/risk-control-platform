package com.riskcontrol.control.domain;

/** The tester's verdict. Effectiveness is always derived from it on the server. */
public enum AssessmentResult {
    EFFECTIVE(1.0),
    PARTIALLY_EFFECTIVE(0.5),
    INEFFECTIVE(0.0);

    private final double effectiveness;

    AssessmentResult(double effectiveness) {
        this.effectiveness = effectiveness;
    }

    public double effectiveness() {
        return effectiveness;
    }
}
