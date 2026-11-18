package kr.co.smartfactory.mes;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name="mes.poll.enabled",havingValue="true",matchIfMissing=true)
public class MesPollScheduler {
    private final MesService mes;

    public MesPollScheduler(MesService mes) { this.mes = mes; }

    @Scheduled(fixedDelay=1000)
    public void poll() { mes.poll(); }
}
