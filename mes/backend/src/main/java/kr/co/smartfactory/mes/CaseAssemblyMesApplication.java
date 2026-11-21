package kr.co.smartfactory.mes;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class CaseAssemblyMesApplication {

	public static void main(String[] args) {
		useDatabaseUrl(System.getenv("DATABASE_URL"));
		SpringApplication.run(CaseAssemblyMesApplication.class, args);
	}

	/**
	 * A hosted Postgres hands out one URL (postgresql://user:password@host/db?sslmode=require). Spring wants the JDBC URL
	 * and the credentials apart, so split it here; nothing else needs setting on the server.
	 */
	static void useDatabaseUrl(String url) {
		if (url == null || url.isBlank()) return;
		java.net.URI uri = java.net.URI.create(url.replaceFirst("^postgres(ql)?://", "http://"));
		String[] user = uri.getRawUserInfo() == null ? new String[0] : uri.getRawUserInfo().split(":", 2);
		String query = uri.getRawQuery() == null ? "sslmode=require" : uri.getRawQuery().replace("channel_binding=require", "").replaceAll("&&", "&").replaceAll("^&|&$", "");
		System.setProperty("spring.datasource.url", "jdbc:postgresql://" + uri.getHost() + (uri.getPort() > 0 ? ":" + uri.getPort() : "") + uri.getRawPath() + "?" + query);
		if (user.length > 0) System.setProperty("spring.datasource.username", java.net.URLDecoder.decode(user[0], java.nio.charset.StandardCharsets.UTF_8));
		if (user.length > 1) System.setProperty("spring.datasource.password", java.net.URLDecoder.decode(user[1], java.nio.charset.StandardCharsets.UTF_8));
		System.setProperty("spring.profiles.active", System.getProperty("spring.profiles.active", "postgres"));
	}

}
