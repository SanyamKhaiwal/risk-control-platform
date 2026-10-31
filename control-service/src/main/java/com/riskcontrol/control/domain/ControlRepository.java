package com.riskcontrol.control.domain;

import org.springframework.data.mongodb.repository.MongoRepository;

public interface ControlRepository extends MongoRepository<Control, String> {
}
