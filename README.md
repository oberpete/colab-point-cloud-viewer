# Collaborative Point Cloud Viewer

Multiple browser tabs load the SoFi Stadium COPC point cloud and share camera position + view direction in real time.

## Prerequisites

- Node.js 22+ (`nvm use 22` if you use nvm)

## Setup

```bash
npm install
npm run setup   # downloads + builds Potree (~2–3 min, runs once)
npm start       # http://localhost:3000
```

## Tests

```bash
npm test        # integration tests — no browser needed
npm run typecheck
```

## Manual testing

Open `http://localhost:3000` in two tabs. The SoFi cloud streams from S3 (~2 GB), first tiles appear in ~10–30 s. Move the camera in one tab — a view cone appears in the other within ~1 second. Close a tab — the cone disappears.

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

**Rendering (Potree):** Handles point cloud loading, LOD, and WebGL. We only configure the data source and default color attribute (`elevation`).

**Collaboration (`server.ts` + `viewer.js`):** The server holds a `Map` of peers and broadcasts camera state. Every second, the client reads the camera's position and look direction from Potree and sends them to the server. Peer cones are plain `THREE.Group` objects added directly to `viewer.scene.scene` — the only two points where the layers touch.

**Scope:** No bundler, no framework, no auth. Native ES modules are enough for this size. `viewer.js` stays plain JS since Potree has no TypeScript types; the server and shared protocol types (`shared/types.ts`) are fully typed.

**AI usage:** Used Claude Code to scaffold the project, work out the Three.js cone geometry, and debug a Potree API mismatch (`viewer.scene.camera` vs `viewer.scene.getActiveCamera()`). Verified manually that elevation coloring applies on load, cones move in place without duplicating, and closing a tab cleans up immediately.
