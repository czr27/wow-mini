import type { ClassId, RoleId, DungeonDifficulty, CustomDifficultySettings, Unit } from '../types.js';
import type { CombatEngine } from '../engine/CombatEngine.js';
import type { RunStateMachine } from '../engine/RunStateMachine.js';
import {
  type LobbyRoom,
  type RoomMember,
  type RoomSlot,
  type DungeonRoleQuota,
  type WaitingQueueEntry,
  type WaitingQueueStatus,
  type MapSwitchValidation,
  type StartGameValidation,
  type SpecSelectionCheck,
  type PlayerInfo,
  DUNGEON_ROLE_QUOTAS,
  CLASS_SPECS_MAP,
  getRoleBySpec,
  coerceDungeonDifficulty,
} from './RoomTypes.js';

// Lore pool for AI teammates (all 10 Cataclysm classes with authentic lore pairings)
const AI_ROSTER_POOL: {
  TANK: Array<{ name: string; classId: ClassId; spec: string }>;
  HEALER: Array<{ name: string; classId: ClassId; spec: string }>;
  DPS: Array<{ name: string; classId: ClassId; spec: string }>;
} = {
  TANK: [
    { name: '莫格莱尼', classId: 'DK', spec: 'BLOOD' },
    { name: '乌瑟尔', classId: 'PALADIN', spec: 'PROTECTION' },
    { name: '穆拉丁', classId: 'WARRIOR', spec: 'PROTECTION' },
    { name: '哈缪尔', classId: 'DRUID', spec: 'FERAL' },
    { name: '萨萨里安', classId: 'DK', spec: 'BLOOD' },
    { name: '博瓦尔', classId: 'PALADIN', spec: 'PROTECTION' },
  ],
  HEALER: [
    { name: '先知努波顿', classId: 'SHAMAN', spec: 'RESTORATION' },
    { name: '安度因', classId: 'PRIEST', spec: 'HOLY' },
    { name: '莉亚德琳', classId: 'PALADIN', spec: 'HOLY' },
    { name: '玛法里奥', classId: 'DRUID', spec: 'RESTORATION' },
    { name: '先知维伦', classId: 'PRIEST', spec: 'DISCIPLINE' },
    { name: '泰兰德', classId: 'PRIEST', spec: 'HOLY' },
  ],
  DPS: [
    { name: '吉安娜', classId: 'MAGE', spec: 'FIRE' },
    { name: '瓦莉拉', classId: 'ROGUE', spec: 'COMBAT' },
    { name: '萨尔', classId: 'SHAMAN', spec: 'ELEMENTAL' },
    { name: '希尔瓦娜斯', classId: 'HUNTER', spec: 'MARKSMANSHIP' },
    { name: '瓦里安', classId: 'WARRIOR', spec: 'ARMS' },
    { name: '古尔丹之影', classId: 'WARLOCK', spec: 'AFFLICTION' },
    { name: '提里奥', classId: 'PALADIN', spec: 'RETRIBUTION' },
    { name: '本尼迪塔斯', classId: 'PRIEST', spec: 'SHADOW' },
    { name: '雷克萨', classId: 'HUNTER', spec: 'BEAST_MASTERY' },
    { name: '萨鲁法尔', classId: 'WARRIOR', spec: 'FURY' },
    { name: '威尔弗雷德', classId: 'WARLOCK', spec: 'DESTRUCTION' },
    { name: '卡德加', classId: 'MAGE', spec: 'ARCANE' },
    { name: '肖尔', classId: 'ROGUE', spec: 'ASSASSINATION' },
    { name: '库尔提拉', classId: 'DK', spec: 'FROST' },
    { name: '布莱恩', classId: 'HUNTER', spec: 'SURVIVAL' },
  ],
};

// Authentic lore hero names grouped by ClassId and optionally SpecId
const CLASS_LORE_NAMES: Record<ClassId, { default: string[]; bySpec?: Record<string, string[]> }> = {
  DK: {
    default: ['莫格莱尼', '萨萨里安', '库尔提拉', '达里安', '科尔蒂拉'],
    bySpec: {
      BLOOD: ['莫格莱尼', '达里安', '萨萨里安'],
      FROST: ['库尔提拉', '萨萨里安', '莫格莱尼'],
      UNHOLY: ['达里安', '瑞文戴尔', '库尔提拉'],
    },
  },
  DRUID: {
    default: ['玛法里奥', '哈缪尔', '布罗尔', '范达尔', '塞纳留斯之影'],
    bySpec: {
      RESTORATION: ['玛法里奥', '雷姆洛斯', '哈缪尔'],
      BALANCE: ['玛法里奥', '范达尔', '月光先知'],
      FERAL: ['哈缪尔', '布罗尔', '利爪德鲁伊'],
    },
  },
  SHAMAN: {
    default: ['萨尔', '先知努波顿', '德雷克塔尔', '雷加尔', '穆尔戈'],
    bySpec: {
      RESTORATION: ['先知努波顿', '德雷克塔尔', '雷加尔'],
      ELEMENTAL: ['萨尔', '德雷克塔尔', '风暴先知'],
      ENHANCEMENT: ['雷加尔', '萨尔', '毁灭之锤'],
    },
  },
  MAGE: {
    default: ['吉安娜', '卡德加', '罗宁', '安东尼达斯', '阿鲁高'],
    bySpec: {
      FIRE: ['罗宁', '吉安娜', '凯尔萨斯'],
      FROST: ['吉安娜', '安东尼达斯', '卡德加'],
      ARCANE: ['卡德加', '麦迪文之影', '安东尼达斯'],
    },
  },
  ROGUE: {
    default: ['瓦莉拉', '肖尔', '伽罗娜', '范克里夫', '莉莉安'],
    bySpec: {
      COMBAT: ['瓦莉拉', '范克里夫', '莉莉安'],
      ASSASSINATION: ['肖尔', '伽罗娜', '瓦莉拉'],
      SUBTLETY: ['伽罗娜', '肖尔', '暗影行者'],
    },
  },
  WARRIOR: {
    default: ['瓦里安', '穆拉丁', '萨鲁法尔', '加尔鲁什', '布洛克斯'],
    bySpec: {
      PROTECTION: ['穆拉丁', '瓦里安', '洛萨之影'],
      ARMS: ['瓦里安', '加尔鲁什', '布洛克斯'],
      FURY: ['萨鲁法尔', '加尔鲁什', '布洛克斯'],
    },
  },
  PALADIN: {
    default: ['提里奥', '乌瑟尔', '莉亚德琳', '博瓦尔', '图拉扬'],
    bySpec: {
      HOLY: ['莉亚德琳', '乌瑟尔', '圣光祭司'],
      PROTECTION: ['乌瑟尔', '博瓦尔', '图拉扬'],
      RETRIBUTION: ['提里奥', '图拉扬', '莉亚德琳'],
    },
  },
  HUNTER: {
    default: ['希尔瓦娜斯', '雷克萨', '布莱恩', '奥蕾莉亚', '赫米特'],
    bySpec: {
      BEAST_MASTERY: ['雷克萨', '米莎驯兽师', '赫米特'],
      MARKSMANSHIP: ['希尔瓦娜斯', '奥蕾莉亚', '温蕾萨'],
      SURVIVAL: ['布莱恩', '赫米特', '雷克萨'],
    },
  },
  PRIEST: {
    default: ['安度因', '先知维伦', '泰兰德', '本尼迪塔斯', '莫伊拉'],
    bySpec: {
      DISCIPLINE: ['先知维伦', '莫伊拉', '安度因'],
      HOLY: ['安度因', '泰兰德', '先知维伦'],
      SHADOW: ['本尼迪塔斯', '暗影主教', '莫伊拉'],
    },
  },
  WARLOCK: {
    default: ['古尔丹之影', '威尔弗雷德', '坎雷萨德', '耐奥祖', '朱贝卡'],
    bySpec: {
      AFFLICTION: ['古尔丹之影', '朱贝卡', '耐奥祖'],
      DEMONOLOGY: ['威尔弗雷德', '坎雷萨德', '古尔丹之影'],
      DESTRUCTION: ['坎雷萨德', '威尔弗雷德', '毁灭术士'],
    },
  },
};

