package kr.co.smartfactory.mes;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

@RestControllerAdvice
public class ApiErrorHandler {
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String,String>> handle(ResponseStatusException error) {
        String detail = error.getReason() == null ? error.getStatusCode().toString() : error.getReason();
        return ResponseEntity.status(error.getStatusCode()).body(Map.of("detail", detail));
    }
}
