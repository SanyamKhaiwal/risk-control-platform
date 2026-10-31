package com.riskcontrol.gateway.web;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.util.unit.DataSize;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

/**
 * Refuses request bodies over the limit before they reach a service, which would read the whole
 * body into memory (a few 150 MB requests crashed the Risk Service). A body without a length
 * (chunked) can't be checked up front, so it is refused too; browsers and API clients send one.
 */
@Component
class RequestSizeFilter implements GlobalFilter, Ordered {

    private final DataSize maxSize;

    RequestSizeFilter(@Value("${rcp.max-request-size}") DataSize maxSize) {
        this.maxSize = maxSize;
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        HttpHeaders headers = exchange.getRequest().getHeaders();
        long length = headers.getContentLength();
        if (length > maxSize.toBytes()) {
            return Problems.write(exchange, HttpStatus.CONTENT_TOO_LARGE, "Request too large",
                    "Request bodies are limited to " + maxSize.toKilobytes() + " KB.");
        }
        String encoding = headers.getFirst(HttpHeaders.TRANSFER_ENCODING);
        if (length < 0 && encoding != null && encoding.toLowerCase().contains("chunked")) {
            return Problems.write(exchange, HttpStatus.LENGTH_REQUIRED, "Length required",
                    "Send the request body with a Content-Length header.");
        }
        return chain.filter(exchange);
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE;
    }
}
