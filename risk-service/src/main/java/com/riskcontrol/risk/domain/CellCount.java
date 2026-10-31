package com.riskcontrol.risk.domain;

/** Number of risks in one heat-map cell. */
public record CellCount(int likelihood, int impact, long count) {
}
