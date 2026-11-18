package kr.co.smartfactory.mes;

import java.time.Instant;

public record PlcSnapshot(
    boolean connected,
    String message,
    Instant sampledAt,
    int target,
    int launched,
    int rejected,
    int packed,
    int lineExit,
    int machineState,
    int assemblyPhase,
    int inspectionPhase,
    int packingPhase,
    boolean mesStop,
    boolean motorRunning
) {
    public static PlcSnapshot offline(String message) {
        return new PlcSnapshot(false, message, Instant.now(), 0, 0, 0, 0, 0, 0, 0, 0, 0, false, false);
    }
}
