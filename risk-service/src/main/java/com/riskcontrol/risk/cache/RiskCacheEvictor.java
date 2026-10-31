package com.riskcontrol.risk.cache;

import com.riskcontrol.risk.service.RiskChanged;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Evicts after commit, so a reader can't re-cache the old value from the database before the new
 * one is visible. The TTLs bound any remaining race.
 */
@Component
class RiskCacheEvictor {

    private static final Logger log = LoggerFactory.getLogger(RiskCacheEvictor.class);

    private final CacheManager caches;
    private final RiskListCache lists;

    RiskCacheEvictor(CacheManager caches, RiskListCache lists) {
        this.caches = caches;
        this.lists = lists;
    }

    @TransactionalEventListener
    void onRiskChanged(RiskChanged event) {
        lists.clear();
        try {
            if (event.heatmapChanged()) {
                clear(CacheConfig.HEATMAP); // a text-only edit leaves every count as it was
            }
            clear(CacheConfig.TOP);
            Cache risk = caches.getCache(CacheConfig.RISK);
            if (risk != null) {
                risk.evict(event.riskId());
            }
        } catch (RuntimeException e) {
            // The change is already committed; a failed eviction must not turn into an error response.
            log.warn("Cache eviction failed for risk {}; entries expire by TTL: {}", event.riskId(), e.toString());
        }
    }

    private void clear(String name) {
        Cache cache = caches.getCache(name);
        if (cache != null) {
            cache.clear();
        }
    }
}
