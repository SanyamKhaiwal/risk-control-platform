package com.riskcontrol.control.api;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.data.mongodb.core.query.Criteria.where;
import static org.springframework.data.mongodb.core.query.Query.query;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.riskcontrol.control.domain.Assessment;
import com.riskcontrol.control.domain.AssessmentHasher;
import com.riskcontrol.control.domain.AssessmentResult;
import com.riskcontrol.control.domain.Control;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;

class AssessmentApiTests extends ApiTestSupport {

    @Test
    void recordingDerivesEffectivenessAndUpdatesTheControl() throws Exception {
        String controlId = createControl("bob", "PREVENTIVE");

        String body = mvc.perform(post("/api/controls/{id}/assessments", controlId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"result": "PARTIALLY_EFFECTIVE", "tester": "carol", "evidence": "2 of 5 admins without MFA"}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.sequence").value(1))
                .andExpect(jsonPath("$.effectiveness").value(0.5))
                .andExpect(jsonPath("$.prevHash").value(AssessmentHasher.GENESIS))
                .andExpect(jsonPath("$.hash").value(org.hamcrest.Matchers.matchesPattern("[0-9a-f]{64}")))
                .andReturn().getResponse().getContentAsString();
        String assessedAt = JsonPath.read(body, "$.assessedAt");

        mvc.perform(get("/api/controls/{id}", controlId))
                .andExpect(jsonPath("$.latestResult").value("PARTIALLY_EFFECTIVE"))
                .andExpect(jsonPath("$.latestEffectiveness").value(0.5))
                .andExpect(jsonPath("$.lastAssessedAt").value(assessedAt))
                .andExpect(jsonPath("$.assessmentCount").value(1))
                .andExpect(jsonPath("$.version").value(1));
    }

    @Test
    void clientCannotChooseTheEffectiveness() throws Exception {
        String controlId = createControl("bob", "PREVENTIVE");

        mvc.perform(post("/api/controls/{id}/assessments", controlId).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"result\": \"INEFFECTIVE\", \"tester\": \"carol\", \"effectiveness\": 1.0}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.effectiveness").value(0.0));
    }

    @Test
    void ownerCannotAssessTheirOwnControl() throws Exception {
        String controlId = createControl("bob", "PREVENTIVE");

        mvc.perform(post("/api/controls/{id}/assessments", controlId).with(user("bob").roles("CONTROL_OWNER", "CONTROL_TESTER")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"result\": \"EFFECTIVE\", \"tester\": \"bob\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.detail").value(containsString("Segregation of duties")));

        mvc.perform(get("/api/controls/{id}", controlId)).andExpect(jsonPath("$.assessmentCount").value(0));
    }

