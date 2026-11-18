# CIVIC · Autonomous Urban Operations

CIVIC is a municipal street-cleaning simulator with a live Halifax digital twin, fleet telemetry, mission dispatch, and a simulated parking-obstruction review workflow.

## Run the command center

From the repository root, use Node.js 22 or newer.

```sh
cd web
npm ci
npm run dev
```

Open `http://localhost:5199` and select **Run City Operations Demo**. The guided sequence pauses for human review. Mark the evidence reviewed, approve the referral, then route it to simulated Municipal Parking Enforcement. You can also reject the case or mark the evidence insufficient. **Live City Map → Open replay** lets you scrub from 06:00 to 22:00.

The default preset includes 9 robots, 3 stations, and 36 street segments in Halifax's South End. Choose the Peninsula preset in the city menu to load 100 robots. OpenFreeMap provides the online basemap and the bundled OpenStreetMap street network supplies the offline fallback. The simulation runs without a map API key or connected robot.

## Verify

```sh
npm test
npm run build
```

The **Hardware Prototype** page can use a webcam on localhost or HTTPS. Its camera access is optional. Fleet telemetry and referrals are simulated.

### Live webcam detection

Start the vision bridge from the repository root in a second terminal. On a fresh clone, create `.venv` with `python -m venv .venv`, install [PyTorch](https://pytorch.org/get-started/locally/) for your hardware into that environment, then run `.\.venv\Scripts\python.exe -m pip install -r requirements.txt`.

```powershell
.\.venv\Scripts\python.exe tools/vision_bridge.py
```

Open **Hardware Prototype → Connect camera**. Detection starts automatically. Green boxes mark debris, amber boxes mark potential obstacles such as people and vehicles, and cyan boxes mark other recognized objects. **Live debris and object detection** toggles analysis while keeping the camera connected. Webcam frames are processed on this computer.

The repository includes `models/pretrain.pt` for debris and `yolo11n.pt` for general objects. See the [model credits](models/README.md) for provenance and licensing.

The camera panel shows **Steering guidance** for the manual RC controller. It uses the left, center, and right regions of the camera image to suggest a turn around a detected obstacle or guide the robot toward debris. It recommends stopping when the route is blocked and holding position when the camera result is stale. The region thresholds are in `config.yaml`.
