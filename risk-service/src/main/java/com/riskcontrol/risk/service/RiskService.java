package com.riskcontrol.risk.service;

import com.riskcontrol.risk.cache.RiskListCache;
import com.riskcontrol.risk.domain.Risk;
import com.riskcontrol.risk.domain.RiskCategory;
import com.riskcontrol.risk.domain.RiskControlLink;
import com.riskcontrol.risk.domain.RiskControlLinkRepository;
import com.riskcontrol.risk.domain.RiskRepository;
import com.riskcontrol.risk.domain.RiskScoreHistory;
import com.riskcontrol.risk.domain.RiskScoreHistoryRepository;
import com.riskcontrol.risk.domain.RiskSpecifications;
import com.riskcontrol.risk.domain.RiskStatus;
import com.riskcontrol.risk.domain.ScoreChangeCause;
import com.riskcontrol.risk.error.ConflictException;
import com.riskcontrol.risk.error.ForbiddenException;
import com.riskcontrol.risk.error.NotFoundException;
import com.riskcontrol.risk.events.EventTopics;
import com.riskcontrol.risk.events.RiskUpdatedEvent;
import com.riskcontrol.risk.outbox.OutboxWriter;
import com.riskcontrol.risk.scoring.Rating;
import com.riskcontrol.risk.scoring.ScoringEngine;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional
public class RiskService {

    private static final Logger log = LoggerFactory.getLogger(RiskService.class);

    private static final Sort REGISTER_ORDER = Sort.by(Sort.Order.desc("residualScore"), Sort.Order.desc("updatedAt"));

    private final RiskRepository risks;
    private final RiskControlLinkRepository links;
    private final RiskScoreHistoryRepository history;
    private final OutboxWriter outbox;
    private final ApplicationEventPublisher events;
    private final RiskListCache lists;
    private final Clock clock;

    public RiskService(RiskRepository risks, RiskControlLinkRepository links, RiskScoreHistoryRepository history,
                       OutboxWriter outbox, ApplicationEventPublisher events, RiskListCache lists, Clock clock) {
        this.risks = risks;
        this.links = links;
        this.history = history;
        this.outbox = outbox;
        this.events = events;
        this.lists = lists;
        this.clock = clock;
    }

    public Risk create(String title, String description, RiskCategory category, String owner, int likelihood, int impact) {
        Instant now = now();
        Risk risk = risks.save(new Risk(title, description, category, owner, likelihood, impact, now));
        history.save(new RiskScoreHistory(risk, ScoreChangeCause.CREATED, null, null, now));
        announce(risk, ScoreChangeCause.CREATED.name(), null, null);
        return risk;
    }

    @Transactional(readOnly = true)
    public Risk get(UUID id) {
        return risks.findById(id).orElseThrow(() -> new NotFoundException("Risk " + id + " not found"));
    }

    @Transactional(readOnly = true)
    public Page<Risk> list(RiskStatus status, Rating rating, String owner, UUID controlId, int page, int size) {
        // Every open screen polls this every 2 s; kept for a moment, cleared on every change (RiskListCache).
        return lists.get(new RiskListCache.Key(status, rating, owner, controlId, page, size),
                () -> risks.findAll(RiskSpecifications.matching(status, rating, owner, controlId),
                        PageRequest.of(page, size, REGISTER_ORDER)));
    }

    /** Always announced (even a title-only edit changes what the dashboard and caches show). */
    public Risk update(UUID id, int expectedVersion, String actor, String title, String description,
                       RiskCategory category, int likelihood, int impact) {
        Risk risk = get(id);
        requireOwner(risk, actor);
        requireVersion(risk, expectedVersion);
        requireNotClosed(risk);
        Rating previousRating = risk.getRating();
        List<Integer> cellsBefore = cells(risk);
        risk.edit(title, description, category, likelihood, impact, now());
        recalculate(risk, ScoreChangeCause.EDITED, null, null);
        announce(risk, ScoreChangeCause.EDITED.name(), previousRating, null, !cells(risk).equals(cellsBefore));
        return risk;
    }