/** Extra AI display names used in combat setup that are not already in the lore pools. */
const EXTRA_RESERVED_AI_NAMES = ['布罗尔·熊皮', '古尔丹'];

let _reservedAiNameKeysCache: Set<string> | null = null;

/** All reserved AI / lore names (normalized keys) that player characters may not use. */
export function collectReservedAiNameKeys(): Set<string> {
  if (_reservedAiNameKeysCache) return _reservedAiNameKeysCache;
  const keys = new Set<string>();
  const add = (raw: string) => {
    const k = (raw || '').trim().toLowerCase();
    if (k) keys.add(k);
  };
  for (const role of Object.keys(AI_ROSTER_POOL) as Array<keyof typeof AI_ROSTER_POOL>) {
    for (const c of AI_ROSTER_POOL[role]) add(c.name);
  }
  for (const classId of Object.keys(CLASS_LORE_NAMES) as ClassId[]) {
    const entry = CLASS_LORE_NAMES[classId];
    for (const n of entry.default || []) add(n);
    if (entry.bySpec) {
      for (const list of Object.values(entry.bySpec)) {
        for (const n of list) add(n);
      }
    }
  }
  for (const n of EXTRA_RESERVED_AI_NAMES) add(n);
  _reservedAiNameKeysCache = keys;
  return keys;
}

export function isReservedAiName(name: string): boolean {
  const key = (name || '').trim().toLowerCase();
  if (!key) return false;
  return collectReservedAiNameKeys().has(key);
}

export function pickLoreNameForClassSpec(
  classId: ClassId,
  spec: string,
  existingNames: Set<string>
): string {
  const entry = CLASS_LORE_NAMES[classId];
  const specUp = (spec || '').toUpperCase();
  const preferred = [
    ...(entry?.bySpec?.[specUp] ?? []),
    ...(entry?.default ?? []),
  ];
  for (const name of preferred) {
    if (!existingNames.has(name)) {
      return name;
    }
  }
  const base = preferred[0] || `${classId}勇士`;
  let suffix = 2;
  while (existingNames.has(`${base}${suffix}`)) {
    suffix++;
  }
  return `${base}${suffix}`;
}

/**
 * Pure validation helper for map switching
 */
export function validateMapSwitch(
  members: RoomMember[],
  targetDungeonId: string
): MapSwitchValidation {
  const targetQuota = DUNGEON_ROLE_QUOTAS[targetDungeonId] || DUNGEON_ROLE_QUOTAS.shadowfang_keep;

  let currentTanks = 0;
  let currentHealers = 0;
  let currentDps = 0;

  for (const m of members) {
    if (m.role === 'TANK') currentTanks++;
    else if (m.role === 'HEALER') currentHealers++;
    else currentDps++;
  }

  const errors: string[] = [];
  const tankExceed = Math.max(0, currentTanks - targetQuota.roles.TANK.max);
  const healerExceed = Math.max(0, currentHealers - targetQuota.roles.HEALER.max);
  const dpsExceed = Math.max(0, currentDps - targetQuota.roles.DPS.max);

  if (tankExceed > 0) {
    errors.push(`坦克人员超出 ${tankExceed} 名`);
  }
  if (healerExceed > 0) {
    errors.push(`治疗人员超出 ${healerExceed} 名`);
  }
  if (dpsExceed > 0) {
    errors.push(`输出人员超出 ${dpsExceed} 名`);
  }

  return {
    canSwitch: errors.length === 0,
    errors,
  };
}

/**
 * Pure validation helper for game start
 */
/** members 为权威名单：按 slotIndex 回写 slots，避免席位与成员脱节导致「看着齐、校验不齐」 */
export function reconcileRoomRoster(room: LobbyRoom): void {
  if (!room?.members || !room?.slots) return;
  const bySlot = new Map<number, (typeof room.members)[0]>();
  for (const m of room.members) {
    if (m.isAi) {
      m.isReady = true;
      m.isPlayer = false;
    }
    bySlot.set(m.slotIndex, m);
  }
  for (const slot of room.slots) {
    const m = bySlot.get(slot.index);
    if (m) {
      slot.occupied = true;
      slot.member = m;
      slot.role = m.role;
    } else {
      slot.occupied = false;
      slot.member = undefined;
    }
  }
}

/** 自定义难度：不卡职业配额 / 不卡人数下限，只禁超员 */
export function isCustomDifficultyRoom(room: Pick<LobbyRoom, 'difficulty'>): boolean {
  return room.difficulty === 'CUSTOM';
}

/**
 * 热加入顶替 AI 优先级（自定义难度可不限职责）：
 * 1) 同职责（同职业优先）→ 2) DPS → 3) 治疗 → 4) 坦克最后（避免奶/输出重进把坦顶光）。
 * 普通/英雄调用方仍只传入同职责 AI 池。
 */
export function pickHotJoinAiReplacement(
  ais: RoomMember[],
  playerClassId: ClassId,
  preferredRole?: RoleId
): RoomMember | undefined {
  if (!ais.length) return undefined;
  const roleOrder: RoleId[] = preferredRole
    ? [
        preferredRole,
        ...(['DPS', 'HEALER', 'TANK'] as RoleId[]).filter((r) => r !== preferredRole),
      ]
    : ['DPS', 'HEALER', 'TANK'];
  for (const role of roleOrder) {
    const pool = ais.filter((m) => m.role === role);
    if (!pool.length) continue;
    const sameClass = pool.filter((m) => m.classId === playerClassId);
    return sameClass[0] || pool[0];
  }
  return ais[0];
}

/** 大厅/列表：是否还有可进席位（自定义：任意空位或任意 AI；常规：同职责） */
export function hasJoinableSeat(
  room: LobbyRoom,
  playerRole: RoleId
): boolean {
  const emptySlots = room.slots || [];
  if (isCustomDifficultyRoom(room)) {
    return emptySlots.some((s) => !s.occupied) || room.members.some((m) => m.isAi);
  }
  return (
    emptySlots.some((s) => !s.occupied && s.role === playerRole) ||
    room.members.some((m) => m.isAi && m.role === playerRole)
  );
}

