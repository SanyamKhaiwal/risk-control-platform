package com.riskcontrol.risk.events;

import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.common.TopicPartition;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;
import org.springframework.kafka.core.KafkaOperations;
import org.springframework.kafka.listener.DeadLetterPublishingRecoverer;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.kafka.support.ExponentialBackOffWithMaxRetries;

/** Topics this service produces or consumes (the broker doesn't auto-create topics), and consumer error handling. */
@Configuration(proxyBeanMethods = false)
class KafkaConfig {

    private final int partitions;
    private final int replicas;

    KafkaConfig(@Value("${rcp.kafka.partitions:3}") int partitions, @Value("${rcp.kafka.replicas:1}") int replicas) {
        this.partitions = partitions;
        this.replicas = replicas;
    }

    @Bean
    NewTopic controlAssessedTopic() {
        return topic(EventTopics.CONTROL_ASSESSED);
    }

    @Bean
    NewTopic controlAssessedDeadLetterTopic() {
        return topic(EventTopics.CONTROL_ASSESSED + EventTopics.DLT_SUFFIX);
    }

    @Bean
    NewTopic riskUpdatedTopic() {
        return topic(EventTopics.RISK_UPDATED);
    }

    /**
     * Retries a failing record 3 times (1 s, 2 s, 4 s), then publishes it to {@code <topic>.DLT}.
     * Invalid events are never going to succeed, so they skip the retries.
     */
    @Bean
    DefaultErrorHandler kafkaErrorHandler(KafkaOperations<Object, Object> kafka) {
        DeadLetterPublishingRecoverer recoverer = new DeadLetterPublishingRecoverer(kafka,
                (record, exception) -> new TopicPartition(record.topic() + EventTopics.DLT_SUFFIX, -1));
        ExponentialBackOffWithMaxRetries backOff = new ExponentialBackOffWithMaxRetries(3);
        backOff.setInitialInterval(1_000);
        backOff.setMultiplier(2.0);
        DefaultErrorHandler handler = new DefaultErrorHandler(recoverer, backOff);
        handler.addNotRetryableExceptions(InvalidEventException.class);
        return handler;
    }

    private NewTopic topic(String name) {
        return TopicBuilder.name(name).partitions(partitions).replicas(replicas).build();
    }
}
