package com.riskcontrol.control;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.kafka.KafkaContainer;
import org.testcontainers.mongodb.MongoDBContainer;

/** A real MongoDB replica set and Kafka (same images as compose.yaml), started once per test context. */
@TestConfiguration(proxyBeanMethods = false)
public class TestcontainersConfiguration {

    @Bean
    @ServiceConnection
    MongoDBContainer mongoContainer() {
        // Testcontainers 2 starts a standalone server unless a replica set is requested.
        // MONGO_IMAGE: CI runs 7.0, as MongoDB 8 won't start on its kernel (.github/workflows/ci.yml).
        return new MongoDBContainer(System.getenv().getOrDefault("MONGO_IMAGE", "mongo:8.0.34")).withReplicaSet();
    }

    @Bean
    @ServiceConnection
    KafkaContainer kafka() {
        return new KafkaContainer("apache/kafka:4.3.2");
    }
}
