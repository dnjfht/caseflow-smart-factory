VAR_INPUT
  MesPermit : BOOL := FALSE; (* MES 가동 허가: MES는 허가만 내리고 실제 가동은 현장 시작 버튼 *)
  MesMaterialPermit : BOOL := TRUE;
  HmiStart : BOOL := FALSE; (* 현장 HMI(웹 트윈) 시작 버튼 *)
  HmiStop : BOOL := FALSE; (* 현장 HMI(웹 트윈) 정지 버튼 *)
  IndyBridgeEnabled : BOOL := FALSE;
  IndyDone : BOOL := FALSE;
  IndyFault : BOOL := FALSE;
  (* 미러 모드: 웹 트윈이 현장 PC(OIP 데스크톱) 라인을 따라갈 때만 TRUE. 현장 라인에서는 항상 FALSE *)
  MirrorMode : BOOL := FALSE;
  MirrorLaunchLimit : INT := 0; (* 현장 라인이 투입한 세트 수: 이 수만큼만 투입 *)
  MirrorVerdictReady : BOOL := FALSE; (* 현장 라인의 같은 순번 제품 판정이 도착함 *)
  MirrorVerdictGood : BOOL := FALSE; (* 그 판정: TRUE 양품, FALSE 불량 *)
  AiMode : BOOL := FALSE; (* MES 비전 AI가 판정: 검사 셀의 자체 판정 대신 AI 판정을 기다려 쓴다 *)
  AiVerdictSeq : INT := 0; (* AI 판정이 해당하는 제품 순번 (InspectedCount + 1과 같을 때만 사용) *)
  AiVerdictGood : BOOL := FALSE; (* AI 판정: TRUE 양품, FALSE 불량 *)
  AiRequest : BOOL := FALSE; (* 검사 위치에 제품 도착: MES에 AI 판정 요청 *)
