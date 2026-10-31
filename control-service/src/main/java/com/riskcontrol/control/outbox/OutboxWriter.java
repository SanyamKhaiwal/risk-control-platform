package com.riskcontrol.control.outbox;

import com.riskcontrol.control.events.EventJson;
import com.riskcontrol.control.events.EventSignatures;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.springframework.stereotype.Component;

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

    /** Call inside the transaction that makes the change, so the event is saved only if the change is. */
    public void write(String topic, String key, UUID eventId, Object event) {
        // Signed here, inside the transaction: a document inserted by anyone else has no valid signature.
        String payload = json.write(event);
        outbox.insert(new OutboxMessage(eventId.toString(), topic, key, payload, signatures.sign(payload),
                tracing.currentTraceParent(), Instant.now(clock).truncatedTo(ChronoUnit.MILLIS)));
    }
}
