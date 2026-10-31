package com.riskcontrol.control.events;

interface VersionedEvent {

    int schemaVersion();

    boolean hasRequiredFields();
}
