package com.riskcontrol.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import com.riskcontrol.gateway.auth.TokenIssuer;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.reactive.server.WebTestClient;

/**
 * A Gateway starts, and live updates keep working, while Redis is down (fetching for itself until Redis is back).
 * Found when a Gateway couldn't start without Redis: the live channels connected at start-up (docs/kubernetes.md).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class LiveWithoutRedisTests {

    private static final HttpServer SERVICE = startService();

    @LocalServerPort
    private int port;

    @Autowired
    private TokenIssuer tokens;

    private static HttpServer startService() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/", exchange -> {
                byte[] bytes = "{\"version\":1}".getBytes(StandardCharsets.UTF_8);
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
        registry.add("spring.data.redis.host", () -> "127.0.0.1");
        registry.add("spring.data.redis.port", () -> 1); // nothing listens: connection refused
        registry.add("rcp.live.interval", () -> "200ms");
    }

    @AfterAll
    static void stop() {
        SERVICE.stop(0);
    }

    @Test
    void liveUpdatesWorkWithoutRedis() {
        String token = tokens.serviceToken("alice", List.of("VIEWER"));
        String first = WebTestClient.bindToServer().baseUrl("http://localhost:" + port).responseTimeout(Duration.ofSeconds(15)).build()
                .post().uri("/api/live").header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON).accept(MediaType.TEXT_EVENT_STREAM)
                .bodyValue(Map.of("paths", List.of("/api/dashboard/overview"))).exchange().expectStatus().isOk()
                .returnResult(new ParameterizedTypeReference<ServerSentEvent<String>>() { })
                .getResponseBody()
                .filter(event -> "update".equals(event.event()))
                .map(ServerSentEvent::data)
                .blockFirst(Duration.ofSeconds(10));
        assertThat(first).isEqualTo("{\"path\":\"/api/dashboard/overview\",\"body\":{\"version\":1}}");
    }
}
