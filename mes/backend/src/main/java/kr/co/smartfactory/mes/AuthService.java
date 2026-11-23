package kr.co.smartfactory.mes;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Who is using the MES, and what their role lets them do. Roles stack (each includes the ones below it):
 * OPERATOR (생산 작업자) runs the line and drafts plans; SUPERVISOR (생산 관리자) approves plans, issues and permits
 * work orders; ADMIN (시스템 관리자) also manages accounts. Anyone may look without signing in.
 * <p>
 * Passwords are kept as PBKDF2-SHA256 hashes; a sign-in returns a token signed with a key kept in the database, so
 * sign-ins survive a server restart (the free server sleeps and wakes often).
 */
@Service
public class AuthService {
    public enum Role { OPERATOR, SUPERVISOR, ADMIN }
    public record User(String username, String name, Role role) {
        public String label() { return name + " (" + username + ")"; }
        public boolean atLeast(Role r) { return role.ordinal() >= r.ordinal(); }
    }

    static final long TTL_SECONDS = 12 * 3600;
    private static final int ITERATIONS = 120_000;
    private final JdbcTemplate db;
    private final SecureRandom random = new SecureRandom();
    private final byte[] key;

    public AuthService(JdbcTemplate db,
                       @Value("${mes.demo.password.operator:operator1234}") String operatorPw,
                       @Value("${mes.demo.password.supervisor:supervisor1234}") String supervisorPw,
                       @Value("${mes.demo.password.admin:admin1234}") String adminPw) {
        this.db = db;
        List<String> k = db.queryForList("SELECT setting_value FROM app_setting WHERE setting_key='auth.key'", String.class);
        if (k.isEmpty()) {
            byte[] fresh = new byte[32];
            random.nextBytes(fresh);
            db.update("INSERT INTO app_setting(setting_key,setting_value) VALUES ('auth.key',?)", HexFormat.of().formatHex(fresh));
            key = fresh;
        } else key = HexFormat.of().parseHex(k.get(0));
        Integer users = db.queryForObject("SELECT COUNT(*) FROM mes_user", Integer.class);
        if (users == null || users == 0) {
            create("operator1", "김현장", Role.OPERATOR, operatorPw);
            create("supervisor1", "이반장", Role.SUPERVISOR, supervisorPw);
            create("admin", "시스템관리자", Role.ADMIN, adminPw);
        }
    }

    void create(String username, String name, Role role, String password) {
        db.update("INSERT INTO mes_user(username,display_name,role,password_hash) VALUES (?,?,?,?)", username, name, role.name(), hash(password));
    }

    String hash(String password) {
        byte[] salt = new byte[16];
        random.nextBytes(salt);
        return "pbkdf2$" + ITERATIONS + "$" + HexFormat.of().formatHex(salt) + "$" + HexFormat.of().formatHex(pbkdf2(password, salt, ITERATIONS));
    }

    private static byte[] pbkdf2(String password, byte[] salt, int iterations) {
        try {
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
                .generateSecret(new PBEKeySpec(password.toCharArray(), salt, iterations, 256)).getEncoded();
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    static boolean matches(String password, String stored) {
        String[] p = stored.split("\\$");
        if (p.length != 4 || !"pbkdf2".equals(p[0])) return false;
        byte[] expected = HexFormat.of().parseHex(p[3]);
        return MessageDigest.isEqual(expected, pbkdf2(password, HexFormat.of().parseHex(p[2]), Integer.parseInt(p[1])));
    }

    /** a signed token for the user, or null if the name or password is wrong */
    public Map<String, Object> login(String username, String password) {
        if (username == null || password == null) return null;
        List<Map<String, Object>> rows = db.queryForList(
            "SELECT username, display_name, role, password_hash FROM mes_user WHERE username=? AND active=TRUE", username.trim());
        if (rows.isEmpty() || !matches(password, String.valueOf(rows.get(0).get("password_hash")))) return null;
        Map<String, Object> r = rows.get(0);
        User u = new User(String.valueOf(r.get("username")), String.valueOf(r.get("display_name")), Role.valueOf(String.valueOf(r.get("role"))));
        long exp = Instant.now().getEpochSecond() + TTL_SECONDS;
        String body = b64(u.username() + "\n" + u.role() + "\n" + exp + "\n" + u.name());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("token", body + "." + sign(body));
        out.put("user", Map.of("username", u.username(), "name", u.name(), "role", u.role().name()));
        out.put("expiresAt", exp);
        return out;
    }

    /** the user a token belongs to, or null if it is missing, forged or expired */
    public User verify(String token) {
        if (token == null || !token.contains(".")) return null;
        String body = token.substring(0, token.indexOf('.')), sig = token.substring(token.indexOf('.') + 1);
        if (!MessageDigest.isEqual(sign(body).getBytes(StandardCharsets.US_ASCII), sig.getBytes(StandardCharsets.US_ASCII))) return null;
        String[] f = new String(Base64.getUrlDecoder().decode(body), StandardCharsets.UTF_8).split("\n", 4);
        if (f.length != 4 || Long.parseLong(f[2]) < Instant.now().getEpochSecond()) return null;
        return new User(f[0], f[3], Role.valueOf(f[1]));
    }

    private static String b64(String s) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(s.getBytes(StandardCharsets.UTF_8));
    }

    private String sign(String body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(body.getBytes(StandardCharsets.US_ASCII)));
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    public List<Map<String, Object>> users() {
        return db.queryForList("SELECT username, display_name, role, active, created_at FROM mes_user ORDER BY id");
    }

    public void audit(User u, String action, String result) {
        db.update("INSERT INTO audit_log(username,role,action,result) VALUES (?,?,?,?)",
            u == null ? null : u.username(), u == null ? null : u.role().name(), action.length() > 120 ? action.substring(0, 120) : action, result);
    }

    public List<Map<String, Object>> auditLog(int limit) {
        return db.queryForList("SELECT a.at, a.username, u.display_name, a.role, a.action, a.result FROM audit_log a " +
            "LEFT JOIN mes_user u ON u.username = a.username ORDER BY a.id DESC LIMIT ?", Math.max(1, Math.min(200, limit)));
    }
}
