package com.riskcontrol.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import reactor.core.publisher.Flux;
import reactor.test.StepVerifier;

/** Live updates (LiveHub, LiveController): one fetch per address for every watcher, pushed only when it changes. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@Testcontainers
class LiveTests {

    @Container
    @ServiceConnection(name = "redis")
    static final GenericContainer<?> REDIS = new GenericContainer<>("redis:7.4.12").withExposedPorts(6379);

    private static volatile String body = "{\"version\":1}";
    private static final AtomicInteger FETCHES = new AtomicInteger();
    private static final HttpServer SERVICE = startService();

    @LocalServerPort
    private int port;

    private static HttpServer startService() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/", exchange -> {
                FETCHES.incrementAndGet();
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE);
                exchange.sendResponseHeaders(200, bytes.length);
                exchange.getResponseBody().write(bytes);
                exchange.close();
            });
            server.start();
            return server;
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        String service = "http://127.0.0.1:" + SERVICE.getAddress().getPort();
        registry.add("RISK_SERVICE_URL", () -> service);
        registry.add("CONTROL_SERVICE_URL", () -> service);
        registry.add("rcp.live.interval", () -> "200ms");
    }

    @AfterAll
    static void stop() {
        SERVICE.stop(0);
    }

    private WebTestClient client() {
        return WebTestClient.bindToServer().baseUrl("http://localhost:" + port).responseTimeout(Duration.ofSeconds(10)).build();
    }

    private String token(String user) {
        return client().post().uri("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("username", user, "password", "demo123")).exchange().expectStatus().isOk()
                .expectBody(Map.class).returnResult().getResponseBody().get("accessToken").toString();
    }

    private Flux<String> stream(String token, List<String> paths) {
        return client().post().uri("/api/live").header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON).accept(MediaType.TEXT_EVENT_STREAM)
                .bodyValue(Map.of("paths", paths)).exchange().expectStatus().isOk()
                .returnResult(new ParameterizedTypeReference<ServerSentEvent<String>>() { })
                .getResponseBody()
                .filter(event -> "update".equals(event.event()))
                .map(ServerSentEvent::data);
    }

    @Test
    void watchersOfOneAddressShareOneFetchAndGetEachChange() throws InterruptedException {
        body = "{\"version\":1}";
        Flux<String> alice = stream(token("alice"), List.of("/api/dashboard/overview"));
        Flux<String> dave = stream(token("dave"), List.of("/api/dashboard/overview"));

        StepVerifier.create(Flux.merge(alice.take(2), dave.take(2)).collectList()
                        .doOnSubscribe(s -> new Thread(() -> {
                            sleep(1200);
                            int during = FETCHES.get();
                            sleep(1000);
                            // Both watchers together: about one fetch per interval (200 ms), not one each.
                            assertThat(FETCHES.get() - during).isBetween(3, 7);
                            body = "{\"version\":2}";
                        }).start()))
                .assertNext(events -> assertThat(events).containsExactlyInAnyOrder(
                        "{\"path\":\"/api/dashboard/overview\",\"body\":{\"version\":1}}",
                        "{\"path\":\"/api/dashboard/overview\",\"body\":{\"version\":1}}",
                        "{\"path\":\"/api/dashboard/overview\",\"body\":{\"version\":2}}",
                        "{\"path\":\"/api/dashboard/overview\",\"body\":{\"version\":2}}"))
                .expectComplete()
                .verify(Duration.ofSeconds(10));
    }

    @Test
    void onlyReadOnlyAddressesSignedInAndAFewAtATime() {
        String token = token("carol");
        for (String path : List.of("/api/auth/login", "/actuator/prometheus", "/api/risks/../actuator", "http://evil.example/x")) {
            client().post().uri("/api/live").header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                    .contentType(MediaType.APPLICATION_JSON).bodyValue(Map.of("paths", List.of(path)))
                    .exchange().expectStatus().isBadRequest();
        }
        List<String> eleven = java.util.stream.IntStream.range(0, 11).mapToObj(i -> "/api/risks?page=" + i).toList();
        client().post().uri("/api/live").header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON).bodyValue(Map.of("paths", eleven))
                .exchange().expectStatus().isBadRequest();
        client().post().uri("/api/live").contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("paths", List.of("/api/dashboard/overview")))
                .exchange().expectStatus().isUnauthorized();
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
