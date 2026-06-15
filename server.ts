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
}

export function createServer() {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  app.use(express.static(path.join(__dirname, 'public')));

  const peers = new Map<string, Peer>();

  wss.on('connection', (ws) => {
    const id = randomUUID();
    peers.set(id, { ws, camera: null });

    send(ws, { type: 'init', id, peers: activePeers(id) });

    ws.on('message', (raw) => {
      let msg: ClientMessage;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.type === 'camera') {
        peers.get(id)!.camera = msg.camera;
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
