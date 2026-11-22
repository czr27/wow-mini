import type { ClassId, RoleId, DungeonDifficulty, CustomDifficultySettings, Buff } from '../types.js';
import type { LobbyRoom, PlayerInfo } from '../room/RoomTypes.js';

/** Compact unit state for host→guest combat sync (server does not tick). */
export interface NetworkUnitSnapshot {
  id: string;
  name: string;
  classId: string;
  spec?: string;
  role: string;
  isPlayer: boolean;
  isAi?: boolean;
  isAlive: boolean;
  hp: number;
  maxHp: number;
  mp?: number;
  maxMp?: number;
  energy?: number;
  rage?: number;
  runicPower?: number;
  focus?: number;
  absorb: number;
  position: { x: number; y: number };
  buffs: Buff[];
  combatStats?: {
    damageDealt: number;
    healingDone: number;
    overhealDone: number;
    damageTaken: number;
    interruptCount: number;
  };
}

export interface NetworkCombatSnapshot {
  roomId: string;
  seq: number;
  timeMs: number;
  runPhase: string;
  bossTargetId?: string | null;
  units: NetworkUnitSnapshot[];
}

export interface PlayerInputPayload {
  playerId: string;
  spellId?: string;
  targetId?: string | null;
  slotIndex?: number;
  kind: 'CAST' | 'TARGET' | 'INTERRUPT' | 'MOVE' | 'READY' | 'WIPE_VOTE';
  x?: number;
  y?: number;
  wipeVote?: boolean;
}

export type NetMessageType =
  | 'PING'
  | 'PONG'
  | 'CONNECTED'
  | 'AUTH'
  | 'AUTH_OK'
  | 'AUTH_FAIL'
  | 'PRESENCE'
  | 'ROOM_LIST'
  | 'ROOM_LIST_SYNC'
  | 'ROOM_CREATE'
  | 'ROOM_JOIN'
  | 'ROOM_LEAVE'
  | 'ROOM_UPDATE'
  | 'ROOM_START'
  | 'ROOM_ACTION'
  | 'PLAYER_INPUT'
  | 'COMBAT_STATE'
  | 'MEMBER_LEFT'
  | 'MEMBER_REPLACE_AI'
  | 'HOST_TRANSFER'
  | 'ERROR';

export interface NetEnvelope<T = unknown> {
  type: NetMessageType;
  seq?: number;
  roomId?: string;
  timeMs?: number;
  payload?: T;
  error?: string;
}

export interface AuthPayload {
  username: string;
  playerId: string;
  playerName: string;
  classId: ClassId;
  spec: string;
  role?: RoleId;
}

export interface RoomCreatePayload {
  name: string;
  dungeonId?: string;
  difficulty?: DungeonDifficulty;
  customDifficulty?: CustomDifficultySettings;
  host: PlayerInfo;
}

export interface RoomActionPayload {
  action:
    | 'AUTO_FILL_AI'
    | 'ADD_AI'
    | 'KICK'
    | 'SET_READY'
    | 'SET_DIFFICULTY'
    | 'CHANGE_SPEC'
    | 'SWITCH_MAP';
  memberId?: string;
  role?: RoleId;
  ready?: boolean;
  difficulty?: DungeonDifficulty;
  customDifficulty?: CustomDifficultySettings;
  classId?: ClassId;
  spec?: string;
  dungeonId?: string;
}

export interface PresencePayload {
  onlinePlayerIds: string[];
  roomId?: string;
}

export interface MemberReplaceAiPayload {
  roomId: string;
  playerId: string;
  aiMemberId: string;
  room: LobbyRoom;
}

export function encodeNetMessage(msg: NetEnvelope): string {
  return JSON.stringify(msg);
}

export function decodeNetMessage(raw: string): NetEnvelope | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.type !== 'string') return null;
    return parsed as NetEnvelope;
  } catch {
    return null;
  }
}