export function validateStartGame(room: LobbyRoom): StartGameValidation {
  reconcileRoomRoster(room);
  const quota = DUNGEON_ROLE_QUOTAS[room.dungeonId] || DUNGEON_ROLE_QUOTAS.shadowfang_keep;
  const reasons: string[] = [];
  const custom = isCustomDifficultyRoom(room);

  let currentTanks = 0;
  let currentHealers = 0;
  let currentDps = 0;

  for (const m of room.members) {
    if (m.role === 'TANK') currentTanks++;
    else if (m.role === 'HEALER') currentHealers++;
    else currentDps++;
  }

  const isFull = room.members.length === quota.capacity;
  const overCapacity = room.members.length > quota.capacity;

  if (overCapacity) {
    reasons.push(`人数超出上限（${room.members.length}/${quota.capacity}）`);
  }

  // 自定义：允许人数不足、不校验职责配比；普通/英雄仍要求满员+合法配比
  let isRoleCompositionValid = true;
  if (!custom) {
    if (!isFull) {
      reasons.push(`队伍未满（${room.members.length}/${quota.capacity}）`);
      const needTanks = Math.max(0, quota.roles.TANK.min - currentTanks);
      const needHealers = Math.max(0, quota.roles.HEALER.min - currentHealers);
      const targetDps = quota.tier === '20man' ? (currentHealers >= 5 ? 13 : 14) : quota.roles.DPS.min;
      const needDps = Math.max(0, targetDps - currentDps);

      if (needTanks > 0) reasons.push(`缺少坦克 ${needTanks} 名`);
      if (needHealers > 0) reasons.push(`缺少治疗 ${needHealers} 名`);
      if (needDps > 0) reasons.push(`缺少输出 ${needDps} 名`);
    }

    isRoleCompositionValid = quota.validCompositions.some(
      (c) => c.TANK === currentTanks && c.HEALER === currentHealers && c.DPS === currentDps
    );

    if (isFull && !isRoleCompositionValid) {
      const reqText = quota.tier === '5man' ? '1坦 1治 3输出' : '2坦 4~5治 13~14输出';
      reasons.push(
        `队伍分工不符合副本要求（当前 ${currentTanks}坦 ${currentHealers}治 ${currentDps}输出，需 ${reqText}）`
      );
    }
  } else if (room.members.length < 1) {
    reasons.push('房间内没有成员');
  }

  // 仅真人需准备；AI 一律视为已准备（顺带纠正脏数据里的 AI.isReady=false）
  for (const m of room.members) {
    if (m.isAi) m.isReady = true;
  }
  const allReady = room.members.every((m) => m.isAi || m.isReady);
  if (!allReady) {
    reasons.push('有玩家未准备');
  }

  const canStart = custom
    ? room.members.length >= 1 && !overCapacity && allReady
    : isFull && isRoleCompositionValid && allReady;

  return {
    canStart,
    reasons,
    isFull: custom ? room.members.length >= 1 && !overCapacity : isFull,
    isRoleCompositionValid,
    allReady,
  };
}

/**
 * Helper to build default empty slots for a dungeon
 */
export function buildDefaultSlots(dungeonId: string): RoomSlot[] {
  const quota = DUNGEON_ROLE_QUOTAS[dungeonId] || DUNGEON_ROLE_QUOTAS.shadowfang_keep;
  const slots: RoomSlot[] = [];

  if (quota.tier === '5man') {
    // 1 TANK, 1 HEALER, 3 DPS
    slots.push({ index: 0, role: 'TANK', occupied: false });
    slots.push({ index: 1, role: 'HEALER', occupied: false });
    slots.push({ index: 2, role: 'DPS', occupied: false });
    slots.push({ index: 3, role: 'DPS', occupied: false });
    slots.push({ index: 4, role: 'DPS', occupied: false });
  } else {
    // 20-man: 2 TANK, 4 HEALER, 14 DPS (standard)
    let idx = 0;
    for (let i = 0; i < 2; i++) slots.push({ index: idx++, role: 'TANK', occupied: false });
    for (let i = 0; i < 4; i++) slots.push({ index: idx++, role: 'HEALER', occupied: false });
    for (let i = 0; i < 14; i++) slots.push({ index: idx++, role: 'DPS', occupied: false });
  }
  return slots;
}

export class RoomManager {
  private rooms: Map<string, LobbyRoom> = new Map();
  private nextRoomId = 1;

  public getQuota(dungeonId: string): DungeonRoleQuota {
    return DUNGEON_ROLE_QUOTAS[dungeonId] || DUNGEON_ROLE_QUOTAS.shadowfang_keep;
  }

  /**
   * Create a new room with host placed in the first matching role slot
   */
  public createRoom(options: {
    name: string;
    dungeonId?: string;
    difficulty?: DungeonDifficulty;
    customDifficulty?: CustomDifficultySettings;
    host: PlayerInfo;
  }): LobbyRoom {
    const dungeonId = options.dungeonId || 'shadowfang_keep';
    const difficulty: DungeonDifficulty = coerceDungeonDifficulty(
      dungeonId,
      options.difficulty || 'HEROIC',
    );
    const roomId = `room_${this.nextRoomId++}`;

    const hostRole = options.host.role || getRoleBySpec(options.host.classId, options.host.spec);
    const slots = buildDefaultSlots(dungeonId);

    // Find the first unoccupied slot matching hostRole (UI slots remain role-agnostic)
    let hostSlot = slots.find(s => s.role === hostRole && !s.occupied);
    if (!hostSlot) {
      hostSlot = slots[0];
      hostSlot.role = hostRole;
    }

    const hostMember: RoomMember = {
      id: options.host.id,
      name: options.host.name,
      classId: options.host.classId,
      spec: options.host.spec,
      role: hostRole,
      isPlayer: true,
      isAi: false,
      isHost: true,
      isReady: true,
      slotIndex: hostSlot.index,
    };

    hostSlot.occupied = true;
    hostSlot.member = hostMember;

    const room: LobbyRoom = {
      id: roomId,
      name: options.name,
      dungeonId,
      difficulty,
      customDifficulty: options.customDifficulty ? { ...options.customDifficulty } : undefined,
      status: 'LOBBY',
      hostId: options.host.id,
      slots,
      members: [hostMember],
      waitingQueue: [],
      createdAt: Date.now(),
    };

    this.rooms.set(roomId, room);
    return room;
  }

  public getRoom(roomId: string): LobbyRoom | undefined {
    return this.rooms.get(roomId);
  }

  /** Upsert a room snapshot from the network authority (client mirror). */
  public upsertRoom(room: LobbyRoom): void {
    reconcileRoomRoster(room);
    this.rooms.set(room.id, room);
  }

  /**
   * Remove any rooms that have zero human players (AI-only or empty rooms)
   */
  public cleanupAiOnlyRooms(): number {
    let removed = 0;
    for (const [roomId, room] of this.rooms.entries()) {
      const hasHumanPlayer = room.members.some(m => m.isPlayer && !m.isAi);
      if (!hasHumanPlayer) {
        this.rooms.delete(roomId);
        removed++;
      }
    }
    return removed;
  }

