package com.riskcontrol.risk.client;

import com.riskcontrol.risk.error.NotFoundException;
import com.riskcontrol.risk.error.ServiceUnavailableException;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/** Synchronous call to the Control Service, used only when a control is linked to a risk. */
@Component
public class ControlClient {

    private final RestClient controlServiceRestClient;

    public ControlClient(RestClient controlServiceRestClient) {
        this.controlServiceRestClient = controlServiceRestClient;
    }

    public ControlSummary getControl(UUID controlId) {
        try {
            ControlSummary control = controlServiceRestClient.get()
                    .uri("/api/controls/{id}", controlId)
                    .retrieve()
                    .onStatus(status -> status.isSameCodeAs(HttpStatus.NOT_FOUND), (request, response) -> {
                        throw new NotFoundException("Control " + controlId + " not found");
                    })
                    .body(ControlSummary.class);
            if (control == null || control.type() == null) {
                throw new ServiceUnavailableException("Control Service returned an invalid response", null);
            }
            return control;
        } catch (RestClientException e) {
            throw new ServiceUnavailableException("Control Service is unavailable", e);
        }
    }
}
