package kr.co.smartfactory.mes;

import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthService auth;

    public AuthController(AuthService auth) { this.auth = auth; }

    public record Login(String username, String password) {}

    @PostMapping("/login")
    public Map<String, Object> login(@RequestBody Login l) {
        Map<String, Object> r = auth.login(l.username(), l.password());
        if (r == null) {
            auth.audit(null, "LOGIN " + (l.username() == null ? "" : l.username()), "DENIED");
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "아이디 또는 비밀번호가 맞지 않습니다.");
        }
        return r;
    }

    /** who the token belongs to (null when not signed in) */
    @GetMapping("/me")
    public Map<String, Object> me(HttpServletRequest req) {
        AuthService.User u = current(req);
        return u == null ? Map.of("signedIn", false)
            : Map.of("signedIn", true, "username", u.username(), "name", u.name(), "role", u.role().name());
    }

    @GetMapping("/users")
    public List<Map<String, Object>> users() { return auth.users(); }

    @GetMapping("/audit")
    public List<Map<String, Object>> audit(@RequestParam(defaultValue = "50") int limit) { return auth.auditLog(limit); }

    static AuthService.User current(HttpServletRequest req) {
        return req.getAttribute(AuthInterceptor.USER) instanceof AuthService.User u ? u : null;
    }
}
