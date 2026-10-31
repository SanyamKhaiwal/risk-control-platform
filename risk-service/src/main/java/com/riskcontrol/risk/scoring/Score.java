package com.riskcontrol.risk.scoring;

public record Score(int inherentScore, int residualLikelihood, int residualImpact, int residualScore, Rating rating) {
}