END_VAR
VAR
  StartPB AT %IX0.0 : BOOL;
  StopPB AT %IX0.1 : BOOL;
  BodyDetected AT %IX0.2 : BOOL;
  LidDetected AT %IX0.3 : BOOL;
  BodyAtAssembly AT %IX0.4 : BOOL;
  LidAtAssembly AT %IX0.5 : BOOL;
  RobotReady AT %IX0.6 : BOOL;
  RobotDone AT %IX0.7 : BOOL;
  AssembledDetected AT %IX1.0 : BOOL;
  InspectionDetected AT %IX1.1 : BOOL;
  RejectDetected AT %IX1.2 : BOOL;
  PackDetected AT %IX1.3 : BOOL;
  PackDone AT %IX1.4 : BOOL;
  FinishedGoodsDetected AT %IX1.5 : BOOL;
  ShipmentDetected AT %IX1.6 : BOOL;
  InspectionValidSim AT %IX2.0 : BOOL;
  InspectionGoodSim AT %IX2.1 : BOOL;
  SortEye AT %IX2.2 : BOOL;
  AssemblyReadySim AT %IX2.3 : BOOL;
  AssemblyJoinedSim AT %IX2.4 : BOOL;

  BodyConveyorRun AT %QX0.0 : BOOL;
  LidConveyorRun AT %QX0.1 : BOOL;
  BodyFeedEnable AT %QX0.2 : BOOL;
  LidFeedEnable AT %QX0.3 : BOOL;
  BodyStopper AT %QX0.4 : BOOL;
  LidStopper AT %QX0.5 : BOOL;
  RobotStart AT %QX0.6 : BOOL;
  AssemblyOutRun AT %QX0.7 : BOOL;
  InspectionConveyorRun AT %QX1.0 : BOOL;
  RejectDiverter AT %QX1.1 : BOOL;
  PackingConveyorRun AT %QX1.2 : BOOL;
  PackStart AT %QX1.3 : BOOL;
  FinishedGoodsConveyorRun AT %QX1.4 : BOOL;
  ShippingConveyorRun AT %QX1.5 : BOOL;
  AlarmLamp AT %QX1.6 : BOOL;
  InspectionStart AT %QX1.7 : BOOL;
  PermitLamp AT %QX2.1 : BOOL; (* 시작 버튼 램프: MES 허가 대기 중 점등 *)
  RunLamp AT %QX2.2 : BOOL; (* 운전 중 표시 *)
  RobotCommand AT %QW2 : INT;
  RobotReleasedSignal AT %QX2.0 : BOOL;
  TruckLoadVisual AT %QW3 : INT;
  TruckTargetVisual AT %QW4 : INT;
  BodyStockVisual AT %QW5 : INT;
  LidStockVisual AT %QW6 : INT;

  WorkOrderActive AT %MW100 : INT;
  ProductType AT %MW101 : INT;
  TargetQuantity AT %MW102 : INT;
  MaterialPermit AT %MW103 : INT;
  ProducedCount AT %MW104 : INT;
  RejectCount AT %MW105 : INT;
  ShippedCount AT %MW110 : INT;
  LaunchedCount AT %MW111 : INT;
  GoodWaiting AT %MW112 : INT;
  BodyStockDisplay AT %MW113 : INT;
  LidStockDisplay AT %MW114 : INT;
  MachineState AT %MW106 : INT;
  FaultCode AT %MW107 : INT;
  InspectionResultValidWord AT %MW108 : INT;
  InspectionResultWord AT %MW109 : INT;

  M0 : BOOL := FALSE;
  M1 : BOOL := FALSE;
  M2 : BOOL := FALSE;
  M3 : BOOL := FALSE;
  M4 : BOOL := FALSE;
  M5 : BOOL := FALSE;
  M6 : BOOL := FALSE;
  M7 : BOOL := FALSE;
  M8 : BOOL := FALSE;
  M9 : BOOL := FALSE;
  M10 : BOOL := FALSE;
  M11 : BOOL := FALSE;
  M12 : BOOL := FALSE;
  M13 : BOOL := FALSE;
  M14 : BOOL := FALSE;
  M15 : BOOL := FALSE;
  AssemblyPhase : INT := 0;
  InspectionPhase : INT := 0;
  PackingPhase : INT := 0;
  AssemblyPermit : BOOL := FALSE;
  RejectPending : BOOL := FALSE;
  InspectedCount : INT := 0; (* 판정을 내린 제품 수 = 다음 제품의 판정 순번 *)
  LastVerdictGood : BOOL := FALSE; (* 마지막 판정 결과 *)
  VerdictGood : BOOL := FALSE;
  RobotBusySeen : BOOL := FALSE;
  OipRobotComplete : BOOL := FALSE;
  IndyWaitCycles : INT := 0;
  InspectionWasHigh : BOOL := FALSE;
  RejectWasHigh : BOOL := FALSE;
  ShipmentWasHigh : BOOL := FALSE;
  DemoStarted : BOOL := FALSE;
  DrainActive : BOOL := FALSE;
  DrainCycles : INT := 0;
  RunLatch : BOOL := FALSE; (* 현장 시작 버튼으로 걸리는 운전 자기유지 *)
END_VAR

(* Temporary demonstration order: three GOOD packed and shipped cases.
   Later MES writes MW100, MW102 and MW103. Rejects never count as good. *)
IF NOT DemoStarted THEN
  WorkOrderActive := 1;
  MaterialPermit := 1;
  TargetQuantity := 3;
  BodyStockDisplay := 20;
  LidStockDisplay := 20;
  DemoStarted := TRUE;
END_IF;
(* 운전 자기유지: MES 허가 + 현장 시작 버튼 → 운전. 정지 버튼, 허가 해제, 고장, 목표 달성 → 해제 *)
IF StopPB OR HmiStop OR NOT MesPermit OR (FaultCode <> 0) OR (WorkOrderActive <> 1) OR (ShippedCount >= TargetQuantity) THEN
  RunLatch := FALSE;
ELSIF StartPB OR HmiStart THEN
  RunLatch := TRUE;
END_IF;
IF MesMaterialPermit THEN MaterialPermit := 1; ELSE MaterialPermit := 0; END_IF;
IF IndyBridgeEnabled AND IndyFault THEN FaultCode := 71; END_IF;
M0 := RunLatch AND MesPermit AND (WorkOrderActive = 1)
  AND (ShippedCount < TargetQuantity) AND (FaultCode = 0);

InspectionResultValidWord := 0;
InspectionResultWord := 0;
IF InspectionValidSim THEN InspectionResultValidWord := 1; END_IF;
IF InspectionGoodSim THEN InspectionResultWord := 1; END_IF;
RobotCommand := 1;
RobotReleasedSignal := RobotDone;

