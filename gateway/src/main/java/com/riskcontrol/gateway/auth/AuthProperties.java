package com.riskcontrol.gateway.auth;

import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.core.io.Resource;

/**
 * Login and token settings. The users are demo accounts for local development (real SSO is out
 * of scope); in other environments they come from configuration or Kubernetes Secrets.
 */
@ConfigurationProperties("rcp.auth")
public record AuthProperties(String issuer, Duration tokenTtl, Resource privateKeyLocation,
                             Resource publicKeyLocation, int loginAttemptsPerMinute,
                             int loginAttemptsPerMinutePerAddress, List<DemoUser> users) {

    public record DemoUser(String username, String passwordHash, List<String> roles) {
    }
}
