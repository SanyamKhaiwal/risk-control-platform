package com.riskcontrol.risk.cache;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Duration;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;

/**
 * Keeps answers for a moment (about a second), for list endpoints that every open screen asks for every 2 seconds:
 * with hundreds of people watching, the same query would otherwise run hundreds of times a second for the same
 * answer (docs/performance.md). Cleared whenever this service changes the data, so nobody misses their own change;
 * a list someone else just changed can be up to the TTL old. A TTL of zero turns it off.
 */
public final class ShortLivedCache<K, V> {

    private record Entry<V>(V value, long expiresAtNanos) {
    }

    private final ConcurrentHashMap<K, Entry<V>> entries = new ConcurrentHashMap<>();
    private final long ttlNanos;
    private final int maxEntries;
    private final Counter hits;
    private final Counter misses;

    public ShortLivedCache(String name, Duration ttl, int maxEntries, MeterRegistry metrics) {
        this.ttlNanos = ttl.toNanos();
        this.maxEntries = maxEntries;
        this.hits = metrics.counter("rcp.list.cache", "cache", name, "result", "hit");
        this.misses = metrics.counter("rcp.list.cache", "cache", name, "result", "miss");
    }

    public V get(K key, Supplier<V> load) {
        if (ttlNanos <= 0) {
            return load.get();
        }
        long now = System.nanoTime();
        Entry<V> entry = entries.get(key);
        if (entry != null && now - entry.expiresAtNanos < 0) {
            hits.increment();
            return entry.value();
        }
        misses.increment();
        V value = load.get();
        if (entries.size() >= maxEntries) {
            entries.clear(); // a handful of filter combinations in practice; this only bounds memory
        }
        entries.put(key, new Entry<>(value, now + ttlNanos));
        return value;
    }

    /** Call after a change is committed, so a reader can't put the old answer back from before the change. */
    public void clear() {
        entries.clear();
    }
}
