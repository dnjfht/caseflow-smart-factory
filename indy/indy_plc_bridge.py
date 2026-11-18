"""Optional OIP OPC UA ↔ ROS 2 Indy7 synchronization for the demo assembly cycle.

OIP's own robot still moves the physical scene. When enabled in MES, the PLC
additionally waits for this Gazebo robot's completion before releasing assembly.
The two joint targets below are a demonstration trajectory, not calibrated
lid pick/place positions.
"""

import argparse
import asyncio
import json
import logging
import math
import subprocess
import time
import urllib.request
from contextlib import suppress

from asyncua import Client
import rclpy
from rclpy.action import ActionClient
from control_msgs.action import FollowJointTrajectory
from trajectory_msgs.msg import JointTrajectoryPoint
from builtin_interfaces.msg import Duration


LOG = logging.getLogger('indy_plc_bridge')
ACTION = '/joint_trajectory_controller/follow_joint_trajectory'
JOINTS = [f'joint{i}' for i in range(6)]
MOTION = (
    [0.25, -0.15, -1.35, 0.10, -1.45, 0.10],
    [0.0, 0.0, -1.57, 0.0, -1.57, 0.0],
)


def windows_gateway():
    words = subprocess.check_output(['ip', 'route', 'show', 'default'], text=True).split()
    return words[words.index('via') + 1]


def http_json(url, payload=None):
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode('utf-8')
    request = urllib.request.Request(url, data=body,
                                     headers={'Content-Type': 'application/json; charset=utf-8'} if body else {})
    with urllib.request.urlopen(request, timeout=3) as response:
        return json.load(response)


def run_motion(node, action, speed_pct, steps=None):
    if not action.wait_for_server(timeout_sec=1.0):
        return False, 'ROS2 action server unavailable'
    for step in (steps or [{'positions': p, 'seconds': 4} for p in MOTION]):
        positions = step['positions']
        goal = FollowJointTrajectory.Goal()
        goal.trajectory.joint_names = JOINTS
        point = JointTrajectoryPoint()
        point.positions = positions
        point.time_from_start = Duration(sec=round(step['seconds'] * 100 / speed_pct))
        goal.trajectory.points = [point]
        future = action.send_goal_async(goal)
        rclpy.spin_until_future_complete(node, future, timeout_sec=5.0)
        handle = future.result() if future.done() else None
        if handle is None or not handle.accepted:
            return False, 'trajectory goal rejected'
        result = handle.get_result_async()
        rclpy.spin_until_future_complete(node, result, timeout_sec=25.0)
        response = result.result() if result.done() else None
        if response is None or response.result.error_code != 0:
            return False, 'trajectory timed out or failed'
    return True, 'two Indy7 joint targets completed'


async def report(mes_url, state, detail, cycles, plc, action):
    payload = {'state': state, 'detail': detail[:200], 'completedCycles': cycles,
               'plcConnected': plc, 'actionAvailable': action}
    with suppress(Exception):
        await asyncio.to_thread(http_json, f'{mes_url}/api/robot/telemetry', payload)
    LOG.info('%s: %s', state, detail)


async def probe_plc(opc_url):
    """Read only: show readiness without arming the PLC or moving the robot."""
    try:
        async with Client(opc_url, timeout=2) as opc:
            await opc.get_node('ns=1;s=RobotStart').read_value()
        return True
    except Exception:
        return False


