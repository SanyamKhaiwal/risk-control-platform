package com.riskcontrol.risk.outbox;

import com.riskcontrol.risk.events.EventSignatures;
import com.riskcontrol.risk.events.EventTopics;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Limit;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Sends unpublished outbox rows to Kafka in creation order and marks them published once the broker
 * acknowledges. A crash between sending and marking re-sends the row; consumers are idempotent.
 * Stops at the first failure so later rows never overtake an earlier one. Assumes one instance per
 * service (ARCHITECTURE.md §8.2).
 */
@Component
class OutboxPublisher {

    private static final Logger log = LoggerFactory.getLogger(OutboxPublisher.class);

    private final OutboxRepository outbox;
    private final KafkaTemplate<String, String> kafka;
    private final TransactionTemplate transaction;
    private final OutboxTracing tracing;
    private final MeterRegistry metrics;
    private final Clock clock;
    private final int batchSize;

    OutboxPublisher(OutboxRepository outbox, KafkaTemplate<String, String> kafka, TransactionTemplate transaction,
                    OutboxTracing tracing, MeterRegistry metrics, Clock clock,
                    @Value("${outbox.batch-size:100}") int batchSize) {
        this.outbox = outbox;
        this.kafka = kafka;
        this.transaction = transaction;
        this.tracing = tracing;
        this.metrics = metrics;
        this.clock = clock;
        this.batchSize = batchSize;
        // Events waiting to go to Kafka. Should stay near zero; growth means Kafka is down or the publisher is behind.
        Gauge.builder("rcp.outbox.pending", outbox, OutboxRepository::countByPublishedAtIsNull)
                .description("Outbox events not yet published to Kafka").register(metrics);
        metrics.counter("rcp.outbox.published", "topic", EventTopics.RISK_UPDATED); // starts at 0, see EventMetrics
    }

    @Scheduled(fixedDelayString = "${outbox.publish-interval:500ms}")
    void publishPending() {
        List<OutboxMessage> batch = outbox.findByPublishedAtIsNullOrderByCreatedAt(Limit.of(batchSize));
        for (OutboxMessage message : batch) {
            try {
                // Continues the trace of the request that wrote the row, so one trace runs across Kafka.
                tracing.inTraceOf(message.getTraceParent(), "outbox publish " + message.getTopic(),
                        () -> kafka.send(record(message)).get(10, TimeUnit.SECONDS));
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            } catch (Exception e) {
                log.warn("Could not publish outbox message {} to {}; will retry: {}", message.getId(),
                        message.getTopic(), e.toString());
                return;
            }
            metrics.counter("rcp.outbox.published", "topic", message.getTopic()).increment();
            Instant now = Instant.now(clock).truncatedTo(ChronoUnit.MICROS);
            transaction.executeWithoutResult(status -> outbox.markPublished(message.getId(), now));
        }
    }

    /** The stored signature goes in a header; a row without one is sent unsigned, and consumers reject it. */
    private static ProducerRecord<String, String> record(OutboxMessage message) {
        ProducerRecord<String, String> record = new ProducerRecord<>(message.getTopic(), message.getMsgKey(), message.getPayload());
        if (message.getSignature() != null) {
            record.headers().add(EventSignatures.HEADER, message.getSignature().getBytes(StandardCharsets.US_ASCII));
        }
        return record;
    }
}
