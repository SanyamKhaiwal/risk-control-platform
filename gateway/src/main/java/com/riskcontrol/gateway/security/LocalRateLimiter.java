package com.riskcontrol.gateway.security;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.gateway.filter.ratelimit.RateLimiter;
import org.springframework.context.annotation.Primary;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

/**
 * Per-user token bucket kept in this Gateway's memory: the same rule as before (about 20 requests a second, bursts
 * of 40), without a Redis round trip on every request. The load test measured that call at about 6% of the
 * Gateway's CPU, and at 100,000 users it would be over 100,000 Redis operations a second (docs/performance.md).
 * <p>
 * Trade-off: with several Gateway instances each counts on its own, so a user spread across N instances gets up
 * to N times the rate. That's fine for what this limit is for (stopping one client from flooding the platform);
 * sign-in attempts, where an exact count matters, are still counted in Redis (LoginThrottle).
 */
@Component
@Primary // Spring Cloud Gateway also creates a Redis one; this is the one used
public class LocalRateLimiter implements RateLimiter<Object> {

    private static final class Bucket {
        private double tokens;
        private long lastNanos;
        private long lastUsedNanos;

        Bucket(double tokens, long now) {
            this.tokens = tokens;
            this.lastNanos = now;
            this.lastUsedNanos = now;
        }
    }

    private final ConcurrentHashMap<String, Bucket> buckets = new ConcurrentHashMap<>();
    private final double replenishPerSecond;
    private final double burst;

    LocalRateLimiter(@Value("${rcp.rate-limit.replenish-rate}") double replenishPerSecond,
                     @Value("${rcp.rate-limit.burst-capacity}") double burst) {
        this.replenishPerSecond = replenishPerSecond;
        this.burst = burst;
    }

    @Override
    public Mono<Response> isAllowed(String routeId, String id) {
        long now = System.nanoTime();
        Bucket bucket = buckets.computeIfAbsent(id, k -> new Bucket(burst, now));
        boolean allowed;
        long remaining;
        synchronized (bucket) {
            bucket.tokens = Math.min(burst, bucket.tokens + (now - bucket.lastNanos) / 1e9 * replenishPerSecond);
            bucket.lastNanos = now;
            bucket.lastUsedNanos = now;
            allowed = bucket.tokens >= 1;
            if (allowed) {
                bucket.tokens -= 1;
            }
            remaining = (long) bucket.tokens;
        }
        return Mono.just(new Response(allowed, Map.of(
                "X-RateLimit-Remaining", Long.toString(remaining),
                "X-RateLimit-Burst-Capacity", Long.toString((long) burst),
                "X-RateLimit-Replenish-Rate", Long.toString((long) replenishPerSecond))));
    }

    /** Forgets users idle for a minute (their bucket would be full again anyway), so memory stays bounded. */
    @Scheduled(fixedDelay = 60_000)
    void forgetIdleUsers() {
        long cutoff = System.nanoTime() - 60_000_000_000L;
        buckets.values().removeIf(b -> {
            synchronized (b) {
                return b.lastUsedNanos < cutoff;
            }
        });
    }

    @Override
    public Map<String, Object> getConfig() {
        return Map.of();
    }

    @Override
    public Class<Object> getConfigClass() {
        return Object.class;
    }

    @Override
    public Object newConfig() {
        return new Object();
    }
}
