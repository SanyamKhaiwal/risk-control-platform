package com.riskcontrol.gateway.auth;

import java.time.Clock;
import java.time.Duration;
import java.util.Locale;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

/**
 * Limits login attempts per minute (fixed windows in Redis), per username and per client address.
 * The username limit slows down guessing one account's password; the address limit slows down
 * spraying one password across many usernames, each attempt costing a bcrypt check.
 * If Redis is unavailable, logins are allowed rather than locking everyone out.
 */
@Component
class LoginThrottle {

    private static final Logger log = LoggerFactory.getLogger(LoginThrottle.class);

    private final ReactiveStringRedisTemplate redis;
    private final Clock clock;
    private final int attemptsPerMinute;
    private final int attemptsPerMinutePerAddress;

    LoginThrottle(ReactiveStringRedisTemplate redis, Clock clock, AuthProperties properties) {
        this.redis = redis;
        this.clock = clock;
        this.attemptsPerMinute = properties.loginAttemptsPerMinute();
        this.attemptsPerMinutePerAddress = properties.loginAttemptsPerMinutePerAddress();
    }

    Mono<Boolean> tryAcquire(String username, String address) {
        long minute = clock.instant().getEpochSecond() / 60;
        Mono<Boolean> byAddress = count("login-attempts:address:" + address + ":" + minute, attemptsPerMinutePerAddress);
        Mono<Boolean> byUser = count("login-attempts:" + username.toLowerCase(Locale.ROOT) + ":" + minute, attemptsPerMinute);
        return Mono.zip(byAddress, byUser, (a, u) -> a && u)
                .onErrorResume(e -> {
                    log.warn("Login throttle unavailable, allowing attempt: {}", e.toString());
                    return Mono.just(true);
                });
    }

    private Mono<Boolean> count(String key, int limit) {
        return redis.opsForValue().increment(key)
                .flatMap(count -> count == 1 ? redis.expire(key, Duration.ofSeconds(60)).thenReturn(count) : Mono.just(count))
                .map(count -> count <= limit);
    }
}
