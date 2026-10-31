package com.riskcontrol.control.api;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.io.InputStream;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.converter.RsaKeyConverters;
import org.springframework.security.test.context.support.WithAnonymousUser;

/** Real RS256 tokens and the role, ownership and segregation-of-duties rules. */
class SecurityApiTests extends ApiTestSupport {

    private static final String NEW_CONTROL = "{\"name\": \"x\", \"type\": \"PREVENTIVE\", \"frequency\": \"MONTHLY\"}";

    private static String token(String subject, String... roles) throws Exception {
        try (InputStream in = new ClassPathResource("test-keys/jwt-private.pem").getInputStream()) {
            JWTClaimsSet claims = new JWTClaimsSet.Builder().issuer("rcp-gateway").subject(subject)
                    .claim("roles", List.of(roles)).expirationTime(Date.from(Instant.now().plusSeconds(600))).build();
            SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.RS256), claims);
            jwt.sign(new RSASSASigner(RsaKeyConverters.pkcs8().convert(in)));
            return "Bearer " + jwt.serialize();
        }
    }

    @Test
    @WithAnonymousUser
    void requestsWithoutATokenGet401() throws Exception {
        mvc.perform(get("/api/controls")).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.title").value("Unauthorized"));
    }

    @Test
    @WithAnonymousUser
    void realTokensAreAcceptedAndTheirRolesApply() throws Exception {
        mvc.perform(get("/api/controls").header(HttpHeaders.AUTHORIZATION, token("dave", "VIEWER")))
                .andExpect(status().isOk());
        mvc.perform(post("/api/controls").header(HttpHeaders.AUTHORIZATION, token("dave", "VIEWER"))
                        .contentType(MediaType.APPLICATION_JSON).content(NEW_CONTROL))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/controls").header(HttpHeaders.AUTHORIZATION, token("bob", "CONTROL_OWNER"))
                        .contentType(MediaType.APPLICATION_JSON).content(NEW_CONTROL))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.owner").value("bob"));
    }

    @Test
    void onlyTestersCanRecordAssessmentsAndTheTesterComesFromTheToken() throws Exception {
        String controlId = createControl("bob", "PREVENTIVE");

        mvc.perform(post("/api/controls/{id}/assessments", controlId).with(user("bob").roles("CONTROL_OWNER"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"result\": \"EFFECTIVE\"}"))
                .andExpect(status().isForbidden());

        mvc.perform(post("/api/controls/{id}/assessments", controlId).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"result\": \"EFFECTIVE\", \"tester\": \"mallory\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.tester").value("carol"));
    }

    @Test
    void aUserWithBothControlRolesStillCannotAssessTheirOwnControl() throws Exception {
        String erinsControl = createControl("erin", "DETECTIVE");
        String bobsControl = createControl("bob", "DETECTIVE");

        mvc.perform(post("/api/controls/{id}/assessments", erinsControl)
                        .with(user("erin").roles("CONTROL_OWNER", "CONTROL_TESTER"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"result\": \"EFFECTIVE\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.detail").value(containsString("Segregation of duties")));

        mvc.perform(post("/api/controls/{id}/assessments", bobsControl)
                        .with(user("erin").roles("CONTROL_OWNER", "CONTROL_TESTER"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"result\": \"EFFECTIVE\"}"))
                .andExpect(status().isCreated());
    }

    @Test
    void anotherControlOwnerCannotEditSomeoneElsesControl() throws Exception {
        String bobsControl = createControl("bob", "PREVENTIVE");

        mvc.perform(put("/api/controls/{id}", bobsControl).with(user("erin").roles("CONTROL_OWNER"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\": \"Mine now\", \"frequency\": \"MONTHLY\", \"version\": 0}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.detail").value(containsString("Only the owner")));
    }

    @Test
    @WithAnonymousUser
    void oversizedBodiesAreRefusedBeforeTheyAreRead() throws Exception {
        String huge = "{\"name\": \"" + "A".repeat(300 * 1024) + "\", \"type\": \"PREVENTIVE\", \"frequency\": \"MONTHLY\"}";
        mvc.perform(post("/api/controls").header(HttpHeaders.AUTHORIZATION, token("bob", "CONTROL_OWNER"))
                        .contentType(MediaType.APPLICATION_JSON).content(huge))
                .andExpect(status().is(413))
                .andExpect(jsonPath("$.title").value("Request too large"));
    }
}
