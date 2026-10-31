package com.riskcontrol.control.service;

import com.riskcontrol.control.domain.Assessment;
import com.riskcontrol.control.domain.AssessmentHasher;
import com.riskcontrol.control.domain.AssessmentRepository;
import com.riskcontrol.control.domain.Control;
import com.riskcontrol.control.domain.ControlRepository;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * One-time migration: re-hashes every assessment chain with the current key, trusting the records as they are now.
 * Needed once when moving from unkeyed SHA-256 to HMAC chains (docs/security-review.md SEC-16), or after rotating
 * the key. Off by default and only switched on by the operator (CONTROL_ASSESSMENTS_RESEAL=true for one start),
 * never by anything in the database, so someone who edits records can't use it to launder their edits.
 */
@Component
@ConditionalOnProperty(name = "control.assessments.reseal", havingValue = "true")
class ChainResealer implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(ChainResealer.class);

    private final ControlRepository controls;
    private final AssessmentRepository assessments;
    private final AssessmentHasher hasher;
    private final TransactionTemplate transaction;

    ChainResealer(ControlRepository controls, AssessmentRepository assessments, AssessmentHasher hasher,
                  TransactionTemplate transaction) {
        this.controls = controls;
        this.assessments = assessments;
        this.hasher = hasher;
        this.transaction = transaction;
    }

    @Override
    public void run(ApplicationArguments args) {
        int resealed = 0;
        for (Control control : controls.findAll()) {
            transaction.executeWithoutResult(status -> {
                String prev = AssessmentHasher.GENESIS;
                for (Assessment a : assessments.findByControlIdOrderBySequenceAsc(control.getId())) {
                    a.reseal(prev, hasher);
                    assessments.save(a);
                    prev = a.getHash();
                }
                List<Assessment> chain = assessments.findByControlIdOrderBySequenceAsc(control.getId());
                String head = chain.isEmpty() ? null : prev;
                control.resealHead(head);
                control.sealHead(hasher.sealHead(control.getId(), chain.size(), head));
                controls.save(control);
            });
            resealed++;
        }
        log.warn("Re-sealed the assessment chains of {} controls with the current key. Turn control.assessments.reseal "
                + "off again.", resealed);
    }
}
