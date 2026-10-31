package com.riskcontrol.control.domain;

import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;

public interface AssessmentRepository extends MongoRepository<Assessment, String> {

    Page<Assessment> findByControlId(String controlId, Pageable pageable);

    List<Assessment> findByControlIdOrderBySequenceAsc(String controlId);
}
