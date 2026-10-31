package com.riskcontrol.control.outbox;

import java.util.List;
import org.springframework.data.domain.Limit;
import org.springframework.data.mongodb.repository.MongoRepository;

interface OutboxRepository extends MongoRepository<OutboxMessage, String> {

    List<OutboxMessage> findByPublishedAtIsNullOrderByCreatedAtAsc(Limit limit);

    long countByPublishedAtIsNull();
}
