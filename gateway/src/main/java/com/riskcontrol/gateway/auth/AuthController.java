package com.riskcontrol.gateway.auth;

import io.micrometer.core.instrument.MeterRegistry;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.net.InetSocketAddress;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

@RestController
@RequestMapping("/api/auth")
class AuthController {

    private final DemoUserStore users;
    private final TokenIssuer tokens;
    private final LoginThrottle throttle;
    private final MeterRegistry metrics;

    AuthController(DemoUserStore users, TokenIssuer tokens, LoginThrottle throttle, MeterRegistry metrics) {
        this.users = users;
        this.tokens = tokens;
        this.throttle = throttle;
        this.metrics = metrics;
        // Each outcome starts at 0, so the first failure shows as an increase (Prometheus can't see a counter's first rise).
        for (String outcome : new String[] {"success", "failure", "throttled"}) {
            metrics.counter("rcp.logins", "outcome", outcome);
        }
    }

    record LoginRequest(@NotBlank @Size(max = 64) String username, @NotBlank @Size(max = 200) String password) {
    }

    /** Same 401 for an unknown user and a wrong password, so usernames can't be discovered. */
    @PostMapping("/login")
    Mono<ResponseEntity<Object>> login(@Valid @RequestBody LoginRequest request, ServerHttpRequest http) {
        InetSocketAddress remote = http.getRemoteAddress();
        String address = remote == null || remote.getAddress() == null ? "unknown" : remote.getAddress().getHostAddress();
        return throttle.tryAcquire(request.username(), address).flatMap(allowed -> {
            if (!allowed) {
                count("throttled");
                return Mono.just(problem(HttpStatus.TOO_MANY_REQUESTS, "Too many login attempts",
                        "Too many login attempts; try again in a minute."));
            }
            return Mono.fromCallable(() -> users.authenticate(request.username(), request.password()))
                    .subscribeOn(Schedulers.boundedElastic())
                    .map(user -> user.<ResponseEntity<Object>>map(u -> {
                        count("success");
                        return ResponseEntity.ok(tokens.issue(u));
                    }).orElseGet(() -> {
                        count("failure");
                        return problem(HttpStatus.UNAUTHORIZED, "Unauthorized", "Invalid username or password.");
                    }));
        });
    }

    /** Sign-in attempts by outcome, for the Grafana "Security" dashboard. */
    private void count(String outcome) {
        metrics.counter("rcp.logins", "outcome", outcome).increment();
    }

    private static ResponseEntity<Object> problem(HttpStatus status, String title, String detail) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
        problem.setTitle(title);
        return ResponseEntity.status(status).body(problem);
    }
}
