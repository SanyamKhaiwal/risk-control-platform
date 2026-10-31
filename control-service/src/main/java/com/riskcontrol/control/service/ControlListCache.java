package com.riskcontrol.control.service;

import com.riskcontrol.control.domain.Control;
import com.riskcontrol.control.domain.ControlType;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Duration;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.stereotype.Component;

/**
 * The control lists every open screen polls (the 100-control list, the re-test count), kept for a moment
 * (ShortLivedCache). Every write in this service clears it after it commits: creating or editing a control,
 * recording a test, flagging controls for re-testing.
 */
@Component
public class ControlListCache {

    record Key(ControlType type, String owner, Boolean retestRequired, int page, int size) {
    }

    private final ShortLivedCache<Key, Page<Control>> cache;

    ControlListCache(@Value("${control.list-cache.ttl:1s}") Duration ttl, MeterRegistry metrics) {
        this.cache = new ShortLivedCache<>("controls", ttl, 1000, metrics);
    }

    Page<Control> get(Key key, Supplier<Page<Control>> load) {
        return cache.get(key, load);
    }

    public void clear() {
        cache.clear();
    }
}
