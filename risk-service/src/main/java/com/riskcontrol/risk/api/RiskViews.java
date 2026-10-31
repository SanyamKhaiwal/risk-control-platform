package com.riskcontrol.risk.api;

import com.riskcontrol.risk.api.RiskDtos.HeatmapResponse;
import com.riskcontrol.risk.api.RiskDtos.RiskResponse;
import com.riskcontrol.risk.api.RiskDtos.TopRisksResponse;
import com.riskcontrol.risk.cache.CacheConfig;
import com.riskcontrol.risk.domain.CellCount;
import com.riskcontrol.risk.domain.RiskRepository;
import com.riskcontrol.risk.domain.RiskStatus;
import com.riskcontrol.risk.service.RiskService;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Read models served from Redis when cached (keys: {@code risk::<id>}, {@code dashHeatmap::all}, {@code dashTop::<limit>}). */
@Component
@Transactional(readOnly = true)
public class RiskViews {

    private final RiskService riskService;
    private final RiskRepository risks;

    public RiskViews(RiskService riskService, RiskRepository risks) {
        this.riskService = riskService;
        this.risks = risks;
    }

    @Cacheable(cacheNames = CacheConfig.RISK, key = "#id")
    public RiskResponse risk(UUID id) {
        return RiskResponse.from(riskService.get(id));
    }

    /** Open, mitigated and accepted risks; closed risks are left out. */
    @Cacheable(cacheNames = CacheConfig.HEATMAP, key = "'all'")
    public HeatmapResponse heatmap() {
        List<CellCount> inherent = risks.countByInherentCell();
        long total = inherent.stream().mapToLong(CellCount::count).sum();
        return new HeatmapResponse(grid(inherent), grid(risks.countByResidualCell()), total);
    }

    @Cacheable(cacheNames = CacheConfig.TOP, key = "#limit")
    public TopRisksResponse top(int limit) {
        return new TopRisksResponse(risks.findByStatusNotOrderByResidualScoreDescUpdatedAtDesc(RiskStatus.CLOSED,
                Limit.of(limit)).stream().map(RiskResponse::from).toList());
    }

    /** rows = likelihood 1–5, columns = impact 1–5. */
    private static List<List<Long>> grid(List<CellCount> cells) {
        long[][] counts = new long[5][5];
        for (CellCount cell : cells) {
            counts[cell.likelihood() - 1][cell.impact() - 1] = cell.count();
        }
        List<List<Long>> rows = new ArrayList<>();
        for (long[] row : counts) {
            rows.add(Arrays.stream(row).boxed().toList());
        }
        return rows;
    }
}
