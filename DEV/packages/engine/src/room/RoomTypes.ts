import type { ClassId, RoleId, DungeonDifficulty } from '../types.js';

export type RoomStatus = 'LOBBY' | 'IN_COMBAT' | 'OUT_OF_COMBAT' | 'CLEARED' | 'CLOSED';

export interface RoomMember {
  id: string;
  name: string;
  classId: ClassId;
  spec: string;
  role: RoleId;
  isPlayer: boolean;
  isAi: boolean;
  isHost: boolean;
  isReady: boolean;
  slotIndex: number;
}

export interface RoomSlot {
  index: number;
  role: RoleId;
  occupied: boolean;
  member?: RoomMember;
}

export interface RoleLimit {
  min: number;
  max: number;
}

export interface DungeonRoleQuota {
  dungeonId: string;
  dungeonName: string;
  tier: '5man' | '20man';
  capacity: number;
  roles: {
    TANK: RoleLimit;
    HEALER: RoleLimit;
    DPS: RoleLimit;
  };
  validCompositions: Array<{ TANK: number; HEALER: number; DPS: number }>;
}

export interface WaitingQueueEntry {
  id: string;
  roomId: string;
  playerId: string;
  playerName: string;
  classId: ClassId;
  spec: string;
  role: RoleId;
  joinedAtMs: number;
}

export interface MapSwitchValidation {
  canSwitch: boolean;
  errors: string[];
}

export interface StartGameValidation {
  canStart: boolean;
  reasons: string[];
  isFull: boolean;
  isRoleCompositionValid: boolean;
  allReady: boolean;
}

export interface SpecSelectionCheck {
  allowed: boolean;
  disabled: boolean;
  reason?: string;
}

export interface WaitingQueueStatus {
  inCombat: boolean;
  bossName?: string;
  bossHpPct?: number; // 0 - 100
  queuePosition: number;
  totalWaiting: number;
}

export interface PlayerInfo {
  id: string;
  name: string;
  classId: ClassId;
  spec: string;
  role?: RoleId;
}

export interface LobbyRoom {
  id: string;
  name: string;
  dungeonId: string;
  difficulty: DungeonDifficulty;
  status: RoomStatus;
  hostId: string;
  slots: RoomSlot[];
  members: RoomMember[];
  waitingQueue: WaitingQueueEntry[];
  createdAt: number;
  inCombatBossId?: string;
  inCombatBossName?: string;
  inCombatBossHp?: number;
  inCombatBossMaxHp?: number;
}

export const CLASS_SPECS_MAP: Record<ClassId, { id: string; name: string; role: RoleId }[]> = {
  DK: [
    { id: 'BLOOD', name: '鲜血（主坦）', role: 'TANK' },
    { id: 'FROST', name: '冰霜（输出）', role: 'DPS' },
    { id: 'UNHOLY', name: '邪恶（输出）', role: 'DPS' },
  ],
  DRUID: [
    { id: 'RESTORATION', name: '恢复（治疗）', role: 'HEALER' },
    { id: 'BALANCE', name: '平衡（输出）', role: 'DPS' },
    { id: 'FERAL', name: '野性（坦克/输出）', role: 'TANK' },
  ],
  SHAMAN: [
    { id: 'RESTORATION', name: '恢复（治疗）', role: 'HEALER' },
    { id: 'ELEMENTAL', name: '元素（输出）', role: 'DPS' },
    { id: 'ENHANCEMENT', name: '增强（输出）', role: 'DPS' },
  ],
  MAGE: [
    { id: 'FIRE', name: '火焰（输出）', role: 'DPS' },
    { id: 'FROST', name: '冰霜（输出）', role: 'DPS' },
    { id: 'ARCANE', name: '奥术（输出）', role: 'DPS' },
  ],
  ROGUE: [
    { id: 'COMBAT', name: '战斗（输出）', role: 'DPS' },
    { id: 'ASSASSINATION', name: '刺杀（输出）', role: 'DPS' },
    { id: 'SUBTLETY', name: '敏锐（输出）', role: 'DPS' },
  ],
  WARRIOR: [
    { id: 'PROTECTION', name: '防护（主坦）', role: 'TANK' },
    { id: 'ARMS', name: '武器（输出）', role: 'DPS' },
    { id: 'FURY', name: '狂怒（输出）', role: 'DPS' },
  ],
  PALADIN: [
    { id: 'HOLY', name: '神圣（治疗）', role: 'HEALER' },
    { id: 'PROTECTION', name: '防护（主坦）', role: 'TANK' },
    { id: 'RETRIBUTION', name: '惩戒（输出）', role: 'DPS' },
  ],
  HUNTER: [
    { id: 'BEAST_MASTERY', name: '野兽控制（输出）', role: 'DPS' },
    { id: 'MARKSMANSHIP', name: '射击（输出）', role: 'DPS' },
    { id: 'SURVIVAL', name: '生存（输出）', role: 'DPS' },
  ],
  PRIEST: [
    { id: 'DISCIPLINE', name: '戒律（治疗）', role: 'HEALER' },
    { id: 'HOLY', name: '神圣（治疗）', role: 'HEALER' },
    { id: 'SHADOW', name: '暗影（输出）', role: 'DPS' },
  ],
  WARLOCK: [
    { id: 'AFFLICTION', name: '痛苦（输出）', role: 'DPS' },
    { id: 'DEMONOLOGY', name: '恶魔学识（输出）', role: 'DPS' },
    { id: 'DESTRUCTION', name: '毁灭（输出）', role: 'DPS' },
  ],
};

export const DUNGEON_ROLE_QUOTAS: Record<string, DungeonRoleQuota> = {
  shadowfang_keep: {
    dungeonId: 'shadowfang_keep',
    dungeonName: '影牙城堡',
    tier: '5man',
    capacity: 5,
    roles: {
      TANK: { min: 1, max: 1 },
      HEALER: { min: 1, max: 1 },
      DPS: { min: 3, max: 3 },
    },
    validCompositions: [
      { TANK: 1, HEALER: 1, DPS: 3 },
    ],
  },
  dragon_soul: {
    dungeonId: 'dragon_soul',
    dungeonName: '巨龙之魂',
    tier: '20man',
    capacity: 20,
    roles: {
      TANK: { min: 2, max: 2 },
      HEALER: { min: 4, max: 5 },
      DPS: { min: 13, max: 14 },
    },
    validCompositions: [
      { TANK: 2, HEALER: 4, DPS: 14 },
      { TANK: 2, HEALER: 5, DPS: 13 },
    ],
  },
};

export function getRoleBySpec(classId: ClassId, spec: string): RoleId {
  const specUpper = (spec || '').toUpperCase();
  if (specUpper === 'BLOOD' || specUpper === 'GUARDIAN') return 'TANK';
  if (specUpper === 'RESTORATION') return 'HEALER';
  const list = CLASS_SPECS_MAP[classId];
  if (list) {
    const found = list.find(s => s.id.toUpperCase() === specUpper);
    if (found) return found.role;
  }
  return 'DPS';
}
