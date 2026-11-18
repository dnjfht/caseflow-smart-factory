package kr.co.smartfactory.mes;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Resets only a completed line before a new work order starts. */
@Component
public class OipRunGateway {
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    private final ObjectMapper mapper;
    private final URI endpoint = URI.create("http://127.0.0.1:5189/mcp");

    public OipRunGateway(ObjectMapper mapper) { this.mapper = mapper; }

    public void resetLine() throws Exception {
        call("stop");
        call("run");
    }

    public JsonNode state(String tool) throws Exception { return call(tool); }

    private JsonNode call(String tool) throws Exception {
        String payload = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"" + tool + "\",\"arguments\":{}}}";
        HttpRequest request = HttpRequest.newBuilder(endpoint).timeout(Duration.ofSeconds(8))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(payload)).build();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) throw new IllegalStateException("현장 운전 전환 실패: HTTP " + response.statusCode());
        JsonNode result = mapper.readTree(response.body());
        if (result.has("error") || result.path("result").path("isError").asBoolean())
            throw new IllegalStateException("현장 운전 전환 실패: " + response.body());
        for (JsonNode item : result.path("result").path("content"))
            if ("text".equals(item.path("type").asText())) return mapper.readTree(item.path("text").asText());
        return result.path("result");
    }
}
