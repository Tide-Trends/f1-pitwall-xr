# PitWall XR

Immersive F1 pit wall for **Mac desktop** and **Meta Quest 2 VR** — a Lapz-inspired multi-stream viewer with 3D track, live/replay support, and sync engine.

> Unofficial fan project. Not affiliated with Formula One. Personal use only — each user logs in with their own F1 TV credentials.

## Features

- **Multi-stream pit wall** — main broadcast, driver onboards, data, tracker (6+ panels)
- **Live & Replay** — browse F1 TV archive by season; replay mode for easy testing
- **3D track diorama** — [f1-circuits](https://github.com/bacinger/f1-circuits) GeoJSON → live car positions
- **Sync engine** — target latency (live) or seek-sync (replay)
- **Team layout presets** — McLaren, Ferrari, Red Bull walls, etc.
- **Timing tower + race control** — live SignalR or OpenF1 replay telemetry
- **VR mode** — WebXR for Quest 2 browser (`Enter VR` button)
- **Dark immersive background**

## Requirements

- Node.js 20+
- pnpm 9+
- **F1 TV Pro** subscription (included with US Apple TV+ — link accounts at [formula1.com](https://www.formula1.com/en-us/subscribe-to-f1-tv))
- Mac (Apple Silicon or Intel)

For **DRM live playback**, use Electron with [castLabs ECS](https://github.com/castlabs/electron-releases) (same as MultiViewer). Standard Electron/browser works for UI + replay testing.

## Quick start

```bash
cd f1-pitwall-xr
pnpm install
pnpm dev:web
```

Open http://localhost:5173

1. Sign in with F1 TV email/password
2. **Replay** tab → pick season → select a past race
3. Drag panels, tune sync, expand 3D track

### Full stack (server + client + Electron)

```bash
pnpm dev
```

## Quest 2 VR

1. Mac and Quest on same Wi-Fi (5 GHz)
2. Find your Mac IP: `ipconfig getifaddr en0`
3. On Quest Browser, open `http://<mac-ip>:5173` (or HTTPS with mkcert for WebXR)
4. Load a session → click **VR Mode** → **Enter VR**

> Quest 2 hardware limits ~1–2 simultaneous video decodes. VR mode shows 3D track + UI; use desktop for full 6-stream wall, or stream-swap in VR.

## Project structure

```
f1-pitwall-xr/
├── apps/
│   ├── client/     React + R3F + Shaka + WebXR UI
│   └── server/     Express API + F1 TV + SignalR telemetry
├── packages/
│   ├── f1tv-client/   Auth, archive, playback URLs
│   ├── sync-engine/   Multi-stream sync
│   ├── track-3d/      Circuit mesh + car interpolation
│   ├── layout-engine/ Presets + persistence
│   └── shared/        Types
├── electron/       Desktop shell
└── assets/f1-circuits/  Track GeoJSON (cloned)
```

## API (local server :8787)

| Endpoint | Description |
|---|---|
| `POST /api/auth/login` | F1 TV credentials |
| `GET /api/sessions/live` | Live sessions |
| `GET /api/sessions/replay?season=2025` | Archive |
| `GET /api/sessions/:contentId?kind=replay` | Session + channels |
| `GET /api/playback/:contentId?channelId=` | DRM manifest |
| `GET /api/replay/telemetry?sessionKey=&t=` | OpenF1 positions at video time |
| `WS /ws/telemetry` | Live timing feed |

## DRM note

F1 live streams use Widevine DRM. For full playback:

1. Replace `electron` with castLabs ECS fork in `electron/package.json`
2. Wait for `components.whenReady()` before creating BrowserWindow
3. See [MultiViewer docs](https://multiviewer.app/docs) for reference

Replay VOD may work in browser without castLabs depending on session age.

## License

Personal use. F1 trademarks belong to Formula One Licensing BV.
