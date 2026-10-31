package com.riskcontrol.risk.scoring;

/** Preventive controls reduce likelihood; detective and corrective controls reduce impact. */
public enum ControlType {
    PREVENTIVE,
    DETECTIVE,
    CORRECTIVE;

    public boolean reducesLikelihood() {
        return this == PREVENTIVE;
    }
}
