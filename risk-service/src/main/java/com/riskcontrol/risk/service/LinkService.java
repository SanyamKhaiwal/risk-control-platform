package com.riskcontrol.risk.service;

import com.riskcontrol.risk.client.ControlClient;
import com.riskcontrol.risk.client.ControlSummary;
import com.riskcontrol.risk.domain.Risk;
import com.riskcontrol.risk.domain.RiskControlLink;
import com.riskcontrol.risk.domain.RiskControlLinkRepository;
import com.riskcontrol.risk.domain.ScoreChangeCause;
import com.riskcontrol.risk.error.ConflictException;
import com.riskcontrol.risk.error.NotFoundException;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class LinkService {

    private final RiskService riskService;
    private final RiskControlLinkRepository links;
    private final ControlClient controlClient;
    private final TransactionTemplate transaction;
    private final Clock clock;

    public LinkService(RiskService riskService, RiskControlLinkRepository links, ControlClient controlClient,
                       TransactionTemplate transaction, Clock clock) {
        this.riskService = riskService;
        this.links = links;
        this.controlClient = controlClient;
        this.transaction = transaction;
        this.clock = clock;
    }

    /**
     * Links a control to a risk and rescores the risk. The Control Service is called outside the
     * database transaction so no connection is held during the HTTP call.
     */
    public RiskControlLink link(UUID riskId, UUID controlId, String actor) {
        Risk risk = riskService.get(riskId);
        RiskService.requireOwner(risk, actor);
        RiskService.requireNotClosed(risk);
        requireNotLinked(riskId, controlId);

        ControlSummary control = controlClient.getControl(controlId);

        return transaction.execute(status -> {
            Risk current = riskService.get(riskId);
            RiskService.requireNotClosed(current);
            requireNotLinked(riskId, controlId);
            RiskControlLink link = links.save(new RiskControlLink(riskId, controlId, control.type(),
                    control.latestEffectiveness(), control.lastAssessedAt(), now()));
            riskService.rescore(current, ScoreChangeCause.LINKED, null, controlId);
            return link;
        });
    }

    @Transactional
    public void unlink(UUID riskId, UUID controlId, String actor) {
        Risk risk = riskService.get(riskId);
        RiskService.requireOwner(risk, actor);
        RiskService.requireNotClosed(risk);
        RiskControlLink link = links.findById(new RiskControlLink.Key(riskId, controlId))
                .orElseThrow(() -> new NotFoundException("Control " + controlId + " is not linked to risk " + riskId));
        links.delete(link);
        riskService.rescore(risk, ScoreChangeCause.UNLINKED, null, controlId);
    }

    @Transactional(readOnly = true)
    public List<RiskControlLink> list(UUID riskId) {
        riskService.get(riskId);
        return links.findByIdRiskIdOrderByLinkedAt(riskId);
    }

    private void requireNotLinked(UUID riskId, UUID controlId) {
        if (links.existsById(new RiskControlLink.Key(riskId, controlId))) {
            throw new ConflictException("Control " + controlId + " is already linked to risk " + riskId);
        }
    }

    private Instant now() {
        return Instant.now(clock).truncatedTo(ChronoUnit.MICROS);
    }
}
