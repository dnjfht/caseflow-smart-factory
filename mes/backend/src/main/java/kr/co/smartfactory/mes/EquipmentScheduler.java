package kr.co.smartfactory.mes;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name="mes.poll.enabled",havingValue="true",matchIfMissing=true)
public class EquipmentScheduler {
    private final EquipmentService equipment;

    public EquipmentScheduler(EquipmentService equipment) { this.equipment = equipment; }

    @Scheduled(fixedDelay=1000, initialDelay=3000)
    public void tick() { equipment.tick(); }
}
