package com.riskcontrol.control.events;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Component;

/**
 * Ed25519 signatures on Kafka events, so a message is trusted because of who signed it, not because it
 * reached the topic (ARCHITECTURE.md §8, docs/security-review.md SEC-07). This service signs what it
 * publishes with its own private key and accepts only events signed by the other service's key.
 * The signature travels in the {@value #HEADER} header, base64, over the exact payload bytes.
 */
@Component
public class EventSignatures {

    public static final String HEADER = "rcp-signature";
    private static final String ALGORITHM = "Ed25519";

    private final PrivateKey signingKey;
    private final PublicKey peerKey;

    public EventSignatures(@Value("${rcp.events.signing-key-location}") Resource signingKey,
                           @Value("${rcp.events.peer-public-key-location}") Resource peerKey) {
        try {
            KeyFactory keys = KeyFactory.getInstance(ALGORITHM);
            this.signingKey = keys.generatePrivate(new PKCS8EncodedKeySpec(pem(signingKey)));
            this.peerKey = keys.generatePublic(new X509EncodedKeySpec(pem(peerKey)));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Invalid event signing keys (generate dev keys with: node scripts/gen-dev-keys.mjs)", e);
        }
    }

    /** Base64 signature of the payload with this service's key. */
    public String sign(String payload) {
        try {
            Signature signature = Signature.getInstance(ALGORITHM);
            signature.initSign(signingKey);
            signature.update(payload.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(signature.sign());
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Could not sign event", e);
        }
    }

    /** True only if {@code header} is a valid signature of {@code payload} by the other service. */
    public boolean signedByPeer(String payload, byte[] header) {
        if (payload == null || header == null) {
            return false;
        }
        try {
            Signature signature = Signature.getInstance(ALGORITHM);
            signature.initVerify(peerKey);
            signature.update(payload.getBytes(StandardCharsets.UTF_8));
            return signature.verify(Base64.getDecoder().decode(header));
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            return false;
        }
    }

    private static byte[] pem(Resource resource) {
        try {
            String text = resource.getContentAsString(StandardCharsets.US_ASCII);
            return Base64.getMimeDecoder().decode(text.replaceAll("-----[A-Z ]+-----", ""));
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot read event signing key " + resource
                    + " (generate dev keys with: node scripts/gen-dev-keys.mjs)", e);
        }
    }
}
