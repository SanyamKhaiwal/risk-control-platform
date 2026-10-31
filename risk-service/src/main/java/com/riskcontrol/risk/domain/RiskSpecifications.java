package com.riskcontrol.risk.domain;

import com.riskcontrol.risk.scoring.Rating;
import jakarta.persistence.criteria.Root;
import jakarta.persistence.criteria.Subquery;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.data.jpa.domain.Specification;

/** Optional filters for the risk register list; null arguments are ignored. */
public final class RiskSpecifications {

    private RiskSpecifications() {
    }

    public static Specification<Risk> matching(RiskStatus status, Rating rating, String owner, UUID controlId) {
        List<Specification<Risk>> filters = new ArrayList<>();
        if (status != null) {
            filters.add((risk, query, cb) -> cb.equal(risk.get("status"), status));
        }
        if (rating != null) {
            filters.add((risk, query, cb) -> cb.equal(risk.get("rating"), rating));
        }
        if (owner != null) {
            filters.add((risk, query, cb) -> cb.equal(risk.get("owner"), owner));
        }
        if (controlId != null) {
            filters.add(linkedTo(controlId));
        }
        return Specification.allOf(filters);
    }

    private static Specification<Risk> linkedTo(UUID controlId) {
        return (risk, query, cb) -> {
            Subquery<Integer> link = Objects.requireNonNull(query).subquery(Integer.class);
            Root<RiskControlLink> l = link.from(RiskControlLink.class);
            link.select(cb.literal(1)).where(
                    cb.equal(l.get("id").get("riskId"), risk.get("id")),
                    cb.equal(l.get("id").get("controlId"), controlId));
            return cb.exists(link);
        };
    }
}
