import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import type { Server } from 'http';
import { createServer } from '../server.ts';
import type { ServerMessage, CameraState } from '../shared/types.ts';

const TEST_PORT = 3099;
let server: Server;

before(() => new Promise<void>((resolve, reject) => {
  server = createServer();
  server.once('error', reject);
  server.listen(TEST_PORT, resolve);
}));

after(() => new Promise<void>((resolve, reject) => {
  server.closeAllConnections();
  server.close((err) => err ? reject(err) : resolve());
}));

// Buffers messages immediately on attach — no message is ever dropped due to timing.
// close() returns a Promise that resolves only after the server has processed the
// disconnect, preventing stale peer_leave messages from leaking into the next test.
interface TestClient {
  next(): Promise<ServerMessage>;
  send(data: object): void;
  close(): Promise<void>;
}

function createClient(): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
    const buffer: ServerMessage[] = [];
    const waiters: Array<(msg: ServerMessage) => void> = [];

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage;
      if (waiters.length) {
        waiters.shift()!(msg);
      } else {
        buffer.push(msg);
      }
    });

    ws.once('open', () => resolve({
      next() {
        if (buffer.length) return Promise.resolve(buffer.shift()!);
        return new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error('no message within 3s')), 3000);
          waiters.push((msg) => { clearTimeout(t); res(msg); });
        });
      },
      send: (data) => ws.send(JSON.stringify(data)),
      close: () => new Promise<void>((res) => {
        // Wait for the client-side close event, then give the server one event-loop
        // tick to process its own close handler and broadcast peer_leave.
        ws.once('close', () => setTimeout(res, 20));
        ws.close();
      }),
    }));

    ws.once('error', reject);
  });
}

test('new client receives init with its own id and empty peer list', async () => {
  const a = await createClient();
  const msg = await a.next();

  assert.equal(msg.type, 'init');
  if (msg.type !== 'init') return;
  assert.ok(msg.id);
  assert.deepEqual(msg.peers, []);

  await a.close();
});

test('camera update from one client is broadcast to others', async () => {
  const a = await createClient();
  await a.next(); // init

  const b = await createClient();
  await b.next(); // init

  const camera: CameraState = { position: { x: 1, y: 2, z: 3 }, direction: { x: 0, y: 0, z: -1 } };
  a.send({ type: 'camera', camera });

  const msg = await b.next();
  assert.equal(msg.type, 'peer_update');
  if (msg.type !== 'peer_update') return;
  assert.deepEqual(msg.camera, camera);

  await a.close();
  await b.close();
});

test('new joiner receives existing camera state in init', async () => {
  const a = await createClient();
  await a.next(); // init

  const camera: CameraState = { position: { x: 10, y: 20, z: 30 }, direction: { x: 1, y: 0, z: 0 } };
  a.send({ type: 'camera', camera });
  await new Promise((r) => setTimeout(r, 50));

  const b = await createClient();
  const init = await b.next();

  assert.equal(init.type, 'init');
  if (init.type !== 'init') return;
  assert.equal(init.peers.length, 1);
  assert.deepEqual(init.peers[0].camera, camera);

  await a.close();
  await b.close();
});

test('disconnect sends peer_leave to remaining clients', async () => {
  const a = await createClient();
  await a.next(); // init

  const b = await createClient();
  const bInit = await b.next();
  if (bInit.type !== 'init') throw new Error('expected init');

  const pending = a.next(); // register before closing b
  await b.close();           // await so server finishes broadcasting peer_leave

  const msg = await pending;
  assert.equal(msg.type, 'peer_leave');
  if (msg.type !== 'peer_leave') return;
  assert.equal(msg.id, bInit.id);

  await a.close();
});
