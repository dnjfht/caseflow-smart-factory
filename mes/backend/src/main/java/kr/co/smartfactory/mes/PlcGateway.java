package kr.co.smartfactory.mes;

/**
 * The line's PLC as the MES sees it. Two implementations, picked by {@code mes.plc.mode}:
 * <ul>
 *   <li>{@code twin} (default on the server): the web twin running in a browser reports its tags to the MES and
 *       takes the MES's writes back ({@link TwinGateway}). No desktop program is needed.</li>
 *   <li>{@code opcua}: OIP Desktop's simulated PLC over OPC UA on this PC ({@link OpcUaGateway}).</li>
 * </ul>
 * The MES only grants the run ({@link #stop}): the line starts when a field start button is pressed.
 */
public interface PlcGateway {
    PlcSnapshot sample();
    /** {@code stopped=false} grants the run permit (MesPermit); {@code true} withdraws it */
    void stop(boolean stopped) throws Exception;
    void target(int quantity) throws Exception;
    void materialPermit(boolean permitted) throws Exception;
    void materialStock(int bodies, int lids) throws Exception;
    /** clear the line's counters and cargo before a new work order (stop and restart the simulation) */
    void resetLine() throws Exception;
    /** how long a reset may take to show zero counters */
    default long resetTimeoutMs() { return 6000; }
    void close();
}
