package com.riskcontrol.risk.domain;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RiskScoreHistoryRepository extends JpaRepository<RiskScoreHistory, UUID> {

    List<RiskScoreHistory> findByRiskIdOrderByChangedAtDesc(UUID riskId);
}
