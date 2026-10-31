package com.riskcontrol.control.events;

import static org.springframework.data.mongodb.core.query.Criteria.where;
import static org.springframework.data.mongodb.core.query.Query.query;

import com.riskcontrol.control.domain.Control;
import com.riskcontrol.control.service.ControlListCache;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Consumes risk.updated (ARCHITECTURE.md §8.6). When a risk worsens to HIGH or CRITICAL, its linked
 * controls that haven't been assessed recently are flagged for re-testing. Writes no events, so
 * there is no loop back to the Risk Service.
 */
@Component
public class RiskUpdatedHandler {

    private static final Logger log = LoggerFactory.getLogger(RiskUpdatedHandler.class);

    private final EventJson json;
    private final EventSignatures signatures;
    private final EventMetrics metrics;
    private final ControlListCache listCache;
    private final ProcessedEventRepository processed;
    private final MongoTemplate mongo;
    private final TransactionTemplate transaction;
    private final Clock clock;
    private final Duration staleAfter;

    public RiskUpdatedHandler(EventJson json, EventSignatures signatures, EventMetrics metrics,
                              ControlListCache listCache, ProcessedEventRepository processed, MongoTemplate mongo, TransactionTemplate transaction, Clock clock,
                              @Value("${control.retest.stale-after:30d}") Duration staleAfter) {
        this.json = json;
        this.signatures = signatures;
        this.metrics = metrics;
        this.listCache = listCache;
        this.processed = processed;
        this.mongo = mongo;
        this.transaction = transaction;
        this.clock = clock;
        this.staleAfter = staleAfter;
    }

    @KafkaListener(topics = EventTopics.RISK_UPDATED)
    public void onMessage(@Payload String payload,
                          @Header(name = EventSignatures.HEADER, required = false) byte[] signature) {
        if (!signatures.signedByPeer(payload, signature)) {
            // Anyone who can write to the topic could otherwise flag controls for re-testing.
            log.warn("SECURITY: rejected risk.updated without a valid Risk Service signature");
            metrics.consumed(EventTopics.RISK_UPDATED, EventMetrics.Outcome.REJECTED_SIGNATURE);
            throw new InvalidEventException("risk.updated is not signed by the Risk Service", null);
        }
        RiskUpdatedEvent event = json.read(payload, RiskUpdatedEvent.class);
        // Counted after the transaction commits, so a retried transaction isn't counted twice.
        EventMetrics.Outcome outcome = transaction.execute(status -> handle(event));
        if (outcome == EventMetrics.Outcome.APPLIED) {
            listCache.clear(); // controls were flagged for re-testing; committed by now
        }
        metrics.consumed(EventTopics.RISK_UPDATED, outcome);
    }

    private EventMetrics.Outcome handle(RiskUpdatedEvent event) {
        if (processed.existsById(event.eventId().toString())) {
            log.debug("Skipping duplicate risk.updated {}", event.eventId());
            return EventMetrics.Outcome.DUPLICATE;
        }
        long flagged = 0;
        Instant now = Instant.now(clock).truncatedTo(ChronoUnit.MILLIS);
        if (event.worsenedToHighOrAbove() && !event.controlIds().isEmpty()) {
            Criteria stale = new Criteria().orOperator(
                    where("lastAssessedAt").is(null), where("lastAssessedAt").lt(now.minus(staleAfter)));
            // Bumping the version makes a concurrent edit based on an older read fail instead of clearing the flag.
            Update flag = new Update()
                    .set("retestRequired", true)
                    .set("retestReason", event.retestReason())
                    .set("retestRiskId", event.riskId().toString())
                    .set("updatedAt", now)
                    .inc("version", 1);
            flagged = mongo.updateMulti(query(where("_id").in(event.controlIds()).andOperator(stale)), flag,
                    Control.class).getModifiedCount();
            log.info("Risk {} rose to {}: flagged {} stale control(s) for re-testing", event.riskId(), event.rating(),
                    flagged);
        }
        processed.insert(new ProcessedEvent(event.eventId().toString(), EventTopics.RISK_UPDATED, now));
        return flagged > 0 ? EventMetrics.Outcome.APPLIED : EventMetrics.Outcome.NO_CHANGE;
    }
}
