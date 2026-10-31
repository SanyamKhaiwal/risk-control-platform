package com.riskcontrol.risk.domain;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RiskControlLinkRepository extends JpaRepository<RiskControlLink, RiskControlLink.Key> {

    List<RiskControlLink> findByIdRiskIdOrderByLinkedAt(UUID riskId);

    List<RiskControlLink> findByIdControlId(UUID controlId);
}
