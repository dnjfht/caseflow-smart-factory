#!/usr/bin/env bash
set -euo pipefail

workspace=/home/dnjfht/indy-ros2
expected=ca0353f077620c877c1edff2e26c8cd976773f27
if [[ ! -f "$workspace/install/setup.bash" ]]; then
  echo "Indy7 ROS 2 workspace is not built at $workspace" >&2
  exit 1
fi
actual=$(git -C "$workspace" rev-parse HEAD)
if [[ "$actual" != "$expected" ]]; then
  echo "Warning: Indy7 upstream is $actual; verified commit is $expected" >&2
fi
source /opt/ros/jazzy/setup.bash
source "$workspace/install/setup.bash"
exec ros2 launch indy_gazebo indy_gazebo.launch.py indy_type:=indy7 launch_rviz:=false
