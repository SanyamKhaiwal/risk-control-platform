package com.riskcontrol.risk.service;

import java.util.UUID;

/** In-process notification that a risk changed; caches are evicted after the transaction commits. */
/**
 * A risk changed (published after the change, evicted after commit by RiskCacheEvictor). {@code heatmapChanged} is
 * false when only text changed (title, description, category): the heat-map counts stay valid and keep their cache.
 */
public record RiskChanged(UUID riskId, boolean heatmapChanged) {
}
