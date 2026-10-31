package com.riskcontrol.control.api;

import com.riskcontrol.control.api.ControlDtos.ControlResponse;
import com.riskcontrol.control.api.ControlDtos.CreateControlRequest;
import com.riskcontrol.control.api.ControlDtos.PageResponse;
import com.riskcontrol.control.api.ControlDtos.UpdateControlRequest;
import com.riskcontrol.control.domain.Control;
import com.riskcontrol.control.domain.ControlType;
import com.riskcontrol.control.service.ControlService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.net.URI;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

@RestController
@RequestMapping("/api/controls")
public class ControlController {

    private final ControlService controlService;

    public ControlController(ControlService controlService) {
        this.controlService = controlService;
    }

    @GetMapping
    public PageResponse<ControlResponse> list(@RequestParam(required = false) ControlType type,
                                              @RequestParam(required = false) String owner,
                                              @RequestParam(required = false) Boolean retestRequired,
                                              @RequestParam(defaultValue = "0") @Min(0) int page,
                                              @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return PageResponse.of(controlService.list(type, owner, retestRequired, page, size), ControlResponse::from);
    }

    /** The logged-in control owner becomes the control's owner. */
    @PostMapping
    @PreAuthorize("hasRole('CONTROL_OWNER')")
    public ResponseEntity<ControlResponse> create(@Valid @RequestBody CreateControlRequest request,
                                                  Authentication user) {
        Control control = controlService.create(request.name(), request.description(), request.type(),
                user.getName(), request.frequency());
        URI location = ServletUriComponentsBuilder.fromCurrentRequest().path("/{id}").buildAndExpand(control.getId()).toUri();
        return ResponseEntity.created(location).body(ControlResponse.from(control));
    }

    @GetMapping("/{id}")
    public ControlResponse get(@PathVariable String id) {
        return ControlResponse.from(controlService.get(id));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasRole('CONTROL_OWNER')")
    public ControlResponse update(@PathVariable String id, @Valid @RequestBody UpdateControlRequest request,
                                  Authentication user) {
        return ControlResponse.from(controlService.update(id, request.version(), user.getName(), request.name(),
                request.description(), request.frequency()));
    }
}
