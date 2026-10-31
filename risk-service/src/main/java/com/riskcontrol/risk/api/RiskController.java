package com.riskcontrol.risk.api;

import com.riskcontrol.risk.api.RiskDtos.ChangeStatusRequest;
import com.riskcontrol.risk.api.RiskDtos.CreateRiskRequest;
import com.riskcontrol.risk.api.RiskDtos.HistoryResponse;
import com.riskcontrol.risk.api.RiskDtos.PageResponse;
import com.riskcontrol.risk.api.RiskDtos.RiskResponse;
import com.riskcontrol.risk.api.RiskDtos.UpdateRiskRequest;
import com.riskcontrol.risk.domain.Risk;
import com.riskcontrol.risk.domain.RiskStatus;
import com.riskcontrol.risk.scoring.Rating;
import com.riskcontrol.risk.service.RiskService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import jakarta.validation.constraints.Pattern;
import java.net.URI;
import java.util.List;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

@RestController
@RequestMapping("/api/risks")
public class RiskController {

    private final RiskService riskService;
    private final RiskViews views;

    public RiskController(RiskService riskService, RiskViews views) {
        this.riskService = riskService;
        this.views = views;
    }

    /** Risk register, highest residual score first. */
    @GetMapping
    public PageResponse<RiskResponse> list(@RequestParam(required = false) RiskStatus status,
                                           @RequestParam(required = false) Rating rating,
                                           @RequestParam(required = false) @Size(max = 64) @Pattern(regexp = "[A-Za-z0-9._@-]+") String owner,
                                           @RequestParam(required = false) UUID controlId,
                                           @RequestParam(defaultValue = "0") @Min(0) int page,
                                           @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return PageResponse.of(riskService.list(status, rating, owner, controlId, page, size), RiskResponse::from);
    }

    @PostMapping
    @PreAuthorize("hasRole('RISK_OWNER')")
    public ResponseEntity<RiskResponse> create(@Valid @RequestBody CreateRiskRequest request, Authentication user) {
        Risk risk = riskService.create(request.title(), request.description(), request.category(), user.getName(),
                request.likelihood(), request.impact());
        URI location = ServletUriComponentsBuilder.fromCurrentRequest().path("/{id}").buildAndExpand(risk.getId()).toUri();
        return ResponseEntity.created(location).body(RiskResponse.from(risk));
    }

    @GetMapping("/{id}")
    public RiskResponse get(@PathVariable UUID id) {
        return views.risk(id);
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasRole('RISK_OWNER')")
    public RiskResponse update(@PathVariable UUID id, @Valid @RequestBody UpdateRiskRequest request,
                               Authentication user) {
        return RiskResponse.from(riskService.update(id, request.version(), user.getName(), request.title(),
                request.description(), request.category(), request.likelihood(), request.impact()));
    }

    /** Risks are never deleted; they are moved to CLOSED (and can be reopened). */
    @PatchMapping("/{id}/status")
    @PreAuthorize("hasRole('RISK_OWNER')")
    public RiskResponse changeStatus(@PathVariable UUID id, @Valid @RequestBody ChangeStatusRequest request,
                                     Authentication user) {
        return RiskResponse.from(riskService.changeStatus(id, request.version(), user.getName(), request.status()));
    }

    @GetMapping("/{id}/history")
    public List<HistoryResponse> history(@PathVariable UUID id) {
        return riskService.history(id).stream().map(HistoryResponse::from).toList();
    }
}
