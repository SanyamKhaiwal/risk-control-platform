package com.riskcontrol.risk.cache;

import com.riskcontrol.risk.domain.Risk;
import com.riskcontrol.risk.domain.RiskStatus;
import com.riskcontrol.risk.scoring.Rating;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Duration;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.stereotype.Component;

/**
 * The risk register lists every open screen polls, kept for a moment (ShortLivedCache). Cleared by RiskCacheEvictor
 * after every committed risk change, like the Redis caches.
 */
@Component
public class RiskListCache {

    public record Key(RiskStatus status, Rating rating, String owner, UUID controlId, int page, int size) {
    }

    private final ShortLivedCache<Key, Page<Risk>> cache;

    RiskListCache(@Value("${risk.list-cache.ttl:1s}") Duration ttl, MeterRegistry metrics) {
        this.cache = new ShortLivedCache<>("risks", ttl, 1000, metrics);
    }

    public Page<Risk> get(Key key, Supplier<Page<Risk>> load) {
        return cache.get(key, load);
    }

    void clear() {
        cache.clear();
    }
}
