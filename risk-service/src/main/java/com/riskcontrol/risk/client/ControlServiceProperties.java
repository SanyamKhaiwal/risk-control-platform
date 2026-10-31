package com.riskcontrol.risk.client;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("risk.control-service")
public record ControlServiceProperties(String url, Duration connectTimeout, Duration readTimeout) {
}