(* The number of started bodies may reach target + rejects. This limits
   speculative WIP while replacing every rejected case with a new cycle. *)
IF M0 AND MesMaterialPermit AND (AssemblyPhase = 0)
   AND NOT AssemblyPermit AND (LaunchedCount < TargetQuantity + RejectCount) THEN
  AssemblyPermit := TRUE;
END_IF;

(* Assembly runs independently of inspection, packing and shipping. *)
IF M0 THEN
  IF AssemblyPhase = 0 THEN
    IF BodyDetected AND NOT M1 THEN M1 := TRUE; LaunchedCount := LaunchedCount + 1; END_IF;
    IF LidDetected THEN M2 := TRUE; END_IF;
    IF BodyAtAssembly AND M1 THEN M3 := TRUE; END_IF;
    IF LidAtAssembly AND M2 THEN M4 := TRUE; END_IF;
    IF M3 AND M4 AND RobotReady AND AssemblyReadySim THEN
      M5 := TRUE; RobotBusySeen := FALSE; OipRobotComplete := FALSE; AssemblyPhase := 1;
    END_IF;
  ELSIF AssemblyPhase = 1 THEN
    IF NOT RobotReady THEN RobotBusySeen := TRUE; END_IF;
    IF RobotBusySeen AND RobotDone AND AssemblyJoinedSim THEN
      OipRobotComplete := TRUE;
    END_IF;
    IF IndyBridgeEnabled AND NOT IndyDone THEN
      IndyWaitCycles := IndyWaitCycles + 1;
      IF IndyWaitCycles > 12000 THEN FaultCode := 72; END_IF;
    END_IF;
    IF OipRobotComplete AND ((NOT IndyBridgeEnabled) OR IndyDone) THEN
      M6 := TRUE; AssemblyPhase := 2;
    END_IF;
  ELSIF AssemblyPhase = 2 THEN
    IF AssembledDetected THEN
      M7 := TRUE;
      M1 := FALSE; M2 := FALSE; M3 := FALSE; M4 := FALSE; M5 := FALSE; M6 := FALSE;
      AssemblyPermit := FALSE;
      AssemblyPhase := 0;
      OipRobotComplete := FALSE;
      IndyWaitCycles := 0;
    END_IF;
  END_IF;
END_IF;

(* An inspection result frees the station while its case continues to sort
   or pack. Another assembly can already be in progress. *)
IF M0 THEN
  IF InspectionPhase = 0 THEN
    IF InspectionDetected AND NOT InspectionWasHigh THEN
      M8 := TRUE; M9 := FALSE; M11 := FALSE; M7 := FALSE;
      InspectionPhase := 1;
    END_IF;
  ELSIF InspectionPhase = 1 THEN
    (* 미러 모드에서는 스스로 판정하지 않고, 현장 라인이 같은 순번 제품에 내린 판정이 올 때까지 기다려 그대로 쓴다 *)
    (* AI 모드에서는 MES 비전 AI가 이 순번 제품에 내린 판정이 올 때까지 기다린다 (미러 모드가 우선) *)
    IF (InspectionResultValidWord = 1) AND (NOT MirrorMode OR MirrorVerdictReady)
       AND (MirrorMode OR NOT AiMode OR (AiVerdictSeq = InspectedCount + 1)) THEN
      M9 := TRUE;
      IF MirrorMode THEN VerdictGood := MirrorVerdictGood;
      ELSIF AiMode THEN VerdictGood := AiVerdictGood;
      ELSE VerdictGood := (InspectionResultWord = 1); END_IF;
      InspectedCount := InspectedCount + 1;
      LastVerdictGood := VerdictGood;
      IF VerdictGood THEN
        M11 := TRUE;
        GoodWaiting := GoodWaiting + 1;
      ELSE
        RejectPending := TRUE;
      END_IF;
      InspectionPhase := 2;
    END_IF;
  ELSIF InspectionPhase = 2 THEN
    IF NOT InspectionDetected THEN InspectionPhase := 0; M8 := FALSE; END_IF;
  END_IF;
END_IF;
InspectionWasHigh := InspectionDetected;
AiRequest := M0 AND (InspectionPhase = 1) AND AiMode AND NOT MirrorMode;

