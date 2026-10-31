package com.riskcontrol.control.api;

import com.riskcontrol.control.api.ControlDtos.AssessmentResponse;
import com.riskcontrol.control.api.ControlDtos.PageResponse;
import com.riskcontrol.control.api.ControlDtos.RecordAssessmentRequest;
import com.riskcontrol.control.domain.Assessment;
import com.riskcontrol.control.service.AssessmentService;
import com.riskcontrol.control.service.ChainVerification;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.net.URI;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

/** Assessments are append-only: there is no update or delete endpoint. */
@RestController
@RequestMapping("/api/controls/{controlId}/assessments")
public class AssessmentController {

    private final AssessmentService assessmentService;

    public AssessmentController(AssessmentService assessmentService) {
        this.assessmentService = assessmentService;
    }

    /** The logged-in tester is recorded as the tester. */
    @PostMapping
    @PreAuthorize("hasRole('CONTROL_TESTER')")
    public ResponseEntity<AssessmentResponse> record(@PathVariable String controlId,
                                                     @Valid @RequestBody RecordAssessmentRequest request,
                                                     Authentication user) {
        Assessment assessment = assessmentService.record(controlId, request.result(), user.getName(),
                request.evidence(), request.comments());
        URI location = ServletUriComponentsBuilder.fromCurrentRequest().build().toUri();
        return ResponseEntity.created(location).body(AssessmentResponse.from(assessment));
    }

    /** Audit history, newest first. */
    @GetMapping
    public PageResponse<AssessmentResponse> history(@PathVariable String controlId,
                                                    @RequestParam(defaultValue = "0") @Min(0) int page,
                                                    @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return PageResponse.of(assessmentService.history(controlId, page, size), AssessmentResponse::from);
    }

    @GetMapping("/verify")
    public ChainVerification verify(@PathVariable String controlId) {
        return assessmentService.verify(controlId);
    }
}
