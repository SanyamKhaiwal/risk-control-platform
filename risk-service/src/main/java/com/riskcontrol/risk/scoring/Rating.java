package com.riskcontrol.risk.scoring;

public enum Rating {
    LOW,
    MEDIUM,
    HIGH,
    CRITICAL;

    /** Bands: LOW 1–5, MEDIUM 6–11, HIGH 12–19, CRITICAL 20–25. */
    public static Rating of(int score) {
        if (score < 1 || score > 25) {
            throw new IllegalArgumentException("Score must be between 1 and 25, was " + score);
        }
        if (score <= 5) {
            return LOW;
        }
        if (score <= 11) {
            return MEDIUM;
        }
        if (score <= 19) {
            return HIGH;
        }
        return CRITICAL;
    }
}
