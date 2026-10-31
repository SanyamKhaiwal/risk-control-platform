package com.riskcontrol.risk.api;

import com.riskcontrol.risk.domain.Risk;
import com.riskcontrol.risk.domain.RiskCategory;
import com.riskcontrol.risk.domain.RiskControlLink;
import com.riskcontrol.risk.domain.RiskScoreHistory;
import com.riskcontrol.risk.domain.RiskStatus;
import com.riskcontrol.risk.domain.ScoreChangeCause;
import com.riskcontrol.risk.scoring.ControlType;
import com.riskcontrol.risk.scoring.Rating;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.function.Function;
import org.springframework.data.domain.Page;

/** Request and response bodies of the Risk Service API. */
public final class RiskDtos {

    private RiskDtos() {
    }

    /** PostgreSQL text can't hold a NUL character; refuse it here (400) instead of failing in the database (500). */
    static final String NO_NUL = "[^\\x00]*";
    static final String NO_NUL_MESSAGE = "must not contain NUL characters";

    public record CreateRiskRequest(
            @NotBlank @Size(max = 200) @Pattern(regexp = NO_NUL, message = NO_NUL_MESSAGE) String title,
            @Size(max = 5000) @Pattern(regexp = NO_NUL, message = NO_NUL_MESSAGE) String description,
            @NotNull RiskCategory category,
            @NotNull @Min(1) @Max(5) Integer likelihood,
            @NotNull @Min(1) @Max(5) Integer impact) {
    }

    public record UpdateRiskRequest(
            @NotBlank @Size(max = 200) @Pattern(regexp = NO_NUL, message = NO_NUL_MESSAGE) String title,
            @Size(max = 5000) @Pattern(regexp = NO_NUL, message = NO_NUL_MESSAGE) String description,
            @NotNull RiskCategory category,
            @NotNull @Min(1) @Max(5) Integer likelihood,
            @NotNull @Min(1) @Max(5) Integer impact,
            @NotNull Integer version) {
    }

    public record ChangeStatusRequest(@NotNull RiskStatus status, @NotNull Integer version) {
    }

    public record RiskResponse(
            UUID id, String title, String description, RiskCategory category, String owner,
            int likelihood, int impact, int inherentScore, Rating inherentRating,
            int residualLikelihood, int residualImpact, int residualScore, Rating rating,
            RiskStatus status, int version, Instant createdAt, Instant updatedAt) {

        static RiskResponse from(Risk r) {
            return new RiskResponse(r.getId(), r.getTitle(), r.getDescription(), r.getCategory(), r.getOwner(),
                    r.getLikelihood(), r.getImpact(), r.getInherentScore(), Rating.of(r.getInherentScore()),
                    r.getResidualLikelihood(), r.getResidualImpact(), r.getResidualScore(), r.getRating(),
                    r.getStatus(), r.getVersion(), r.getCreatedAt(), r.getUpdatedAt());
        }
    }

    public record LinkResponse(UUID controlId, ControlType controlType, BigDecimal latestEffectiveness,
                               Instant lastAssessedAt, Instant linkedAt) {

        static LinkResponse from(RiskControlLink l) {
            return new LinkResponse(l.getControlId(), l.getControlType(), l.getLatestEffectiveness(),
                    l.getLastAssessedAt(), l.getLinkedAt());
        }
    }

    public record HistoryResponse(int inherentScore, int residualScore, Rating rating, ScoreChangeCause cause,
                                  UUID causeEventId, UUID causeControlId, Instant changedAt) {

        static HistoryResponse from(RiskScoreHistory h) {
            return new HistoryResponse(h.getInherentScore(), h.getResidualScore(), h.getRating(), h.getCause(),
                    h.getCauseEventId(), h.getCauseControlId(), h.getChangedAt());
        }
    }

    /** Grids are rows of likelihood 1–5 by columns of impact 1–5; {@code totalRisks} excludes closed risks. */
    public record HeatmapResponse(List<List<Long>> inherent, List<List<Long>> residual, long totalRisks) {
    }

    public record TopRisksResponse(List<RiskResponse> risks) {
    }

    /** What the Overview screen shows, in one response: both heat-maps and the riskiest open risks. */
    public record OverviewResponse(HeatmapResponse heatmap, TopRisksResponse top) {
    }

    public record PageResponse<T>(List<T> content, int page, int size, long totalElements, int totalPages) {

        static <E, T> PageResponse<T> of(Page<E> page, Function<E, T> mapper) {
            return new PageResponse<>(page.map(mapper).getContent(), page.getNumber(), page.getSize(),
                    page.getTotalElements(), page.getTotalPages());
        }
    }
}
