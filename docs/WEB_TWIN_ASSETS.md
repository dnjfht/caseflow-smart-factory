# Web factory 3D asset provenance

The MES factory viewer uses selected assets from Open Industry Project browser `main` at commit `7ed2b7dbf01835365ba3432bbdd84d933a843dde` (https://github.com/Open-Industry-Project/Open-Industry-Project). The source is MIT-licensed; its copyright and license are preserved in `OIP-MIT-LICENSE.txt`. This repository does not use the source project's name or logo as its own.

| MES file | Source asset |
|---|---|
| `mes/web/public/twin-assets/SixAxisRobot.glb` | Optimized `dist/models/SixAxisRobot.glb` |
| `mes/web/public/twin-assets/rig.json` | `examples/parts/six-axis-robot/rig.json` |
| `mes/web/public/twin-assets/BaseColor.webp`, `ORM.webp` | `dist/models/sixaxis/` |
| `mes/web/public/twin-assets/BeltFabric.jpg`, `BuildingFloor.webp` | `dist/textures/` |
| `mes/web/public/twin-assets/draco/*` | `three/examples/jsm/libs/draco/` decoder (Google Draco, Apache-2.0); license in `DRACO-APACHE-2.0.txt` |

The 3D viewer is a visualization of production telemetry, not the physics/PLC simulator. The browser robot joint motion is a phase-based visual cue, not measured INDY joint positions.
