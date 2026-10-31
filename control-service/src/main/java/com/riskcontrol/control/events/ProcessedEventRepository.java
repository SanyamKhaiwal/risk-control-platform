package com.riskcontrol.control.events;

import org.springframework.data.mongodb.repository.MongoRepository;

interface ProcessedEventRepository extends MongoRepository<ProcessedEvent, String> {
}
