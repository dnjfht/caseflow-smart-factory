package kr.co.smartfactory.mes;

import jakarta.annotation.PreDestroy;
import java.time.Instant;
import java.util.List;
import org.eclipse.milo.opcua.sdk.client.OpcUaClient;
import org.eclipse.milo.opcua.stack.core.types.builtin.DataValue;
import org.eclipse.milo.opcua.stack.core.types.builtin.NodeId;
import org.eclipse.milo.opcua.stack.core.types.builtin.StatusCode;
import org.eclipse.milo.opcua.stack.core.types.builtin.Variant;
import org.eclipse.milo.opcua.stack.core.types.enumerated.TimestampsToReturn;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** OIP's local simulated PLC, published at localhost only. This is not OpenPLC Runtime. */
@Component
public class OpcUaGateway {
    private final String endpoint;
    private OpcUaClient client;

    public OpcUaGateway(@Value("${mes.opc.endpoint:opc.tcp://127.0.0.1:4843}") String endpoint) {
        this.endpoint = endpoint;
    }

    private synchronized OpcUaClient client() throws Exception {
        if (client == null) {
            client = OpcUaClient.create(endpoint);
            client.connect();
        }
        return client;
    }

    private Object read(String variable) throws Exception {
        DataValue value = client().readValue(0.0, TimestampsToReturn.Neither,
            new NodeId(1, variable));
        if (value.getStatusCode() == null || !value.getStatusCode().isGood()) {
            throw new IllegalStateException(variable + " quality: " + value.getStatusCode());
        }
        return value.getValue().getValue();
    }

    private int number(String name) throws Exception {
        return ((Number) read(name)).intValue();
    }

    public PlcSnapshot sample() {
        try {
            return new PlcSnapshot(true, "OIP 내부 PLC 연결", Instant.now(),
                number("TargetQuantity"), number("LaunchedCount"), number("RejectCount"),
                number("ProducedCount"), number("ShippedCount"), number("MachineState"),
                number("AssemblyPhase"), number("InspectionPhase"), number("PackingPhase"),
                (Boolean) read("MesStop"), (Boolean) read("BodyConveyorRun"),
                (Boolean) read("BodyStopper"), (Boolean) read("LidStopper"),
                (Boolean) read("RejectDiverter"));
        } catch (Exception e) {
            resetClient();
            return PlcSnapshot.offline(e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    private void write(String variable, Object value) throws Exception {
        try {
            StatusCode status = client().writeValues(List.of(new NodeId(1, variable)),
                List.of(new DataValue(new Variant(value)))).getFirst();
            if (!status.isGood()) throw new IllegalStateException(variable + " write: " + status);
        } catch (Exception e) { resetClient(); throw e; }
    }

    public void stop(boolean stopped) throws Exception {
        write("MesStop", stopped);
    }

    public void target(int quantity) throws Exception {
        write("TargetQuantity", (short) quantity); // OIP INT is OPC UA Int16.
    }

    public void materialPermit(boolean permitted) throws Exception {
        write("MesMaterialPermit", permitted);
    }

    public void materialStock(int bodies, int lids) throws Exception {
        write("BodyStockDisplay", (short) bodies);
        write("LidStockDisplay", (short) lids);
    }

    @PreDestroy
    public void close() { resetClient(); }

    private synchronized void resetClient() {
        if (client != null) {
            try { client.disconnect(); } catch (Exception ignored) { }
            client = null;
        }
    }
}