IF RejectDetected AND NOT RejectWasHigh AND RejectPending THEN
  M10 := TRUE;
  RejectCount := RejectCount + 1;
  RejectPending := FALSE;
END_IF;
RejectWasHigh := RejectDetected;

(* Each accepted case is visibly wrapped before ProducedCount increases. *)
IF M0 THEN
  IF PackingPhase = 0 THEN
    IF PackDetected AND (GoodWaiting > 0) THEN
      GoodWaiting := GoodWaiting - 1;
      M12 := TRUE; M13 := FALSE;
      PackingPhase := 1;
    END_IF;
  ELSIF PackingPhase = 1 THEN
    IF PackDone THEN
      M13 := TRUE;
      ProducedCount := ProducedCount + 1;
      PackingPhase := 2;
    END_IF;
  ELSIF PackingPhase = 2 THEN
    IF NOT PackDetected THEN PackingPhase := 0; M12 := FALSE; END_IF;
  END_IF;
END_IF;

IF FinishedGoodsDetected THEN M14 := TRUE; END_IF;
IF ShipmentDetected AND NOT ShipmentWasHigh THEN
  M15 := TRUE;
  ShippedCount := ShippedCount + 1;
END_IF;
ShipmentWasHigh := ShipmentDetected;
IF M0 AND (ProducedCount >= TargetQuantity) AND (ShippedCount >= TargetQuantity)
   AND (LaunchedCount <= ProducedCount + RejectCount) THEN
  M0 := FALSE; RunLatch := FALSE; DrainActive := TRUE; DrainCycles := 0;
END_IF;
IF DrainActive THEN
  DrainCycles := DrainCycles + 1;
  IF DrainCycles >= 900 THEN DrainActive := FALSE; END_IF;
END_IF;

BodyConveyorRun := M0 AND (((AssemblyPhase = 0) AND AssemblyPermit AND NOT M3)
                      OR ((AssemblyPhase = 2) AND NOT M7));
LidConveyorRun := M0 AND (AssemblyPhase = 0) AND AssemblyPermit AND NOT M4;
(* 미러 모드: 현장 라인이 투입한 세트 수만큼만 투입한다 (본체가 이미 나간 세트의 뚜껑은 허용) *)
BodyFeedEnable := M0 AND MesMaterialPermit AND (AssemblyPhase = 0) AND AssemblyPermit AND NOT M1
  AND (NOT MirrorMode OR (LaunchedCount < MirrorLaunchLimit));
LidFeedEnable := M0 AND MesMaterialPermit AND (AssemblyPhase = 0) AND AssemblyPermit AND NOT M2
  AND (NOT MirrorMode OR M1 OR (LaunchedCount < MirrorLaunchLimit));
BodyStopper := M0 AND M3 AND (AssemblyPhase = 0);
LidStopper := M0 AND M4 AND (AssemblyPhase = 0);
RobotStart := M0 AND (AssemblyPhase = 1) AND NOT M6;
AssemblyOutRun := M0;
InspectionConveyorRun := M0 AND (InspectionPhase <> 1);
InspectionStart := M0 AND (InspectionPhase = 1);
RejectDiverter := M0 AND RejectPending AND SortEye;
PackingConveyorRun := M0 AND (PackingPhase <> 1);
PackStart := M0 AND (PackingPhase = 1) AND NOT M13;
FinishedGoodsConveyorRun := M0 OR DrainActive;
ShippingConveyorRun := M0 OR DrainActive;
AlarmLamp := FaultCode <> 0;
PermitLamp := MesPermit AND NOT RunLatch AND (WorkOrderActive = 1) AND (ShippedCount < TargetQuantity);
RunLamp := M0;
TruckLoadVisual := ShippedCount;
TruckTargetVisual := TargetQuantity;
BodyStockVisual := BodyStockDisplay;
LidStockVisual := LidStockDisplay;

IF (ProducedCount >= TargetQuantity) AND (ShippedCount >= TargetQuantity) THEN
  MachineState := 6;
ELSIF FaultCode <> 0 THEN MachineState := 5;
ELSIF M0 THEN MachineState := 2;
ELSIF MesPermit AND (WorkOrderActive = 1) THEN MachineState := 3; (* 허가됨, 현장 시작 대기 *)
ELSIF StopPB OR HmiStop THEN MachineState := 4;
ELSE MachineState := 1; END_IF;

