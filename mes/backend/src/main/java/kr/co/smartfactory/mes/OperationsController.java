package kr.co.smartfactory.mes;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class OperationsController {
    private final MesService mes;
    private final LotService lots;

    public OperationsController(MesService mes, LotService lots) { this.mes=mes; this.lots=lots; }

    @GetMapping("/plans") public List<Map<String,Object>> plans() { return mes.plans(); }
    @PostMapping("/plans") public Map<String,Object> createPlan(@RequestBody PlanRequest r) {
        return mes.createPlan(r.code(),r.target(),r.plannedStart(),r.plannedStartTime(),r.dueDate(),r.destination(),r.createdBy());
    }
    @PostMapping("/plans/{id}/approve") public Map<String,Object> approve(@PathVariable long id,@RequestBody ApproveRequest r) {
        return mes.approvePlan(id,r.approver());
    }
    @PostMapping("/plans/{id}/release") public Map<String,Object> release(@PathVariable long id) {
        return mes.releasePlan(id);
    }
    @GetMapping("/lots") public List<Map<String,Object>> lots() { return lots.lots(); }
    @PostMapping("/lots") public Map<String,Object> receive(@RequestBody ReceiptRequest r) {
        return lots.receive(r.lotCode(),r.sku(),r.quantity(),r.supplier(),r.origin(),r.receivedBy());
    }
    @GetMapping("/production-lots") public List<Map<String,Object>> productionLots() { return mes.productionLots(); }
    @GetMapping("/bom") public List<Map<String,Object>> bom() { return lots.bom(); }
    @GetMapping("/items") public List<Map<String,Object>> items() { return lots.items(); }
    @GetMapping("/shipments") public List<Map<String,Object>> shipments() { return mes.shipments(); }
    @GetMapping("/trace/forward/{lotCode}") public List<Map<String,Object>> forward(@PathVariable String lotCode) {
        return lots.forward(lotCode);
    }
    @GetMapping("/trace/backward/{orderCode}") public List<Map<String,Object>> backward(@PathVariable String orderCode) {
        return lots.backward(orderCode);
    }

    public record PlanRequest(String code, int target, LocalDate plannedStart, LocalTime plannedStartTime, LocalDate dueDate,
                              String destination,String createdBy) { }
    public record ApproveRequest(String approver) { }
    public record ReceiptRequest(String lotCode, String sku, int quantity, String supplier, String origin,
                                 String receivedBy) { }
}
