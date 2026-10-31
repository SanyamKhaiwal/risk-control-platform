package com.riskcontrol.gateway.web;

import java.nio.charset.StandardCharsets;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

/** Writes an RFC 7807 problem+json response, the same shape as every other error from this API. */
final class Problems {

    private Problems() {
    }

    static Mono<Void> write(ServerWebExchange exchange, HttpStatus status, String title, String detail) {
        var response = exchange.getResponse();
        response.setStatusCode(status);
        response.getHeaders().setContentType(MediaType.APPLICATION_PROBLEM_JSON);
        byte[] body = """
                {"type":"about:blank","title":"%s","status":%d,"detail":"%s"}"""
                .formatted(title, status.value(), detail).getBytes(StandardCharsets.UTF_8);
        DataBuffer buffer = response.bufferFactory().wrap(body);
        return response.writeWith(Mono.just(buffer));
    }
}
