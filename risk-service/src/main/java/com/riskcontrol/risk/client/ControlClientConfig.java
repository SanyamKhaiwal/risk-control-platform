package com.riskcontrol.risk.client;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

@Configuration(proxyBeanMethods = false)
class ControlClientConfig {

    @Bean
    RestClient controlServiceRestClient(RestClient.Builder builder, ControlServiceProperties properties) {
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(properties.connectTimeout());
        requestFactory.setReadTimeout(properties.readTimeout());
        return builder.baseUrl(properties.url())
                .requestFactory(requestFactory)
                .requestInterceptor(new BearerTokenForwarder())
                .build();
    }
}
