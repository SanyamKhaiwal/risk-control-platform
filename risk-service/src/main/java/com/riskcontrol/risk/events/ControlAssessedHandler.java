package com.riskcontrol.risk.events;

import com.riskcontrol.risk.domain.RiskControlLink;
import com.riskcontrol.risk.domain.RiskControlLinkRepository;
import com.riskcontrol.risk.domain.ScoreChangeCause;
import com.riskcontrol.risk.service.RiskService;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Consumes control.assessed (ARCHITECTURE.md §8.6). In one transaction: skip if already processed,
 * update every link to the control (newer assessments only), rescore those risks (which writes
 * history and risk.updated outbox rows), record the event id.
 */
@Component
public class ControlAssessedHandler {

    private static final Logger log = LoggerFactory.getLogger(ControlAssessedHandler.class);

    private final EventJson json;
    private final EventSignatures signatures;
    private final EventMetrics metrics;
    private final ProcessedEventRepository processed;
    private final RiskControlLinkRepository links;
    private final RiskService riskService;
    private final Clock clock;

    ControlAssessedHandler(EventJson json, EventSignatures signatures, EventMetrics metrics,
                           ProcessedEventRepository processed, RiskControlLinkRepository links, RiskService riskService,
                           Clock clock) {
        this.json = json;
        this.signatures = signatures;
        this.metrics = metrics;
        this.processed = processed;
        this.links = links;
        this.riskService = riskService;
        this.clock = clock;
    }

    @KafkaListener(topics = EventTopics.CONTROL_ASSESSED)
    @Transactional
    public void onMessage(@Payload String payload,
                          @Header(name = EventSignatures.HEADER, required = false) byte[] signature) {
        if (!signatures.signedByPeer(payload, signature)) {
            // Anyone who can write to the topic could otherwise change risk scores (docs/security-review.md SEC-07).
            log.warn("SECURITY: rejected control.assessed without a valid Control Service signature");
            metrics.consumed(EventTopics.CONTROL_ASSESSED, EventMetrics.Outcome.REJECTED_SIGNATURE);
            throw new InvalidEventException("control.assessed is not signed by the Control Service", null);
        }
        ControlAssessedEvent event = json.read(payload, ControlAssessedEvent.class);
        if (processed.existsById(event.eventId())) {
            log.debug("Skipping duplicate control.assessed {}", event.eventId());
            metrics.consumed(EventTopics.CONTROL_ASSESSED, EventMetrics.Outcome.DUPLICATE);
            return;
        }
        BigDecimal effectiveness = BigDecimal.valueOf(event.effectiveness());
        boolean rescored = false;
        for (RiskControlLink link : links.findByIdControlId(event.controlId())) {
            if (link.applyAssessment(effectiveness, event.assessedAt())) {
                riskService.rescore(riskService.get(link.getRiskId()), ScoreChangeCause.ASSESSMENT, event.eventId(),
                        event.controlId());
                rescored = true;
            } else {
                log.debug("Ignoring out-of-order assessment {} for link {}", event.eventId(), link.getRiskId());
            }
        }
        Instant now = Instant.now(clock);
        processed.save(new ProcessedEvent(event.eventId(), EventTopics.CONTROL_ASSESSED, now));
        metrics.consumed(EventTopics.CONTROL_ASSESSED, rescored ? EventMetrics.Outcome.APPLIED : EventMetrics.Outcome.NO_CHANGE);
        if (rescored) {
            metrics.assessmentToRescore(Duration.between(event.assessedAt(), now));
        }
    }
}
