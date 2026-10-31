package com.riskcontrol.risk.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.riskcontrol.risk.KafkaTestConsumer;
import com.riskcontrol.risk.client.ControlSummary;
import com.riskcontrol.risk.events.EventSignatures;
import com.riskcontrol.risk.events.EventTopics;
import com.riskcontrol.risk.scoring.ControlType;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.kafka.core.ConsumerFactory;
import org.springframework.kafka.core.KafkaTemplate;

/** control.assessed in, risk.updated out (ARCHITECTURE.md §8). */
class EventFlowTests extends ApiTestSupport {

    private static final Instant T1 = Instant.parse("2026-10-28T10:00:00Z");

    /** Signs as the Control Service would, and checks what this service publishes against its public key. */
    private static final EventSignatures CONTROL_SERVICE = keys("events-control-private.pem", "events-risk-public.pem");
    /** This service's own key: a valid signature, but not the Control Service's. */
    private static final EventSignatures WRONG_SIGNER = keys("events-risk-private.pem", "events-risk-public.pem");

    private static EventSignatures keys(String signing, String peer) {
        return new EventSignatures(new ClassPathResource("test-keys/" + signing), new ClassPathResource("test-keys/" + peer));
    }

    @Autowired
    private KafkaTemplate<String, String> kafka;

    @Autowired
    private ConsumerFactory<String, String> consumers;

    private UUID linkedUntestedPreventiveControl(String... riskIds) throws Exception {
        UUID controlId = UUID.randomUUID();
        when(controlClient.getControl(controlId))
                .thenReturn(new ControlSummary(controlId, ControlType.PREVENTIVE, null, null));
        for (String riskId : riskIds) {
            mvc.perform(post("/api/risks/{riskId}/controls/{controlId}", riskId, controlId).with(asOwnerOf(riskId)))
                    .andExpect(status().isCreated());
        }
        return controlId;
    }

    private static String assessedPayload(UUID eventId, UUID controlId, double effectiveness, Instant assessedAt) {
        return """
                {"eventId": "%s", "schemaVersion": 1, "controlId": "%s", "controlType": "PREVENTIVE",
                 "assessmentId": "%s", "result": "X", "effectiveness": %s, "assessedAt": "%s"}
                """.formatted(eventId, controlId, UUID.randomUUID(), effectiveness, assessedAt);
    }

    /** Publishes with the given signer, or unsigned when {@code signer} is null. */
    private void send(UUID controlId, String payload, EventSignatures signer) throws Exception {
        ProducerRecord<String, String> record = new ProducerRecord<>(EventTopics.CONTROL_ASSESSED, controlId.toString(), payload);
        if (signer != null) {
            record.headers().add(EventSignatures.HEADER, signer.sign(payload).getBytes(StandardCharsets.US_ASCII));
        }
        kafka.send(record).get();
    }

    private void sendAssessed(UUID eventId, UUID controlId, double effectiveness, Instant assessedAt) throws Exception {
        send(controlId, assessedPayload(eventId, controlId, effectiveness, assessedAt), CONTROL_SERVICE);
    }

    private List<Integer> assessmentHistory(String riskId) {
        return jdbc.queryForList("""
                select residual_score from risk_score_history
                where risk_id = ?::uuid and cause = 'ASSESSMENT' order by changed_at""", Integer.class, riskId);
    }

    @Test
    void assessmentEventRescoresEveryLinkedRisk() throws Exception {
        String takeover = createRisk("alice", 4, 5);
        String phishing = createRisk("bob", 2, 2);
        UUID mfa = linkedUntestedPreventiveControl(takeover, phishing);
        UUID eventId = UUID.randomUUID();

        sendAssessed(eventId, mfa, 0.5, T1);

        await().atMost(Duration.ofSeconds(15)).until(() -> residualScore(takeover) == 10);
        await().atMost(Duration.ofSeconds(5)).until(() -> residualScore(phishing) == 2);
        String cause = jdbc.queryForObject("""
                select cause_event_id::text from risk_score_history where risk_id = ?::uuid and cause = 'ASSESSMENT'""",
                String.class, takeover);
        assertThat(cause).isEqualTo(eventId.toString());
        String causeControl = jdbc.queryForObject("""
                select cause_control_id::text from risk_score_history where risk_id = ?::uuid and cause = 'ASSESSMENT'""",
                String.class, takeover);
        assertThat(causeControl).isEqualTo(mfa.toString());

        // Monitoring: the event and its end-to-end time show up for Prometheus (ARCHITECTURE.md §14).
        String metrics = mvc.perform(get("/actuator/prometheus")).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(metrics)
                .contains("rcp_events_consumed_total{outcome=\"applied\",topic=\"control.assessed\"}")
                .contains("rcp_assessment_to_rescore_seconds_count")
                .contains("rcp_assessment_to_rescore_seconds_bucket")
                .contains("rcp_outbox_pending");
    }

