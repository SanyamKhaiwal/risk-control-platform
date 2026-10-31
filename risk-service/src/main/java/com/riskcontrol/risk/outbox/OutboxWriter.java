package com.riskcontrol.risk.outbox;

import com.riskcontrol.risk.events.EventJson;
import com.riskcontrol.risk.events.EventSignatures;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Component
public class OutboxWriter {

    private final OutboxRepository outbox;
    private final EventJson json;
    private final EventSignatures signatures;
    private final OutboxTracing tracing;
    private final Clock clock;

    public OutboxWriter(OutboxRepository outbox, EventJson json, EventSignatures signatures, OutboxTracing tracing,
                        Clock clock) {
        this.outbox = outbox;
        this.json = json;
        this.signatures = signatures;
        this.tracing = tracing;
        this.clock = clock;
    }

    /** Must join the caller's transaction: the event is saved only if the change is. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void write(String topic, String key, UUID eventId, Object event) {
        // Signed here, inside the transaction: a row inserted into the table by anyone else has no valid signature.
        String payload = json.write(event);
        outbox.save(new OutboxMessage(eventId, topic, key, payload, signatures.sign(payload),
                tracing.currentTraceParent(), Instant.now(clock).truncatedTo(ChronoUnit.MICROS)));
    }
}