  /** Drop settled rooms so they cannot linger in the lobby / quick-join pool. */
  public cleanupSettledRooms(): number {
    let removed = 0;
    for (const [roomId, room] of this.rooms.entries()) {
      if (room.status === 'CLEARED' || room.status === 'CLOSED') {
        this.rooms.delete(roomId);
        removed++;
      }
    }
    return removed;
  }

  public listRooms(): LobbyRoom[] {
    this.cleanupAiOnlyRooms();
    this.cleanupSettledRooms();
    return Array.from(this.rooms.values());
  }

  public deleteRoom(roomId: string): boolean {
    return this.rooms.delete(roomId);
  }

  /**
   * Player (or host) leaves a room.
   * If no human players remain (only AI or empty), the room is immediately deleted.
   * If the host leaves and other human players remain, host transfers to the first remaining human.
   */
  /**
   * Mid-combat / disconnect: convert a human member into an AI occupying the same slot.
   * Returns the new AI member id, or null if the member was not found / already AI.
   */
  public replaceHumanWithAi(
    roomId: string,
    memberId: string
  ): { ok: boolean; aiMemberId?: string; roomDeleted?: boolean; newHostId?: string; room?: LobbyRoom } {
    const room = this.getRoom(roomId);
    if (!room) return { ok: false };

    const member = room.members.find((m) => m.id === memberId);
    if (!member || member.isAi) return { ok: false };

    const wasHost = room.hostId === memberId;
    const existingNames = new Set(room.members.filter((m) => m.id !== memberId).map((m) => m.name));
    const pool = AI_ROSTER_POOL[member.role] || AI_ROSTER_POOL.DPS;
    const available = pool.filter((c) => !existingNames.has(c.name));
    const candidate =
      available.find((c) => c.classId === member.classId && c.spec === member.spec) ||
      available.find((c) => c.classId === member.classId) ||
      available[0] ||
      pool[0];

    const aiMemberId = `ai_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    member.id = aiMemberId;
    member.name = candidate?.name || `${member.name}-AI`;
    if (candidate) {
      member.classId = candidate.classId;
      member.spec = candidate.spec;
      member.role = getRoleBySpec(candidate.classId, candidate.spec);
    }
    member.isPlayer = false;
    member.isAi = true;
    member.isHost = false;
    member.isReady = true;

    const slot = room.slots.find((s) => s.index === member.slotIndex);
    if (slot) {
      slot.member = member;
      slot.role = member.role;
    }

    let newHostId: string | undefined;
    if (wasHost) {
      const nextHost = room.members.find((m) => m.isPlayer && !m.isAi);
      if (nextHost) {
        nextHost.isHost = true;
        nextHost.isReady = true;
        room.hostId = nextHost.id;
        newHostId = nextHost.id;
      } else {
        // No humans left — delete room
        this.rooms.delete(roomId);
        return { ok: true, aiMemberId, roomDeleted: true };
      }
    }

    return { ok: true, aiMemberId, newHostId, room };
  }

  /** Count human (non-AI) players in a room. */
  public countHumanPlayers(roomId: string): number {
    const room = this.getRoom(roomId);
    if (!room) return 0;
    return room.members.filter((m) => m.isPlayer && !m.isAi).length;
  }

  public countAiMembers(roomId: string): number {
    const room = this.getRoom(roomId);
    if (!room) return 0;
    return room.members.filter((m) => m.isAi).length;
  }

  /**
   * Join a human into the room:
   * - NORMAL/HEROIC: empty same-role slot, or replace same-role AI (never switch player role).
   * - CUSTOM: any empty slot / any AI while humans < capacity; hot-join AI pick = 同职责优先→DPS→奶→坦.
   */
  public joinOrHotSwapPlayer(
    roomId: string,
    player: PlayerInfo
  ): {
    ok: boolean;
    reason?: string;
    room?: LobbyRoom;
    replacedAiId?: string;
    member?: RoomMember;
  } {
    const room = this.getRoom(roomId);
    if (!room) return { ok: false, reason: '房间不存在' };
    reconcileRoomRoster(room);

    if (room.members.some((m) => m.id === player.id)) {
      return { ok: true, room, member: room.members.find((m) => m.id === player.id) };
    }

    const quota = this.getQuota(room.dungeonId);
    const humans = room.members.filter((m) => m.isPlayer && !m.isAi).length;
    if (humans >= quota.capacity) {
      return { ok: false, reason: '玩家人数已满' };
    }

    const role = player.role || getRoleBySpec(player.classId, player.spec);
    const roleLabel = role === 'TANK' ? '坦克' : role === 'HEALER' ? '治疗' : '输出';
    const custom = isCustomDifficultyRoom(room);

    // Prefer empty seat: same-role first; CUSTOM may take any empty seat
    let slot = room.slots.find((s) => !s.occupied && s.role === role);
    if (!slot && custom) {
      slot = room.slots.find((s) => !s.occupied);
    }

    if (slot) {
      const member: RoomMember = {
        id: player.id,
        name: player.name,
        classId: player.classId,
        spec: player.spec,
        role,
        isPlayer: true,
        isAi: false,
        isHost: false,
        isReady: room.status === 'LOBBY' ? false : true,
        slotIndex: slot.index,
      };
      slot.occupied = true;
      slot.role = role;
      slot.member = member;
      room.members.push(member);
      return { ok: true, room, member };
    }

    // No empty slot: replace AI
    const aiPool = custom
      ? room.members.filter((m) => m.isAi)
      : room.members.filter((m) => m.isAi && m.role === role);
    const replacedAi = custom
      ? pickHotJoinAiReplacement(aiPool, player.classId, role)
      : aiPool[0];
    if (!replacedAi) {
      return {
        ok: false,
        reason: custom
          ? '当前房间没有可加入的空位或 AI'
          : `当前房间没有可加入的${roleLabel}席位（需同职责空位或同职责 AI）`,
      };
    }

    const newMember: RoomMember = {
      id: player.id,
      name: player.name,
      classId: player.classId,
      spec: player.spec,
      role,
      isPlayer: true,
      isAi: false,
      isHost: false,
      isReady: true,
      slotIndex: replacedAi.slotIndex,
    };
    const memIdx = room.members.findIndex((m) => m.id === replacedAi.id);
    if (memIdx !== -1) room.members[memIdx] = newMember;
    const s = room.slots.find((x) => x.index === replacedAi.slotIndex);
    if (s) {
      s.member = newMember;
      s.role = role;
    }
    return { ok: true, room, replacedAiId: replacedAi.id, member: newMember };
  }

  /** Force-destroy a room (wipe finish / host leave). */
  public destroyRoom(roomId: string): boolean {
    return this.rooms.delete(roomId);
  }

  public leaveRoom(
    roomId: string,
    memberId: string
  ): { removed: boolean; roomDeleted: boolean; newHostId?: string; destroyedByHost?: boolean } {
    const room = this.getRoom(roomId);
    if (!room) return { removed: false, roomDeleted: false };

    // Host leave → destroy entire room
    if (room.hostId === memberId) {
      this.leaveWaitingQueue(roomId, memberId);
      this.rooms.delete(roomId);
      return { removed: true, roomDeleted: true, destroyedByHost: true };
    }

    // Remove from waiting queue if present
    this.leaveWaitingQueue(roomId, memberId);

    const idx = room.members.findIndex(m => m.id === memberId);
    if (idx !== -1) {
      const member = room.members[idx];
      const slot = room.slots.find(s => s.index === member.slotIndex);
      if (slot) {
        slot.occupied = false;
        slot.member = undefined;
      }
      room.members.splice(idx, 1);
    }

    const remainingHumans = room.members.filter(m => m.isPlayer && !m.isAi);
    if (remainingHumans.length === 0) {
      this.rooms.delete(roomId);
      return { removed: idx !== -1, roomDeleted: true };
    }

    return { removed: idx !== -1, roomDeleted: false };
  }

  /**
   * Update room difficulty (NORMAL / HEROIC / CUSTOM) and optional custom parameters
   */
  public setRoomDifficulty(
    roomId: string,
    difficulty: DungeonDifficulty,
    customDifficulty?: CustomDifficultySettings
  ): boolean {
    const room = this.getRoom(roomId);
    if (!room) return false;
    const resolved = coerceDungeonDifficulty(room.dungeonId, difficulty);
    // Leaving CUSTOM for NORMAL/HEROIC requires roster within role quotas
    if (resolved === 'NORMAL' || resolved === 'HEROIC') {
      const gate = validateMapSwitch(room.members, room.dungeonId);
      if (!gate.canSwitch) return false;
    }
    const difficultyChanged = room.difficulty !== resolved;
    const customChanged =
      !!customDifficulty &&
      JSON.stringify(room.customDifficulty || null) !== JSON.stringify(customDifficulty);
    room.difficulty = resolved;
    if (customDifficulty) {
      room.customDifficulty = { ...customDifficulty };
    }
    // Map/difficulty edits invalidate ready — clients re-sync via ROOM_UPDATE
    if (difficultyChanged || customChanged) {
      this.clearHumanReady(room);
    }
    return true;
  }

  /** Clear ready flags for human players (AI stays ready). */
  private clearHumanReady(room: LobbyRoom): void {
    for (const m of room.members) {
      if (m.isPlayer && !m.isAi) m.isReady = false;
    }
  }

  /**
   * 清掉房间内全部 AI，释放席位（不影响真人）。
   */
  private clearAllAiMembers(room: LobbyRoom): number {
    let removed = 0;
    for (let i = room.members.length - 1; i >= 0; i--) {
      const m = room.members[i];
      if (!m.isAi) continue;
      const slot = room.slots.find((s) => s.index === m.slotIndex);
      if (slot) {
        slot.occupied = false;
        slot.member = undefined;
      }
      room.members.splice(i, 1);
      removed++;
    }
    return removed;
  }

  /**
   * One-click AI fill ("一键添加 AI")
   * - 默认：只补缺，保留已有 AI
   * - replaceExistingAi：先踢光全部 AI，再按配额重新分配
   */
  public autoFillAi(
    roomId: string,
    opts?: { replaceExistingAi?: boolean }
  ): { success: boolean; addedCount: number; removedCount: number } {
    const room = this.getRoom(roomId);
    if (!room) return { success: false, addedCount: 0, removedCount: 0 };

    const removedCount = opts?.replaceExistingAi ? this.clearAllAiMembers(room) : 0;

    const quota = this.getQuota(room.dungeonId);

    let currentTanks = 0;
    let currentHealers = 0;
    let currentDps = 0;
    for (const m of room.members) {
      if (m.role === 'TANK') currentTanks++;
      else if (m.role === 'HEALER') currentHealers++;
      else currentDps++;
    }

    let targetTanks = quota.roles.TANK.min;
    let targetHealers = quota.roles.HEALER.min;
    let targetDps = quota.roles.DPS.min;

    if (quota.tier === '20man') {
      targetTanks = 2;
      if (currentHealers >= 5) {
        targetHealers = 5;
        targetDps = 13;
      } else if (currentDps >= 14) {
        targetHealers = 4;
        targetDps = 14;
      } else {
        targetHealers = 4;
        targetDps = 14;
      }
    }

    const needTanks = Math.max(0, targetTanks - currentTanks);
    const needHealers = Math.max(0, targetHealers - currentHealers);
    const needDps = Math.max(0, targetDps - currentDps);

    const neededList: RoleId[] = [
      ...Array(needTanks).fill('TANK' as RoleId),
      ...Array(needHealers).fill('HEALER' as RoleId),
      ...Array(needDps).fill('DPS' as RoleId),
    ];

    let addedCount = 0;
    const existingNames = new Set(room.members.map(m => m.name));

    for (const role of neededList) {
      // Find candidate empty slot
      let targetSlot = room.slots.find(s => !s.occupied && s.role === role);
      if (!targetSlot) {
        targetSlot = room.slots.find(s => !s.occupied);
        if (targetSlot) {
          targetSlot.role = role;
        }
      }
      if (!targetSlot) break; // Room is full

      // Pick AI template
      const pool = AI_ROSTER_POOL[role];
      const availableCandidates = pool.filter(c => !existingNames.has(c.name));
      const candidate = availableCandidates.length > 0
        ? availableCandidates[Math.floor(Math.random() * availableCandidates.length)]
        : pool[Math.floor(Math.random() * pool.length)];

      existingNames.add(candidate.name);

      const aiMember: RoomMember = {
        id: `ai_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        name: candidate.name,
        classId: candidate.classId,
        spec: candidate.spec,
        role,
        isPlayer: false,
        isAi: true,
        isHost: false,
        isReady: true, // AI is always ready!
        slotIndex: targetSlot.index,
      };

