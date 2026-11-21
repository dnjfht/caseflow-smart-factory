package kr.co.smartfactory.mes;

import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/plc")
public class PlcController {
    private final PlcGateway gateway;

    public PlcController(PlcGateway gateway) { this.gateway = gateway; }

    @GetMapping
    public PlcSnapshot snapshot() { return gateway.sample(); }

    @PostMapping("/stop")
    public Map<String, Object> stop(@RequestBody StopRequest request) {
        try {
            gateway.stop(request.stopped());
            return Map.of("stopped", request.stopped(), "plc", gateway.sample());
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, e.getMessage(), e);
        }
    }

    public record StopRequest(boolean stopped) { }
}
