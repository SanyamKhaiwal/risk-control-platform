package com.riskcontrol.risk.api;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class RiskApiTests extends ApiTestSupport {

    @Test
    void createsRiskWithScoresAndHistory() throws Exception {
        mvc.perform(post("/api/risks").contentType(MediaType.APPLICATION_JSON).content("""
                        {"title": "Account takeover", "category": "CYBER", "likelihood": 4, "impact": 5}
                        """))
                .andExpect(status().isCreated())
                .andExpect(header().string("Location", containsString("/api/risks/")))
                .andExpect(jsonPath("$.inherentScore").value(20))
                .andExpect(jsonPath("$.inherentRating").value("CRITICAL"))
                .andExpect(jsonPath("$.residualLikelihood").value(4))
                .andExpect(jsonPath("$.residualImpact").value(5))
                .andExpect(jsonPath("$.residualScore").value(20))
                .andExpect(jsonPath("$.rating").value("CRITICAL"))
                .andExpect(jsonPath("$.status").value("OPEN"))
                .andExpect(jsonPath("$.version").value(0));

        String id = createRisk("alice", 2, 3);
        mvc.perform(get("/api/risks/{id}/history", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].cause").value("CREATED"))
                .andExpect(jsonPath("$[0].residualScore").value(6));
    }

    @Test
    void invalidRequestReturnsProblemWithFieldErrors() throws Exception {
        mvc.perform(post("/api/risks").contentType(MediaType.APPLICATION_JSON).content("""
                        {"title": "", "category": "CYBER", "likelihood": 6, "impact": 3}
                        """))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.errors.title").exists())
                .andExpect(jsonPath("$.errors.likelihood").exists());
    }

    @Test
    void unknownEnumValueIsBadRequest() throws Exception {
        mvc.perform(post("/api/risks").contentType(MediaType.APPLICATION_JSON).content("""
                        {"title": "x", "category": "WEATHER", "likelihood": 3, "impact": 3}
                        """))
                .andExpect(status().isBadRequest());
    }

    @Test
    void unknownRiskIsNotFoundProblem() throws Exception {
        mvc.perform(get("/api/risks/{id}", UUID.randomUUID()))
                .andExpect(status().isNotFound())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.title").value("Not found"));
    }

    @Test
    void updateRescoresAndRejectsStaleVersion() throws Exception {
        String id = createRisk("alice", 2, 2);
        String edit = """
                {"title": "Edited", "category": "FRAUD", "likelihood": 5, "impact": 5, "version": 0}
                """;

        mvc.perform(put("/api/risks/{id}", id).contentType(MediaType.APPLICATION_JSON).content(edit))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Edited"))
                .andExpect(jsonPath("$.inherentScore").value(25))
                .andExpect(jsonPath("$.rating").value("CRITICAL"))
                .andExpect(jsonPath("$.version").value(1));

        mvc.perform(put("/api/risks/{id}", id).contentType(MediaType.APPLICATION_JSON).content(edit))
                .andExpect(status().isConflict());

        mvc.perform(get("/api/risks/{id}/history", id))
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].cause").value("EDITED"))
                .andExpect(jsonPath("$[0].residualScore").value(25));
    }

    @Test
    void closedRiskCannotBeEditedUntilReopened() throws Exception {
        String id = createRisk("alice", 3, 3);

        mvc.perform(patch("/api/risks/{id}/status", id).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\": \"CLOSED\", \"version\": 0}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CLOSED"))
                .andExpect(jsonPath("$.version").value(1));

        mvc.perform(put("/api/risks/{id}", id).contentType(MediaType.APPLICATION_JSON).content("""
                        {"title": "x", "category": "CYBER", "likelihood": 1, "impact": 1, "version": 1}
                        """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail").value(containsString("closed")));

        mvc.perform(patch("/api/risks/{id}/status", id).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\": \"CLOSED\", \"version\": 1}"))
                .andExpect(status().isConflict());

        mvc.perform(patch("/api/risks/{id}/status", id).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\": \"OPEN\", \"version\": 1}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("OPEN"));
    }

    @Test
    void listFiltersAndOrdersByResidualScore() throws Exception {
        createRisk("alice", 5, 5); // 25 CRITICAL
        createRisk("alice", 1, 2); // 2 LOW
        createRisk("bob", 3, 3);   // 9 MEDIUM

        mvc.perform(get("/api/risks"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.content[0].residualScore").value(25))
                .andExpect(jsonPath("$.content[1].residualScore").value(9))
                .andExpect(jsonPath("$.content[2].residualScore").value(2));

        mvc.perform(get("/api/risks").param("owner", "alice"))
                .andExpect(jsonPath("$.totalElements").value(2));

        mvc.perform(get("/api/risks").param("rating", "LOW"))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].residualScore").value(2));

        mvc.perform(get("/api/risks").param("owner", "alice").param("rating", "CRITICAL").param("status", "OPEN"))
                .andExpect(jsonPath("$.totalElements").value(1));

        mvc.perform(get("/api/risks").param("size", "2"))
                .andExpect(jsonPath("$.content", hasSize(2)))
                .andExpect(jsonPath("$.totalPages").value(2));

        mvc.perform(get("/api/risks").param("size", "101"))
                .andExpect(status().isBadRequest());
    }
}
