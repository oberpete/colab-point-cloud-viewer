import express from 'express';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import http from 'http';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import path from 'path';
import type { CameraState, ClientMessage, ServerMessage } from './shared/types.ts';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

interface Peer {
  ws: WebSocket;
  camera: CameraState | null;
  lastBroadcast: number; // Date.now() of the last camera update we broadcast for this peer
}

// Matches the client's own ~1Hz send rate (see viewer.js). This is defense-in-depth:
// a buggy or malicious client could ignore its own throttle and flood the server,
// and every camera message is fanned out to all other peers (O(n) per message).
const THROTTLE_MS = 900;

export function createServer() {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  app.use(express.static(path.join(__dirname, 'public')));

  const peers = new Map<string, Peer>();

  wss.on('connection', (ws) => {
    const id = randomUUID();
    peers.set(id, { ws, camera: null, lastBroadcast: 0 });

    send(ws, { type: 'init', id, peers: activePeers(id) });

    ws.on('message', (raw) => {
      let msg: ClientMessage;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.type === 'camera') {
        const peer = peers.get(id)!;
        peer.camera = msg.camera; // always keep the latest state, even if this update isn't broadcast

        // Throttle: drop this update if we broadcast for this peer too recently.
        const now = Date.now();
        if (now - peer.lastBroadcast < THROTTLE_MS) return;
        peer.lastBroadcast = now;

        broadcast({ type: 'peer_update', id, camera: msg.camera }, id);
      }
    });

    ws.on('close', () => {
      peers.delete(id);
      broadcast({ type: 'peer_leave', id }, null);
    });

    ws.on('error', (err) => console.error(`ws error [${id}]:`, err.message));
  });

  function activePeers(excludeId: string) {
    return Array.from(peers.entries())
      .filter(([pid, p]) => pid !== excludeId && p.camera !== null)
      .map(([pid, p]) => ({ id: pid, camera: p.camera! }));
  }

  function broadcast(msg: ServerMessage, fromId: string | null) {
    const data = JSON.stringify(msg);
    for (const [pid, { ws }] of peers) {
      if (pid === fromId) continue;
      if (ws.readyState === ws.OPEN) ws.send(data);
    }
  }

  return server;
}

function send(ws: WebSocket, msg: ServerMessage) {
  ws.send(JSON.stringify(msg));
}

// Only listen when run directly (not imported by tests)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const PORT = process.env.PORT ?? 3000;
  createServer().listen(PORT, () => console.log(`Server →  http://localhost:${PORT}`));
}
