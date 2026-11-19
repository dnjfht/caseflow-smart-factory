package kr.co.smartfactory.mes;

import jakarta.servlet.http.HttpServletRequest;
import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

@RestController
@RequestMapping("/api/scene")
public class SceneStateController {
    private static final URI AGENT = URI.create("http://127.0.0.1:5189/mcp");
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    private final ObjectMapper mapper;
    private final MesService mes;

    public SceneStateController(ObjectMapper mapper, MesService mes) { this.mapper = mapper; this.mes = mes; }

    @GetMapping("/layout")
    public ResponseEntity<?> layout(HttpServletRequest caller) { return state("get_scene", caller); }

    @GetMapping("/runtime")
    public ResponseEntity<?> runtime(HttpServletRequest caller) { return state("get_cargo", caller); }

    private ResponseEntity<?> state(String tool, HttpServletRequest caller) {
        try {
            if (!InetAddress.getByName(caller.getRemoteAddr()).isLoopbackAddress())
                return ResponseEntity.status(403).build();
            String payload = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"" + tool + "\",\"arguments\":{}}}";
            HttpRequest request = HttpRequest.newBuilder(AGENT).timeout(Duration.ofSeconds(4))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(payload)).build();
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) return ResponseEntity.status(503).build();
            JsonNode result = mapper.readTree(response.body()).path("result");
            if (result.path("isError").asBoolean()) return ResponseEntity.status(503).build();
            for (JsonNode item : result.path("content")) {
                if ("text".equals(item.path("type").asText())) {
                    JsonNode body=mapper.readTree(item.path("text").asText());
                    if (tool.equals("get_cargo") && body instanceof ObjectNode runtime) {
                        PlcSnapshot plc=mes.plc();
                        runtime.put("assemblyPhase",plc.assemblyPhase());
                        runtime.put("inspectionPhase",plc.inspectionPhase());
                        runtime.put("packingPhase",plc.packingPhase());
                        runtime.put("rejected",plc.rejected());
                        runtime.put("packed",plc.packed());
                        runtime.put("motorRunning",plc.motorRunning());
                        runtime.put("bodyStopper",plc.bodyStopper());
                        runtime.put("lidStopper",plc.lidStopper());
                        runtime.put("rejectDiverter",plc.rejectDiverter());
                        runtime.put("mesStop",plc.mesStop());
                    }
                    return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);
                }
            }
        } catch (Exception unavailable) {
            return ResponseEntity.status(503).build();
        }
        return ResponseEntity.status(503).build();
    }
}
