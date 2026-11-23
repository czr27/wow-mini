/**
 * Host canvas ↔ COMBAT_STATE ↔ Guest canvas 迷宫同步桥。
 * 按 roomId 隔离：每个房间独立镜像，进本 clear 只清本房间。
 */

export type MazeTrashNet = {
  id: string;
  hp: number;
  maxHp: number;
  isDead: boolean;
  isTombstone: boolean;
  dissipateAlpha?: number;
};

/** Lightweight maze floating numbers (host → guest). */
export type MazeSctNet = {
  id: string;
  text: string;
  x: number;
  y: number;
  color: string;
  createdAt: number;
  isCrit: boolean;
};

export type MazeSyncPayload = {
  roomId?: string | null;
  mazeSeed: number;
  mazeDungeonId: string;
  mazeStageIndex: number;
  mazeLeadDist: number;
  mazeTrash: MazeTrashNet[];
  /** Recent encounter SCT — guests merge by id */
  sctEvents?: MazeSctNet[];
};

/** Active host publish target (current local room). */
let activeRoomId: string | null = null;
let published: MazeSyncPayload | null = null;
const guestMirrorByRoom = new Map<string, MazeSyncPayload>();

export function setMazeSyncRoomId(roomId: string | null | undefined): void {
  activeRoomId = roomId || null;
}

export function publishHostMazeSync(payload: MazeSyncPayload): void {
  published = {
    ...payload,
    roomId: payload.roomId ?? activeRoomId,
  };
}

export function takeHostMazeSyncForBroadcast(): MazeSyncPayload | null {
  return published;
}

export function applyGuestMazeSync(payload: Partial<MazeSyncPayload> | null | undefined): void {
  if (!payload) return;
  const roomKey = payload.roomId || activeRoomId || '__default__';
  const prev = guestMirrorByRoom.get(roomKey);
  guestMirrorByRoom.set(roomKey, {
    roomId: roomKey,
    mazeSeed: payload.mazeSeed ?? prev?.mazeSeed ?? 0,
    mazeDungeonId: payload.mazeDungeonId ?? prev?.mazeDungeonId ?? '',
    mazeStageIndex: payload.mazeStageIndex ?? prev?.mazeStageIndex ?? 0,
    mazeLeadDist: payload.mazeLeadDist ?? prev?.mazeLeadDist ?? 0,
    mazeTrash: payload.mazeTrash ?? prev?.mazeTrash ?? [],
    sctEvents: payload.sctEvents ?? prev?.sctEvents ?? [],
  });
}

export function readGuestMazeSync(roomId?: string | null): MazeSyncPayload | null {
  const roomKey = roomId || activeRoomId || '__default__';
  return guestMirrorByRoom.get(roomKey) || null;
}

/** Clear current room mirrors (call on startAdventure / leave room). */
export function clearMazeSync(roomId?: string | null): void {
  const roomKey = roomId || activeRoomId;
  published = null;
  if (roomKey) {
    guestMirrorByRoom.delete(roomKey);
  } else {
    guestMirrorByRoom.clear();
  }
}