    public Risk changeStatus(UUID id, int expectedVersion, String actor, RiskStatus status) {
        Risk risk = get(id);
        requireOwner(risk, actor);
        requireVersion(risk, expectedVersion);
        if (risk.getStatus() == status) {
            throw new ConflictException("Risk " + id + " is already " + status);
        }
        risk.changeStatus(status, now());
        announce(risk, "STATUS", risk.getRating(), null);
        return risk;
    }

    @Transactional(readOnly = true)
    public List<RiskScoreHistory> history(UUID id) {
        get(id);
        return history.findByRiskIdOrderByChangedAtDesc(id);
    }

    /**
     * Rescores a risk after its links or their effectiveness changed and, if the score moved,
     * records history and announces it. Must run inside the caller's transaction.
     */
    public void rescore(Risk risk, ScoreChangeCause cause, UUID causeEventId, UUID causeControlId) {
        Rating previousRating = risk.getRating();
        int previousScore = risk.getResidualScore();
        if (recalculate(risk, cause, causeEventId, causeControlId)) {
            log.info("Rescored risk {} from {} {} to {} {} ({}, control {})", risk.getId(), previousScore, previousRating,
                    risk.getResidualScore(), risk.getRating(), cause, causeControlId);
            announce(risk, cause.name(), previousRating, causeEventId);
        }
    }

    /** Rescores from the current links; writes a history row and returns true if the score changed. */
    private boolean recalculate(Risk risk, ScoreChangeCause cause, UUID causeEventId, UUID causeControlId) {
        var controls = links.findByIdRiskIdOrderByLinkedAt(risk.getId()).stream()
                .map(RiskControlLink::toEffectiveness)
                .toList();
        Instant now = now();
        if (!risk.applyScore(ScoringEngine.score(risk.getLikelihood(), risk.getImpact(), controls), now)) {
            return false;
        }
        history.save(new RiskScoreHistory(risk, cause, causeEventId, causeControlId, now));
        return true;
    }

    /** Writes risk.updated to the outbox (same transaction) and schedules cache eviction for after commit. */
    /** Where the risk sits on both heat-maps: what decides whether a change moves the counts. */
    private static List<Integer> cells(Risk risk) {
        return List.of(risk.getLikelihood(), risk.getImpact(), risk.getResidualLikelihood(), risk.getResidualImpact());
    }

    private void announce(Risk risk, String cause, Rating previousRating, UUID causeEventId) {
        announce(risk, cause, previousRating, causeEventId, true);
    }

    private void announce(Risk risk, String cause, Rating previousRating, UUID causeEventId, boolean heatmapChanged) {
        List<UUID> controlIds = links.findByIdRiskIdOrderByLinkedAt(risk.getId()).stream()
                .map(RiskControlLink::getControlId)
                .toList();
        UUID eventId = UUID.randomUUID();
        RiskUpdatedEvent event = new RiskUpdatedEvent(eventId, RiskUpdatedEvent.SCHEMA_VERSION, risk.getId(),
                risk.getTitle(), cause, risk.getStatus(), risk.getInherentScore(), risk.getResidualScore(), risk.getRating(), previousRating,
                controlIds, causeEventId, risk.getUpdatedAt());
        outbox.write(EventTopics.RISK_UPDATED, risk.getId().toString(), eventId, event);
        events.publishEvent(new RiskChanged(risk.getId(), heatmapChanged));
    }

    /** Only the risk's owner may change it (the RISK_OWNER role alone is not enough). */
    static void requireOwner(Risk risk, String actor) {
        if (!risk.getOwner().equals(actor)) {
            throw new ForbiddenException("Only the owner (" + risk.getOwner() + ") can change risk " + risk.getId());
        }
    }

    static void requireNotClosed(Risk risk) {
        if (risk.isClosed()) {
            throw new ConflictException("Risk " + risk.getId() + " is closed; reopen it before changing it");
        }
    }

    private static void requireVersion(Risk risk, int expectedVersion) {
        if (risk.getVersion() != expectedVersion) {
            throw new ConflictException("Risk " + risk.getId() + " has changed (version " + risk.getVersion()
                    + ", request had " + expectedVersion + "); reload it and retry");
        }
    }

    /** PostgreSQL stores microseconds, so truncate to keep API responses equal to what is stored. */
    private Instant now() {
        return Instant.now(clock).truncatedTo(ChronoUnit.MICROS);
    }
}
