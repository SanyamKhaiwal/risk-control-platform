package com.riskcontrol.control.config;

import com.riskcontrol.control.domain.AssessmentHasher;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;

/** The secret that keys the assessment hash chain: a base64 file only this service can read. */
@Configuration(proxyBeanMethods = false)
class ChainKeyConfig {

    @Bean
    AssessmentHasher assessmentHasher(@Value("${control.assessments.chain-key-location}") Resource key) {
        try {
            return new AssessmentHasher(Base64.getDecoder().decode(key.getContentAsString(StandardCharsets.US_ASCII).trim()));
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot read the assessment chain key " + key
                    + " (generate dev keys with: node scripts/gen-dev-keys.mjs)", e);
        }
    }
}
