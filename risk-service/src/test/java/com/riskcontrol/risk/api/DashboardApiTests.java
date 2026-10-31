package com.riskcontrol.risk.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.riskcontrol.risk.client.ControlSummary;
import com.riskcontrol.risk.scoring.ControlType;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;

class DashboardApiTests extends ApiTestSupport {

    @Autowired
    private StringRedisTemplate redis;

    @Test
    void heatmapCountsRisksPerCellAndLeavesOutClosedRisks() throws Exception {
        createRisk("alice", 4, 5);
        createRisk("alice", 4, 5);
        createRisk("bob", 1, 1);
        String closed = createRisk("bob", 3, 3);
        mvc.perform(patch("/api/risks/{id}/status", closed).with(asOwnerOf(closed)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\": \"CLOSED\", \"version\": 0}")).andExpect(status().isOk());

        mvc.perform(get("/api/dashboard/heatmap"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalRisks").value(3))
                .andExpect(jsonPath("$.inherent", hasSize(5)))
                .andExpect(jsonPath("$.inherent[3][4]").value(2))
                .andExpect(jsonPath("$.inherent[0][0]").value(1))
                .andExpect(jsonPath("$.inherent[2][2]").value(0))
                .andExpect(jsonPath("$.residual[3][4]").value(2));
    }

    @Test
    void residualHeatmapMovesWhenAControlReducesTheRisk() throws Exception {
        String risk = createRisk("alice", 4, 5);
        UUID mfa = UUID.randomUUID();
        when(controlClient.getControl(mfa)).thenReturn(new ControlSummary(mfa, ControlType.PREVENTIVE,
                new BigDecimal("0.5"), Instant.parse("2026-10-28T10:00:00Z")));
        mvc.perform(get("/api/dashboard/heatmap")).andExpect(jsonPath("$.residual[3][4]").value(1));

        mvc.perform(post("/api/risks/{riskId}/controls/{controlId}", risk, mfa)).andExpect(status().isCreated());

        mvc.perform(get("/api/dashboard/heatmap"))
                .andExpect(jsonPath("$.inherent[3][4]").value(1))
                .andExpect(jsonPath("$.residual[3][4]").value(0))
                .andExpect(jsonPath("$.residual[1][4]").value(1));
    }

    @Test
    void heatmapIsCachedInRedisAndEvictedWhenARiskChanges() throws Exception {
        createRisk("alice", 2, 2);
        mvc.perform(get("/api/dashboard/heatmap")).andExpect(jsonPath("$.totalRisks").value(1));
        assertThat(redis.hasKey("dashHeatmap::all")).isTrue();
        assertThat(redis.opsForValue().get("dashHeatmap::all")).contains("\"totalRisks\":1");

        createRisk("bob", 3, 3);

        assertThat(redis.hasKey("dashHeatmap::all")).isFalse();
        mvc.perform(get("/api/dashboard/heatmap")).andExpect(jsonPath("$.totalRisks").value(2));
    }

    @Test
    void singleRiskIsCachedAndEvictedOnEdit() throws Exception {
        String id = createRisk("alice", 2, 2);
        mvc.perform(get("/api/risks/{id}", id)).andExpect(jsonPath("$.title").value("Risk of alice"));
        assertThat(redis.hasKey("risk::" + id)).isTrue();

        mvc.perform(put("/api/risks/{id}", id).contentType(MediaType.APPLICATION_JSON).content("""
                {"title": "Renamed", "category": "CYBER", "likelihood": 2, "impact": 2, "version": 0}
                """)).andExpect(status().isOk());

        assertThat(redis.hasKey("risk::" + id)).isFalse();
        mvc.perform(get("/api/risks/{id}", id)).andExpect(jsonPath("$.title").value("Renamed"));
    }

    @Test
    void topRisksAreOrderedLimitedAndExcludeClosed() throws Exception {
        createRisk("alice", 5, 5);
        createRisk("alice", 3, 3);
        createRisk("alice", 1, 2);
        String closed = createRisk("bob", 5, 4);
        mvc.perform(patch("/api/risks/{id}/status", closed).with(asOwnerOf(closed)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\": \"CLOSED\", \"version\": 0}")).andExpect(status().isOk());

        mvc.perform(get("/api/dashboard/top").param("limit", "2"))
                .andExpect(jsonPath("$.risks", hasSize(2)))
                .andExpect(jsonPath("$.risks[0].residualScore").value(25))
                .andExpect(jsonPath("$.risks[1].residualScore").value(9));
        assertThat(redis.hasKey("dashTop::2")).isTrue();

        mvc.perform(get("/api/dashboard/top").param("limit", "51")).andExpect(status().isBadRequest());
    }

    /** One request for the whole Overview screen, served from the same caches (docs/performance.md). */
    @Test
    void overviewHasBothHeatMapsAndTheTopRisksInOneResponse() throws Exception {
        createRisk("alice", 5, 5);
        createRisk("alice", 2, 3);

        String overview = mvc.perform(get("/api/dashboard/overview").param("limit", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.heatmap.inherent", hasSize(5)))
                .andExpect(jsonPath("$.top.risks", hasSize(1)))
                .andExpect(jsonPath("$.top.risks[0].residualScore").value(25))
                .andReturn().getResponse().getContentAsString();
        String heatmap = mvc.perform(get("/api/dashboard/heatmap")).andReturn().getResponse().getContentAsString();
        assertThat(overview).contains(heatmap);
        assertThat(redis.hasKey("dashTop::1")).isTrue();
    }

    /** Clearing only what a change affects (docs/performance.md): a text edit leaves the heat-map's counts cached. */
    @Test
    void aTextOnlyEditKeepsTheHeatMapCachedAndAScoreEditClearsIt() throws Exception {
        String risk = createRisk("alice", 3, 3);
        mvc.perform(get("/api/dashboard/heatmap")).andExpect(status().isOk());
        assertThat(redis.hasKey("dashHeatmap::all")).isTrue();

        mvc.perform(put("/api/risks/{id}", risk).with(asOwnerOf(risk)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\": \"Reworded\", \"category\": \"CYBER\", \"likelihood\": 3, \"impact\": 3, \"version\": 0}"))
                .andExpect(status().isOk());
        assertThat(redis.hasKey("dashHeatmap::all")).as("text-only edit").isTrue();

        mvc.perform(put("/api/risks/{id}", risk).with(asOwnerOf(risk)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\": \"Reworded\", \"category\": \"CYBER\", \"likelihood\": 4, \"impact\": 3, \"version\": 1}"))
                .andExpect(status().isOk());
        assertThat(redis.hasKey("dashHeatmap::all")).as("likelihood changed").isFalse();
    }
}
