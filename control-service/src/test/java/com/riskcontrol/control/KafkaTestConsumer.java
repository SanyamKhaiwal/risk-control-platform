package com.riskcontrol.control;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.function.Predicate;
import org.apache.kafka.clients.consumer.Consumer;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.core.ConsumerFactory;

/** Reads a topic from the beginning with a fresh consumer group until a matching record appears. */
public final class KafkaTestConsumer {

    private KafkaTestConsumer() {
    }

    public static ConsumerRecord<String, String> awaitRecord(ConsumerFactory<String, String> factory, String topic,
                                                            Predicate<ConsumerRecord<String, String>> match) {
        try (Consumer<String, String> consumer = factory.createConsumer("test-" + UUID.randomUUID(), null)) {
            consumer.subscribe(List.of(topic));
            Instant deadline = Instant.now().plus(Duration.ofSeconds(20));
            while (Instant.now().isBefore(deadline)) {
                for (ConsumerRecord<String, String> record : consumer.poll(Duration.ofMillis(500))) {
                    if (match.test(record)) {
                        return record;
                    }
                }
            }
        }
        throw new AssertionError("No matching record on " + topic + " within 20 s");
    }
}
