package com.riskcontrol.risk.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.riskcontrol.risk.error.NotFoundException;
import com.riskcontrol.risk.error.ServiceUnavailableException;
import com.riskcontrol.risk.scoring.ControlType;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class ControlClientTest {

    private static final UUID CONTROL_ID = UUID.fromString("8f1c0000-0000-4000-8000-000000000001");

    private MockRestServiceServer server;
    private ControlClient client;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://control-service");
        server = MockRestServiceServer.bindTo(builder).build();
        client = new ControlClient(builder.build());
    }

    @Test
    void mapsTheFieldsLinkingNeedsAndIgnoresTheRest() {
        server.expect(requestTo("http://control-service/api/controls/" + CONTROL_ID))
                .andRespond(withSuccess("""
                        {"id": "%s", "name": "MFA on admin accounts", "type": "PREVENTIVE", "owner": "bob",
                         "latestEffectiveness": 0.5, "lastAssessedAt": "2026-10-28T10:00:00Z", "version": 3}
                        """.formatted(CONTROL_ID), MediaType.APPLICATION_JSON));

        ControlSummary control = client.getControl(CONTROL_ID);

        assertThat(control).isEqualTo(new ControlSummary(CONTROL_ID, ControlType.PREVENTIVE,
                new BigDecimal("0.5"), Instant.parse("2026-10-28T10:00:00Z")));
    }

    @Test
    void untestedControlHasNullEffectiveness() {
        server.expect(requestTo("http://control-service/api/controls/" + CONTROL_ID))
                .andRespond(withSuccess("""
                        {"id": "%s", "type": "DETECTIVE", "latestEffectiveness": null, "lastAssessedAt": null}
                        """.formatted(CONTROL_ID), MediaType.APPLICATION_JSON));

        assertThat(client.getControl(CONTROL_ID).latestEffectiveness()).isNull();
    }

    @Test
    void notFoundBecomesNotFoundException() {
        server.expect(requestTo("http://control-service/api/controls/" + CONTROL_ID))
                .andRespond(withStatus(HttpStatus.NOT_FOUND));

        assertThatThrownBy(() -> client.getControl(CONTROL_ID))
                .isInstanceOf(NotFoundException.class)
                .hasMessageContaining(CONTROL_ID.toString());
    }

    @Test
    void serverErrorBecomesServiceUnavailable() {
        server.expect(requestTo("http://control-service/api/controls/" + CONTROL_ID)).andRespond(withServerError());

        assertThatThrownBy(() -> client.getControl(CONTROL_ID)).isInstanceOf(ServiceUnavailableException.class);
    }

    @Test
    void responseWithoutTypeIsRejected() {
        server.expect(requestTo("http://control-service/api/controls/" + CONTROL_ID))
                .andRespond(withSuccess("{\"id\": \"%s\"}".formatted(CONTROL_ID), MediaType.APPLICATION_JSON));

        assertThatThrownBy(() -> client.getControl(CONTROL_ID)).isInstanceOf(ServiceUnavailableException.class);
    }
}
