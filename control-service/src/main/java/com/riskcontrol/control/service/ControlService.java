package com.riskcontrol.control.service;

import static org.springframework.data.mongodb.core.query.Criteria.where;

import com.riskcontrol.control.domain.AssessmentHasher;
import com.riskcontrol.control.domain.Control;
import com.riskcontrol.control.domain.ControlFrequency;
import com.riskcontrol.control.domain.ControlRepository;
import com.riskcontrol.control.domain.ControlType;
import com.riskcontrol.control.error.ConflictException;
import com.riskcontrol.control.error.ForbiddenException;
import com.riskcontrol.control.error.NotFoundException;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Service;

@Service
public class ControlService {

    private final ControlRepository controls;
    private final MongoTemplate mongo;
    private final AssessmentHasher hasher;
    private final ControlListCache listCache;
    private final Clock clock;

    public ControlService(ControlRepository controls, MongoTemplate mongo, AssessmentHasher hasher,
                          ControlListCache listCache, Clock clock) {
        this.controls = controls;
        this.mongo = mongo;
        this.hasher = hasher;
        this.listCache = listCache;
        this.clock = clock;
    }

    public Control create(String name, String description, ControlType type, String owner, ControlFrequency frequency) {
        Control control = new Control(name, description, type, owner, frequency, now());
        control.sealHead(hasher.sealHead(control.getId(), 0, null));
        Control created = controls.insert(control);
        listCache.clear();
        return created;
    }

    public Control get(String id) {
        return controls.findById(id).orElseThrow(() -> new NotFoundException("Control " + id + " not found"));
    }

    public Page<Control> list(ControlType type, String owner, Boolean retestRequired, int page, int size) {
        return listCache.get(new ControlListCache.Key(type, owner, retestRequired, page, size),
                () -> query(type, owner, retestRequired, page, size));
    }

    private Page<Control> query(ControlType type, String owner, Boolean retestRequired, int page, int size) {
        Query query = new Query();
        if (type != null) {
            query.addCriteria(where("type").is(type));
        }
        if (owner != null) {
            query.addCriteria(where("owner").is(owner));
        }
        if (retestRequired != null) {
            query.addCriteria(where("retestRequired").is(retestRequired));
        }
        long total = mongo.count(query, Control.class);
        PageRequest pageable = PageRequest.of(page, size, Sort.by(Sort.Order.asc("name"), Sort.Order.asc("_id")));
        List<Control> content = mongo.find(query.with(pageable), Control.class);
        return new PageImpl<>(content, pageable, total);
    }

    public Control update(String id, long expectedVersion, String actor, String name, String description,
                          ControlFrequency frequency) {
        Control control = get(id);
        if (!control.getOwner().equals(actor)) {
            throw new ForbiddenException("Only the owner (" + control.getOwner() + ") can change control " + id);
        }
        if (control.getVersion() != expectedVersion) {
            throw new ConflictException("Control " + id + " has changed (version " + control.getVersion()
                    + ", request had " + expectedVersion + "); reload it and retry");
        }
        control.edit(name, description, frequency, now());
        Control saved = controls.save(control);
        listCache.clear();
        return saved;
    }

    /** MongoDB stores milliseconds. */
    private Instant now() {
        return Instant.now(clock).truncatedTo(ChronoUnit.MILLIS);
    }
}
