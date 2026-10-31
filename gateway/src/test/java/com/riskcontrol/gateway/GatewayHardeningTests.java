package com.riskcontrol.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.converter.RsaKeyConverters;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * The defences added after the security review (docs/security-review.md): request size limits,
 * 503 instead of 500 when a service is down, and the per-address login limit against password spraying.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@Testcontainers
class GatewayHardeningTests {

    @Container
    @ServiceConnection(name = "redis")
    static final GenericContainer<?> REDIS = new GenericContainer<>("redis:7.4.12").withExposedPorts(6379);

    private static final int LOGINS_PER_ADDRESS = 8;

    @LocalServerPort
    private int port;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("RISK_SERVICE_URL", () -> "http://127.0.0.1:1"); // nothing listens: connection refused
        registry.add("CONTROL_SERVICE_URL", () -> "http://control-service.invalid"); // unknown host
        registry.add("rcp.max-request-size", () -> "1KB");
        registry.add("rcp.auth.login-attempts-per-minute-per-address", () -> LOGINS_PER_ADDRESS);
    }

    private WebTestClient client() {
        return WebTestClient.bindToServer().baseUrl("http://localhost:" + port).responseTimeout(Duration.ofSeconds(15)).build();
    }

    /** Signed with the test key, so these tests don't use up login attempts. */
    private static String token() throws IOException {
        RSAPublicKey publicKey;
        RSAPrivateKey privateKey;
        try (InputStream pub = new ClassPathResource("test-keys/jwt-public.pem").getInputStream();
             InputStream priv = new ClassPathResource("test-keys/jwt-private.pem").getInputStream()) {
            publicKey = RsaKeyConverters.x509().convert(pub);
            privateKey = RsaKeyConverters.pkcs8().convert(priv);
        }
        RSAKey key = new RSAKey.Builder(publicKey).privateKey(privateKey).build();
        JwtClaimsSet claims = JwtClaimsSet.builder().issuer("rcp-gateway").subject("alice")
                .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(300)).claim("roles", List.of("RISK_OWNER")).build();
        return new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(key)))
                .encode(JwtEncoderParameters.from(JwsHeader.with(SignatureAlgorithm.RS256).build(), claims)).getTokenValue();
    }

    @Test
    void aServiceThatIsDownGives503NotA500() throws IOException {
        String token = token();
        for (String path : List.of("/api/risks", "/api/controls")) {
            client().get().uri(path).header(HttpHeaders.AUTHORIZATION, "Bearer " + token).exchange()
                    .expectStatus().isEqualTo(HttpStatus.SERVICE_UNAVAILABLE)
                    .expectHeader().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON)
                    .expectBody().jsonPath("$.title").isEqualTo("Service unavailable");
        }
    }

    @Test
    void anOversizedBodyIsRefusedBeforeItReachesAService() throws IOException {
        client().post().uri("/api/risks").header(HttpHeaders.AUTHORIZATION, "Bearer " + token())
                .contentType(MediaType.APPLICATION_JSON).bodyValue("{\"title\":\"" + "A".repeat(2048) + "\"}").exchange()
                .expectStatus().isEqualTo(HttpStatus.CONTENT_TOO_LARGE)
                .expectBody().jsonPath("$.title").isEqualTo("Request too large");
    }

    @Test
    void aBodyWithoutALengthIsRefused() throws IOException, InterruptedException {
        // An InputStream publisher has no known length, so the JDK client sends it chunked.
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/risks"))
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token())
                .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .POST(HttpRequest.BodyPublishers.ofInputStream(() -> new ByteArrayInputStream("{\"title\":\"x\"}".getBytes())))
                .build();
        HttpResponse<String> response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(HttpStatus.LENGTH_REQUIRED.value());
    }

    @Test
    void sprayingOnePasswordAcrossManyUsernamesIsSlowedDown() {
        int limited = 0;
        for (int i = 0; i < LOGINS_PER_ADDRESS + 3; i++) {
            HttpStatus status = (HttpStatus) client().post().uri("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(Map.of("username", "spray-" + UUID.randomUUID(), "password", "Winter2026!"))
                    .exchange().returnResult(String.class).getStatus();
            if (status == HttpStatus.TOO_MANY_REQUESTS) {
                limited++;
            }
        }
        assertThat(limited).isEqualTo(3);
    }
}
