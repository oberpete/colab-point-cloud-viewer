const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const { randomUUID } = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// peers: Map<id, { ws: WebSocket, camera: object | null }>
const peers = new Map();

wss.on('connection', (ws) => {
  const id = randomUUID();
  peers.set(id, { ws, camera: null });

  // Send this client its assigned ID + snapshot of all peers that already have camera state
  ws.send(JSON.stringify({
    type: 'init',
    id,
    peers: activePeers(id),
  }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'camera') {
      peers.get(id).camera = msg.camera;
      broadcast({ type: 'peer_update', id, camera: msg.camera }, id);
    }
  });

  ws.on('close', () => {
    peers.delete(id);
    broadcast({ type: 'peer_leave', id }, null);
  });

  ws.on('error', (err) => console.error(`ws error [${id}]:`, err.message));
});

function activePeers(excludeId) {
  return Array.from(peers.entries())
    .filter(([pid, p]) => pid !== excludeId && p.camera !== null)
    .map(([pid, p]) => ({ id: pid, camera: p.camera }));
}

function broadcast(msg, fromId) {
  const data = JSON.stringify(msg);
  for (const [pid, { ws }] of peers) {
    if (pid === fromId) continue;
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server →  http://localhost:${PORT}`));
