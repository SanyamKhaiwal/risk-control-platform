package com.riskcontrol.risk.api;

import static org.hamcrest.Matchers.hasSize;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.riskcontrol.risk.client.ControlSummary;
import com.riskcontrol.risk.error.NotFoundException;
import com.riskcontrol.risk.error.ServiceUnavailableException;
import com.riskcontrol.risk.scoring.ControlType;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class LinkApiTests extends ApiTestSupport {

    private UUID givenControl(ControlType type, String effectiveness) {
        UUID id = UUID.randomUUID();
        when(controlClient.getControl(id)).thenReturn(new ControlSummary(id, type,
                effectiveness == null ? null : new BigDecimal(effectiveness),
                effectiveness == null ? null : Instant.parse("2026-10-28T10:00:00Z")));
        return id;
    }

    @Test
    void linkingAPartiallyEffectivePreventiveControlLowersResidualLikelihood() throws Exception {
        String riskId = createRisk("alice", 4, 5);
        UUID mfa = givenControl(ControlType.PREVENTIVE, "0.5");

        mvc.perform(post("/api/risks/{riskId}/controls/{controlId}", riskId, mfa))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.controlId").value(mfa.toString()))
                .andExpect(jsonPath("$.controlType").value("PREVENTIVE"))
                .andExpect(jsonPath("$.latestEffectiveness").value(0.5));

        mvc.perform(get("/api/risks/{id}", riskId))
                .andExpect(jsonPath("$.inherentScore").value(20))
                .andExpect(jsonPath("$.residualLikelihood").value(2))
                .andExpect(jsonPath("$.residualImpact").value(5))
                .andExpect(jsonPath("$.residualScore").value(10))
                .andExpect(jsonPath("$.rating").value("MEDIUM"));

        mvc.perform(get("/api/risks/{id}/history", riskId))
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].cause").value("LINKED"))
                .andExpect(jsonPath("$[0].causeControlId").value(mfa.toString()))
                .andExpect(jsonPath("$[0].residualScore").value(10));

        mvc.perform(get("/api/risks/{riskId}/controls", riskId))
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].controlId").value(mfa.toString()));
    }

    @Test
    void linkingAnUntestedControlLeavesTheScoreUnchanged() throws Exception {
        String riskId = createRisk("alice", 4, 5);
        UUID siem = givenControl(ControlType.DETECTIVE, null);

        mvc.perform(post("/api/risks/{riskId}/controls/{controlId}", riskId, siem))
                .andExpect(status().isCreated());

        mvc.perform(get("/api/risks/{id}", riskId)).andExpect(jsonPath("$.residualScore").value(20));
        mvc.perform(get("/api/risks/{id}/history", riskId)).andExpect(jsonPath("$", hasSize(1)));
    }

    @Test
    void unlinkingRestoresTheScore() throws Exception {
        String riskId = createRisk("alice", 4, 5);
        UUID mfa = givenControl(ControlType.PREVENTIVE, "1.0");
        mvc.perform(post("/api/risks/{riskId}/controls/{controlId}", riskId, mfa)).andExpect(status().isCreated());
        mvc.perform(get("/api/risks/{id}", riskId)).andExpect(jsonPath("$.residualScore").value(5));

        mvc.perform(delete("/api/risks/{riskId}/controls/{controlId}", riskId, mfa))
                .andExpect(status().isNoContent());

        mvc.perform(get("/api/risks/{id}", riskId)).andExpect(jsonPath("$.residualScore").value(20));
        mvc.perform(get("/api/risks/{id}/history", riskId)).andExpect(jsonPath("$[0].cause").value("UNLINKED"));
        mvc.perform(delete("/api/risks/{riskId}/controls/{controlId}", riskId, mfa))
                .andExpect(status().isNotFound());
    }

    @Test
    void duplicateLinkIsConflictWithoutCallingTheControlServiceAgain() throws Exception {
        String riskId = createRisk("alice", 3, 3);
        UUID control = givenControl(ControlType.CORRECTIVE, "0.5");
        mvc.perform(post("/api/risks/{riskId}/controls/{controlId}", riskId, control)).andExpect(status().isCreated());

        mvc.perform(post("/api/risks/{riskId}/controls/{controlId}", riskId, control))
                .andExpect(status().isConflict());

        verify(controlClient, times(1)).getControl(control);
    }

    @Test
    void unknownControlIsNotFound() throws Exception {
        String riskId = createRisk("alice", 3, 3);
        UUID unknown = UUID.randomUUID();
        when(controlClient.getControl(unknown)).thenThrow(new NotFoundException("Control " + unknown + " not found"));

        mvc.perform(post("/api/risks/{riskId}/controls/{controlId}", riskId, unknown))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/risks/{riskId}/controls", riskId)).andExpect(jsonPath("$", hasSize(0)));
    }

    @Test
    void controlServiceDownIsServiceUnavailable() throws Exception {
        String riskId = createRisk("alice", 3, 3);
        when(controlClient.getControl(any())).thenThrow(new ServiceUnavailableException("Control Service is unavailable", null));

        mvc.perform(post("/api/risks/{riskId}/controls/{controlId}", riskId, UUID.randomUUID()))
                .andExpect(status().isServiceUnavailable());
    }

    @Test
    void closedRiskCannotBeLinked() throws Exception {
        String riskId = createRisk("alice", 3, 3);
        mvc.perform(patch("/api/risks/{id}/status", riskId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\": \"CLOSED\", \"version\": 0}")).andExpect(status().isOk());

        mvc.perform(post("/api/risks/{riskId}/controls/{controlId}", riskId, UUID.randomUUID()))
                .andExpect(status().isConflict());

        verify(controlClient, never()).getControl(any());
    }

    @Test
    void registerCanBeFilteredByControl() throws Exception {
        UUID shared = givenControl(ControlType.PREVENTIVE, "0.5");
        String first = createRisk("alice", 4, 4);
        String second = createRisk("bob", 2, 2);
        createRisk("carol", 5, 5);
        mvc.perform(post("/api/risks/{riskId}/controls/{controlId}", first, shared)).andExpect(status().isCreated());
        mvc.perform(post("/api/risks/{riskId}/controls/{controlId}", second, shared).with(asOwnerOf(second))).andExpect(status().isCreated());

        mvc.perform(get("/api/risks").param("controlId", shared.toString()))
                .andExpect(jsonPath("$.totalElements").value(2));
    }
}
