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

## What works where

| | Mac app (Electron) | Browser (Safari, Chrome, Quest) |
|---|---|---|
| F1 TV sign-in | Yes | No — sign in once via Mac app |
| Live DRM streams | Yes (castLabs ECS) | No |
| Replay archive | Yes | Yes |
| Pit wall UI + sync | Yes | Yes |
| 3D track + spatial preview | Yes | Yes |
| Quest WebXR | — | Yes (HTTPS required) |

After you sign in once on the Mac app, the local server stores your session in `apps/data/tokens.json`. Browsers on the same machine (or Quest on the same network / hosted URL) can then **Continue in browser** without signing in again.

## Quick start (first time)

### 1. Install dependencies

```bash
cd f1-pitwall-xr
pnpm install
```

### 2. Launch the Mac app

**Option A — Desktop launcher (easiest)**

```bash
./scripts/install-desktop-launcher.sh
```

Then double-click **Start PitWall XR** on your Desktop.

**Option B — Terminal**

```bash
pnpm start
```

This starts the API server, web UI, and Electron. When Electron opens:

1. Click **Open F1 TV** and sign in with your F1 TV account
2. When the F1 TV home screen loads, click **Continue to Pit Wall**
3. Pick a replay session from the library

### 3. Use the browser (optional)

After sign-in, open [https://localhost:5173](https://localhost:5173) in Safari or Chrome for replay, UI, and spatial mode.

Hosted copy (when deployed): [https://f1.lukaah.com](https://f1.lukaah.com)

### Browser-only dev stack

If you already signed in via the Mac app and the server is running with a saved session:

```bash
pnpm dev:web
```

Opens the web UI + API without Electron. Good for UI work and replay testing. You still need a prior Mac-app sign-in for F1 TV access.

## Quest 2 VR

1. Mac and Quest on same Wi-Fi (5 GHz)
2. Sign in on the Mac app first (session must exist on the server)
3. Find your Mac IP: `ipconfig getifaddr en0`
4. On Quest Browser, open `https://<mac-ip>:5173` (or [https://f1.lukaah.com](https://f1.lukaah.com) when hosted)
5. Click **Continue in browser** if prompted, then load a session → **Spatial** → **Enter VR**

> Quest 2 hardware limits ~1–2 simultaneous video decodes. VR mode shows 3D track + UI; use desktop for full 6-stream wall, or stream-swap in VR.

## Project structure

```
f1-pitwall-xr/
├── apps/
│   ├── client/     React + R3F + Shaka + WebXR UI
│   ├── server/     Express API + F1 TV + SignalR telemetry
│   └── data/       tokens.json, layouts (created at runtime)
├── packages/
│   ├── f1tv-client/   Auth, archive, playback URLs
│   ├── sync-engine/   Multi-stream sync
│   ├── track-3d/      Circuit mesh + car interpolation
│   ├── layout-engine/ Presets + persistence
│   └── shared/        Types
├── electron/       Desktop shell
├── scripts/
│   ├── start-pitwall.command          Double-click launcher
│   └── install-desktop-launcher.sh    Copy launcher to ~/Desktop
└── assets/f1-circuits/  Track GeoJSON (cloned)
```

## API (local server :8787)

| Endpoint | Description |
|---|---|
| `GET /api/auth/status` | Whether server has a valid F1 TV session |
| `POST /api/auth/login` | F1 TV credentials (usually blocked) |
| `POST /api/auth/tokens` | Sync tokens from Electron to server |
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

## Web hosting

See [docs/web-hosting.md](docs/web-hosting.md) for Vercel + nginx setup with `f1.lukaah.com`.

## License

Personal use. F1 trademarks belong to Formula One Licensing BV.
