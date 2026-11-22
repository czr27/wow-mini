import type { ClassId, RoleId, DungeonDifficulty, Unit } from '../types.js';
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
} from './RoomTypes.js';

// Lore pool for AI teammates
const AI_ROSTER_POOL: {
  TANK: Array<{ name: string; classId: ClassId; spec: string }>;
  HEALER: Array<{ name: string; classId: ClassId; spec: string }>;
  DPS: Array<{ name: string; classId: ClassId; spec: string }>;
} = {
  TANK: [
    { name: '莫格莱尼', classId: 'DK', spec: 'BLOOD' },
    { name: '乌瑟尔', classId: 'DK', spec: 'BLOOD' },
    { name: '萨萨里安', classId: 'DK', spec: 'BLOOD' },
    { name: '穆拉丁', classId: 'DK', spec: 'BLOOD' },
  ],
  HEALER: [
    { name: '玛法里奥', classId: 'DRUID', spec: 'RESTORATION' },
    { name: '先知努波顿', classId: 'SHAMAN', spec: 'RESTORATION' },
    { name: '安度因', classId: 'DRUID', spec: 'RESTORATION' },
    { name: '莉亚德琳', classId: 'SHAMAN', spec: 'RESTORATION' },
    { name: '泰兰德', classId: 'DRUID', spec: 'RESTORATION' },
  ],
  DPS: [
    { name: '吉安娜', classId: 'MAGE', spec: 'FIRE' },
    { name: '瓦莉拉', classId: 'ROGUE', spec: 'COMBAT' },
    { name: '萨尔', classId: 'SHAMAN', spec: 'ELEMENTAL' },
    { name: '卡德加', classId: 'MAGE', spec: 'ARCANE' },
    { name: '萨鲁法尔', classId: 'DK', spec: 'FROST' },
    { name: '肖尔', classId: 'ROGUE', spec: 'ASSASSINATION' },
    { name: '古尔丹之影', classId: 'MAGE', spec: 'FIRE' },
    { name: '威尔弗雷德', classId: 'MAGE', spec: 'FROST' },
    { name: '希尔瓦娜斯', classId: 'ROGUE', spec: 'COMBAT' },
    { name: '雷克萨', classId: 'SHAMAN', spec: 'ELEMENTAL' },
    { name: '本尼迪塔斯', classId: 'MAGE', spec: 'ARCANE' },
    { name: '库尔提拉', classId: 'DK', spec: 'FROST' },
    { name: '瓦里安', classId: 'DK', spec: 'FROST' },
    { name: '伊利丹之魂', classId: 'ROGUE', spec: 'COMBAT' },
    { name: '布莱恩', classId: 'ROGUE', spec: 'ASSASSINATION' },
  ],
};

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
export function validateStartGame(room: LobbyRoom): StartGameValidation {
  const quota = DUNGEON_ROLE_QUOTAS[room.dungeonId] || DUNGEON_ROLE_QUOTAS.shadowfang_keep;
  const reasons: string[] = [];

  let currentTanks = 0;
  let currentHealers = 0;
  let currentDps = 0;

  for (const m of room.members) {
    if (m.role === 'TANK') currentTanks++;
    else if (m.role === 'HEALER') currentHealers++;
    else currentDps++;
  }

  const isFull = room.members.length === quota.capacity;

  if (!isFull) {
    // Calculate deficits against minimums / standard quotas
    const needTanks = Math.max(0, quota.roles.TANK.min - currentTanks);
    const needHealers = Math.max(0, quota.roles.HEALER.min - currentHealers);
    const targetDps = quota.tier === '20man' ? (currentHealers >= 5 ? 13 : 14) : quota.roles.DPS.min;
    const needDps = Math.max(0, targetDps - currentDps);

    if (needTanks > 0) reasons.push(`缺少坦克 ${needTanks} 名`);
    if (needHealers > 0) reasons.push(`缺少治疗 ${needHealers} 名`);
    if (needDps > 0) reasons.push(`缺少输出 ${needDps} 名`);
  }

  // Validate composition
  const isRoleCompositionValid = quota.validCompositions.some(
    c => c.TANK === currentTanks && c.HEALER === currentHealers && c.DPS === currentDps
  );

  if (isFull && !isRoleCompositionValid) {
    reasons.push('队伍分工不符合副本要求');
  }

  // Check all members ready (players must have isReady = true, AI is always ready)
  const allReady = room.members.every(m => m.isReady);
  if (!allReady) {
    reasons.push('有玩家未准备');
  }

  return {
    canStart: isFull && isRoleCompositionValid && allReady,
    reasons,
    isFull,
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
    host: PlayerInfo;
  }): LobbyRoom {
    const dungeonId = options.dungeonId || 'shadowfang_keep';
    const difficulty: DungeonDifficulty = options.difficulty || 'HEROIC';
    const roomId = `room_${this.nextRoomId++}`;

    const hostRole = options.host.role || getRoleBySpec(options.host.classId, options.host.spec);
    const slots = buildDefaultSlots(dungeonId);

    // Find the first slot matching host's role
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

  public listRooms(): LobbyRoom[] {
    return Array.from(this.rooms.values());
  }

  public deleteRoom(roomId: string): boolean {
    return this.rooms.delete(roomId);
  }

  /**
   * One-click AI fill ("一键添加 AI")
   * Accurately fills missing slots to match role quota with isReady = true
   */
  public autoFillAi(roomId: string): { success: boolean; addedCount: number } {
    const room = this.getRoom(roomId);
    if (!room) return { success: false, addedCount: 0 };

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

    return { success: true, addedCount };
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

    let targetSlot = room.slots.find(s => !s.occupied && s.role === targetRole);
    if (!targetSlot) {
      targetSlot = room.slots.find(s => !s.occupied);
      if (targetSlot) targetSlot.role = targetRole;
    }
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

    const aiMember: RoomMember = {
      id: `ai_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: candidate.name,
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
   * Change member's spec and role
   */
  public changeMemberSpec(
    roomId: string,
    memberId: string,
    newClassId: ClassId,
    newSpec: string
  ): boolean {
    const check = this.canSelectSpec(roomId, memberId, newSpec, newClassId);
    if (!check.allowed) return false;

    const room = this.getRoom(roomId);
    if (!room) return false;

    const member = room.members.find(m => m.id === memberId);
    if (!member) return false;

    const newRole = getRoleBySpec(newClassId, newSpec);
    member.classId = newClassId;
    member.spec = newSpec;
    member.role = newRole;

    const slot = room.slots.find(s => s.index === member.slotIndex);
    if (slot) {
      slot.role = newRole;
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

    const validation = this.validateStartGame(roomId);
    if (!validation.canStart) {
      return { success: false, reason: validation.reasons.join('，') };
    }

    room.status = 'IN_COMBAT';
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
   * Substitute waiting players when out of combat.
   * Mid-combat (rsm.phase === 'BOSS_COMBAT'), substitution is prohibited.
   * On out-of-combat event (boss killed or wipe retry -> TRAVEL_RECOVERY),
   * randomly replaces a friendly AI of the same role.
   */
  public substituteOutOfCombat(
    roomId: string,
    combatEngine?: CombatEngine,
    rsm?: RunStateMachine
  ): { substituted: { player: RoomMember; replacedAi: RoomMember }[] } {
    const room = this.getRoom(roomId);
    if (!room) return { substituted: [] };

    // Strict mid-combat check
    if (rsm && rsm.phase === 'BOSS_COMBAT') {
      return { substituted: [] };
    }

    const substituted: { player: RoomMember; replacedAi: RoomMember }[] = [];
    if (room.waitingQueue.length === 0) return { substituted };

    const queueCopy = [...room.waitingQueue];
    for (const queued of queueCopy) {
      // Find matching AI in room
      const matchingAis = room.members.filter(m => m.isAi && m.role === queued.role);
      if (matchingAis.length === 0) continue;

      // Randomly pick one AI of the same role
      const randIdx = Math.floor(Math.random() * matchingAis.length);
      const replacedAi = matchingAis[randIdx];

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

      // Replace in members
      const memIdx = room.members.findIndex(m => m.id === replacedAi.id);
      if (memIdx !== -1) {
        room.members[memIdx] = newMember;
      }

      // Replace in slots
      const slot = room.slots.find(s => s.index === replacedAi.slotIndex);
      if (slot) {
        slot.member = newMember;
        slot.role = newMember.role;
      }

      // If combatEngine is provided, update engine units and reset stats
      if (combatEngine) {
        combatEngine.removeUnit(replacedAi.id);

        const isTank = queued.role === 'TANK';
        const isHealer = queued.role === 'HEALER';
        const hasMana =
          isHealer ||
          queued.classId === 'MAGE' ||
          queued.classId === 'SHAMAN' ||
          (queued.classId === 'DRUID' && queued.role === 'DPS');

        const maxHp = isTank ? 145000 : 105000;
        const maxMp = hasMana ? 95000 : 0;

        const newUnit: Unit = {
          id: queued.playerId,
          name: queued.playerName,
          classId: queued.classId,
          role: queued.role,
          isPlayer: true,
          isAlive: true,
          alive: true,
          hp: maxHp,
          maxHp,
          mp: maxMp,
          maxMp,
          energy: queued.classId === 'ROGUE' ? 100 : 0,
          absorb: 0,
          resources: hasMana
            ? [{ kind: 'MANA', current: maxMp, max: maxMp }]
            : queued.classId === 'ROGUE'
            ? [{ kind: 'ENERGY', current: 100, max: 100 }]
            : queued.classId === 'DK'
            ? [{ kind: 'RUNIC_POWER', current: 0, max: 100 }]
            : [],
          buffs: [],
          threatTable: [],
          position: { x: isTank ? 440 : 180, y: 160 },
          stats: {
            attackPower: 8000,
            spellPower: 8000,
            critChance: 0.25,
            haste: 0.15,
            armor: isTank ? 24000 : 12000,
            spellResist: 0,
            block: 0.15,
            parry: 0.12,
            dodge: 0.10,
            mastery: 0.18,
            versatility: 0.05,
            speed: 1,
          },
        };

        combatEngine.addUnit(newUnit);
      }

      // Remove player from queue
      this.leaveWaitingQueue(roomId, queued.playerId);
      substituted.push({ player: newMember, replacedAi });
    }

    return { substituted };
  }

  /**
   * Set ready state for a human player
   */
  public setPlayerReady(roomId: string, playerId: string, isReady: boolean): boolean {
    const room = this.getRoom(roomId);
    if (!room) return false;

    const member = room.members.find(m => m.id === playerId);
    if (!member) return false;

    member.isReady = isReady;
    return true;
  }
}

export const roomManager = new RoomManager();
