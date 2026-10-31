package com.riskcontrol.risk.outbox;

import io.micrometer.tracing.Span;
import io.micrometer.tracing.Tracer;
import io.micrometer.tracing.propagation.Propagator;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.Callable;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

/**
 * Carries a trace across the outbox. The publisher runs on a timer, so without this the trace of a request would
 * stop at the outbox and the Kafka hop would start a new one. The writer stores the request's W3C
 * {@code traceparent}; the publisher sends inside a span continuing it. Does nothing when tracing is off.
 */
@Component
public class OutboxTracing {

    private static final String TRACEPARENT = "traceparent";

    private final ObjectProvider<Tracer> tracer;
    private final ObjectProvider<Propagator> propagator;

    OutboxTracing(ObjectProvider<Tracer> tracer, ObjectProvider<Propagator> propagator) {
        this.tracer = tracer;
        this.propagator = propagator;
    }

    /** The current trace as a W3C traceparent, or null if there is none. */
    public String currentTraceParent() {
        Tracer t = tracer.getIfAvailable();
        Propagator p = propagator.getIfAvailable();
        if (t == null || p == null || t.currentTraceContext().context() == null) {
            return null;
        }
        Map<String, String> carrier = new HashMap<>();
        p.inject(t.currentTraceContext().context(), carrier, Map::put);
        return carrier.get(TRACEPARENT);
    }

    <T> T inTraceOf(String traceParent, String name, Callable<T> work) throws Exception {
        Tracer t = tracer.getIfAvailable();
        Propagator p = propagator.getIfAvailable();
        if (t == null || p == null || traceParent == null) {
            return work.call();
        }
        Span span = p.extract(Map.of(TRACEPARENT, traceParent), Map::get).name(name).start();
        try (Tracer.SpanInScope scope = t.withSpan(span)) {
            return work.call();
        } catch (Exception e) {
            span.error(e);
            throw e;
        } finally {
            span.end();
        }
    }
}
