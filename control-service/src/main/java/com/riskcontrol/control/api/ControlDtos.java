package com.riskcontrol.control.api;

import com.riskcontrol.control.domain.Assessment;
import com.riskcontrol.control.domain.AssessmentResult;
import com.riskcontrol.control.domain.Control;
import com.riskcontrol.control.domain.ControlFrequency;
import com.riskcontrol.control.domain.ControlType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.function.Function;
import org.springframework.data.domain.Page;

/** Request and response bodies of the Control Service API. */
public final class ControlDtos {

    private ControlDtos() {
    }

    public record CreateControlRequest(
            @NotBlank @Size(max = 200) String name,
            @Size(max = 5000) String description,
            @NotNull ControlType type,
            @NotNull ControlFrequency frequency) {
    }

    /** No {@code type} (fixed at creation) and no {@code owner} (the creator owns the control). */
    public record UpdateControlRequest(
            @NotBlank @Size(max = 200) String name,
            @Size(max = 5000) String description,
            @NotNull ControlFrequency frequency,
            @NotNull Long version) {
    }

    /** No {@code effectiveness} (derived from the result) and no {@code tester} (the logged-in user). */
    public record RecordAssessmentRequest(
            @NotNull AssessmentResult result,
            @Size(max = 5000) String evidence,
            @Size(max = 5000) String comments) {
    }

    public record ControlResponse(
            String id, String name, String description, ControlType type, String owner, ControlFrequency frequency,
            AssessmentResult latestResult, Double latestEffectiveness, Instant lastAssessedAt, long assessmentCount,
            boolean retestRequired, String retestReason, String retestRiskId, long version, Instant createdAt,
            Instant updatedAt) {

        static ControlResponse from(Control c) {
            return new ControlResponse(c.getId(), c.getName(), c.getDescription(), c.getType(), c.getOwner(),
                    c.getFrequency(), c.getLatestResult(), c.getLatestEffectiveness(), c.getLastAssessedAt(),
                    c.getAssessmentCount(), c.isRetestRequired(), c.getRetestReason(), c.getRetestRiskId(), c.getVersion(),
                    c.getCreatedAt(), c.getUpdatedAt());
        }
    }

    public record AssessmentResponse(
            String id, String controlId, long sequence, AssessmentResult result, double effectiveness, String tester,
            String evidence, String comments, Instant assessedAt, String prevHash, String hash) {

        static AssessmentResponse from(Assessment a) {
            return new AssessmentResponse(a.getId(), a.getControlId(), a.getSequence(), a.getResult(),
                    a.getEffectiveness(), a.getTester(), a.getEvidence(), a.getComments(), a.getAssessedAt(),
                    a.getPrevHash(), a.getHash());
        }
    }

    public record PageResponse<T>(List<T> content, int page, int size, long totalElements, int totalPages) {

        static <E, T> PageResponse<T> of(Page<E> page, Function<E, T> mapper) {
            return new PageResponse<>(page.map(mapper).getContent(), page.getNumber(), page.getSize(),
                    page.getTotalElements(), page.getTotalPages());
        }
    }
}
