package kr.co.smartfactory.mes;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class CaseAssemblyMesApplication {

	public static void main(String[] args) {
		SpringApplication.run(CaseAssemblyMesApplication.class, args);
	}

}
