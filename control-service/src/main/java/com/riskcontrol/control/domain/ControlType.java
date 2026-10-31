package com.riskcontrol.control.domain;

/** Fixed when the control is created, so the Risk Service's copy of it never goes stale. */
public enum ControlType {
    PREVENTIVE,
    DETECTIVE,
    CORRECTIVE
}
