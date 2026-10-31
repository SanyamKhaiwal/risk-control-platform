package com.riskcontrol.gateway.auth;

import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;
import org.springframework.security.converter.RsaKeyConverters;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusReactiveJwtDecoder;
import org.springframework.security.oauth2.jwt.ReactiveJwtDecoder;

/** RS256 keys: the gateway signs with the private key; it and the services verify with the public key. */
@Configuration(proxyBeanMethods = false)
class JwtConfig {

    @Bean
    RSAKey signingKey(AuthProperties properties) {
        RSAPublicKey publicKey = read(properties.publicKeyLocation(), RsaKeyConverters.x509()::convert);
        RSAPrivateKey privateKey = read(properties.privateKeyLocation(), RsaKeyConverters.pkcs8()::convert);
        try {
            return new RSAKey.Builder(publicKey).privateKey(privateKey).keyIDFromThumbprint().build();
        } catch (com.nimbusds.jose.JOSEException e) {
            throw new IllegalStateException("Could not compute the JWT key id", e);
        }
    }

    @Bean
    JwtEncoder jwtEncoder(RSAKey signingKey) {
        return new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(signingKey)));
    }

    /** Checks signature, expiry and issuer before a request is routed to a service. */
    @Bean
    ReactiveJwtDecoder jwtDecoder(RSAKey signingKey, AuthProperties properties, Clock clock)
            throws com.nimbusds.jose.JOSEException {
        NimbusReactiveJwtDecoder decoder = NimbusReactiveJwtDecoder.withPublicKey(signingKey.toRSAPublicKey()).build();
        decoder.setJwtValidator(JwtValidators.createDefaultWithIssuer(properties.issuer()));
        return new CachingJwtDecoder(decoder, clock);
    }

    private static <T> T read(Resource resource, KeyReader<T> reader) {
        try (InputStream in = resource.getInputStream()) {
            return reader.read(in);
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot read JWT key " + resource
                    + " (generate dev keys with: node scripts/gen-dev-keys.mjs)", e);
        }
    }

    @FunctionalInterface
    private interface KeyReader<T> {
        T read(InputStream in);
    }
}
