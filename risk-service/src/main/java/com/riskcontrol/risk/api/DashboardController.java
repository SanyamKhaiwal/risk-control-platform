package com.riskcontrol.risk.api;

import com.riskcontrol.risk.api.RiskDtos.HeatmapResponse;
import com.riskcontrol.risk.api.RiskDtos.OverviewResponse;
import com.riskcontrol.risk.api.RiskDtos.TopRisksResponse;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/dashboard")
public class DashboardController {

    private final RiskViews views;

    public DashboardController(RiskViews views) {
        this.views = views;
    }

    /** Inherent and residual 5×5 grids: {@code inherent[likelihood-1][impact-1]} is a count of risks. */
    @GetMapping("/heatmap")
    public HeatmapResponse heatmap() {
        return views.heatmap();
    }

    /**
     * Everything the Overview screen needs in one request (both heat-maps and the riskiest risks), instead of one each.
     * Both parts come from the Redis caches (docs/performance.md).
     */
    @GetMapping("/overview")
    public OverviewResponse overview(@RequestParam(defaultValue = "10") @Min(1) @Max(50) int limit) {
        return new OverviewResponse(views.heatmap(), views.top(limit));
    }

    /** Highest residual risks, excluding closed ones. */
    @GetMapping("/top")
    public TopRisksResponse top(@RequestParam(defaultValue = "10") @Min(1) @Max(50) int limit) {
        return views.top(limit);
    }
}
