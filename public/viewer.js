/**
 * viewer.js — WebSocket camera sync + peer presence in the 3D scene.
 * Exported as an ES module; called from index.html after Potree is ready.
 */

export function initSync(viewer, THREE) {
  // wss:// when the page itself is served over https — plain ws:// is blocked as mixed content
  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${wsProtocol}//${location.host}`);

  // id assigned by the server on connection
  let myId = null;

  // Map<peerId, THREE.Group> — one group per peer, updated in-place (no duplicates)
  const peerObjects = new Map();

  // Map<peerId, timestamp> — last time a camera update was received
  const lastSeen = new Map();

  // ── WebSocket handlers ──────────────────────────────────────────────────────

  ws.addEventListener('open', () => setConnected(true));
  ws.addEventListener('close', () => setConnected(false));

  ws.addEventListener('message', ({ data }) => {
    const msg = JSON.parse(data);

    switch (msg.type) {
      case 'init':
        myId = msg.id;
        msg.peers.forEach(p => upsertPeer(p.id, p.camera));
        break;
      case 'peer_update':
        upsertPeer(msg.id, msg.camera);
        break;
      case 'peer_leave':
        removePeer(msg.id);
        break;
    }
  });

  // ── Camera broadcasting (~1 Hz) ─────────────────────────────────────────────

  let lastSent = 0;

  setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (document.hidden) return; // pause heartbeat while tab is backgrounded — makes peer staleness deterministic instead of depending on browser timer throttling
    const now = Date.now();
    if (now - lastSent < 900) return;
    lastSent = now;

    const camera = viewer?.scene?.getActiveCamera?.();
    if (!camera) return;

    const pos = camera.position;
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);

    ws.send(JSON.stringify({
      type: 'camera',
      camera: {
        position:  { x: pos.x, y: pos.y, z: pos.z },
        direction: { x: dir.x, y: dir.y, z: dir.z },
      },
    }));
  }, 100); // checks often but gates on lastSent

  // ── Peer cone geometry ──────────────────────────────────────────────────────

  // Deterministic HSL color from a peer UUID
  function peerColor(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) {
      h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
    }
    return new THREE.Color().setHSL((Math.abs(h) % 360) / 360, 0.75, 0.55);
  }

  function buildPeerObject(id) {
    const color = peerColor(id);
    const group = new THREE.Group();

    // Small sphere marks the camera eye position
    group.add(new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 8, 8),
      new THREE.MeshBasicMaterial({ color })
    ));

    // Open cone: apex at group origin, base opens in local +Z
    // ConeGeometry default: axis=Y, apex at +Y*h/2, base at -Y*h/2
    const coneGeo = new THREE.ConeGeometry(8, 20, 8, 1, true);
    coneGeo.translate(0, -10, 0);     // apex → origin, base center → (0,-20,0)
    coneGeo.rotateX(-Math.PI / 2);    // base → (0,0,20) — cone opens in +Z
    group.add(new THREE.Mesh(
      coneGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
    ));

    return group;
  }

  const FORWARD = new THREE.Vector3(0, 0, 1);

  function upsertPeer(id, camera) {
    if (!camera) return;

    lastSeen.set(id, Date.now());

    if (!peerObjects.has(id)) {
      const obj = buildPeerObject(id);
      viewer.scene.scene.add(obj);
      peerObjects.set(id, obj);
      renderPeerList();
    }

    const obj = peerObjects.get(id);
    const { position, direction } = camera;

    obj.position.set(position.x, position.y, position.z);

    // Rotate group so its +Z axis aligns with the peer's look direction
    const dir = new THREE.Vector3(direction.x, direction.y, direction.z).normalize();

    if (FORWARD.dot(dir) < -0.9999) {
      // Antiparallel edge case — rotate 180° around Y
      obj.setRotationFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    } else {
      obj.setRotationFromQuaternion(
        new THREE.Quaternion().setFromUnitVectors(FORWARD, dir)
      );
    }
  }

  function removePeer(id) {
    const obj = peerObjects.get(id);
    if (!obj) return;

    viewer.scene.scene.remove(obj);
    obj.traverse(child => {
      child.geometry?.dispose();
      child.material?.dispose();
    });
    peerObjects.delete(id);
    lastSeen.delete(id);
    renderPeerList();
  }

  // ── Peer list overlay ───────────────────────────────────────────────────────

  function setConnected(connected) {
    document.getElementById('conn-dot').className = `dot ${connected ? 'connected' : 'disconnected'}`;
    document.getElementById('conn-label').textContent = connected ? 'Connected' : 'Disconnected';
  }

  // Peers are greyed out in the list once their heartbeat goes stale
  // (e.g. their tab is backgrounded) but before the WebSocket actually closes.
  const INACTIVE_THRESHOLD_MS = 5000;

  // "just now" / 10s chunks / whole minutes — deliberately coarse so the
  // overlay doesn't need to re-render every second to stay accurate.
  function formatLastSeen(ts) {
    const diffSec = Math.floor((Date.now() - ts) / 1000);
    if (diffSec < 5) return 'just now';
    if (diffSec < 60) return `${Math.ceil(diffSec / 10) * 10}s ago`;
    return `${Math.ceil(diffSec / 60)}m ago`;
  }

  function renderPeerList() {
    const list = document.getElementById('peer-list');
    list.innerHTML = '';

    if (peerObjects.size === 0) {
      const li = document.createElement('li');
      li.className = 'peer-empty';
      li.textContent = 'No other viewers';
      list.appendChild(li);
      return;
    }

    for (const id of peerObjects.keys()) {
      const ts = lastSeen.get(id);
      const stale = Date.now() - ts >= INACTIVE_THRESHOLD_MS;
      const hex = `#${peerColor(id).getHexString()}`;
      const li = document.createElement('li');
      li.className = stale ? 'peer-inactive' : '';
      li.innerHTML =
        `<span class="peer-dot" style="background:${hex}"></span>` +
        `<span class="peer-info">` +
        `<span class="peer-name">Viewer&nbsp;<code>${id.slice(0, 6)}</code></span>` +
        `<span class="peer-seen">${formatLastSeen(ts)}</span>` +
        `</span>`;
      list.appendChild(li);
    }
  }

  renderPeerList();
  setInterval(renderPeerList, 5000); // matches the 10s display granularity — no need to re-render every second
}
