package com.riskcontrol.gateway.live;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.server.reactive.ServerHttpResponse;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * {@code POST /api/live} with the addresses a screen shows: a server-sent event stream with each one's latest answer,
 * then every change (LiveHub). The browser keeps one stream open instead of polling every address every 2 seconds.
 * <p>
 * Signed-in users only. At most 10 addresses per stream and 5 streams per user; a heartbeat every 20 s keeps proxies
 * from closing an idle stream; the stream ends when the sign-in token expires, and the browser reconnects with a
 * fresh one (or falls back to polling).
 */
@RestController
class LiveController {

    record LiveRequest(@NotEmpty @Size(max = 10) List<@Size(max = 300) String> paths) {
    }

    private static final int MAX_STREAMS_PER_USER = 5;

    private final LiveHub hub;
    private final Clock clock;
    private final ConcurrentHashMap<String, AtomicInteger> streamsPerUser = new ConcurrentHashMap<>();
    private final AtomicInteger streams = new AtomicInteger();

    LiveController(LiveHub hub, Clock clock, MeterRegistry metrics) {
        this.hub = hub;
        this.clock = clock;
        Gauge.builder("rcp.live.connections", streams, AtomicInteger::get).description("Open live-update streams")
                .register(metrics);
    }

    @PostMapping(path = "/api/live")
    Mono<Void> live(@Valid @RequestBody LiveRequest request, JwtAuthenticationToken auth, ServerHttpResponse response) {
        List<String> paths = request.paths().stream().distinct().toList();
        for (String path : paths) {
            if (!LiveHub.allowed(path)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Not an address that can be watched: " + path);
            }
        }
        String user = auth.getName();
        AtomicInteger mine = streamsPerUser.computeIfAbsent(user, u -> new AtomicInteger());
        if (mine.incrementAndGet() > MAX_STREAMS_PER_USER) {
            release(user, mine);
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Too many live streams open for this user");
        }
        streams.incrementAndGet();

        Instant expires = auth.getToken().getExpiresAt();
        Duration remaining = expires == null ? Duration.ofMinutes(30) : Duration.between(clock.instant(), expires);
        // The hub hands every viewer the same, already-encoded event bytes; they're wrapped, not copied.
        Flux<byte[]> events = Flux.merge(Flux.fromIterable(paths).map(hub::watch).concatWithValues(hub.heartbeats()))
                .take(remaining.isNegative() ? Duration.ZERO : remaining)
                .doFinally(signal -> {
                    streams.decrementAndGet();
                    release(user, mine);
                });
        response.getHeaders().setContentType(MediaType.TEXT_EVENT_STREAM);
        response.getHeaders().setCacheControl("no-store");
        return response.writeAndFlushWith(events.map(bytes -> Mono.just(response.bufferFactory().wrap(bytes))));
    }

    private void release(String user, AtomicInteger count) {
        if (count.decrementAndGet() <= 0) {
            streamsPerUser.remove(user, count);
        }
    }
}