      targetSlot.occupied = true;
      targetSlot.member = aiMember;
      room.members.push(aiMember);
      addedCount++;
    }

    this.normalizeAiReady(roomId);
    return { success: true, addedCount, removedCount };
  }

  /**
   * Add a single AI manually
   */
  public addAiMember(
    roomId: string,
    role?: RoleId,
    classId?: ClassId,
    spec?: string
  ): RoomMember | null {
    const room = this.getRoom(roomId);
    if (!room) return null;

    const quota = this.getQuota(room.dungeonId);
    if (room.members.length >= quota.capacity) return null;

    // Determine role if not specified
    let targetRole = role;
    if (!targetRole) {
      let currentTanks = 0;
      let currentHealers = 0;
      let currentDps = 0;
      for (const m of room.members) {
        if (m.role === 'TANK') currentTanks++;
        else if (m.role === 'HEALER') currentHealers++;
        else currentDps++;
      }
      if (currentTanks < quota.roles.TANK.max) targetRole = 'TANK';
      else if (currentHealers < quota.roles.HEALER.max) targetRole = 'HEALER';
      else targetRole = 'DPS';
    }

    let targetSlot = room.slots.find(s => !s.occupied);
    if (!targetSlot) return null;

    const existingNames = new Set(room.members.map(m => m.name));
    const pool = AI_ROSTER_POOL[targetRole];
    const available = pool.filter(c => !existingNames.has(c.name));
    const candidate = available.length > 0
      ? available[Math.floor(Math.random() * available.length)]
      : pool[Math.floor(Math.random() * pool.length)];

    const chosenClass = classId || candidate.classId;
    const chosenSpec = spec || candidate.spec;
    const resolvedRole = getRoleBySpec(chosenClass, chosenSpec);
    const chosenName = (classId || spec)
      ? pickLoreNameForClassSpec(chosenClass, chosenSpec, existingNames)
      : candidate.name;

    targetSlot.role = resolvedRole;

    const aiMember: RoomMember = {
      id: `ai_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: chosenName,
      classId: chosenClass,
      spec: chosenSpec,
      role: resolvedRole,
      isPlayer: false,
      isAi: true,
      isHost: false,
      isReady: true,
      slotIndex: targetSlot.index,
    };

    targetSlot.occupied = true;
    targetSlot.member = aiMember;
    room.members.push(aiMember);

    return aiMember;
  }

  /**
   * Kick member from room (AI or player)
   */
  public kickMember(roomId: string, memberId: string): boolean {
    const room = this.getRoom(roomId);
    if (!room) return false;

    const idx = room.members.findIndex(m => m.id === memberId);
    if (idx === -1) return false;

    const member = room.members[idx];
    if (member.isHost) return false; // Cannot kick host

    const slot = room.slots.find(s => s.index === member.slotIndex);
    if (slot) {
      slot.occupied = false;
      slot.member = undefined;
    }

    room.members.splice(idx, 1);
    this.cleanupAiOnlyRooms();
    return true;
  }

  /**
   * Check whether a member can switch to targetSpec
   */
  public canSelectSpec(
    roomId: string,
    memberId: string,
    targetSpec: string,
    targetClassId?: ClassId
  ): SpecSelectionCheck {
    const room = this.getRoom(roomId);
    if (!room) return { allowed: false, disabled: true, reason: '房间不存在' };

    const member = room.members.find(m => m.id === memberId);
    if (!member) return { allowed: false, disabled: true, reason: '成员不存在' };

    const classId = targetClassId || member.classId;
    const targetRole = getRoleBySpec(classId, targetSpec);
    const currentRole = member.role;

    // Same-role spec switch is always allowed (e.g. Frost Mage -> Fire Mage)
    if (targetRole === currentRole) {
      return { allowed: true, disabled: false };
    }

    // 自定义难度不限制职业/职责数量
    if (isCustomDifficultyRoom(room)) {
      return { allowed: true, disabled: false };
    }

    const quota = this.getQuota(room.dungeonId);

    // Count other members
    let otherTanks = 0;
    let otherHealers = 0;
    let otherDps = 0;

    for (const m of room.members) {
      if (m.id === memberId) continue;
      if (m.role === 'TANK') otherTanks++;
      else if (m.role === 'HEALER') otherHealers++;
      else otherDps++;
    }

    const hypoTanks = otherTanks + (targetRole === 'TANK' ? 1 : 0);
    const hypoHealers = otherHealers + (targetRole === 'HEALER' ? 1 : 0);
    const hypoDps = otherDps + (targetRole === 'DPS' ? 1 : 0);

    if (quota.tier === '5man') {
      if (hypoTanks > quota.roles.TANK.max) {
        return { allowed: false, disabled: true, reason: `坦克人数已满 (上限 ${quota.roles.TANK.max} 名)` };
      }
      if (hypoHealers > quota.roles.HEALER.max) {
        return { allowed: false, disabled: true, reason: `治疗人数已满 (上限 ${quota.roles.HEALER.max} 名)` };
      }
      if (hypoDps > quota.roles.DPS.max) {
        return { allowed: false, disabled: true, reason: `输出人数已满 (上限 ${quota.roles.DPS.max} 名)` };
      }
    } else {
      // 20-man
      if (hypoTanks > quota.roles.TANK.max) {
        return { allowed: false, disabled: true, reason: `坦克人数已满 (上限 ${quota.roles.TANK.max} 名)` };
      }
      if (hypoHealers > quota.roles.HEALER.max) {
        return { allowed: false, disabled: true, reason: `治疗人数已满 (上限 ${quota.roles.HEALER.max} 名)` };
      }
      if (hypoDps > quota.roles.DPS.max) {
        return { allowed: false, disabled: true, reason: `输出人数已满 (上限 ${quota.roles.DPS.max} 名)` };
      }
      if (hypoHealers === 5 && hypoDps > 13) {
        return { allowed: false, disabled: true, reason: '治疗为 5 名时，输出上限为 13 名' };
      }
      if (hypoDps === 14 && hypoHealers > 4) {
        return { allowed: false, disabled: true, reason: '输出为 14 名时，治疗上限为 4 名' };
      }
    }

    return { allowed: true, disabled: false };
  }

  /**
   * Change member's class, spec and role.
   * For AI teammates, automatically updates their lore name to match the newly chosen class/spec.
   * When options.allowOverQuota is true, allows free rearrangement and relies on pre-start validation.
   */
  public changeMemberSpec(
    roomId: string,
    memberId: string,
    newClassId: ClassId,
    newSpec: string,
    options?: { allowOverQuota?: boolean }
  ): boolean {
    if (!options?.allowOverQuota) {
      const check = this.canSelectSpec(roomId, memberId, newSpec, newClassId);
      if (!check.allowed) return false;
    }

    const room = this.getRoom(roomId);
    if (!room) return false;

    const member = room.members.find(m => m.id === memberId);
    if (!member) return false;

    const prevClassId = member.classId;
    const prevSpec = member.spec;
    const newRole = getRoleBySpec(newClassId, newSpec);

    member.classId = newClassId;
    member.spec = newSpec;
    member.role = newRole;

    // Auto-sync AI hero name to match the new class & spec
    if (member.isAi && (newClassId !== prevClassId || newSpec !== prevSpec)) {
      const otherNames = new Set(room.members.filter(m => m.id !== member.id).map(m => m.name));
      member.name = pickLoreNameForClassSpec(newClassId, newSpec, otherNames);
    }

    const slot = room.slots.find(s => s.index === member.slotIndex);
    if (slot) {
      slot.role = newRole;
      slot.member = member;
    }

    return true;
  }

  /**
   * Validate switching to target dungeon
   */
  public validateMapSwitch(roomId: string, targetDungeonId: string): MapSwitchValidation {
    const room = this.getRoom(roomId);
    if (!room) return { canSwitch: false, errors: ['房间不存在'] };
    return validateMapSwitch(room.members, targetDungeonId);
  }

  /**
   * Execute map switch and restructure slots
   */
  public switchMap(roomId: string, targetDungeonId: string): boolean {
    const validation = this.validateMapSwitch(roomId, targetDungeonId);
    if (!validation.canSwitch) return false;

    const room = this.getRoom(roomId);
    if (!room) return false;

    room.dungeonId = targetDungeonId;
    room.difficulty = coerceDungeonDifficulty(targetDungeonId, room.difficulty);
    this.clearHumanReady(room);
    const targetQuota = this.getQuota(targetDungeonId);

    // Reconstruct slots
    const newSlots: RoomSlot[] = [];
    const members = [...room.members];

    // Place existing members in slots
    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      m.slotIndex = i;
      newSlots.push({
        index: i,
        role: m.role,
        occupied: true,
        member: m,
      });
    }

    // Determine missing roles to populate remaining empty slots
    let currentTanks = members.filter(m => m.role === 'TANK').length;
    let currentHealers = members.filter(m => m.role === 'HEALER').length;
    let currentDps = members.filter(m => m.role === 'DPS').length;

    let targetTanks = targetQuota.roles.TANK.min;
    let targetHealers = targetQuota.roles.HEALER.min;
    let targetDps = targetQuota.roles.DPS.min;

    if (targetQuota.tier === '20man') {
      targetTanks = 2;
      targetHealers = currentHealers >= 5 ? 5 : 4;
      targetDps = targetHealers === 5 ? 13 : 14;
    }

    const neededTanks = Math.max(0, targetTanks - currentTanks);
    const neededHealers = Math.max(0, targetHealers - currentHealers);
    const neededDps = Math.max(0, targetDps - currentDps);

    const emptyRoles: RoleId[] = [
      ...Array(neededTanks).fill('TANK' as RoleId),
      ...Array(neededHealers).fill('HEALER' as RoleId),
      ...Array(neededDps).fill('DPS' as RoleId),
    ];

    let slotIdx = members.length;
    for (const r of emptyRoles) {
      if (slotIdx >= targetQuota.capacity) break;
      newSlots.push({
        index: slotIdx++,
        role: r,
        occupied: false,
      });
    }

    // If still under capacity, fill with DPS
    while (slotIdx < targetQuota.capacity) {
      newSlots.push({
        index: slotIdx++,
        role: 'DPS',
        occupied: false,
      });
    }

    room.slots = newSlots;
    return true;
  }

  /**
   * Validate whether the game can start
   */
  public validateStartGame(roomId: string): StartGameValidation {
    const room = this.getRoom(roomId);
    if (!room) {
      return {
        canStart: false,
        reasons: ['房间不存在'],
        isFull: false,
        isRoleCompositionValid: false,
        allReady: false,
      };
    }
    return validateStartGame(room);
  }

  /**
   * Start the game
   */
  public startGame(
    roomId: string,
    operatorId: string
  ): { success: boolean; reason?: string } {
    const room = this.getRoom(roomId);
    if (!room) return { success: false, reason: '房间不存在' };

    if (operatorId !== room.hostId) {
      return { success: false, reason: '只有房主可以开始游戏' };
    }

    // 普通/英雄：开局前自动按默认配额补 AI（也覆盖乐观补齐竞态）。
    // 自定义：允许人数不足开局，不自动补人；房主可手动点「AI 补齐」按默认需求补位。
    if (!isCustomDifficultyRoom(room)) {
      this.autoFillAi(roomId);
      this.normalizeAiReady(roomId);
    }

    const validation = this.validateStartGame(roomId);
    if (!validation.canStart) {
      return { success: false, reason: validation.reasons.join('，') };
    }

    const started = this.getRoom(roomId);
    if (!started) return { success: false, reason: '房间不存在' };
    started.status = 'IN_COMBAT';
    return { success: true };
  }

  /**
   * Join waiting queue
   */
  public joinWaitingQueue(
    roomId: string,
    player: PlayerInfo
  ): { success: boolean; entry?: WaitingQueueEntry; reason?: string } {
    const room = this.getRoom(roomId);
    if (!room) return { success: false, reason: '房间不存在' };

    const role = player.role || getRoleBySpec(player.classId, player.spec);

    // Check if player is already in queue
    const existing = room.waitingQueue.find(e => e.playerId === player.id);
    if (existing) {
      return { success: true, entry: existing };
    }

    const entry: WaitingQueueEntry = {
      id: `queue_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      roomId,
      playerId: player.id,
      playerName: player.name,
      classId: player.classId,
      spec: player.spec,
      role,
      joinedAtMs: Date.now(),
    };

    room.waitingQueue.push(entry);
    return { success: true, entry };
  }

  /**
   * Leave waiting queue
   */
  public leaveWaitingQueue(roomId: string, playerId: string): boolean {
    const room = this.getRoom(roomId);
    if (!room) return false;

    const idx = room.waitingQueue.findIndex(e => e.playerId === playerId);
    if (idx === -1) return false;

    room.waitingQueue.splice(idx, 1);
    return true;
  }

  /**
   * Get waiting queue and live combat boss status
   */
  public getWaitingQueueStatus(roomId: string, playerId?: string): WaitingQueueStatus {
    const room = this.getRoom(roomId);
    if (!room) {
      return { inCombat: false, queuePosition: 0, totalWaiting: 0 };
    }

    const inCombat = room.status === 'IN_COMBAT';
    let bossHpPct: number | undefined;
    if (room.inCombatBossHp !== undefined && room.inCombatBossMaxHp && room.inCombatBossMaxHp > 0) {
      bossHpPct = Math.max(0, Math.min(100, Math.round((room.inCombatBossHp / room.inCombatBossMaxHp) * 100)));
    }

    const queuePosition = playerId ? room.waitingQueue.findIndex(e => e.playerId === playerId) + 1 : 0;

    return {
      inCombat,
      bossName: room.inCombatBossName,
      bossHpPct,
      queuePosition,
      totalWaiting: room.waitingQueue.length,
    };
  }

  /**
   * Update combat boss health/state for waiting queue spectators
   */
  public updateCombatBossState(
    roomId: string,
    bossName: string,
    hp: number,
    maxHp: number,
    bossId?: string
  ): void {
    const room = this.getRoom(roomId);
    if (!room) return;
    room.inCombatBossName = bossName;
    room.inCombatBossHp = hp;
    room.inCombatBossMaxHp = maxHp;
    if (bossId) room.inCombatBossId = bossId;
  }

  /**
   * Apply host-authored combat snapshot onto this room only (isolated; no cross-room writes).
   * Server tracks membership / queue / settlement; dungeon tick stays on the host client.
   */
  public applyHostCombatSnapshot(
    roomId: string,
    snap: {
      runPhase?: string;
      travelRemainingMs?: number;
      currentBossIndex?: number;
      isCleared?: boolean;
      units?: Array<{
        id: string;
        name?: string;
        hp?: number;
        maxHp?: number;
        isBoss?: boolean;
        role?: string;
      }>;
    }
  ): LobbyRoom | undefined {
    const room = this.getRoom(roomId);
    if (!room) return undefined;

    if (snap.runPhase) room.runPhase = snap.runPhase;
    if (typeof snap.travelRemainingMs === 'number') room.travelRemainingMs = snap.travelRemainingMs;
    if (typeof snap.currentBossIndex === 'number') room.currentBossIndex = snap.currentBossIndex;

    const boss =
      (snap.units || []).find((u) => u.isBoss) ||
      (snap.units || []).find((u) => u.role === 'ENEMY' || u.role === 'BOSS');
    if (boss && typeof boss.hp === 'number' && typeof boss.maxHp === 'number') {
      room.inCombatBossId = boss.id;
      room.inCombatBossName = boss.name || room.inCombatBossName;
      room.inCombatBossHp = boss.hp;
      room.inCombatBossMaxHp = boss.maxHp;
    }

    if (snap.runPhase === 'TRAVEL_RECOVERY') {
      room.status = 'OUT_OF_COMBAT';
    } else if (snap.runPhase === 'BOSS_COMBAT' || snap.runPhase === 'WIPE_VOTE') {
      room.status = 'IN_COMBAT';
    } else if (snap.runPhase === 'SUMMARY') {
      room.status = snap.isCleared ? 'CLEARED' : 'CLOSED';
      room.lastSettlement = {
        cleared: !!snap.isCleared,
        currentBossIndex: snap.currentBossIndex ?? room.currentBossIndex ?? 0,
        settledAtMs: Date.now(),
      };
    }

    return room;
  }

  /**
   * Hot-swap waiting players onto AI slots.
   * NORMAL/HEROIC: same-role AI only.
   * CUSTOM: any AI; pick order 同职责优先 → DPS → 奶 → 坦最后.
   * Inherits HP / resources / Buff / position / threat from the replaced AI unit.
   */
  public substituteOutOfCombat(
    roomId: string,
    combatEngine?: CombatEngine,
    _rsm?: RunStateMachine
  ): { substituted: { player: RoomMember; replacedAi: RoomMember; unit?: Unit }[] } {
    const room = this.getRoom(roomId);
    if (!room) return { substituted: [] };

    const substituted: { player: RoomMember; replacedAi: RoomMember; unit?: Unit }[] = [];
    if (room.waitingQueue.length === 0) return { substituted };
    const custom = isCustomDifficultyRoom(room);

    const queueCopy = [...room.waitingQueue];
    for (const queued of queueCopy) {
      const matchingAis = custom
        ? room.members.filter((m) => m.isAi)
        : room.members.filter((m) => m.isAi && m.role === queued.role);
      if (matchingAis.length === 0) continue;

      // Prefer AIs that already exist in the combat engine so HP/buff inherit cannot miss
      const withCombatUnit = combatEngine
        ? matchingAis.filter((m) => !!combatEngine.getUnit(m.id))
        : [];
      const pool = withCombatUnit.length > 0 ? withCombatUnit : matchingAis;
      const replacedAi = custom
        ? pickHotJoinAiReplacement(pool, queued.classId, queued.role) || pool[0]
        : pool[Math.floor(Math.random() * pool.length)];
      if (!replacedAi) continue;

      const newMember: RoomMember = {
        id: queued.playerId,
        name: queued.playerName,
        classId: queued.classId,
        spec: queued.spec,
        role: queued.role,
        isPlayer: true,
        isAi: false,
        isHost: false,
        isReady: true,
        slotIndex: replacedAi.slotIndex,
      };

      const memIdx = room.members.findIndex((m) => m.id === replacedAi.id);
      if (memIdx !== -1) {
        room.members[memIdx] = newMember;
      }

      const slot = room.slots.find((s) => s.index === replacedAi.slotIndex);
      if (slot) {
        slot.member = newMember;
        slot.role = newMember.role;
      }

      let inheritedUnit: Unit | undefined;
      if (combatEngine) {
        inheritedUnit = this.inheritCombatUnitFromAi(combatEngine, replacedAi.id, {
          id: queued.playerId,
          name: queued.playerName,
          classId: queued.classId,
          spec: queued.spec,
          role: queued.role,
        });
      }

      this.leaveWaitingQueue(roomId, queued.playerId);
      substituted.push({ player: newMember, replacedAi, unit: inheritedUnit });
    }

    return { substituted };
  }

  /**
   * Remap an AI combat unit to a human player while keeping HP/Buff/resources/threat.
   * Identity (name/class/spec/role) always becomes the joining player; AI casting stops via isHumanControlled.
   * Seat resolution order:
   * 1) already remapped human at player.id
   * 2) engine unit id === room aiUnitId
   * 3) id-drift seat still keyed by player.id but AI-controlled (MEMBER_REPLACE_AI 未改 id 的旧路径)
   * 4) orphan same-role AI (never steal another human seat)
   */
  public inheritCombatUnitFromAi(
    combatEngine: CombatEngine,
    aiUnitId: string,
    player: { id: string; name: string; classId: ClassId; spec: string; role: RoleId }
  ): Unit | undefined {
    // Already remapped (retry / duplicate MEMBER_HOT_SWAP)
    const existing = combatEngine.getUnit(player.id);
    if (existing && (existing.isHumanControlled || existing.isPlayer)) {
      existing.name = player.name;
      existing.classId = player.classId;
      existing.spec = player.spec;
      existing.role = player.role;
      existing.isPlayer = false;
      existing.isHumanControlled = true;
      delete (existing as { unitKind?: string }).unitKind;
      return existing;
    }

    let old = combatEngine.getUnit(aiUnitId);
    // Id drift: leave kept engine id as player.id — reclaim that seat first (do NOT steal another AI)
    if (!old && existing && !existing.isHumanControlled && !existing.isPlayer && !existing.isPet) {
      old = existing;
    }
    if (!old) {
      const orphans = combatEngine.friendlyUnits.filter(
        (u) =>
          !u.isPlayer &&
          !u.isHumanControlled &&
          !u.isPet &&
          u.role === player.role &&
          u.id !== player.id
      );
      old = orphans.find((u) => u.id === aiUnitId) || orphans[0];
    }
    if (!old) return undefined;

    const oldId = old.id;
    const inherited = combatEngine.remapUnitId(oldId, player.id, {
      name: player.name,
      classId: player.classId,
      spec: player.spec,
      role: player.role,
      isPlayer: false,
      isHumanControlled: true,
    });
    if (!inherited) return undefined;
    // Force re-resolve as PLAYER (stale unitKind:'AI' would keep AI labeling in snapshots)
    delete (inherited as { unitKind?: string }).unitKind;
    if (aiUnitId !== oldId && aiUnitId !== player.id) {
      combatEngine.removeUnit(aiUnitId);
    }
    return inherited;
  }

  /**
   * Set ready state for a human player
   */
  public setPlayerReady(roomId: string, playerId: string, isReady: boolean): boolean {
    const room = this.getRoom(roomId);
    if (!room) return false;

    const member = room.members.find(m => m.id === playerId);
    if (!member || member.isAi) return false;

    member.isReady = isReady;
    return true;
  }

  /** Force every AI seat ready (and not marked as human). */
  public normalizeAiReady(roomId: string): void {
    const room = this.getRoom(roomId);
    if (!room) return;
    for (const m of room.members) {
      if (m.isAi) {
        m.isReady = true;
        m.isPlayer = false;
      }
    }
  }
}

export const roomManager = new RoomManager();
