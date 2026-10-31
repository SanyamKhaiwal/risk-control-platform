package com.riskcontrol.risk.domain;

import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;

public interface RiskRepository extends JpaRepository<Risk, UUID>, JpaSpecificationExecutor<Risk> {

    @Query("""
            select new com.riskcontrol.risk.domain.CellCount(r.likelihood, r.impact, count(r))
            from Risk r where r.status <> com.riskcontrol.risk.domain.RiskStatus.CLOSED
            group by r.likelihood, r.impact""")
    List<CellCount> countByInherentCell();

    @Query("""
            select new com.riskcontrol.risk.domain.CellCount(r.residualLikelihood, r.residualImpact, count(r))
            from Risk r where r.status <> com.riskcontrol.risk.domain.RiskStatus.CLOSED
            group by r.residualLikelihood, r.residualImpact""")
    List<CellCount> countByResidualCell();

    List<Risk> findByStatusNotOrderByResidualScoreDescUpdatedAtDesc(RiskStatus status, Limit limit);
}
