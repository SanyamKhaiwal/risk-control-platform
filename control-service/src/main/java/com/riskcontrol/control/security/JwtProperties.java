package com.riskcontrol.control.security;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.core.io.Resource;

/** The gateway's public key and issuer; this service can verify tokens but never issue them. */
@ConfigurationProperties("rcp.jwt")
public record JwtProperties(String issuer, Resource publicKeyLocation) {
}
