package com.riskcontrol.control.api;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class ControlApiTests extends ApiTestSupport {

    @Test
    void createsUntestedControl() throws Exception {
        mvc.perform(post("/api/controls").with(user("bob").roles("CONTROL_OWNER")).contentType(MediaType.APPLICATION_JSON).content("""
                        {"name": "MFA on admin accounts", "type": "PREVENTIVE", "frequency": "QUARTERLY"}
                        """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.owner").value("bob"))
                .andExpect(header().string("Location", containsString("/api/controls/")))
                .andExpect(jsonPath("$.type").value("PREVENTIVE"))
                .andExpect(jsonPath("$.latestResult").doesNotExist())
                .andExpect(jsonPath("$.latestEffectiveness").doesNotExist())
                .andExpect(jsonPath("$.assessmentCount").value(0))
                .andExpect(jsonPath("$.retestRequired").value(false))
                .andExpect(jsonPath("$.version").value(0));
    }

    @Test
    void invalidRequestReturnsProblemWithFieldErrors() throws Exception {
        mvc.perform(post("/api/controls").with(user("bob").roles("CONTROL_OWNER")).contentType(MediaType.APPLICATION_JSON).content("""
                        {"name": "", "frequency": "QUARTERLY"}
                        """))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.errors.name").exists())
                .andExpect(jsonPath("$.errors.type").exists());
    }

    @Test
    void unknownControlIsNotFoundProblem() throws Exception {
        mvc.perform(get("/api/controls/{id}", UUID.randomUUID()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.title").value("Not found"));
    }

    @Test
    void updateKeepsTypeAndOwnerAndRejectsStaleVersion() throws Exception {
        String id = createControl("bob", "DETECTIVE");
        String edit = """
                {"name": "SIEM alerting", "owner": "erin", "frequency": "MONTHLY", "type": "PREVENTIVE", "version": 0}
                """;

        mvc.perform(put("/api/controls/{id}", id).with(user("bob").roles("CONTROL_OWNER")).contentType(MediaType.APPLICATION_JSON).content(edit))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("SIEM alerting"))
                .andExpect(jsonPath("$.owner").value("bob"))
                .andExpect(jsonPath("$.frequency").value("MONTHLY"))
                .andExpect(jsonPath("$.type").value("DETECTIVE"))
                .andExpect(jsonPath("$.version").value(1));

        mvc.perform(put("/api/controls/{id}", id).with(user("bob").roles("CONTROL_OWNER")).contentType(MediaType.APPLICATION_JSON).content(edit))
                .andExpect(status().isConflict());
    }

    @Test
    void listFiltersByTypeOwnerAndRetestFlag() throws Exception {
        createControl("bob", "PREVENTIVE");
        createControl("bob", "DETECTIVE");
        createControl("erin", "PREVENTIVE");

        mvc.perform(get("/api/controls"))
                .andExpect(jsonPath("$.totalElements").value(3));
        mvc.perform(get("/api/controls").param("type", "PREVENTIVE"))
                .andExpect(jsonPath("$.totalElements").value(2));
        mvc.perform(get("/api/controls").param("type", "PREVENTIVE").param("owner", "bob"))
                .andExpect(jsonPath("$.totalElements").value(1));
        mvc.perform(get("/api/controls").param("retestRequired", "true"))
                .andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/api/controls").param("size", "2"))
                .andExpect(jsonPath("$.content", hasSize(2)))
                .andExpect(jsonPath("$.totalPages").value(2));
    }
}
