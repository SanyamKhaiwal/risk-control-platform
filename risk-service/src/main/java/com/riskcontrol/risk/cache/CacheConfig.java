package com.riskcontrol.risk.cache;

import com.riskcontrol.risk.api.RiskDtos.HeatmapResponse;
import com.riskcontrol.risk.api.RiskDtos.RiskResponse;
import com.riskcontrol.risk.api.RiskDtos.TopRisksResponse;
import java.time.Duration;
import org.springframework.boot.cache.autoconfigure.RedisCacheManagerBuilderCustomizer;
import org.springframework.cache.annotation.CachingConfigurer;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.cache.interceptor.CacheErrorHandler;
import org.springframework.cache.interceptor.LoggingCacheErrorHandler;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.serializer.JacksonJsonRedisSerializer;
import org.springframework.data.redis.serializer.RedisSerializationContext.SerializationPair;
import tools.jackson.databind.json.JsonMapper;

/**
 * Redis caches (ARCHITECTURE.md §11). Each cache stores one DTO type as plain JSON, so values are
 * readable with redis-cli. If Redis is down, cache errors are logged and reads go to the database.
 */
@Configuration(proxyBeanMethods = false)
@EnableCaching
public class CacheConfig implements CachingConfigurer {

    public static final String HEATMAP = "dashHeatmap";
    public static final String TOP = "dashTop";
    public static final String RISK = "risk";

    @Bean
    RedisCacheManagerBuilderCustomizer cacheTypes(JsonMapper json) {
        // Statistics on, so Boot publishes cache hits and misses as metrics (cache.gets).
        return builder -> builder
                .enableStatistics()
                .withCacheConfiguration(HEATMAP, typed(json, HeatmapResponse.class, Duration.ofMinutes(5)))
                .withCacheConfiguration(TOP, typed(json, TopRisksResponse.class, Duration.ofMinutes(5)))
                .withCacheConfiguration(RISK, typed(json, RiskResponse.class, Duration.ofMinutes(10)));
    }

    @Override
    public CacheErrorHandler errorHandler() {
        return new LoggingCacheErrorHandler();
    }

    private static RedisCacheConfiguration typed(JsonMapper json, Class<?> type, Duration ttl) {
        return RedisCacheConfiguration.defaultCacheConfig()
                .entryTtl(ttl)
                .disableCachingNullValues()
                .serializeValuesWith(SerializationPair.fromSerializer(new JacksonJsonRedisSerializer<>(json, type)));
    }
}
