export interface CameraState {
  position: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
}

export interface PeerInfo {
  id: string;
  camera: CameraState;
  lastSeen: number; // server-side Date.now() of this peer's last camera update
}

// Server → client
export type ServerMessage =
  | { type: 'init';         id: string; peers: PeerInfo[] }
  | { type: 'peer_update';  id: string; camera: CameraState; lastSeen: number }
  | { type: 'peer_leave';   id: string };

// Client → server
export type ClientMessage =
  | { type: 'camera'; camera: CameraState };
