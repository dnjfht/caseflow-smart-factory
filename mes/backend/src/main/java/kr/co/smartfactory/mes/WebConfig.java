package kr.co.smartfactory.mes;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** The MES web is served by the static site; the API answers it from another origin. */
@Configuration
public class WebConfig implements WebMvcConfigurer {
    private final String[] origins;
    private final AuthInterceptor auth;

    public WebConfig(@Value("${mes.cors.origins:http://127.0.0.1:5173,http://localhost:5173}") String origins, AuthInterceptor auth) {
        this.origins = origins.split(",");
        this.auth = auth;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(auth).addPathPatterns("/api/**");
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**").allowedOrigins(origins).allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS");
    }
}
