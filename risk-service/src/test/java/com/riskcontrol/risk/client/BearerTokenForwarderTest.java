package com.riskcontrol.risk.client;

import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.headerDoesNotExist;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.time.Instant;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class BearerTokenForwarderTest {

    @AfterEach
    void clearContext() {
        SecurityContextHolder.clearContext();
    }

    private static RestClient client(MockRestServiceServer[] server) {
        RestClient.Builder builder = RestClient.builder().requestInterceptor(new BearerTokenForwarder());
        server[0] = MockRestServiceServer.bindTo(builder).build();
        return builder.build();
    }

    @Test
    void forwardsTheCallersToken() {
        Jwt jwt = Jwt.withTokenValue("caller-token").header("alg", "RS256").subject("alice")
                .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(60)).build();
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt));
        MockRestServiceServer[] server = new MockRestServiceServer[1];
        RestClient client = client(server);
        server[0].expect(requestTo("http://control/api/controls/1"))
                .andExpect(header(HttpHeaders.AUTHORIZATION, "Bearer caller-token"))
                .andRespond(withSuccess());

        client.get().uri("http://control/api/controls/1").retrieve().toBodilessEntity();

        server[0].verify();
    }

    @Test
    void addsNothingWithoutAToken() {
        MockRestServiceServer[] server = new MockRestServiceServer[1];
        RestClient client = client(server);
        server[0].expect(requestTo("http://control/api/controls/1"))
                .andExpect(headerDoesNotExist(HttpHeaders.AUTHORIZATION))
                .andRespond(withSuccess());

        client.get().uri("http://control/api/controls/1").retrieve().toBodilessEntity();

        server[0].verify();
    }
}
