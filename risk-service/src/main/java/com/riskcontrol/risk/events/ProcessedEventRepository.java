package com.riskcontrol.risk.events;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface ProcessedEventRepository extends JpaRepository<ProcessedEvent, UUID> {
}
