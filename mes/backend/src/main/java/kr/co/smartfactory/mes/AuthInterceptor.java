package kr.co.smartfactory.mes;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import kr.co.smartfactory.mes.AuthService.Role;
import kr.co.smartfactory.mes.AuthService.User;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * The permission check every API call passes. Looking is open to anyone; each change needs a role (see
 * {@link #required}). The line's own links (the field PC agent, the web twin's sync, the robot telemetry) are machine
 * channels and stay open, as a PLC's I/O would not ask a person to sign in. Every change a person makes is written to
 * the audit log with who did it and whether it was allowed.
 */
@Component
public class AuthInterceptor implements HandlerInterceptor {
    static final String USER = "mes.user";
    private static final Set<String> MACHINE = Set.of("/api/auth/login", "/api/twin/sync", "/api/twin/field-sync",
        "/api/robot/telemetry", "/api/robot/preview-finished");
    private final AuthService auth;

    public AuthInterceptor(AuthService auth) { this.auth = auth; }

    /** the least role a request needs, or null when anyone may make it */
    static Role required(String method, String path) {
        if ("OPTIONS".equals(method)) return null;
        if ("GET".equals(method)) {
            if (path.equals("/api/auth/users")) return Role.ADMIN;
            if (path.equals("/api/auth/audit")) return Role.SUPERVISOR;
            return null;
        }
        if (MACHINE.contains(path)) return null;
        // 생산 작업자: run the line (start / stop at the panel), draft production plans, book material in
        if (path.equals("/api/twin/press") || path.equals("/api/plc/stop") || path.equals("/api/plans") || path.equals("/api/lots"))
            return Role.OPERATOR;
        // 생산 관리자: approve plans, issue work orders, grant / withdraw the MES permit, change the robot program;
        // anything not listed defaults here, so a new endpoint is never open by accident
        return Role.SUPERVISOR;
    }

    @Override
    public boolean preHandle(HttpServletRequest req, HttpServletResponse res, Object handler) throws Exception {
        String path = req.getRequestURI();
        if (!path.startsWith("/api/")) return true;
        String h = req.getHeader("Authorization");
        User u = h != null && h.startsWith("Bearer ") ? auth.verify(h.substring(7)) : null;
        if (u != null) req.setAttribute(USER, u);
        Role need = required(req.getMethod(), path);
        if (need == null || (u != null && u.atLeast(need))) return true;
        String who = need == Role.OPERATOR ? "생산 작업자" : need == Role.SUPERVISOR ? "생산 관리자" : "시스템 관리자";
        int status = u == null ? 401 : 403;
        if (u != null) auth.audit(u, req.getMethod() + " " + path, "DENIED");
        res.setStatus(status);
        res.setContentType("application/json");
        res.setCharacterEncoding(StandardCharsets.UTF_8.name());
        String msg = u == null ? "로그인이 필요합니다. 이 작업은 " + who + " 이상만 할 수 있습니다."
            : u.name() + " 님(" + roleKo(u.role()) + ")은 이 작업 권한이 없습니다. " + who + " 이상이 필요합니다.";
        res.getWriter().write("{\"detail\":\"" + msg + "\"}");
        return false;
    }

    @Override
    public void afterCompletion(HttpServletRequest req, HttpServletResponse res, Object handler, Exception ex) {
        if ("GET".equals(req.getMethod()) || "OPTIONS".equals(req.getMethod())) return;
        if (MACHINE.contains(req.getRequestURI()) || !(req.getAttribute(USER) instanceof User u)) return;
        auth.audit(u, req.getMethod() + " " + req.getRequestURI(), res.getStatus() < 400 && ex == null ? "OK" : "FAILED " + res.getStatus());
    }

    static String roleKo(Role r) {
        return switch (r) { case OPERATOR -> "생산 작업자"; case SUPERVISOR -> "생산 관리자"; case ADMIN -> "시스템 관리자"; };
    }
}
