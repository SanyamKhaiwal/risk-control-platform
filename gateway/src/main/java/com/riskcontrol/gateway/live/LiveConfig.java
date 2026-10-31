package com.riskcontrol.gateway.live;

import io.micrometer.observation.ObservationPredicate;
import org.springframework.data.redis.connection.ReactiveRedisConnectionFactory;
import org.springframework.data.redis.listener.ReactiveRedisMessageListenerContainer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Lazy;
import org.springframework.http.server.reactive.observation.ServerRequestObservationContext;

@Configuration(proxyBeanMethods = false)
class LiveConfig {

    /**
     * Leaves the live streams out of the request metrics and traces. A stream is one "request" that stays open for up
     * to 30 minutes; with thousands open, Micrometer's active-request timer spent noticeable CPU keeping them in order
     * (docs/performance.md). The rcp.live.* gauges count the streams instead.
     */
    @Bean
    ObservationPredicate noObservationsForLiveStreams() {
        return (name, context) -> !(context instanceof ServerRequestObservationContext request
                && "/api/live".equals(request.getCarrier().getPath().value()));
    }

    /**
     * One Redis connection for all live channels (a container per channel would open one connection each). Lazy: it
     * connects when it's made, and a Gateway must start (and serve, fetching on its own) while Redis is down.
     */
    @Bean(destroyMethod = "destroy")
    @Lazy
    ReactiveRedisMessageListenerContainer liveChannels(ReactiveRedisConnectionFactory redis) {
        return new ReactiveRedisMessageListenerContainer(redis);
    }
}
