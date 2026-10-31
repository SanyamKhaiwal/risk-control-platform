package com.riskcontrol.control.events;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.time.Duration;
import org.springframework.stereotype.Component;

/**
 * Business metrics for the event flow (ARCHITECTURE.md §14), shown on the Grafana "Events" dashboard.
 * {@code rcp.events.consumed} counts every event this service receives, tagged with what happened to it.
 */
@Component
public class EventMetrics {

    /** What happened to a received event. */
    public enum Outcome {
        /** Changed something. */
        APPLIED,
        /** Valid, but nothing to change (older than what we have, or about nothing we track). */
        NO_CHANGE,
        /** Already handled: a redelivery. */
        DUPLICATE,
        /** No valid signature from the other service: refused and sent to the dead-letter topic. */
        REJECTED_SIGNATURE,
    }

    private final MeterRegistry registry;
    private final Timer assessmentToRescore;

    public EventMetrics(MeterRegistry registry) {
        this.registry = registry;
        this.assessmentToRescore = Timer.builder("rcp.assessment.to.rescore")
                .description("From a control being assessed to the linked risks being rescored")
                .register(registry);
        // Every series starts at 0, so the first real event shows as an increase. Prometheus can't see a rise in a
        // counter that first appears already at 1 or 2, which hid the first forged events on the dashboard.
        for (Outcome outcome : Outcome.values()) {
            counter(EventTopics.RISK_UPDATED, outcome);
        }
    }

    public void consumed(String topic, Outcome outcome) {
        counter(topic, outcome).increment();
    }

    private Counter counter(String topic, Outcome outcome) {
        return Counter.builder("rcp.events.consumed").tag("topic", topic).tag("outcome", outcome.name().toLowerCase())
                .register(registry);
    }

    /** Only the Risk Service rescores; the timer is registered in both so dashboards query one name. */
    public void assessmentToRescore(Duration elapsed) {
        assessmentToRescore.record(elapsed.isNegative() ? Duration.ZERO : elapsed);
    }
}
