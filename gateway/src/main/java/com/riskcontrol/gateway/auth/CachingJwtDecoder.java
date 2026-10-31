package com.riskcontrol.gateway.auth;

import java.time.Clock;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.ReactiveJwtDecoder;
import reactor.core.publisher.Mono;

/**
 * Remembers tokens that already passed the full check (signature, issuer, expiry), so a browser sending the same
 * token every couple of seconds isn't re-verified each time. Expiry is checked again on every use, so a remembered
 * token stops working the moment it expires. A token that failed is never remembered.
 */
final class CachingJwtDecoder implements ReactiveJwtDecoder {

    private static final int MAX_ENTRIES = 100_000;

    private final ReactiveJwtDecoder delegate;
    private final Clock clock;
    private final ConcurrentHashMap<String, Jwt> verified = new ConcurrentHashMap<>();

    CachingJwtDecoder(ReactiveJwtDecoder delegate, Clock clock) {
        this.delegate = delegate;
        this.clock = clock;
    }

    @Override
    public Mono<Jwt> decode(String token) {
        Jwt known = verified.get(token);
        if (known != null) {
            if (known.getExpiresAt() != null && known.getExpiresAt().isAfter(clock.instant())) {
                return Mono.just(known);
            }
            verified.remove(token);
            return Mono.error(new BadJwtException("Jwt expired at " + known.getExpiresAt()));
        }
        return delegate.decode(token).doOnNext(jwt -> {
            if (verified.size() >= MAX_ENTRIES) {
                verified.clear(); // only bounds memory; the next request for each token is simply verified again
            }
            verified.put(token, jwt);
        });
    }
}
