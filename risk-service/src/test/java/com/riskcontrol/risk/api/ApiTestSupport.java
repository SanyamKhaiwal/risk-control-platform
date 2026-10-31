package com.riskcontrol.risk.api;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.riskcontrol.risk.TestcontainersConfiguration;
import com.riskcontrol.risk.client.ControlClient;
import java.util.Objects;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.cache.CacheManager;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/**
 * Full application against real PostgreSQL, Kafka and Redis; the Control Service client is mocked.
 * Requests run as alice (RISK_OWNER) unless a test says otherwise; SecurityApiTests uses real tokens.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(TestcontainersConfiguration.class)
@WithMockUser(username = "alice", roles = "RISK_OWNER")
abstract class ApiTestSupport {

    @Autowired
    protected MockMvc mvc;

    @Autowired
    protected JdbcTemplate jdbc;

    @MockitoBean
    protected ControlClient controlClient;

    @Autowired
    private CacheManager caches;

    @BeforeEach
    void cleanState() {
        jdbc.execute("truncate risk, risk_control_link, risk_score_history, outbox, processed_event cascade");
        caches.getCacheNames().forEach(name -> Objects.requireNonNull(caches.getCache(name)).clear());
    }

    /** Creates a risk owned by {@code owner} (the owner is always the logged-in user). */
    protected String createRisk(String owner, int likelihood, int impact) throws Exception {
        String body = """
                {"title": "Risk of %s", "description": "test", "category": "CYBER", "likelihood": %d, "impact": %d}
                """.formatted(owner, likelihood, impact);
        MvcResult result = mvc.perform(post("/api/risks").with(user(owner).roles("RISK_OWNER"))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andReturn();
        return JsonPath.read(result.getResponse().getContentAsString(), "$.id");
    }

    /** Runs a request as the risk's owner, for changes only the owner may make. */
    protected RequestPostProcessor asOwnerOf(String riskId) {
        String owner = jdbc.queryForObject("select owner from risk where id = ?::uuid", String.class, riskId);
        return user(owner).roles("RISK_OWNER");
    }

    protected int residualScore(String riskId) {
        return Objects.requireNonNull(jdbc.queryForObject("select residual_score from risk where id = ?::uuid",
                Integer.class, riskId));
    }
}