    @Test
    void assessingAnUnknownControlIsNotFound() throws Exception {
        mvc.perform(post("/api/controls/{id}/assessments", UUID.randomUUID()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"result\": \"EFFECTIVE\", \"tester\": \"carol\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void historyIsNewestFirstAndEachEntryChainsToThePrevious() throws Exception {
        String controlId = createControl("bob", "DETECTIVE");
        assess(controlId, "EFFECTIVE", "carol");
        assess(controlId, "PARTIALLY_EFFECTIVE", "carol");
        assess(controlId, "INEFFECTIVE", "dave");

        String body = mvc.perform(get("/api/controls/{id}/assessments", controlId))
                .andExpect(jsonPath("$.content", hasSize(3)))
                .andExpect(jsonPath("$.content[0].sequence").value(3))
                .andExpect(jsonPath("$.content[2].sequence").value(1))
                .andReturn().getResponse().getContentAsString();
        String newestPrev = JsonPath.read(body, "$.content[0].prevHash");
        String middleHash = JsonPath.read(body, "$.content[1].hash");
        org.assertj.core.api.Assertions.assertThat(newestPrev).isEqualTo(middleHash);

        mvc.perform(get("/api/controls/{id}/assessments/verify", controlId))
                .andExpect(jsonPath("$.valid").value(true))
                .andExpect(jsonPath("$.checked").value(3));
    }

    @Test
    void editingAnAssessmentInTheDatabaseIsDetected() throws Exception {
        String controlId = createControl("bob", "PREVENTIVE");
        assess(controlId, "INEFFECTIVE", "carol");
        String second = assess(controlId, "INEFFECTIVE", "carol");
        assess(controlId, "EFFECTIVE", "carol");

        mongo.updateFirst(query(where("_id").is(second)), Update.update("result", "EFFECTIVE"), Assessment.class);

        mvc.perform(get("/api/controls/{id}/assessments/verify", controlId))
                .andExpect(jsonPath("$.valid").value(false))
                .andExpect(jsonPath("$.checked").value(1))
                .andExpect(jsonPath("$.firstBrokenAssessmentId").value(second))
                .andExpect(jsonPath("$.reason").value(containsString("hash")));
    }

    /**
     * Found in the security review: with an unkeyed hash, someone with database access edited a result, recomputed
     * the hashes and /verify still said valid. Without the service's key, the recomputed hash doesn't match.
     */
    @Test
    void rewritingTheChainWithoutTheKeyIsDetected() throws Exception {
        String controlId = createControl("bob", "PREVENTIVE");
        String only = assess(controlId, "EFFECTIVE", "carol");

        Assessment forged = mongo.findById(only, Assessment.class);
        ReflectionTestUtils.setField(forged, "result", AssessmentResult.INEFFECTIVE);
        ReflectionTestUtils.setField(forged, "effectiveness", 0.0);
        String attackersHash = new AssessmentHasher("attacker does not have the key!!".getBytes()).hash(forged);
        mongo.updateFirst(query(where("_id").is(only)), new Update().set("result", "INEFFECTIVE").set("effectiveness", 0.0)
                .set("hash", attackersHash), Assessment.class);
        mongo.updateFirst(query(where("_id").is(controlId)), Update.update("lastAssessmentHash", attackersHash), Control.class);

        mvc.perform(get("/api/controls/{id}/assessments/verify", controlId))
                .andExpect(jsonPath("$.valid").value(false))
                .andExpect(jsonPath("$.firstBrokenAssessmentId").value(only))
                .andExpect(jsonPath("$.reason").value(containsString("hash")));
    }

    @Test
    void deletingAnAssessmentFromTheMiddleIsDetected() throws Exception {
        String controlId = createControl("bob", "PREVENTIVE");
        assess(controlId, "EFFECTIVE", "carol");
        String second = assess(controlId, "INEFFECTIVE", "carol");
        String third = assess(controlId, "EFFECTIVE", "carol");

        mongo.remove(query(where("_id").is(second)), Assessment.class);

        mvc.perform(get("/api/controls/{id}/assessments/verify", controlId))
                .andExpect(jsonPath("$.valid").value(false))
                .andExpect(jsonPath("$.firstBrokenAssessmentId").value(third))
                .andExpect(jsonPath("$.reason").value(containsString("Sequence gap")));
    }

    /**
     * Found by the independent reviewer: delete the newest (failing) assessment and move the control's head back to
     * the older (passing) one. Every value needed is in the database, so only the keyed head seal catches it.
     */
    @Test
    void rollingTheChainHeadBackToAnOlderAssessmentIsDetected() throws Exception {
        String controlId = createControl("bob", "PREVENTIVE");
        String passed = assess(controlId, "EFFECTIVE", "carol");
        String failed = assess(controlId, "INEFFECTIVE", "carol");
        Assessment older = mongo.findById(passed, Assessment.class);

        mongo.remove(query(where("_id").is(failed)), Assessment.class);
        mongo.updateFirst(query(where("_id").is(controlId)), new Update().set("assessmentCount", 1)
                .set("lastAssessmentHash", older.getHash()).set("latestResult", "EFFECTIVE")
                .set("latestEffectiveness", 1.0).set("lastAssessedAt", older.getAssessedAt()), Control.class);

        mvc.perform(get("/api/controls/{id}/assessments/verify", controlId))
                .andExpect(jsonPath("$.valid").value(false))
                .andExpect(jsonPath("$.checked").value(1))
                .andExpect(jsonPath("$.reason").value(containsString("seal")));
    }

    @Test
    void deletingTheLatestAssessmentIsDetected() throws Exception {
        String controlId = createControl("bob", "PREVENTIVE");
        assess(controlId, "EFFECTIVE", "carol");
        String latest = assess(controlId, "INEFFECTIVE", "carol");

        mongo.remove(query(where("_id").is(latest)), Assessment.class);

        mvc.perform(get("/api/controls/{id}/assessments/verify", controlId))
                .andExpect(jsonPath("$.valid").value(false))
                .andExpect(jsonPath("$.checked").value(1))
                .andExpect(jsonPath("$.reason").value(containsString("missing from the end")));
    }

    @Test
    void newAssessmentClearsTheRetestFlag() throws Exception {
        String controlId = createControl("bob", "PREVENTIVE");
        mongo.updateFirst(query(where("_id").is(controlId)),
                Update.update("retestRequired", true).set("retestReason", "Linked risk became HIGH"), Control.class);
        mvc.perform(get("/api/controls").param("retestRequired", "true")).andExpect(jsonPath("$.totalElements").value(1));

        assess(controlId, "EFFECTIVE", "carol");

        mvc.perform(get("/api/controls/{id}", controlId))
                .andExpect(jsonPath("$.retestRequired").value(false))
                .andExpect(jsonPath("$.retestReason").doesNotExist());
    }
}
