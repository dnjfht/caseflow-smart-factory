package kr.co.smartfactory.mes;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.InetAddress;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Base64;
import javax.imageio.ImageIO;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

@RestController
@RequestMapping("/api/scene")
public class SceneFrameController {
    private static final URI OIP = URI.create("http://127.0.0.1:5189/mcp");
    private static final String CAPTURE = """
        {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"capture_view","arguments":{"from":"window"}}}
        """;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    private final ObjectMapper json;
    private byte[] cachedView;
    private byte[] cachedWindow;
    private long cachedAt;

    public SceneFrameController(ObjectMapper json) { this.json = json; }

    @GetMapping(value="/frame", produces=MediaType.IMAGE_JPEG_VALUE)
    public synchronized ResponseEntity<byte[]> frame(@RequestParam(defaultValue="view") String mode,
                                                       HttpServletRequest caller) {
        if (!localCaller(caller)) return ResponseEntity.status(403).build();
        boolean wholeWindow = "window".equals(mode);
        long now = System.currentTimeMillis();
        byte[] cached = wholeWindow ? cachedWindow : cachedView;
        if (cached != null && now - cachedAt < 90)
            return ResponseEntity.ok().cacheControl(org.springframework.http.CacheControl.noStore()).body(cached);
        try {
            HttpRequest request = HttpRequest.newBuilder(OIP).timeout(Duration.ofSeconds(8))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(CAPTURE)).build();
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) return ResponseEntity.status(503).build();
            JsonNode result = json.readTree(response.body()).path("result");
            if (result.path("isError").asBoolean()) return ResponseEntity.status(503).build();
            String encoded = null;
            for (JsonNode item : result.path("content")) {
                if ("image".equals(item.path("type").asText())) { encoded = item.path("data").asText(); break; }
            }
            if (encoded == null || encoded.isBlank()) return ResponseEntity.status(503).build();
            byte[] image = Base64.getDecoder().decode(encoded);
            BufferedImage source = ImageIO.read(new ByteArrayInputStream(image));
            if (source == null || source.getWidth() < 400 || source.getHeight() < 300)
                return ResponseEntity.status(503).build();
            // The desktop capture uses physical pixels. OIP's editor docks are
            // 208 px on either side, with 60 px above and 340 px below the view
            // at the current window size. Scale the cut with the captured image.
            int x = (int) Math.round(source.getWidth() * 208.0 / 1224.0);
            int y = (int) Math.round(source.getHeight() * 60.0 / 1022.0);
            int right = x;
            int bottom = (int) Math.round(source.getHeight() * 340.0 / 1022.0);
            BufferedImage view = source.getSubimage(x, y, source.getWidth()-x-right, source.getHeight()-y-bottom);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            ImageIO.write(view, "jpg", out);
            cachedWindow = image;
            cachedView = out.toByteArray();
            cachedAt = now;
            return ResponseEntity.ok().cacheControl(org.springframework.http.CacheControl.noStore())
                .body(wholeWindow ? cachedWindow : cachedView);
        } catch (Exception unavailable) {
            return ResponseEntity.status(503).build();
        }
    }

    @GetMapping(value="/stream", produces="multipart/x-mixed-replace;boundary=frame")
    public ResponseEntity<StreamingResponseBody> stream(@RequestParam(defaultValue="view") String mode,
                                                         HttpServletRequest caller) {
        if (!localCaller(caller)) return ResponseEntity.status(403).build();
        byte[] first = frame(mode, caller).getBody();
        if (first == null) return ResponseEntity.status(503).build();
        StreamingResponseBody body = output -> {
            byte[] current = first;
            try {
                while (!Thread.currentThread().isInterrupted()) {
                    output.write(("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                        + current.length + "\r\n\r\n").getBytes(java.nio.charset.StandardCharsets.US_ASCII));
                    output.write(current);
                    output.write("\r\n".getBytes(java.nio.charset.StandardCharsets.US_ASCII));
                    output.flush();
                    Thread.sleep(100);
                    current = frame(mode, caller).getBody();
                    if (current == null) break;
                }
            } catch (IOException | InterruptedException closed) {
                if (closed instanceof InterruptedException) Thread.currentThread().interrupt();
            }
        };
        return ResponseEntity.ok().cacheControl(org.springframework.http.CacheControl.noStore())
            .contentType(MediaType.parseMediaType("multipart/x-mixed-replace;boundary=frame"))
            .body(body);
    }

    private boolean localCaller(HttpServletRequest caller) {
        try { return InetAddress.getByName(caller.getRemoteAddr()).isLoopbackAddress(); }
        catch (Exception invalidAddress) { return false; }
    }
}
