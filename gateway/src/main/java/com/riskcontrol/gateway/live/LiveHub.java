package com.riskcontrol.gateway.live;

import com.riskcontrol.gateway.auth.TokenIssuer;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.ReactiveRedisMessageListenerContainer;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * Live updates without polling from every browser (docs/performance.md). Browsers tell the Gateway which GET
 * addresses they are showing; the platform asks the service for each address about once a second, on behalf of
 * everyone watching it, and pushes the answer only when it changed.
 * <p>
 * <b>One fetch per address for the whole cluster.</b> With several Gateways, each would otherwise poll the same
 * addresses (50 Gateways × 2,000 addresses = 100,000 requests a second to the services). So one Gateway owns each
 * address through a short lease in Redis and fetches it; the answer goes to every Gateway over Redis pub/sub, and
 * each fans it out to its own viewers. If Redis is unavailable, each Gateway fetches for itself, so updates keep
 * flowing.
 * <p>
 * <b>Encoded once.</b> Each change becomes the event's bytes once per Gateway; every viewer gets the same bytes.
 * <p>
 * Every role can read everything (ARCHITECTURE.md §10), so the hub reads with one read-only identity of its own
 * ({@code live-hub}, VIEWER) and shares the answer. Only read-only API addresses are accepted ({@link #ALLOWED}),
 * and the number of distinct addresses per Gateway is bounded.
 */
@Component
public class LiveHub {

    private static final Logger log = LoggerFactory.getLogger(LiveHub.class);

    /** The read-only addresses the dashboard shows: dashboards, lists with simple filters, and one risk or control. */
    static final Pattern ALLOWED = Pattern.compile(
            "^/api/(dashboard/(overview|heatmap|top)|risks|controls)"
                    + "(/[0-9a-fA-F-]{36}(/(controls|history|assessments))?)?"
                    + "(\\?[A-Za-z0-9=&_.,%-]{0,200})?$");

    static final byte[] HEARTBEAT = ":heartbeat\n\n".getBytes(StandardCharsets.UTF_8);
    private static final Duration LEASE = Duration.ofSeconds(3);

    private final class Topic {
        final String path;
        final Broadcast<byte[]> broadcast;
        volatile String lastSent;      // last answer turned into an event here
        volatile String lastPublished; // last answer this Gateway published as owner
        volatile Disposable poller;
        volatile Disposable subscription;

        Topic(String path) {
            this.path = path;
            this.broadcast = new Broadcast<>(watchers -> {
                if (watchers > 0) {
                    start(this);
                } else {
                    stop(this);
                }
            });
        }
    }

    private final ConcurrentHashMap<String, Topic> topics = new ConcurrentHashMap<>();
    private final Broadcast<byte[]> heartbeats = new Broadcast<>(count -> { });
    private final WebClient client;
    private final TokenIssuer tokens;
    private final ReactiveStringRedisTemplate redis;
    private final ObjectProvider<ReactiveRedisMessageListenerContainer> channels;
    private final AtomicLong nextSubscribeAttempt = new AtomicLong();
    private final String instance = UUID.randomUUID().toString();
    private final String riskServiceUrl;
    private final String controlServiceUrl;
    private final Duration interval;
    private final int maxTopics;
    private final Counter fetches;
    private final Counter pushes;
    private volatile String token;
    private volatile Instant tokenRenewAt = Instant.EPOCH;

    LiveHub(TokenIssuer tokens, MeterRegistry metrics, ReactiveStringRedisTemplate redis,
            ObjectProvider<ReactiveRedisMessageListenerContainer> channels,
            @Value("${RISK_SERVICE_URL:http://localhost:8081}") String riskServiceUrl,
            @Value("${CONTROL_SERVICE_URL:http://localhost:8082}") String controlServiceUrl,
            @Value("${rcp.live.interval:1s}") Duration interval,
            @Value("${rcp.live.max-topics:2000}") int maxTopics,
            @Value("${rcp.live.heartbeat:20s}") Duration heartbeat) {
        this.client = WebClient.create(); // its own client: one pooled connection set to the two services
        this.tokens = tokens;
        this.redis = redis;
        this.channels = channels;
        this.riskServiceUrl = riskServiceUrl;
        this.controlServiceUrl = controlServiceUrl;
        this.interval = interval;
        this.maxTopics = maxTopics;
        this.fetches = metrics.counter("rcp.live.fetches");
        this.pushes = metrics.counter("rcp.live.pushes");
        Gauge.builder("rcp.live.topics", topics, ConcurrentHashMap::size).description("Distinct addresses being watched")
                .register(metrics);
        Flux.interval(heartbeat, heartbeat).subscribe(tick -> heartbeats.emit(HEARTBEAT));
    }

    static boolean allowed(String path) {
        return path != null && ALLOWED.matcher(path).matches();
    }

    /** Event bytes for one address: the latest right away, then each change. Fails if too many are being watched. */
    Flux<byte[]> watch(String path) {
        return Flux.defer(() -> {
            Topic topic = topics.computeIfAbsent(path, p -> topics.size() >= maxTopics ? null : new Topic(p));
            if (topic == null) {
                return Flux.error(new IllegalStateException("Too many different addresses are being watched"));
            }
            return topic.broadcast.flux(true);
        });
    }

    /** Heartbeat bytes every few seconds for all open streams, so proxies don't close an idle one. */
    Flux<byte[]> heartbeats() {
        return heartbeats.flux(false);
    }

    private synchronized void start(Topic topic) {
        if (topic.poller != null && !topic.poller.isDisposed()) {
            return;
        }
        subscribe(topic);
        redis.opsForValue().get(latestKey(topic.path))
                .subscribe(body -> deliver(topic, body), e -> { });
        topic.poller = Flux.interval(Duration.ZERO, interval)
                .onBackpressureDrop()
                .concatMap(tick -> tick(topic), 1)
                .subscribe();
    }

    /**
     * Answers fetched by whichever Gateway owns the address, for every Gateway. Retried from tick() while Redis is
     * down (at most every 5 s, off the polling threads: connecting can block), so the channel comes back with Redis.
     */
    private void subscribe(Topic topic) {
        if (topic.subscription != null && !topic.subscription.isDisposed()) {
            return;
        }
        long now = System.currentTimeMillis();
        long next = nextSubscribeAttempt.get();
        if (now < next || !nextSubscribeAttempt.compareAndSet(next, now + 5000)) {
            return;
        }
        Mono.fromRunnable(() -> {
            try {
                topic.subscription = channels.getObject().receiveLater(ChannelTopic.of(channel(topic.path)))
                        .flatMapMany(messages -> {
                            // Subscribed: catch up on anything published before now, then follow the channel.
                            redis.opsForValue().get(latestKey(topic.path)).subscribe(body -> deliver(topic, body), e -> { });
                            return messages;
                        })
                        .subscribe(message -> deliver(topic, message.getMessage()),
                                e -> log.debug("Live channel failed: {}", e.toString()));
                if (topics.get(topic.path) != topic) {
                    topic.subscription.dispose(); // nobody watches it any more (stopped meanwhile)
                }
                nextSubscribeAttempt.set(0); // connected: the other addresses needn't wait
            } catch (RuntimeException e) {
                log.debug("Live channels unavailable, fetching locally: {}", e.toString());
            }
        }).subscribeOn(Schedulers.boundedElastic()).subscribe();
    }

    private synchronized void stop(Topic topic) {
        if (topic.broadcast.size() == 0) {
            if (topic.poller != null) {
                topic.poller.dispose();
            }
            if (topic.subscription != null) {
                topic.subscription.dispose();
            }
            topics.remove(topic.path, topic);
        }
    }

    /** Once a second: if this Gateway holds (or can take) the address's lease, fetch it and publish any change. */
    private Mono<Void> tick(Topic topic) {
        subscribe(topic);
        String ownerKey = "live:owner:" + topic.path;
        return redis.opsForValue().setIfAbsent(ownerKey, instance, LEASE)
                .flatMap(taken -> taken ? Mono.just(true)
                        : redis.opsForValue().get(ownerKey).map(instance::equals)
                                .flatMap(mine -> mine ? redis.expire(ownerKey, LEASE).thenReturn(true) : Mono.just(false)))
                .flatMap(owner -> owner ? fetch(topic.path).flatMap(body -> publish(topic, body)) : Mono.<Void>empty())
                .onErrorResume(e -> {
                    // Redis unavailable: fetch for this Gateway alone, so live updates keep working.
                    log.debug("Live coordination unavailable, fetching locally: {}", e.toString());
                    return fetch(topic.path).doOnNext(body -> deliver(topic, body)).then();
                });
    }

    private Mono<Void> publish(Topic topic, String body) {
        if (Objects.equals(body, topic.lastPublished)) {
            return Mono.empty();
        }
        topic.lastPublished = body;
        return redis.opsForValue().set(latestKey(topic.path), body, Duration.ofMinutes(1))
                .then(redis.convertAndSend(channel(topic.path), body))
                .then();
    }

    /** Turns an answer into event bytes once, and sends them to this Gateway's viewers if it changed. */
    private void deliver(Topic topic, String body) {
        if (body == null || Objects.equals(body, topic.lastSent)) {
            return;
        }
        topic.lastSent = body;
        // Compact JSON has no raw line breaks; removing any keeps the event on one data line.
        String data = "{\"path\":\"" + topic.path + "\",\"body\":" + body.replace("\n", "").replace("\r", "") + "}";
        topic.broadcast.emit(("event:update\ndata:" + data + "\n\n").getBytes(StandardCharsets.UTF_8));
        pushes.increment();
    }

    private Mono<String> fetch(String path) {
        String base = path.startsWith("/api/controls") ? controlServiceUrl : riskServiceUrl;
        fetches.increment();
        return client.get().uri(base + path)
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token())
                .retrieve()
                .bodyToMono(String.class)
                .timeout(Duration.ofSeconds(5))
                .onErrorResume(e -> {
                    log.debug("Live fetch of {} failed: {}", path, e.toString());
                    return Mono.empty(); // keep the last answer; try again next second
                });
    }

    private static String channel(String path) {
        return "live:" + path;
    }

    private static String latestKey(String path) {
        return "live:latest:" + path;
    }

    /** The hub's own read-only token, renewed well before it expires. */
    private String token() {
        if (Instant.now().isAfter(tokenRenewAt)) {
            token = tokens.serviceToken("live-hub", List.of("VIEWER"));
            tokenRenewAt = Instant.now().plus(Duration.ofMinutes(10));
        }
        return token;
    }
}
