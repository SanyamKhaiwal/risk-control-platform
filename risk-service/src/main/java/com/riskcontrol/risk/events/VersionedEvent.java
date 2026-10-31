package com.riskcontrol.risk.events;

interface VersionedEvent {

    int schemaVersion();

    boolean hasRequiredFields();
}
