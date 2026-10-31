package com.riskcontrol.control.api;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.riskcontrol.control.TestcontainersConfiguration;
import com.riskcontrol.control.domain.Assessment;
import com.riskcontrol.control.domain.Control;
import com.riskcontrol.control.events.ProcessedEvent;
import com.riskcontrol.control.outbox.OutboxMessage;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/** Full application against a real MongoDB replica set and Kafka. Requests run as carol (CONTROL_TESTER) by default. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(TestcontainersConfiguration.class)
@WithMockUser(username = "carol", roles = "CONTROL_TESTER")
abstract class ApiTestSupport {

    @Autowired
    protected MockMvc mvc;

    @Autowired
    protected MongoTemplate mongo;

    /** Removes documents but keeps the collections and their indexes. */
    @BeforeEach
    void cleanDatabase() {
        mongo.remove(new Query(), Control.class);
        mongo.remove(new Query(), Assessment.class);
        mongo.remove(new Query(), OutboxMessage.class);
        mongo.remove(new Query(), ProcessedEvent.class);
    }

    protected String createControl(String owner, String type) throws Exception {
        String body = """
                {"name": "Control of %s", "description": "test", "type": "%s", "frequency": "QUARTERLY"}
                """.formatted(owner, type);
        MvcResult result = mvc.perform(post("/api/controls").with(user(owner).roles("CONTROL_OWNER"))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andReturn();
        return JsonPath.read(result.getResponse().getContentAsString(), "$.id");
    }

    protected String assess(String controlId, String result, String tester) throws Exception {
        String body = """
                {"result": "%s", "evidence": "evidence for %s", "comments": "ok"}
                """.formatted(result, result);
        MvcResult response = mvc.perform(post("/api/controls/{id}/assessments", controlId)
                        .with(user(tester).roles("CONTROL_TESTER"))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andReturn();
        return JsonPath.read(response.getResponse().getContentAsString(), "$.id");
    }
}
