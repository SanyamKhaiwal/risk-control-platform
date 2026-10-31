package com.riskcontrol.gateway.live;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.IntConsumer;
import reactor.core.publisher.Flux;
import reactor.core.publisher.FluxSink;

/**
 * Sends each value to every subscriber, and the latest one to whoever joins. Joining and leaving are constant time
 * (a concurrent set). Reactor's replay sink copies its whole subscriber array on every join and leave, which with
 * thousands of viewers on one address took a quarter of the Gateway's CPU in the load test (docs/performance.md).
 * A slow subscriber keeps only the newest value (OverflowStrategy.LATEST): live data never builds a backlog.
 */
final class Broadcast<T> {

    private final Set<FluxSink<T>> subscribers = ConcurrentHashMap.newKeySet();
    private final IntConsumer onCountChange;
    private volatile T latest;

    /** {@code onCountChange} gets the number of subscribers after each join or leave. */
    Broadcast(IntConsumer onCountChange) {
        this.onCountChange = onCountChange;
    }

    Flux<T> flux(boolean replayLatest) {
        return Flux.create(sink -> {
            T current = latest;
            if (replayLatest && current != null) {
                sink.next(current);
            }
            subscribers.add(sink);
            sink.onDispose(() -> {
                subscribers.remove(sink);
                onCountChange.accept(subscribers.size());
            });
            onCountChange.accept(subscribers.size());
        }, FluxSink.OverflowStrategy.LATEST);
    }

    void emit(T value) {
        latest = value;
        for (FluxSink<T> sink : subscribers) {
            sink.next(value);
        }
    }

    int size() {
        return subscribers.size();
    }
}
