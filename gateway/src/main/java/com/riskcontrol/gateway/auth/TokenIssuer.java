package com.riskcontrol.gateway.auth;

import com.nimbusds.jose.jwk.RSAKey;
import com.riskcontrol.gateway.auth.AuthProperties.DemoUser;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Component;

/** Issues RS256 access tokens: sub = username, roles = the user's roles, valid for the configured TTL. */
@Component
public class TokenIssuer {

    private final JwtEncoder encoder;
    private final AuthProperties properties;
    private final String keyId;
    private final Clock clock;

    TokenIssuer(JwtEncoder encoder, AuthProperties properties, RSAKey signingKey, Clock clock) {
        this.encoder = encoder;
        this.properties = properties;
        this.keyId = signingKey.getKeyID();
        this.clock = clock;
    }

    LoginResponse issue(DemoUser user) {
        Instant now = clock.instant();
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .id(UUID.randomUUID().toString())
                .issuer(properties.issuer())
                .subject(user.username())
                .issuedAt(now)
                .expiresAt(now.plus(properties.tokenTtl()))
                .claim("roles", user.roles())
                .build();
        JwsHeader header = JwsHeader.with(SignatureAlgorithm.RS256).keyId(keyId).build();
        String token = encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
        return new LoginResponse(token, "Bearer", properties.tokenTtl().toSeconds(), user.username(), user.roles());
    }

    /**
     * A token for the Gateway's own use (the live-update hub reads data on behalf of everyone watching it), with the
     * given roles and the normal lifetime. It is never handed to a browser.
     */
    public String serviceToken(String subject, List<String> roles) {
        return issue(new DemoUser(subject, null, roles)).accessToken();
    }
}
