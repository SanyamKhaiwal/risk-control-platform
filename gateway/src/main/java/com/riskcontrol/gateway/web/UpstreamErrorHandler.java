package com.riskcontrol.gateway.web;

import java.io.IOException;
import java.net.ConnectException;
import java.net.SocketException;
import java.net.UnknownHostException;
import java.util.concurrent.TimeoutException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebExceptionHandler;
import reactor.core.publisher.Mono;
import reactor.netty.channel.AbortedException;
import reactor.netty.http.client.PrematureCloseException;

/**
 * A service that is down or dies mid-request is the service's problem, not a gateway bug: answer
 * 503 / 502 / 504 instead of a generic 500, so clients know to retry. Runs before Spring Boot's
 * default error handler (order -1); anything else falls through to it.
 */
@Component
@Order(-2)
class UpstreamErrorHandler implements WebExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(UpstreamErrorHandler.class);

    @Override
    public Mono<Void> handle(ServerWebExchange exchange, Throwable ex) {
        HttpStatus status = classify(ex);
        if (status == null || exchange.getResponse().isCommitted()) {
            return Mono.error(ex);
        }
        log.warn("Upstream failure for {} {}: {} -> {}", exchange.getRequest().getMethod(),
                exchange.getRequest().getPath(), ex.toString(), status.value());
        return switch (status) {
            case BAD_GATEWAY -> Problems.write(exchange, status, "Bad gateway",
                    "The service stopped responding while handling the request; try again.");
            case GATEWAY_TIMEOUT -> Problems.write(exchange, status, "Gateway timeout",
                    "The service took too long to respond; try again.");
            default -> Problems.write(exchange, status, "Service unavailable",
                    "The service handling this request is not available right now; try again shortly.");
        };
    }

    static HttpStatus classify(Throwable ex) {
        for (Throwable t = ex; t != null; t = t.getCause()) {
            if (t instanceof ConnectException || t instanceof UnknownHostException) {
                return HttpStatus.SERVICE_UNAVAILABLE;
            }
            // The service went away: closed before answering, closed before the request could be sent, or reset
            // mid-request (all three seen when a service was killed in Kubernetes).
            if (t instanceof PrematureCloseException || t instanceof AbortedException || t instanceof SocketException
                    || isReset(t)) {
                return HttpStatus.BAD_GATEWAY;
            }
            if (t instanceof TimeoutException) {
                return HttpStatus.GATEWAY_TIMEOUT;
            }
        }
        return null;
    }

    /** Netty's native transport reports a reset as a plain IOException ("... Connection reset by peer"). */
    private static boolean isReset(Throwable t) {
        return t instanceof IOException && t.getMessage() != null && t.getMessage().contains("Connection reset");
    }
}
