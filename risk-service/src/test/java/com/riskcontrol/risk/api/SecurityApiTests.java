package com.riskcontrol.risk.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.io.InputStream;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.converter.RsaKeyConverters;
import org.springframework.security.test.context.support.WithAnonymousUser;

/** Real RS256 tokens (signed with the test key, as the gateway would) and the role/ownership rules. */
class SecurityApiTests extends ApiTestSupport {

    private static String token(PrivateKey key, String issuer, String subject, List<String> roles, Instant expiresAt)
            throws Exception {
        JWTClaimsSet claims = new JWTClaimsSet.Builder().issuer(issuer).subject(subject).claim("roles", roles)
                .issueTime(new Date()).expirationTime(Date.from(expiresAt)).build();
        SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).type(JOSEObjectType.JWT).build(), claims);
        jwt.sign(new RSASSASigner(key));
        return jwt.serialize();
    }

    private static PrivateKey testKey() throws Exception {
        try (InputStream in = new ClassPathResource("test-keys/jwt-private.pem").getInputStream()) {
            return RsaKeyConverters.pkcs8().convert(in);
        }
    }

    private static String validToken(String subject, String... roles) throws Exception {
        return token(testKey(), "rcp-gateway", subject, List.of(roles), Instant.now().plusSeconds(600));
    }

    @Test
    @WithAnonymousUser
    void requestsWithoutATokenGet401Problem() throws Exception {
        mvc.perform(get("/api/risks"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string(HttpHeaders.WWW_AUTHENTICATE, "Bearer"))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.title").value("Unauthorized"));
    }

    @Test
    @WithAnonymousUser
    void aValidGatewayTokenIsAcceptedAndItsRolesApply() throws Exception {
        mvc.perform(get("/api/risks").header(HttpHeaders.AUTHORIZATION, "Bearer " + validToken("dave", "VIEWER")))
                .andExpect(status().isOk());

        mvc.perform(post("/api/risks").header(HttpHeaders.AUTHORIZATION, "Bearer " + validToken("dave", "VIEWER"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\": \"x\", \"category\": \"CYBER\", \"likelihood\": 2, \"impact\": 2}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.title").value("Forbidden"));

        mvc.perform(post("/api/risks").header(HttpHeaders.AUTHORIZATION, "Bearer " + validToken("alice", "RISK_OWNER"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\": \"x\", \"category\": \"CYBER\", \"likelihood\": 2, \"impact\": 2}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.owner").value("alice"));
    }

    @Test
    @WithAnonymousUser
    void expiredWrongIssuerAndForeignKeyTokensAreRejected() throws Exception {
        String expired = token(testKey(), "rcp-gateway", "alice", List.of("RISK_OWNER"), Instant.now().minusSeconds(120));
        String wrongIssuer = token(testKey(), "someone-else", "alice", List.of("RISK_OWNER"), Instant.now().plusSeconds(600));
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        String foreignKey = token(generator.generateKeyPair().getPrivate(), "rcp-gateway", "alice",
                List.of("RISK_OWNER"), Instant.now().plusSeconds(600));

        for (String token : List.of(expired, wrongIssuer, foreignKey, "not-a-jwt")) {
            mvc.perform(get("/api/risks").header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                    .andExpect(status().isUnauthorized());
        }
    }

    @Test
    void theOwnerComesFromTheTokenNotTheRequestBody() throws Exception {
        mvc.perform(post("/api/risks").contentType(MediaType.APPLICATION_JSON).content("""
                        {"title": "x", "category": "CYBER", "owner": "mallory", "likelihood": 2, "impact": 2}
                        """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.owner").value("alice"));
    }

    @Test
    void anotherRiskOwnerCannotChangeSomeoneElsesRisk() throws Exception {
        String alices = createRisk("alice", 3, 3);
        String edit = "{\"title\": \"Hijacked\", \"category\": \"CYBER\", \"likelihood\": 1, \"impact\": 1, \"version\": 0}";

        mvc.perform(put("/api/risks/{id}", alices).with(user("bob").roles("RISK_OWNER"))
                        .contentType(MediaType.APPLICATION_JSON).content(edit))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.detail").value(containsString("Only the owner")));
        mvc.perform(patch("/api/risks/{id}/status", alices).with(user("bob").roles("RISK_OWNER"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\": \"CLOSED\", \"version\": 0}"))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/risks/{riskId}/controls/{controlId}", alices, UUID.randomUUID())
                        .with(user("bob").roles("RISK_OWNER")))
                .andExpect(status().isForbidden());

        mvc.perform(put("/api/risks/{id}", alices).contentType(MediaType.APPLICATION_JSON).content(edit))
                .andExpect(status().isOk());
    }

    @Test
    void otherRolesCanReadButNotWrite() throws Exception {
        String risk = createRisk("alice", 3, 3);

        for (String role : List.of("VIEWER", "CONTROL_OWNER", "CONTROL_TESTER")) {
            mvc.perform(get("/api/risks/{id}", risk).with(user("someone").roles(role))).andExpect(status().isOk());
            mvc.perform(get("/api/dashboard/heatmap").with(user("someone").roles(role))).andExpect(status().isOk());
            mvc.perform(post("/api/risks").with(user("someone").roles(role)).contentType(MediaType.APPLICATION_JSON)
                            .content("{\"title\": \"x\", \"category\": \"CYBER\", \"likelihood\": 2, \"impact\": 2}"))
                    .andExpect(status().isForbidden());
        }
    }

    @Test
    @WithAnonymousUser
    void healthAndApiDocsArePublic() throws Exception {
        mvc.perform(get("/actuator/health")).andExpect(status().isOk());
        String docs = mvc.perform(get("/v3/api-docs")).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(docs).contains("\"bearer\"");
    }

    @Test
    @WithAnonymousUser
    void oversizedBodiesAreRefusedBeforeTheyAreRead() throws Exception {
        String huge = "{\"title\": \"" + "A".repeat(300 * 1024) + "\", \"category\": \"CYBER\", \"likelihood\": 2, \"impact\": 2}";
        mvc.perform(post("/api/risks").header(HttpHeaders.AUTHORIZATION, "Bearer " + validToken("alice", "RISK_OWNER"))
                        .contentType(MediaType.APPLICATION_JSON).content(huge))
                .andExpect(status().is(413))
                .andExpect(jsonPath("$.title").value("Request too large"));
    }

    /** Found by OWASP ZAP: PostgreSQL can't store NUL, which surfaced as a 500. */
    @Test
    @WithAnonymousUser
    void nulCharactersAreRejectedAsBadInput() throws Exception {
        String alice = "Bearer " + validToken("alice", "RISK_OWNER");
        mvc.perform(post("/api/risks").header(HttpHeaders.AUTHORIZATION, alice).contentType(MediaType.APPLICATION_JSON)
                        // A JSON escape, so the body is valid JSON that decodes to a title containing NUL.
                        .content("{\"title\": \"a\\u0000b\", \"category\": \"CYBER\", \"likelihood\": 2, \"impact\": 2}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors.title").value("must not contain NUL characters"));
        mvc.perform(get("/api/risks").param("owner", "alice" + (char) 0).header(HttpHeaders.AUTHORIZATION, alice))
                .andExpect(status().isBadRequest());
    }
}
