package com.riskcontrol.risk.api;

import com.riskcontrol.risk.api.RiskDtos.LinkResponse;
import com.riskcontrol.risk.service.LinkService;
import java.net.URI;
import java.util.List;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

@RestController
@RequestMapping("/api/risks/{riskId}/controls")
public class LinkController {

    private final LinkService linkService;

    public LinkController(LinkService linkService) {
        this.linkService = linkService;
    }

    @GetMapping
    public List<LinkResponse> list(@PathVariable UUID riskId) {
        return linkService.list(riskId).stream().map(LinkResponse::from).toList();
    }

    @PostMapping("/{controlId}")
    @PreAuthorize("hasRole('RISK_OWNER')")
    public ResponseEntity<LinkResponse> link(@PathVariable UUID riskId, @PathVariable UUID controlId,
                                             Authentication user) {
        LinkResponse link = LinkResponse.from(linkService.link(riskId, controlId, user.getName()));
        URI location = ServletUriComponentsBuilder.fromCurrentRequest().build().toUri();
        return ResponseEntity.created(location).body(link);
    }

    /** Removes the link only; the risk and the control are unchanged apart from the risk's score. */
    @DeleteMapping("/{controlId}")
    @PreAuthorize("hasRole('RISK_OWNER')")
    public ResponseEntity<Void> unlink(@PathVariable UUID riskId, @PathVariable UUID controlId, Authentication user) {
        linkService.unlink(riskId, controlId, user.getName());
        return ResponseEntity.noContent().build();
    }
}
