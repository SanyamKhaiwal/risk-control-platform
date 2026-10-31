package com.riskcontrol.control.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.springframework.data.mongodb.core.query.Criteria.where;
import static org.springframework.data.mongodb.core.query.Query.query;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.riskcontrol.control.KafkaTestConsumer;
import com.riskcontrol.control.domain.Control;
import com.riskcontrol.control.events.EventSignatures;
import com.riskcontrol.control.events.EventTopics;
import com.riskcontrol.control.outbox.OutboxMessage;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.http.MediaType;
import org.springframework.kafka.core.ConsumerFactory;
import org.springframework.kafka.core.KafkaTemplate;

/** control.assessed out, risk.updated in (ARCHITECTURE.md §8). */
class EventFlowTests extends ApiTestSupport {

    /** Signs as the Risk Service would, and checks what this service publishes against its public key. */
    private static final EventSignatures RISK_SERVICE = keys("events-risk-private.pem", "events-control-public.pem");
    /** This service's own key: a valid signature, but not the Risk Service's. */
    private static final EventSignatures WRONG_SIGNER = keys("events-control-private.pem", "events-control-public.pem");

    private static EventSignatures keys(String signing, String peer) {
        return new EventSignatures(new ClassPathResource("test-keys/" + signing), new ClassPathResource("test-keys/" + peer));
    }

    @Autowired
    private KafkaTemplate<String, String> kafka;

    @Autowired
    private ConsumerFactory<String, String> consumers;

    private void sendRiskUpdated(UUID eventId, UUID riskId, String rating, String previousRating, String... controlIds)
            throws Exception {
        send(riskId.toString(), riskUpdatedPayload(eventId, riskId, rating, previousRating, controlIds), RISK_SERVICE);
    }

    /** Publishes with the given signer, or unsigned when {@code signer} is null. */
    private void send(String key, String payload, EventSignatures signer) throws Exception {
        ProducerRecord<String, String> record = new ProducerRecord<>(EventTopics.RISK_UPDATED, key, payload);
        if (signer != null) {
            record.headers().add(EventSignatures.HEADER, signer.sign(payload).getBytes(StandardCharsets.US_ASCII));
        }
        kafka.send(record).get();
    }

    private static String riskUpdatedPayload(UUID eventId, UUID riskId, String rating, String previousRating,
                                             String... controlIds) {
        String ids = String.join("\", \"", controlIds);
        return """
                {"eventId": "%s", "schemaVersion": 1, "riskId": "%s", "title": "Account takeover", "cause": "ASSESSMENT", "status": "OPEN",
                 "inherentScore": 20, "residualScore": 16, "rating": "%s", "previousRating": %s,
                 "controlIds": ["%s"], "updatedAt": "2026-10-28T10:00:00Z"}
                """.formatted(eventId, riskId, rating, previousRating == null ? "null" : "\"" + previousRating + "\"", ids);
    }

    private boolean retestRequired(String controlId) {
        return mongo.findById(controlId, Control.class).isRetestRequired();
    }

    @Test
    void assessmentIsPublishedAsControlAssessedThroughTheOutbox() throws Exception {
        String controlId = createControl("bob", "PREVENTIVE");

        String assessmentId = assess(controlId, "PARTIALLY_EFFECTIVE", "carol");

        ConsumerRecord<String, String> record = KafkaTestConsumer.awaitRecord(consumers, EventTopics.CONTROL_ASSESSED,
                r -> r.value().contains(assessmentId));
        assertThat(record.key()).isEqualTo(controlId);
        assertThat((String) JsonPath.read(record.value(), "$.controlType")).isEqualTo("PREVENTIVE");
        assertThat((Double) JsonPath.read(record.value(), "$.effectiveness")).isEqualTo(0.5);
        assertThat((Integer) JsonPath.read(record.value(), "$.schemaVersion")).isEqualTo(1);
        assertThat(RISK_SERVICE.signedByPeer(record.value(), record.headers().lastHeader(EventSignatures.HEADER).value()))
                .as("published events carry this service's signature").isTrue();
        await().atMost(Duration.ofSeconds(5)).until(() ->
                mongo.count(query(where("publishedAt").is(null)), OutboxMessage.class) == 0);
    }

    @Test
    void refusedAssessmentWritesNoEvent() throws Exception {
        String controlId = createControl("bob", "PREVENTIVE");

        mvc.perform(post("/api/controls/{id}/assessments", controlId).with(user("bob").roles("CONTROL_OWNER", "CONTROL_TESTER")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"result\": \"EFFECTIVE\", \"tester\": \"bob\"}")).andExpect(status().isForbidden());

        assertThat(mongo.count(new Query(), OutboxMessage.class)).isZero();
    }

