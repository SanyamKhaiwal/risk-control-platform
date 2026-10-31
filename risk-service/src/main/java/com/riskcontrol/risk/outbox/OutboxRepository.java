package com.riskcontrol.risk.outbox;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

interface OutboxRepository extends JpaRepository<OutboxMessage, UUID> {

    List<OutboxMessage> findByPublishedAtIsNullOrderByCreatedAt(Limit limit);

    long countByPublishedAtIsNull();

    @Modifying
    @Query("update OutboxMessage m set m.publishedAt = :publishedAt where m.id = :id")
    int markPublished(UUID id, Instant publishedAt);
}