    @Test
    void duplicateAndOutOfOrderEventsAreIgnored() throws Exception {
        String risk = createRisk("alice", 4, 5);
        UUID mfa = linkedUntestedPreventiveControl(risk);
        UUID first = UUID.randomUUID();
        sendAssessed(first, mfa, 0.5, T1);
        await().atMost(Duration.ofSeconds(15)).until(() -> residualScore(risk) == 10);

        sendAssessed(first, mfa, 0.0, T1.plusSeconds(60));               // redelivery of an already processed event
        sendAssessed(UUID.randomUUID(), mfa, 0.0, T1.minusSeconds(60));   // older assessment arriving late
        sendAssessed(UUID.randomUUID(), mfa, 1.0, T1.plusSeconds(120));   // newer: must apply

        // Same key, so processed in order: once the last event shows, the two before it were handled.
        await().atMost(Duration.ofSeconds(15)).until(() -> residualScore(risk) == 5);
        assertThat(assessmentHistory(risk)).containsExactly(10, 5);
    }

    @Test
    void eventForAnUnlinkedControlIsRecordedAsProcessed() throws Exception {
        UUID eventId = UUID.randomUUID();

        sendAssessed(eventId, UUID.randomUUID(), 1.0, T1);

        await().atMost(Duration.ofSeconds(15)).until(() -> jdbc.queryForObject(
                "select count(*) from processed_event where event_id = ?::uuid", Integer.class, eventId.toString()) == 1);
    }

    @Test
    void riskChangesArePublishedThroughTheOutbox() throws Exception {
        String risk = createRisk("alice", 4, 5);

        ConsumerRecord<String, String> created = KafkaTestConsumer.awaitRecord(consumers, EventTopics.RISK_UPDATED,
                r -> risk.equals(r.key()) && r.value().contains("\"CREATED\""));
        assertThat((String) JsonPath.read(created.value(), "$.rating")).isEqualTo("CRITICAL");
        assertThat(CONTROL_SERVICE.signedByPeer(created.value(), created.headers().lastHeader(EventSignatures.HEADER).value()))
                .as("published events carry this service's signature").isTrue();
        assertThat((Object) JsonPath.read(created.value(), "$.previousRating")).isNull();
        await().atMost(Duration.ofSeconds(5)).until(() -> jdbc.queryForObject(
                "select count(*) from outbox where msg_key = ? and published_at is null", Integer.class, risk) == 0);

        UUID mfa = linkedUntestedPreventiveControl(risk);
        sendAssessed(UUID.randomUUID(), mfa, 0.5, T1);

        ConsumerRecord<String, String> assessed = KafkaTestConsumer.awaitRecord(consumers, EventTopics.RISK_UPDATED,
                r -> risk.equals(r.key()) && r.value().contains("\"ASSESSMENT\""));
        assertThat((String) JsonPath.read(assessed.value(), "$.rating")).isEqualTo("MEDIUM");
        assertThat((String) JsonPath.read(assessed.value(), "$.previousRating")).isEqualTo("CRITICAL");
        assertThat((List<String>) JsonPath.read(assessed.value(), "$.controlIds")).containsExactly(mfa.toString());
    }

    @Test
    void unreadableEventGoesToTheDeadLetterTopicAndDoesNotBlockTheNextOne() throws Exception {
        String risk = createRisk("alice", 4, 5);
        UUID mfa = linkedUntestedPreventiveControl(risk);
        String marker = "not json " + UUID.randomUUID();

        send(mfa, marker, CONTROL_SERVICE);
        sendAssessed(UUID.randomUUID(), mfa, 0.5, T1);

        KafkaTestConsumer.awaitRecord(consumers, EventTopics.CONTROL_ASSESSED + EventTopics.DLT_SUFFIX,
                r -> marker.equals(r.value()));
        await().atMost(Duration.ofSeconds(15)).until(() -> residualScore(risk) == 10);
    }

    /** Found in the security review: a message written straight to Kafka could change scores (SEC-07). */
    @Test
    void unsignedOrWronglySignedEventsAreRejectedAndChangeNothing() throws Exception {
        String risk = createRisk("alice", 4, 5);
        UUID mfa = linkedUntestedPreventiveControl(risk);
        String unsigned = assessedPayload(UUID.randomUUID(), mfa, 1.0, T1);
        String wronglySigned = assessedPayload(UUID.randomUUID(), mfa, 1.0, T1.plusSeconds(1));

        send(mfa, unsigned, null);
        send(mfa, wronglySigned, WRONG_SIGNER);
        sendAssessed(UUID.randomUUID(), mfa, 0.5, T1.plusSeconds(2));

        KafkaTestConsumer.awaitRecord(consumers, EventTopics.CONTROL_ASSESSED + EventTopics.DLT_SUFFIX,
                r -> unsigned.equals(r.value()));
        KafkaTestConsumer.awaitRecord(consumers, EventTopics.CONTROL_ASSESSED + EventTopics.DLT_SUFFIX,
                r -> wronglySigned.equals(r.value()));
        await().atMost(Duration.ofSeconds(15)).until(() -> residualScore(risk) == 10);
        assertThat(assessmentHistory(risk)).as("only the genuine event changed the score").containsExactly(10);
    }
}