async def bridge(opc_url, mes_url):
    rclpy.init()
    node = rclpy.create_node('indy_plc_bridge')
    action = ActionClient(node, FollowJointTrajectory, ACTION)
    cycles = 0
    restored_cycles = False
    try:
        while rclpy.ok():
            try:
                config = await asyncio.to_thread(http_json, f'{mes_url}/api/robot/status')
                if not restored_cycles:
                    cycles = int(config.get('COMPLETED_CYCLES', 0))
                    restored_cycles = True
            except Exception as exc:
                await report(mes_url, 'MES_OFFLINE', str(exc), cycles, False, False)
                await asyncio.sleep(3)
                continue
            program = await asyncio.to_thread(http_json, f'{mes_url}/api/robot/program')
            steps = [{'positions': [math.radians(float(row[f'J{i}'])) for i in range(1,7)], 'seconds': float(row['SECONDS'])} for row in program]
            available = await asyncio.to_thread(action.wait_for_server, timeout_sec=0.5)
            if config.get('PREVIEW_REQUESTED') and not config['ENABLED'] and available:
                await report(mes_url, 'MOVING', '편집한 관절 순서를 Gazebo에서 시험 실행', cycles, True, True)
                try:
                    ok, detail = await asyncio.to_thread(run_motion, node, action, int(config['SPEED_PCT']), steps)
                    if ok: cycles += 1
                    await report(mes_url, 'COMPLETE' if ok else 'FAULT', detail, cycles, True, True)
                finally:
                    await asyncio.to_thread(http_json, f'{mes_url}/api/robot/preview-finished', {})
                continue
            if not config['ENABLED'] or not available:
                state = 'DISABLED' if not config['ENABLED'] else 'ACTION_OFFLINE'
                plc_connected = await probe_plc(opc_url)
                await report(mes_url, state, 'MES 연동 꺼짐' if state == 'DISABLED' else 'Gazebo action 대기', cycles, plc_connected, available)
                await asyncio.sleep(3)
                continue
            try:
                async with Client(opc_url, timeout=4) as opc:
                    start = opc.get_node('ns=1;s=RobotStart')
                    enabled = opc.get_node('ns=1;s=IndyBridgeEnabled')
                    done = opc.get_node('ns=1;s=IndyDone')
                    fault = opc.get_node('ns=1;s=IndyFault')
                    if await start.read_value():
                        await report(mes_url, 'WAITING_IDLE', '조립 중 연결 금지; RobotStart OFF 대기', cycles, True, True)
                        await asyncio.sleep(2)
                        continue
                    await done.write_value(False)
                    await fault.write_value(False)
                    await enabled.write_value(True)
                    armed = True
                    last_report = time.monotonic()
                    await report(mes_url, 'READY', 'PLC RobotStart 상승 에지 대기', cycles, True, True)
                    while rclpy.ok():
                        config = await asyncio.to_thread(http_json, f'{mes_url}/api/robot/status')
                        if not config['ENABLED']:
                            break
                        signal = bool(await start.read_value())
                        if not signal:
                            if not armed:
                                await done.write_value(False)
                            armed = True
                        elif armed:
                            armed = False
                            await done.write_value(False)
                            await report(mes_url, 'MOVING', 'PLC 시작 신호로 Indy7 데모 궤적 수행', cycles, True, True)
                            ok, detail = await asyncio.to_thread(run_motion, node, action, int(config['SPEED_PCT']), steps)
                            if not ok:
                                await fault.write_value(True)
                                await report(mes_url, 'FAULT', detail, cycles, True, True)
                                break
                            await done.write_value(True)
                            cycles += 1
                            await report(mes_url, 'COMPLETE', detail, cycles, True, True)
                            last_report = time.monotonic()
                        if time.monotonic() - last_report >= 5:
                            await report(mes_url, 'READY' if armed else 'COMPLETE',
                                         'PLC RobotStart 상승 에지 대기' if armed else 'INDY 완료 신호 유지',
                                         cycles, True, True)
                            last_report = time.monotonic()
                        await asyncio.sleep(0.2)
                    await enabled.write_value(False)
                    await done.write_value(False)
                    await report(mes_url, 'DISABLED', 'MES 연동 꺼짐 또는 재연결', cycles, True, True)
            except Exception as exc:
                await report(mes_url, 'PLC_OFFLINE', str(exc), cycles, False, available)
            await asyncio.sleep(3)
    finally:
        node.destroy_node()
        rclpy.shutdown()


def main():
    parser = argparse.ArgumentParser()
    host = windows_gateway()
    parser.add_argument('--opc', default=f'opc.tcp://{host}:4843')
    parser.add_argument('--mes', default=f'http://{host}:8085')
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    logging.getLogger('asyncua').setLevel(logging.WARNING)
    try:
        asyncio.run(bridge(args.opc, args.mes))
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
