package com.riskcontrol.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.interfaces.RSAPublicKey;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.converter.RsaKeyConverters;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * The gateway against a real Redis, with the two services replaced by a tiny HTTP stub that records
 * which path it received and whether the token was forwarded.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@Testcontainers
class GatewayTests {

    @Container
    @ServiceConnection(name = "redis")
    static final GenericContainer<?> REDIS = new GenericContainer<>("redis:7.4.12").withExposedPorts(6379);

    private static final Map<String, String> STUB_CALLS = new ConcurrentHashMap<>();
    private static final HttpServer STUB = startStub();

    @LocalServerPort
    private int port;

    private static HttpServer startStub() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/", exchange -> {
                String auth = exchange.getRequestHeaders().getFirst(HttpHeaders.AUTHORIZATION);
                STUB_CALLS.put(exchange.getRequestURI().getPath(), auth == null ? "none" : auth);
                byte[] body = "{\"stub\":true}".getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE);
                exchange.sendResponseHeaders(200, body.length);
                exchange.getResponseBody().write(body);
                exchange.close();
            });
            server.start();
            return server;
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    @DynamicPropertySource
    static void routes(DynamicPropertyRegistry registry) {
        String stub = "http://127.0.0.1:" + STUB.getAddress().getPort();
        registry.add("RISK_SERVICE_URL", () -> stub);
        registry.add("CONTROL_SERVICE_URL", () -> stub);
    }

    @AfterAll
    static void stopStub() {
        STUB.stop(0);
    }

    private WebTestClient client() {
        return WebTestClient.bindToServer().baseUrl("http://localhost:" + port).responseTimeout(Duration.ofSeconds(10)).build();
    }

    private WebTestClient.ResponseSpec login(String username, String password) {
        return client().post().uri("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("username", username, "password", password)).exchange();
    }

    private String tokenFor(String username) {
        return login(username, "demo123").expectStatus().isOk()
                .expectBody(Map.class).returnResult().getResponseBody().get("accessToken").toString();
    }

    private static Jwt decode(String token) throws IOException {
        try (InputStream in = new ClassPathResource("test-keys/jwt-public.pem").getInputStream()) {
            RSAPublicKey key = RsaKeyConverters.x509().convert(in);
            return NimbusJwtDecoder.withPublicKey(key).build().decode(token);
        }
    }

    @Test
    void loginIssuesAnRs256TokenWithSubjectRolesIssuerAndExpiry() throws IOException {
        Map<?, ?> body = login("alice", "demo123").expectStatus().isOk()
                .expectBody(Map.class).returnResult().getResponseBody();

        assertThat(body.get("tokenType")).isEqualTo("Bearer");
        assertThat(body.get("expiresIn")).isEqualTo(1800);
        assertThat(body.get("roles")).isEqualTo(List.of("RISK_OWNER"));
        Jwt jwt = decode(body.get("accessToken").toString());
        assertThat(jwt.getSubject()).isEqualTo("alice");
        assertThat(jwt.getClaimAsStringList("roles")).containsExactly("RISK_OWNER");
        assertThat(jwt.getClaimAsString("iss")).isEqualTo("rcp-gateway");
        assertThat(jwt.getHeaders()).containsEntry("alg", "RS256").containsKey("kid");
        assertThat(jwt.getExpiresAt()).isBetween(Instant.now().plusSeconds(1700), Instant.now().plusSeconds(1810));
    }

    @Test
    void wrongPasswordAndUnknownUserGetTheSame401() {
        login("bob", "wrong").expectStatus().isUnauthorized()
                .expectHeader().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON)
                .expectBody().jsonPath("$.detail").isEqualTo("Invalid username or password.");
        login("nobody", "demo123").expectStatus().isUnauthorized()
                .expectBody().jsonPath("$.detail").isEqualTo("Invalid username or password.");
    }

    @Test
    void repeatedLoginAttemptsForOneUserAreThrottled() {
        for (int i = 0; i < 5; i++) {
            login("dave", "guess-" + i).expectStatus().isUnauthorized();
        }
        login("dave", "demo123").expectStatus().isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
    }

    @Test
    void apiCallsWithoutAValidTokenAreRejectedBeforeReachingAService() {
        STUB_CALLS.clear();
        client().get().uri("/api/risks").exchange()
                .expectStatus().isUnauthorized()
                .expectHeader().valueEquals(HttpHeaders.WWW_AUTHENTICATE, "Bearer")
                .expectBody().jsonPath("$.title").isEqualTo("Unauthorized");
        client().get().uri("/api/risks").header(HttpHeaders.AUTHORIZATION, "Bearer not.a.token").exchange()
                .expectStatus().isUnauthorized();
        assertThat(STUB_CALLS).isEmpty();
    }

    @Test
    void authenticatedCallsAreRoutedWithTheTokenForwarded() {
        String token = tokenFor("carol");
        STUB_CALLS.clear();

        for (String path : List.of("/api/risks", "/api/risks/42/history", "/api/dashboard/heatmap", "/api/controls/7")) {
            client().get().uri(path).header(HttpHeaders.AUTHORIZATION, "Bearer " + token).exchange()
                    .expectStatus().isOk()
                    .expectHeader().exists("X-RateLimit-Remaining");
        }

        assertThat(STUB_CALLS).containsOnlyKeys("/api/risks", "/api/risks/42/history", "/api/dashboard/heatmap",
                "/api/controls/7");
        assertThat(STUB_CALLS.values()).allMatch(header -> header.equals("Bearer " + token));
    }

    @Test
    void unknownPathsAreNotRouted() {
        client().get().uri("/internal/admin").header(HttpHeaders.AUTHORIZATION, "Bearer " + tokenFor("carol"))
                .exchange().expectStatus().isNotFound();
    }

    @Test
    void requestsOverTheRateLimitGet429() {
        String token = tokenFor("erin");
        int limited = 0;
        for (int i = 0; i < 25; i++) {
            HttpStatus status = (HttpStatus) client().get().uri("/api/risks")
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + token).exchange()
                    .returnResult(String.class).getStatus();
            if (status == HttpStatus.TOO_MANY_REQUESTS) {
                limited++;
            }
        }
        assertThat(limited).isPositive();
    }

    @Test
    void corsAllowsTheUiOriginOnly() {
        client().options().uri("/api/risks")
                .header(HttpHeaders.ORIGIN, "http://localhost:5173")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "authorization")
                .exchange()
                .expectStatus().isOk()
                .expectHeader().valueEquals(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "http://localhost:5173");

        client().options().uri("/api/risks")
                .header(HttpHeaders.ORIGIN, "https://evil.example")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    void healthIsPublic() {
        client().get().uri("/actuator/health").exchange().expectStatus().isOk();
    }
}
