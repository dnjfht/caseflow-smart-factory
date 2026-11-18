package kr.co.smartfactory.mes;

import jakarta.annotation.PostConstruct;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Batch-level lineage from a received body/lid LOT to an order and shipment. */
@Service
public class LotService {
    private final JdbcTemplate db;

    public LotService(JdbcTemplate db) { this.db = db; }

    @PostConstruct
    public void seedMaster() {
        item("CASE", "조립 케이스", "PRODUCT");
        item("BODY", "케이스 본체", "MATERIAL");
        item("LID", "케이스 뚜껑", "MATERIAL");
        bom("BODY"); bom("LID");
    }

    private void item(String sku, String name, String type) {
        if (db.queryForObject("SELECT COUNT(*) FROM item_master WHERE sku=?", Integer.class, sku) == 0)
            db.update("INSERT INTO item_master(sku,item_name,item_type,unit) VALUES (?,?,?,'EA')", sku, name, type);
    }

    private void bom(String sku) {
        if (db.queryForObject("SELECT COUNT(*) FROM bom_line WHERE product_sku='CASE' AND material_sku=?", Integer.class, sku) == 0)
            db.update("INSERT INTO bom_line(product_sku,material_sku,quantity_per_unit) VALUES ('CASE',?,1)", sku);
    }

    public void seedOpeningLots() {
        for (String sku : List.of("BODY", "LID")) {
            if (db.queryForObject("SELECT COUNT(*) FROM material_lot WHERE sku=?", Integer.class, sku) == 0) {
                int current = db.queryForObject("SELECT quantity FROM inventory WHERE sku=?", Integer.class, sku);
                db.update("INSERT INTO material_lot(lot_code,sku,supplier,origin,received_qty,available_qty) " +
                    "VALUES (?,?,?,?,?,?)", "OPEN-" + sku + "-001", sku, "데모 기초재고", "기존 MES 재고", current, current);
            }
        }
    }

    public List<Map<String,Object>> items() {
        return db.queryForList("SELECT sku,item_name,item_type,unit FROM item_master ORDER BY sku");
    }

    public List<Map<String,Object>> bom() {
        return db.queryForList("SELECT b.product_sku,b.material_sku,i.item_name,b.quantity_per_unit " +
            "FROM bom_line b JOIN item_master i ON i.sku=b.material_sku ORDER BY b.material_sku");
    }

    public List<Map<String,Object>> lots() {
        return db.queryForList("SELECT id,lot_code,sku,supplier,origin,received_by,received_qty,available_qty,received_at " +
            "FROM material_lot ORDER BY received_at DESC,id DESC");
    }

    @Transactional
    public Map<String,Object> receive(String lotCode, String sku, int quantity, String supplier, String origin) {
        return receive(lotCode,sku,quantity,supplier,origin,"입고 담당자 미지정");
    }

    @Transactional
    public Map<String,Object> receive(String lotCode, String sku, int quantity, String supplier, String origin,
                                       String receivedBy) {
        if (sku == null || !List.of("BODY","LID").contains(sku))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "입고 품목은 본체 또는 뚜껑이어야 합니다.");
        if (quantity < 1 || quantity > Short.MAX_VALUE)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "입고 수량은 1~32,767개여야 합니다.");
        if (supplier == null || supplier.isBlank() || supplier.length()>120 ||
            origin == null || origin.isBlank() || origin.length()>120 ||
            receivedBy == null || receivedBy.isBlank() || receivedBy.length()>100)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "공급처·입고 출처·입고 담당자를 입력하세요.");
        if (lotCode == null || lotCode.isBlank())
            lotCode = sku + "-" + LocalDate.now().format(DateTimeFormatter.BASIC_ISO_DATE) + "-" +
                UUID.randomUUID().toString().substring(0,8).toUpperCase(Locale.ROOT);
        lotCode = lotCode.trim();
        if (lotCode.length() > 80)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "입고 LOT 번호는 80자 이하여야 합니다.");
        int current = db.queryForObject("SELECT quantity FROM inventory WHERE sku=?",Integer.class,sku);
        if ((long)current+quantity > Short.MAX_VALUE)
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                "입고 후 " + sku + " 재고가 OIP 표시 한도 32,767개를 넘습니다. 현재 " + current + "개입니다.");
        if (db.queryForObject("SELECT COUNT(*) FROM material_lot WHERE lot_code=?", Integer.class, lotCode) != 0)
            throw new ResponseStatusException(HttpStatus.CONFLICT, "이미 등록된 LOT 번호입니다.");
        db.update("INSERT INTO material_lot(lot_code,sku,supplier,origin,received_by,received_qty,available_qty) VALUES (?,?,?,?,?,?,?)",
            lotCode,sku,supplier,origin,receivedBy,quantity,quantity);
        db.update("UPDATE inventory SET quantity=quantity+? WHERE sku=?", quantity, sku);
        return db.queryForMap("SELECT * FROM material_lot WHERE lot_code=?", lotCode);
    }

    /** Called within the MES reconciliation transaction. Current CASE BOM uses one of each material. */
    public void issue(long orderId, int launchCounter, String sku) {
        int perUnit = db.queryForObject("SELECT quantity_per_unit FROM bom_line WHERE product_sku='CASE' AND material_sku=?",
            Integer.class, sku);
        List<Map<String,Object>> rows = db.queryForList("SELECT id,available_qty FROM material_lot " +
            "WHERE sku=? AND available_qty>=? ORDER BY received_at,id LIMIT 1", sku, perUnit);
        if (rows.isEmpty()) throw new IllegalStateException(sku + " LOT 재고 부족");
        long lotId = ((Number)rows.getFirst().get("ID")).longValue();
        if (db.update("UPDATE material_lot SET available_qty=available_qty-? WHERE id=? AND available_qty>=?",
                perUnit,lotId,perUnit) != 1) throw new IllegalStateException(sku + " LOT 동시 차감 실패");
        db.update("INSERT INTO material_issue(order_id,launch_counter,material_lot_id,sku,quantity) VALUES (?,?,?,?,?)",
            orderId,launchCounter,lotId,sku,perUnit);
    }

    public List<Map<String,Object>> forward(String lotCode) {
        return db.queryForList("SELECT l.lot_code,l.sku,l.supplier,l.origin,i.quantity,i.launch_counter," +
            "o.order_code,o.status,s.finished_lot_code,s.destination,s.quantity AS shipped_qty " +
            "FROM material_lot l JOIN material_issue i ON i.material_lot_id=l.id " +
            "JOIN mes_order o ON o.id=i.order_id LEFT JOIN shipment s ON s.order_id=o.id " +
            "WHERE l.lot_code=? ORDER BY o.id,i.launch_counter", lotCode);
    }

    public List<Map<String,Object>> backward(String orderCode) {
        return db.queryForList("SELECT o.order_code,CONCAT('FG-',o.order_code) AS finished_lot_code," +
            "i.launch_counter,i.sku,l.lot_code,l.supplier,l.origin,i.quantity," +
            "s.shipment_code,s.destination,s.departed_at " +
            "FROM mes_order o JOIN material_issue i ON i.order_id=o.id " +
            "JOIN material_lot l ON l.id=i.material_lot_id " +
            "LEFT JOIN shipment s ON s.order_id=o.id WHERE o.order_code=? " +
            "ORDER BY i.launch_counter,i.sku", orderCode);
    }
}
