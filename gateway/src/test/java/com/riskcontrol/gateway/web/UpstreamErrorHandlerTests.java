package com.riskcontrol.gateway.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.ConnectException;
import java.net.SocketException;
import java.util.concurrent.TimeoutException;
import org.junit.jupiter.api.Test;
import reactor.netty.channel.AbortedException;
import org.springframework.http.HttpStatus;

/** Which upstream failures become 503 / 502 / 504 rather than a generic 500. */
class UpstreamErrorHandlerTests {

    @Test
    void aServiceThatCrashesMidRequestIsABadGateway() {
        // What reactor-netty raises when the service's process is killed while answering (Kubernetes failure test).
        assertThat(UpstreamErrorHandler.classify(new RuntimeException(new IOException("recvAddress(..) failed with error(-104): Connection reset by peer"))))
                .isEqualTo(HttpStatus.BAD_GATEWAY);
        assertThat(UpstreamErrorHandler.classify(new SocketException("Connection reset"))).isEqualTo(HttpStatus.BAD_GATEWAY);
        assertThat(UpstreamErrorHandler.classify(AbortedException.beforeSend())).isEqualTo(HttpStatus.BAD_GATEWAY);
    }

    @Test
    void aServiceThatIsDownOrSlowKeepsItsStatus() {
        assertThat(UpstreamErrorHandler.classify(new ConnectException("refused"))).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        assertThat(UpstreamErrorHandler.classify(new TimeoutException())).isEqualTo(HttpStatus.GATEWAY_TIMEOUT);
    }

    @Test
    void anythingElseIsLeftToTheDefaultHandler() {
        assertThat(UpstreamErrorHandler.classify(new IllegalStateException("bug"))).isNull();
    }
}
