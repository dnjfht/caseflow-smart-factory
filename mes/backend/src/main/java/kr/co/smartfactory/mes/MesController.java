package kr.co.smartfactory.mes;

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
public class MesController {
    private final MesService mes;
    private final LotService lots;

    public MesController(MesService mes, LotService lots) { this.mes = mes; this.lots = lots; }

    @GetMapping("/overview")
    public Map<String,Object> overview() {
        return Map.of("plc",mes.plc(),"orders",mes.orders(),"inventory",mes.inventory(),"events",mes.events(),
            "plans",mes.plans(),"lots",lots.lots(),"bom",lots.bom(),"shipments",mes.shipments(),
            "productionLots",mes.productionLots());
    }

    @GetMapping("/orders")
    public List<Map<String,Object>> orders() { return mes.orders(); }

    @PostMapping("/orders")
    public Map<String,Object> create(@RequestBody CreateOrder request) {
        return mes.create(request.code(),request.target());
    }

    @PostMapping("/orders/{id}/{action}")
    public Map<String,Object> command(@PathVariable long id,@PathVariable String action) {
        return mes.command(id,action);
    }

    public record CreateOrder(String code,int target) { }
}
