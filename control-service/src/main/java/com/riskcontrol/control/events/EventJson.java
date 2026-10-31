package com.riskcontrol.control.events;

import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.json.JsonMapper;

/** Event (de)serialization. Anything unreadable becomes an {@link InvalidEventException}. */
@Component
public class EventJson {

    static final int SUPPORTED_SCHEMA_VERSION = 1;

    private final JsonMapper json;

    public EventJson(JsonMapper json) {
        this.json = json;
    }

    public String write(Object event) {
        return json.writeValueAsString(event);
    }

    <T extends VersionedEvent> T read(String payload, Class<T> type) {
        T event;
        try {
            event = json.readValue(payload, type);
        } catch (JacksonException e) {
            throw new InvalidEventException("Unreadable " + type.getSimpleName() + ": " + e.getOriginalMessage(), e);
        }
        if (event == null || event.schemaVersion() != SUPPORTED_SCHEMA_VERSION || !event.hasRequiredFields()) {
            throw new InvalidEventException("Unsupported or incomplete " + type.getSimpleName() + ": " + payload, null);
        }
        return event;
    }
}
