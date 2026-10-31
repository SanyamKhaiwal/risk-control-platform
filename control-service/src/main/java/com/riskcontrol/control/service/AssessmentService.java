package com.riskcontrol.control.service;

import com.mongodb.MongoException;
import com.riskcontrol.control.domain.Assessment;
import com.riskcontrol.control.domain.AssessmentHasher;
import com.riskcontrol.control.domain.AssessmentRepository;
import com.riskcontrol.control.domain.AssessmentResult;
import com.riskcontrol.control.domain.Control;
import com.riskcontrol.control.domain.ControlRepository;
import com.riskcontrol.control.error.ForbiddenException;
import com.riskcontrol.control.error.NotFoundException;
import com.riskcontrol.control.events.ControlAssessedEvent;
import com.riskcontrol.control.events.EventTopics;
import com.riskcontrol.control.outbox.OutboxWriter;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class AssessmentService {

    private static final Logger log = LoggerFactory.getLogger(AssessmentService.class);

    /** Concurrent assessments of one control conflict on the control document; the loser retries. */
    static final int MAX_ATTEMPTS = 10;

    private final ControlRepository controls;
    private final AssessmentRepository assessments;
    private final OutboxWriter outbox;
    private final AssessmentHasher hasher;
    private final MeterRegistry metrics;
    private final ControlListCache listCache;
    private final TransactionTemplate transaction;
    private final Clock clock;

    public AssessmentService(ControlRepository controls, AssessmentRepository assessments, OutboxWriter outbox,
                             AssessmentHasher hasher, MeterRegistry metrics, ControlListCache listCache,
                             TransactionTemplate transaction, Clock clock) {
        this.controls = controls;
        this.assessments = assessments;
        this.outbox = outbox;
        this.hasher = hasher;
        this.metrics = metrics;
        this.listCache = listCache;
        for (AssessmentResult result : AssessmentResult.values()) { // each series starts at 0, see EventMetrics
            metrics.counter("rcp.assessments.recorded", "result", result.name().toLowerCase());
        }
        this.transaction = transaction;
        this.clock = clock;
    }

    /**
     * In one transaction: insert the assessment, move the control's chain head and write the
     * control.assessed event to the outbox.
     */
    public Assessment record(String controlId, AssessmentResult result, String tester, String evidence, String comments) {
        for (int attempt = 1; ; attempt++) {
            try {
                Assessment recorded = transaction.execute(status -> recordOnce(controlId, result, tester, evidence, comments));
                listCache.clear(); // the control's latest result changed; committed by now
                metrics.counter("rcp.assessments.recorded", "result", result.name().toLowerCase()).increment();
                log.info("Recorded assessment {} of control {}: {} by {}", recorded.getId(), controlId, result, tester);
                return recorded;
            } catch (RuntimeException e) {
                if (attempt >= MAX_ATTEMPTS || !isWriteConflict(e)) {
                    throw e;
                }
                backOff(attempt);
            }
        }
    }

    private Assessment recordOnce(String controlId, AssessmentResult result, String tester, String evidence,
                                  String comments) {
        Control control = controls.findById(controlId)
                .orElseThrow(() -> new NotFoundException("Control " + controlId + " not found"));
        if (control.getOwner().equals(tester)) {
            throw new ForbiddenException("Segregation of duties: " + tester + " owns control " + controlId
                    + " and cannot assess it");
        }
        Instant assessedAt = Instant.now(clock).truncatedTo(ChronoUnit.MILLIS);
        Assessment assessment = assessments.insert(new Assessment(control, result, tester, evidence, comments, assessedAt,
                hasher));
        control.recordAssessment(assessment);
        control.sealHead(hasher.sealHead(controlId, assessment.getSequence(), assessment.getHash()));
        controls.save(control);
        UUID eventId = UUID.randomUUID();
        outbox.write(EventTopics.CONTROL_ASSESSED, controlId, eventId, new ControlAssessedEvent(eventId,
                ControlAssessedEvent.SCHEMA_VERSION, controlId, control.getType(), assessment.getId(), result,
                assessment.getEffectiveness(), assessedAt));
        return assessment;
    }

    public Page<Assessment> history(String controlId, int page, int size) {
        requireControl(controlId);
        return assessments.findByControlId(controlId, PageRequest.of(page, size, Sort.by(Sort.Order.desc("sequence"))));
    }

    /** Recomputes the whole chain: sequence gaps, broken links, edited content and missing tail entries. */
    public ChainVerification verify(String controlId) {
        Control control = requireControl(controlId);
        List<Assessment> chain = assessments.findByControlIdOrderBySequenceAsc(controlId);

        String expectedPrevHash = AssessmentHasher.GENESIS;
        long expectedSequence = 1;
        int checked = 0;
        for (Assessment a : chain) {
            if (a.getSequence() != expectedSequence) {
                return ChainVerification.broken(checked, a.getId(),
                        "Sequence gap: expected " + expectedSequence + " but found " + a.getSequence());
            }
            if (!a.getPrevHash().equals(expectedPrevHash)) {
                return ChainVerification.broken(checked, a.getId(), "prevHash does not match the previous assessment");
            }
            if (!hasher.hash(a).equals(a.getHash())) {
                return ChainVerification.broken(checked, a.getId(), "Content does not match its hash");
            }
            expectedPrevHash = a.getHash();
            expectedSequence++;
            checked++;
        }
        String head = chain.isEmpty() ? null : expectedPrevHash;
        if (chain.size() != control.getAssessmentCount() || !Objects.equals(head, control.getLastAssessmentHash())) {
            return ChainVerification.broken(checked, null,
                    "Chain head does not match the control: assessments are missing from the end");
        }
        if (!hasher.sealHead(controlId, chain.size(), head).equals(control.getHeadSeal())) {
            return ChainVerification.broken(checked, null,
                    "Chain head seal does not match: the newest assessments were removed or rolled back");
        }
        return ChainVerification.ok(checked);
    }

    private Control requireControl(String controlId) {
        return controls.findById(controlId)
                .orElseThrow(() -> new NotFoundException("Control " + controlId + " not found"));
    }

    static boolean isWriteConflict(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof OptimisticLockingFailureException || t instanceof DuplicateKeyException) {
                return true;
            }
            if (t instanceof MongoException m && m.hasErrorLabel(MongoException.TRANSIENT_TRANSACTION_ERROR_LABEL)) {
                return true;
            }
        }
        return false;
    }

    private static void backOff(int attempt) {
        try {
            Thread.sleep(ThreadLocalRandom.current().nextLong(5, 25) * attempt);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while retrying an assessment", e);
        }
    }
}
