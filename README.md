# Collaborative Point Cloud Viewer

Multiple browser tabs load the SoFi Stadium COPC point cloud and share camera position + view direction in real time.

## Live demo

**[colab-point-cloud-viewer.onrender.com](https://colab-point-cloud-viewer.onrender.com/)**

Hosted on Render's free tier — if it's been idle, the first load can take some time to spin back up.

## Prerequisites

- Node.js 22+ (`nvm use 22` if you use nvm)

## Setup

```bash
npm install
npm run setup   # downloads + builds Potree (~2–3 min, runs once)
npm start       # http://localhost:3000
```

Or with Docker: `docker compose up --build` (builds Potree inside the image, ~2-3 min on first run).

## Tests

```bash
npm test        # integration tests — no browser needed
npm run typecheck
```

## Manual testing

Open the app (locally at `http://localhost:3000`, or the live demo above) in two tabs. The SoFi cloud streams from S3 (~2 GB), first tiles appear in ~10–30 s. Move the camera in one tab — a view cone appears in the other within ~1 second. Close a tab — the cone disappears.

## Architecture

```
Browser Tab A                  Node.js server               Browser Tab B
──────────────────             ──────────────────           ──────────────────
Potree viewer                  Express (static)             Potree viewer
  │                                   │                       │
viewer.js ──{type:camera}────────────▶│──{type:peer_update}──▶viewer.js
  │                                   │                       │
  │        ◀──{type:init, peers:[…]}──│ (on connect)          │
  │                                   │                       │
  │ (tab closes)                      │                       │
  └────────── disconnect ────────────▶│──{type:peer_leave}───▶│
```

## Approach

Clear separation between rendering and collaboration — Potree owns the 3D scene completely, the sync layer sits alongside it without touching Potree internals.

### Rendering (Potree)

Handles point cloud loading, LOD, and WebGL. We only configure the data source and default color attribute (`elevation`).

### Collaboration (`server.ts` + `viewer.js`)

The server holds a `Map` of peers and broadcasts camera state. Every second, the client reads the camera's position and look direction from Potree and sends them to the server. Peer cones are plain `THREE.Group` objects added directly to `viewer.scene.scene` — the only two points where the layers touch.

### Scope

No bundler, no framework, no auth. Native ES modules are enough for this size. `viewer.js` stays plain JS since Potree has no TypeScript types; the server and shared protocol types (`shared/types.ts`) are fully typed.

### Stretch goals implemented

- **Stable peer color** — each peer's cone and list entry use a deterministic HSL color hashed from their UUID, so the color stays consistent across reconnects.
- **Peer list overlay with last-seen** — the top-right panel lists every connected peer with their color, ID, and a coarse last-seen indicator (`just now`, then 10s chunks, then whole minutes). The camera heartbeat pauses when a tab is backgrounded (Page Visibility API), so an idle peer's entry visibly greys out and its timestamp starts climbing *before* the WebSocket actually disconnects — distinguishing "connected but inactive" from "actively viewing." The timestamp comes from the server (sent on `init` and `peer_update`), so a freshly loaded page shows each peer's real last-active time."
- **Server-side throttle** — the client already self-throttles to ~1Hz, but the server enforces the same 900ms minimum gap per peer before broadcasting (`server.ts`). This is defense-in-depth: every camera message is fanned out to all other peers, so a client that ignores its own throttle (bug, or a non-browser client hitting the WebSocket directly) shouldn't be able to flood that broadcast. The server still keeps the latest position internally even when an update is dropped, so it's never out of date for the next allowed broadcast or a new joiner's `init`.
- **Containerized one-command setup** — `docker compose up --build` builds Potree inside the image and starts the server, so reviewers don't need Node/nvm installed locally at all.

### AI usage

Used Claude Code throughout: analyzing the assignment and sketching the overall approach, scaffolding the project, then iteratively implementing features — the core viewer + sync setup was fairly straightforward, most of the iteration went into the peer list and presence state. Also used it to track down and fix bugs, add a basic integration test setup, containerize the app, and deploy the live version to Render. Verified manually throughout that elevation coloring applies on load, cones move in place without duplicating, and closing a tab cleans up immediately.