    @Test
    void worseningRiskFlagsOnlyStaleLinkedControls() throws Exception {
        String neverTested = createControl("bob", "PREVENTIVE");
        String testedLongAgo = createControl("bob", "DETECTIVE");
        String testedToday = createControl("bob", "CORRECTIVE");
        assess(testedLongAgo, "EFFECTIVE", "carol");
        mongo.updateFirst(query(where("_id").is(testedLongAgo)),
                Update.update("lastAssessedAt", Instant.now().minus(Duration.ofDays(45))), Control.class);
        assess(testedToday, "EFFECTIVE", "carol");
        UUID riskId = UUID.randomUUID();

        sendRiskUpdated(UUID.randomUUID(), riskId, "HIGH", "MEDIUM", neverTested, testedLongAgo, testedToday);

        await().atMost(Duration.ofSeconds(15)).until(() -> retestRequired(neverTested) && retestRequired(testedLongAgo));
        assertThat(retestRequired(testedToday)).isFalse();
        assertThat(mongo.findById(neverTested, Control.class).getRetestReason())
                .isEqualTo("Account takeover rose to High");
        assertThat(mongo.findById(neverTested, Control.class).getRetestRiskId()).isEqualTo(riskId.toString());
        mvc.perform(get("/api/controls").param("retestRequired", "true"))
                .andExpect(jsonPath("$.totalElements").value(2));
    }

    @Test
    void ratingThatDidNotRiseAndDuplicateEventsFlagNothing() throws Exception {
        String unchangedRating = createControl("bob", "PREVENTIVE");
        String duplicateTarget = createControl("bob", "PREVENTIVE");
        String sentinel = createControl("bob", "PREVENTIVE");
        UUID riskId = UUID.randomUUID();

        sendRiskUpdated(UUID.randomUUID(), riskId, "HIGH", "HIGH", unchangedRating);

        UUID first = UUID.randomUUID();
        sendRiskUpdated(first, riskId, "CRITICAL", "MEDIUM", duplicateTarget);
        await().atMost(Duration.ofSeconds(15)).until(() -> retestRequired(duplicateTarget));
        mongo.updateFirst(query(where("_id").is(duplicateTarget)), Update.update("retestRequired", false), Control.class);

        sendRiskUpdated(first, riskId, "CRITICAL", "MEDIUM", duplicateTarget);    // redelivery
        sendRiskUpdated(UUID.randomUUID(), riskId, "CRITICAL", "HIGH", sentinel); // same key, so processed after it

        await().atMost(Duration.ofSeconds(15)).until(() -> retestRequired(sentinel));
        assertThat(retestRequired(unchangedRating)).isFalse();
        assertThat(retestRequired(duplicateTarget)).isFalse();
    }

    @Test
    void unreadableEventGoesToTheDeadLetterTopic() throws Exception {
        String marker = "{\"schemaVersion\": 99, \"marker\": \"" + UUID.randomUUID() + "\"}";

        send("some-risk", marker, RISK_SERVICE);

        KafkaTestConsumer.awaitRecord(consumers, EventTopics.RISK_UPDATED + EventTopics.DLT_SUFFIX,
                r -> marker.equals(r.value()));
    }

    @Test
    void controlsListedInTheEventAreTheOnlyOnesTouched() throws Exception {
        String linked = createControl("bob", "PREVENTIVE");
        String unrelated = createControl("bob", "PREVENTIVE");

        sendRiskUpdated(UUID.randomUUID(), UUID.randomUUID(), "CRITICAL", null, linked);

        await().atMost(Duration.ofSeconds(15)).until(() -> retestRequired(linked));
        assertThat(retestRequired(unrelated)).isFalse();
        assertThat(mongo.findById(linked, Control.class).getVersion()).isEqualTo(1L);
    }

    /** Found in the security review: a message written straight to Kafka could flag controls (SEC-07). */
    @Test
    void unsignedOrWronglySignedEventsAreRejectedAndChangeNothing() throws Exception {
        String unsignedTarget = createControl("bob", "PREVENTIVE");
        String wronglySignedTarget = createControl("bob", "PREVENTIVE");
        String sentinel = createControl("bob", "PREVENTIVE");
        UUID riskId = UUID.randomUUID();
        String unsigned = riskUpdatedPayload(UUID.randomUUID(), riskId, "CRITICAL", "LOW", unsignedTarget);
        String wronglySigned = riskUpdatedPayload(UUID.randomUUID(), riskId, "CRITICAL", "LOW", wronglySignedTarget);

        send(riskId.toString(), unsigned, null);
        send(riskId.toString(), wronglySigned, WRONG_SIGNER);
        sendRiskUpdated(UUID.randomUUID(), riskId, "CRITICAL", "LOW", sentinel); // same key, so handled after them

        await().atMost(Duration.ofSeconds(15)).until(() -> retestRequired(sentinel));
        KafkaTestConsumer.awaitRecord(consumers, EventTopics.RISK_UPDATED + EventTopics.DLT_SUFFIX,
                r -> unsigned.equals(r.value()));
        KafkaTestConsumer.awaitRecord(consumers, EventTopics.RISK_UPDATED + EventTopics.DLT_SUFFIX,
                r -> wronglySigned.equals(r.value()));
        assertThat(retestRequired(unsignedTarget)).isFalse();
        assertThat(retestRequired(wronglySignedTarget)).isFalse();
    }
}
