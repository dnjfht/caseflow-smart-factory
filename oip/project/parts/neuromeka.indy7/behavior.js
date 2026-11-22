// indy - a robot. The controller is the app's: it runs the jobs and waypoints set in the Inspector, takes the
// PLC's job number and Execute, and moves the arm. This script declares the robot and the settings it reads.
definePart({
  joints: ["joint0","joint1","joint2","joint3","joint4","joint5","toolGrip"],
  grippers: ["gripper"],
  lamps: ["vacuumLamp"],
  robot: {"joints":["joint0","joint1","joint2","joint3","joint4","joint5"],"gripper":"gripper","lamp":"vacuumLamp","tool":"toolMount","gripJoint":{"name":"toolGrip","open":0.05,"closed":-0.05}},
  params: {
    "speed": {
      "type": "number",
      "default": 60,
      "min": 1,
      "max": 360,
      "step": 1,
      "label": "Joint speed (°/s)",
      "group": "Motion",
      "desc": "Top speed along the joint-space path, in degrees per second (millimetres for a sliding joint). Every joint is driven from one path, so they start and arrive together."
    },
    "accel": {
      "type": "number",
      "default": 360,
      "min": 10,
      "max": 3000,
      "step": 10,
      "label": "Joint accel (°/s²)",
      "group": "Motion",
      "desc": "How hard the arm ramps to and from the joint speed."
    },
    "blendDeg": {
      "type": "number",
      "unit": "°",
      "default": 10,
      "min": 0,
      "max": 60,
      "step": 1,
      "label": "Corner blend",
      "group": "Motion",
      "desc": "How far before a via point the arm starts cutting the corner. The arm caps it at a third of the move."
    },
    "waypoints": {
      "type": "numberList",
      "columns": [
        "J1 °",
        "J2 °",
        "J3 °",
        "J4 °",
        "J5 °",
        "J6 °"
      ],
      "arity": 6,
      "default": [
        [
          17.9,
          -81.6,
          59.6,
          0,
          -158,
          -3.9
        ]
      ],
      "rowNames": "waypointNames",
      "label": "Waypoints",
      "group": "Motion",
      "desc": "The poses this robot knows, one row of joint positions each. Pose the arm with the viewport gizmo and use Capture Pose to add one."
    },
    "waypointNames": {
      "type": "string",
      "default": "Home",
      "hidden": true,
      "label": "Waypoint names"
    },
    "blendWaypoints": {
      "type": "numberList",
      "rowsOf": "waypoints",
      "arity": 1,
      "default": [],
      "label": "Pass-through waypoints (robots without jobs)",
      "group": "Motion",
      "desc": "For a robot with no jobs: the waypoints the arm only passes through, rounding the corner instead of stopping."
    },
    "jobs": {
      "type": "numberList",
      "arity": 4,
      "default": [],
      "program": {
        "names": "jobNames",
        "ops": [
          {
            "code": 1,
            "label": "Move",
            "desc": "Move the arm to a waypoint. Stop arrives exactly and stands still; Blend rounds the corner and carries on into the next move.",
            "args": [
              {
                "kind": "row",
                "of": "waypoints",
                "label": "To"
              },
              {
                "kind": "choice",
                "label": "Corner",
                "options": [
                  {
                    "value": 0,
                    "label": "Stop"
                  },
                  {
                    "value": 1,
                    "label": "Blend"
                  }
                ]
              }
            ]
          },
          {
            "code": 2,
            "label": "Grip",
            "desc": "Close or open the gripper. The load is held from the step it closes to the step it opens.",
            "args": [
              {
                "kind": "choice",
                "options": [
                  {
                    "value": 1,
                    "label": "On"
                  },
                  {
                    "value": 0,
                    "label": "Off"
                  }
                ]
              }
            ]
          },
          {
            "code": 3,
            "label": "Wait",
            "desc": "Stand still for a time. The clock stops while the robot is not enabled.",
            "args": [
              {
                "kind": "number",
                "unit": "s",
                "min": 0,
                "step": 0.1,
                "default": 0.5
              }
            ]
          },
          {
            "code": 4,
            "label": "Wait for",
            "desc": "Hold here until one of the robot inputs reads on (or off): a part in place, a zone clear.",
            "args": [
              {
                "kind": "choice",
                "options": [
                  {
                    "value": 0,
                    "label": "Input 1",
                    "param": "in1Tag"
                  },
                  {
                    "value": 1,
                    "label": "Input 2",
                    "param": "in2Tag"
                  },
                  {
                    "value": 2,
                    "label": "Input 3",
                    "param": "in3Tag"
                  },
                  {
                    "value": 3,
                    "label": "Input 4",
                    "param": "in4Tag"
                  }
                ]
              },
              {
                "kind": "choice",
                "options": [
                  {
                    "value": 1,
                    "label": "On"
                  },
                  {
                    "value": 0,
                    "label": "Off"
                  }
                ]
              }
            ]
          },
          {
            "code": 5,
            "label": "Set",
            "desc": "Switch one of the robot outputs, to tell the PLC what the job has reached.",
            "args": [
              {
                "kind": "choice",
                "options": [
                  {
                    "value": 0,
                    "label": "Output 1",
                    "param": "out1Tag"
                  },
                  {
                    "value": 1,
                    "label": "Output 2",
                    "param": "out2Tag"
                  },
                  {
                    "value": 2,
                    "label": "Output 3",
                    "param": "out3Tag"
                  },
                  {
                    "value": 3,
                    "label": "Output 4",
                    "param": "out4Tag"
                  }
                ]
              },
              {
                "kind": "choice",
                "options": [
                  {
                    "value": 1,
                    "label": "On"
                  },
                  {
                    "value": 0,
                    "label": "Off"
                  }
                ]
              }
            ]
          }
        ]
      },
      "label": "Jobs",
      "desc": "The robot's own programs. The PLC runs one by number (the command tag) and the robot does the whole thing: moves, grip, waits, and the signals it sends back."
    },
    "jobNames": {
      "type": "string",
      "default": "",
      "hidden": true,
      "label": "Job names"
    },
    "pose": {
      "type": "numberList",
      "rows": 1,
      "columns": [
        "J1 °",
        "J2 °",
        "J3 °",
        "J4 °",
        "J5 °",
        "J6 °"
      ],
      "arity": 6,
      "default": [
        [
          17.9,
          -81.6,
          59.6,
          0,
          -158,
          -3.9
        ]
      ],
      "label": "Idle pose",
      "group": "Start state",
      "desc": "The pose the robot rests in until its first command."
    },
    "commandTag": {
      "type": "tag",
      "dir": "in",
      "stType": "INT",
      "default": "",
      "label": "Command tag (job number)",
      "group": "Comms",
      "desc": "Which job to run: 1 is the first job. A robot with no jobs takes a waypoint row here instead (0 is the first). Set it before pulsing Execute."
    },
    "executeTag": {
      "type": "tag",
      "dir": "in",
      "stType": "BOOL",
      "default": "",
      "label": "Execute tag (rising edge runs it)",
      "group": "Comms",
      "desc": "Pulse this false to true to start the job. Holding it true does not repeat it."
    },
    "doneTag": {
      "type": "tag",
      "dir": "out",
      "stType": "BOOL",
      "default": "",
      "label": "Done tag (true while idle)",
      "group": "Comms",
      "desc": "True whenever the robot is ready for the next command. Wait for it before pulsing Execute again."
    },
    "enableTag": {
      "type": "tag",
      "dir": "in",
      "stType": "BOOL",
      "default": "",
      "label": "Enable tag",
      "group": "Comms",
      "desc": "The robot moves only while this is true: drop it and the arm brakes to a stop and the job holds. Until a program drives it the robot is always enabled.",
      "onlyWhenDriven": true
    },
    "gripperTag": {
      "type": "tag",
      "dir": "in",
      "stType": "BOOL",
      "default": "",
      "label": "Grip tag",
      "group": "Comms",
      "desc": "For a robot with no jobs: close the gripper while this is true. A robot with jobs grips with its Grip steps."
    },
    "in1Tag": {
      "type": "tag",
      "dir": "in",
      "stType": "BOOL",
      "default": "",
      "label": "Input 1 tag",
      "group": "Comms/Robot signals",
      "desc": "A signal a job can wait on (a Wait for step)."
    },
    "out1Tag": {
      "type": "tag",
      "dir": "out",
      "stType": "BOOL",
      "default": "",
      "label": "Output 1 tag",
      "group": "Comms/Robot signals",
      "desc": "A signal a job switches (a Set step)."
    },
    "in2Tag": {
      "type": "tag",
      "dir": "in",
      "stType": "BOOL",
      "default": "",
      "label": "Input 2 tag",
      "group": "Comms/Robot signals",
      "desc": "A signal a job can wait on (a Wait for step)."
    },
    "out2Tag": {
      "type": "tag",
      "dir": "out",
      "stType": "BOOL",
      "default": "",
      "label": "Output 2 tag",
      "group": "Comms/Robot signals",
      "desc": "A signal a job switches (a Set step)."
    },
    "in3Tag": {
      "type": "tag",
      "dir": "in",
      "stType": "BOOL",
      "default": "",
      "label": "Input 3 tag",
      "group": "Comms/Robot signals",
      "desc": "A signal a job can wait on (a Wait for step)."
    },
    "out3Tag": {
      "type": "tag",
      "dir": "out",
      "stType": "BOOL",
      "default": "",
      "label": "Output 3 tag",
      "group": "Comms/Robot signals",
      "desc": "A signal a job switches (a Set step)."
    },
    "in4Tag": {
      "type": "tag",
      "dir": "in",
      "stType": "BOOL",
      "default": "",
      "label": "Input 4 tag",
      "group": "Comms/Robot signals",
      "desc": "A signal a job can wait on (a Wait for step)."
    },
    "out4Tag": {
      "type": "tag",
      "dir": "out",
      "stType": "BOOL",
      "default": "",
      "label": "Output 4 tag",
      "group": "Comms/Robot signals",
      "desc": "A signal a job switches (a Set step)."
    },
    "tool": {
      "type": "enum",
      "default": "vacuum",
      "label": "Tool",
      "group": "Tool",
      "desc": "What the robot carries on its flange: a vacuum plate that lifts what is under it, or a clamp gripper whose two paddles close on the sides of a load. Both pick a load of the tool size below.",
      "options": [
        {
          "value": "vacuum",
          "label": "Vacuum plate"
        },
        {
          "value": "gripper",
          "label": "Clamp gripper"
        },
        {
          "value": "none",
          "label": "None"
        }
      ]
    },
    "toolSizeX": {
      "type": "number",
      "default": 0.25,
      "min": 0.1,
      "max": 3,
      "step": 0.01,
      "label": "Tool size X (m)",
      "group": "Tool",
      "desc": "Length of the vacuum plate, or the width of the load the clamp closes on. Size it to the product you pick: it is also the grab reach."
    },
    "toolSizeZ": {
      "type": "number",
      "default": 0.25,
      "min": 0.1,
      "max": 3,
      "step": 0.01,
      "label": "Tool size Z (m)",
      "group": "Tool",
      "desc": "Width of the vacuum plate, or how deep the clamp paddles are."
    },
    "cupPitchX": {
      "type": "number",
      "default": 0.06,
      "min": 0.01,
      "max": 0.5,
      "step": 0.005,
      "label": "Cup pitch X (m)",
      "group": "Tool",
      "desc": "Centre-to-centre spacing of the suction cups along the plate length."
    },
    "cupPitchZ": {
      "type": "number",
      "default": 0.06,
      "min": 0.01,
      "max": 0.5,
      "step": 0.005,
      "label": "Cup pitch Z (m)",
      "group": "Tool",
      "desc": "Centre-to-centre spacing of the suction cups across the plate width."
    },
    "cupMarginX": {
      "type": "number",
      "default": 0.04,
      "min": 0,
      "max": 0.5,
      "step": 0.005,
      "label": "Cup margin X (m)",
      "group": "Tool",
      "desc": "Inset from each end of the plate before the first cup."
    },
    "cupMarginZ": {
      "type": "number",
      "default": 0.04,
      "min": 0,
      "max": 0.5,
      "step": 0.005,
      "label": "Cup margin Z (m)",
      "group": "Tool",
      "desc": "Inset from each side of the plate before the first cup."
    },
    "cupsEnabled": {
      "type": "boolean",
      "default": true,
      "label": "Suction cups",
      "group": "Tool",
      "desc": "Draw the cup grid under the plate. Appearance only."
    }
  },
  step(ctx) {
    ctx.robot.step()
  },
})
