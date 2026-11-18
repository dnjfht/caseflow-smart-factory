"""Move the simulated Indy7 joints and verify Gazebo's FollowJointTrajectory action."""

import sys
import rclpy
from rclpy.action import ActionClient
from control_msgs.action import FollowJointTrajectory
from trajectory_msgs.msg import JointTrajectoryPoint
from builtin_interfaces.msg import Duration


def main():
    rclpy.init()
    node = rclpy.create_node('indy_motion_smoke')
    client = ActionClient(node, FollowJointTrajectory,
                          '/joint_trajectory_controller/follow_joint_trajectory')
    if not client.wait_for_server(timeout_sec=15.0):
        print('INDY_ACTION_UNAVAILABLE')
        node.destroy_node()
        rclpy.shutdown()
        return 1

    for positions in ([0.25, -0.15, -1.35, 0.10, -1.45, 0.10],
                      [0.0, 0.0, -1.57, 0.0, -1.57, 0.0]):
        goal = FollowJointTrajectory.Goal()
        goal.trajectory.joint_names = [f'joint{i}' for i in range(6)]
        point = JointTrajectoryPoint()
        point.positions = list(positions)
        point.time_from_start = Duration(sec=4)
        goal.trajectory.points = [point]
        future = client.send_goal_async(goal)
        rclpy.spin_until_future_complete(node, future, timeout_sec=20.0)
        handle = future.result()
        if handle is None or not handle.accepted:
            print('INDY_GOAL_REJECTED')
            node.destroy_node()
            rclpy.shutdown()
            return 2
        result_future = handle.get_result_async()
        rclpy.spin_until_future_complete(node, result_future, timeout_sec=20.0)
        result = result_future.result()
        if result is None or result.result.error_code != 0:
            print('INDY_MOTION_FAILED', result)
            node.destroy_node()
            rclpy.shutdown()
            return 3
        print('INDY_GOAL_SUCCEEDED', positions)

    node.destroy_node()
    rclpy.shutdown()
    return 0


if __name__ == '__main__':
    sys.exit(main())
