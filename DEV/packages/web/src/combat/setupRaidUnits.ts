import type {
  CharacterRecord,
  ClassId,
  CombatEngine,
  CustomDifficultySettings,
  DungeonDifficulty,
  LobbyRoom,
  Unit,
} from '@cata-raid-sim/engine';
import {
  LEVEL_80_STATS,
  LEVEL_80_MAX_HASTE,
  createLevel80BaseStats,
  getRoleBySpec,
} from '@cata-raid-sim/engine';
import { ensureDkRunes } from './dkResources.js';

export type SetupRaidUnitsParams = {
  engine: CombatEngine;
  char: CharacterRecord | null;
  tier?: '5man' | '20man';
  diff?: DungeonDifficulty;
  customDiff?: CustomDifficultySettings;
  activeRoom?: LobbyRoom;
};

function hasManaForClassRole(cls: ClassId, role: 'TANK' | 'HEALER' | 'DPS'): boolean {
  if (role === 'HEALER') return true;
  return (
    cls === 'MAGE' ||
    cls === 'SHAMAN' ||
    cls === 'PRIEST' ||
    cls === 'WARLOCK' ||
    cls === 'PALADIN' ||
    (cls === 'DRUID' && role === 'DPS')
  );
}

function getLv80MaxMp(cls: ClassId, role: 'TANK' | 'HEALER' | 'DPS'): number {
  if (!hasManaForClassRole(cls, role)) return 0;
  return role === 'HEALER' ? LEVEL_80_STATS.healerBaseMp : LEVEL_80_STATS.casterBaseMp;
}

function finalizeUnit(
  u: Unit,
  playerHpMult: number,
  playerMpMult: number,
  aiHpMult: number,
  aiMpMult: number
): Unit {
  if (u.isPlayer) {
    u.maxHp = Math.round(u.maxHp * playerHpMult);
    u.hp = u.maxHp;
    if (u.maxMp && u.maxMp > 0) {
      u.maxMp = Math.round(u.maxMp * playerMpMult);
      u.mp = u.maxMp;
    }
  } else {
    u.maxHp = Math.round(u.maxHp * aiHpMult);
    u.hp = u.maxHp;
    if (u.maxMp && u.maxMp > 0) {
      u.maxMp = Math.round(u.maxMp * aiMpMult);
      u.mp = u.maxMp;
    }
  }
  u.resources = [];
  if (u.maxMp && u.maxMp > 0) {
    u.resources.push({ kind: 'MANA', current: u.mp ?? u.maxMp, max: u.maxMp });
  }
  if (u.classId === 'ROGUE') {
    u.energy = u.energy ?? 100;
    u.resources.push({ kind: 'ENERGY', current: u.energy, max: 100 });
  } else if (u.classId === 'WARRIOR' || (u.classId === 'DRUID' && u.role === 'TANK')) {
    u.rage = u.rage ?? 40;
    u.resources.push({ kind: 'RAGE', current: u.rage, max: 100 });
  } else if (u.classId === 'HUNTER') {
    u.focus = u.focus ?? 100;
    u.resources.push({ kind: 'FOCUS', current: u.focus, max: 100 });
  } else if (u.classId === 'DK') {
    // Cata: start at 0 RP; RP comes from spending runes / Horn of Winter
    u.runicPower = u.runicPower ?? 0;
    ensureDkRunes(u);
    u.resources.push({ kind: 'RUNIC_POWER', current: u.runicPower, max: 100 });
  } else if (u.classId === 'PALADIN') {
    u.holyPower = u.holyPower ?? 1;
    u.resources.push({ kind: 'HOLY_POWER', current: u.holyPower, max: 3 });
  }
  return u;
}

/**
 * Reset engine and rebuild the friendly roster for lobby / room start.
 * Returns the party snapshot for React state (caller clears cast/CD UI).
 */
export function setupRaidUnits(params: SetupRaidUnitsParams): Unit[] {
  const {
    engine,
    char,
    tier = '5man',
    diff = 'HEROIC',
    customDiff,
    activeRoom,
  } = params;

  engine.reset();
  engine.difficulty = diff;
  if (customDiff) engine.customDifficulty = customDiff;

  const isCustom = diff === 'CUSTOM';
  const playerHpMult = isCustom ? Math.max(0.1, customDiff?.playerHpCoeff ?? 1.0) : 1.0;
  const playerMpMult = isCustom ? Math.max(0.1, customDiff?.playerMpCoeff ?? 1.0) : 1.0;
  const aiHpMult = isCustom ? Math.max(0.1, customDiff?.aiHpCoeff ?? 1.0) : 1.0;
  const aiMpMult = isCustom ? Math.max(0.1, customDiff?.aiMpCoeff ?? 1.0) : 1.0;

  const applyFinalize = (u: Unit) =>
    finalizeUnit(u, playerHpMult, playerMpMult, aiHpMult, aiMpMult);

  if (activeRoom && activeRoom.members.length > 0) {
    const party: Unit[] = [];
    activeRoom.members.forEach((member, idx) => {
      // Only the local character is isPlayer. Never collapse all humans onto `p1_player`
      // (that Map overwrite dropped the 5th unit when 2+ players joined).
      const isLocalPlayer = !!char && member.id === char.id;
      const assignedClass = member.classId;
      const assignedRole = member.role;
      const assignedName = member.name;
      const isTankMember = assignedRole === 'TANK';
      const isHealerMember = assignedRole === 'HEALER';
      const isRemoteHuman = member.isPlayer && !member.isAi && !isLocalPlayer;

      const nameSeed = assignedName.split('').reduce((acc, c) => acc + c.charCodeAt(0), idx * 37);
      const apJitter = isLocalPlayer || isRemoteHuman ? 0 : ((nameSeed % 11) - 5) * 40;
      const spJitter = isLocalPlayer || isRemoteHuman ? 0 : (((nameSeed >> 2) % 11) - 5) * 40;
      const critJitter = isLocalPlayer || isRemoteHuman ? 0 : (((nameSeed >> 4) % 7) - 3) * 0.01;
      const baseStats = createLevel80BaseStats(assignedRole);
      const maxHp = isTankMember ? LEVEL_80_STATS.tankBaseHp : LEVEL_80_STATS.dpsHealerBaseHp;
      const maxMp = getLv80MaxMp(assignedClass, assignedRole);

      party.push({
        id: member.id,
        name: assignedName,
        classId: assignedClass,
        spec: member.spec,
        role: assignedRole,
        isPlayer: isLocalPlayer,
        isHumanControlled: isLocalPlayer || isRemoteHuman,
        isAlive: true,
        alive: true,
        hp: maxHp,
        maxHp,
        mp: maxMp,
        maxMp,
        energy: assignedClass === 'ROGUE' ? 100 : 0,
        rage: assignedClass === 'WARRIOR' || (assignedClass === 'DRUID' && isTankMember) ? 40 : 0,
        focus: assignedClass === 'HUNTER' ? 100 : 0,
        runicPower: 0,
        holyPower: assignedClass === 'PALADIN' ? 1 : 0,
        absorb: 0,
        resources: [],
        buffs: [],
        threatTable: [],
        position: {
          x: isTankMember ? 440 : (isHealerMember ? 140 : 220),
          y: 160 + (idx % 5) * 20,
        },
        stats: {
          ...baseStats,
          attackPower: Math.round(baseStats.attackPower + apJitter),
          spellPower: Math.round(baseStats.spellPower + spJitter),
          critChance: Math.round((baseStats.critChance + critJitter) * 100) / 100,
          haste: LEVEL_80_MAX_HASTE,
          dodge: isTankMember ? 0.12 : (assignedClass === 'ROGUE' ? 0.08 : 0.05),
        },
      });
    });

    party.forEach(u => engine.addUnit(applyFinalize(u)));
    return [...engine.friendlyUnits];
  }

  const pClass: ClassId = char ? char.classId : 'DK';
  const pRole: 'TANK' | 'HEALER' | 'DPS' = char?.lastSpec
    ? getRoleBySpec(pClass, char.lastSpec)
    : 'TANK';

  if (tier === '20man') {
    const party: Unit[] = [];
    const roster: Array<{
      name: string;
      classId: ClassId;
      role: 'TANK' | 'HEALER' | 'DPS';
      posX: number;
      posY: number;
    }> = [
      { name: '莫格莱尼', classId: 'DK', role: 'TANK', posX: 440, posY: 165 },
      { name: '乌瑟尔', classId: 'PALADIN', role: 'TANK', posX: 440, posY: 195 },
      { name: '瓦莉拉', classId: 'ROGUE', role: 'DPS', posX: 465, posY: 150 },
      { name: '瓦里安', classId: 'WARRIOR', role: 'DPS', posX: 475, posY: 210 },
      { name: '玛法里奥', classId: 'DRUID', role: 'HEALER', posX: 190, posY: 150 },
      { name: '萨萨里安', classId: 'DK', role: 'DPS', posX: 460, posY: 130 },
      { name: '萨鲁法尔', classId: 'WARRIOR', role: 'DPS', posX: 460, posY: 230 },
      { name: '肖尔', classId: 'ROGUE', role: 'DPS', posX: 450, posY: 180 },
      { name: '萨尔', classId: 'SHAMAN', role: 'DPS', posX: 230, posY: 130 },
      { name: '先知努波顿', classId: 'SHAMAN', role: 'HEALER', posX: 190, posY: 220 },
      { name: '吉安娜', classId: 'MAGE', role: 'DPS', posX: 240, posY: 160 },
      { name: '卡德加', classId: 'MAGE', role: 'DPS', posX: 250, posY: 200 },
      { name: '古尔丹之影', classId: 'WARLOCK', role: 'DPS', posX: 260, posY: 140 },
      { name: '威尔弗雷德', classId: 'WARLOCK', role: 'DPS', posX: 270, posY: 230 },
      { name: '安度因', classId: 'PRIEST', role: 'HEALER', posX: 180, posY: 180 },
      { name: '希尔瓦娜斯', classId: 'HUNTER', role: 'DPS', posX: 280, posY: 120 },
      { name: '雷克萨', classId: 'HUNTER', role: 'DPS', posX: 290, posY: 240 },
      { name: '本尼迪塔斯', classId: 'PRIEST', role: 'DPS', posX: 300, posY: 180 },
      { name: '库尔提拉', classId: 'PALADIN', role: 'DPS', posX: 430, posY: 200 },
      { name: '莉亚德琳', classId: 'PALADIN', role: 'HEALER', posX: 200, posY: 250 },
    ];

    let playerSlotIdx = 0;
    if (pRole === 'TANK') {
      playerSlotIdx = 0;
    } else if (pRole === 'HEALER') {
      playerSlotIdx = 4;
    } else {
      playerSlotIdx = 2;
    }

    roster.forEach((member, idx) => {
      const isPlayer = idx === playerSlotIdx;
      const assignedClass = isPlayer ? pClass : member.classId;
      const assignedRole = isPlayer ? pRole : member.role;
      const assignedName = isPlayer ? (char ? char.name : '勇士') : member.name;
      const isTankMember = assignedRole === 'TANK';

      const nameSeed = assignedName.split('').reduce((acc, c) => acc + c.charCodeAt(0), idx * 37);
      const apJitter = isPlayer ? 0 : ((nameSeed % 11) - 5) * 40;
      const spJitter = isPlayer ? 0 : (((nameSeed >> 2) % 11) - 5) * 40;
      const critJitter = isPlayer ? 0 : (((nameSeed >> 4) % 7) - 3) * 0.01;
      const baseStats = createLevel80BaseStats(assignedRole);
      const maxHp = isTankMember ? LEVEL_80_STATS.tankBaseHp : LEVEL_80_STATS.dpsHealerBaseHp;
      const maxMp = getLv80MaxMp(assignedClass, assignedRole);

      party.push({
        id: isPlayer ? 'p1_player' : `ai_raid_${idx + 1}`,
        name: assignedName,
        classId: assignedClass,
        role: assignedRole,
        isPlayer,
        isAlive: true,
        alive: true,
        hp: maxHp,
        maxHp,
        mp: maxMp,
        maxMp,
        energy: assignedClass === 'ROGUE' ? 100 : 0,
        rage: assignedClass === 'WARRIOR' || (assignedClass === 'DRUID' && isTankMember) ? 40 : 0,
        focus: assignedClass === 'HUNTER' ? 100 : 0,
        runicPower: 0,
        holyPower: assignedClass === 'PALADIN' ? 1 : 0,
        absorb: 0,
        resources: [],
        buffs: [],
        threatTable: [],
        position: { x: member.posX, y: member.posY },
        stats: {
          ...baseStats,
          attackPower: Math.round(baseStats.attackPower + apJitter),
          spellPower: Math.round(baseStats.spellPower + spJitter),
          critChance: Math.round((baseStats.critChance + critJitter) * 100) / 100,
          haste: LEVEL_80_MAX_HASTE,
        },
      });
    });

    if (pClass === 'DK' || pClass === 'MAGE' || pClass === 'HUNTER' || pClass === 'WARLOCK') {
      const petName =
        pClass === 'DK' ? '食尸鬼' :
        pClass === 'MAGE' ? '水元素' :
        pClass === 'HUNTER' ? '幽灵狼' : '恶魔卫士';
      party.push({
        id: 'player_pet',
        name: petName,
        classId: 'NPC',
        role: 'DPS',
        isPlayer: false,
        isPet: true,
        ownerId: 'p1_player',
        isAlive: true,
        alive: true,
        hp: LEVEL_80_STATS.petBaseHp,
        maxHp: LEVEL_80_STATS.petBaseHp,
        absorb: 0,
        resources: [],
        buffs: [],
        threatTable: [],
        position: { x: 220, y: 160 },
        stats: {
          ...createLevel80BaseStats('DPS'),
          attackPower: 2600,
          spellPower: 2400,
          haste: LEVEL_80_MAX_HASTE,
        },
      });
    }

    for (const u of party) {
      applyFinalize(u);
      engine.addUnit(u);
    }
    return party;
  }

  const playerBaseStats = createLevel80BaseStats(pRole);
  const playerMaxHp = pRole === 'TANK' ? LEVEL_80_STATS.tankBaseHp : LEVEL_80_STATS.dpsHealerBaseHp;
  const playerMaxMp = getLv80MaxMp(pClass, pRole);

  const party: Unit[] = [
    {
      id: 'p1_player',
      name: char ? char.name : '勇士',
      classId: pClass,
      role: pRole,
      isPlayer: true,
      isAlive: true,
      alive: true,
      hp: playerMaxHp,
      maxHp: playerMaxHp,
      mp: playerMaxMp,
      maxMp: playerMaxMp,
      energy: pClass === 'ROGUE' ? 100 : 0,
      rage: pClass === 'WARRIOR' || (pClass === 'DRUID' && pRole === 'TANK') ? 40 : 0,
      focus: pClass === 'HUNTER' ? 100 : 0,
      runicPower: 0,
      holyPower: pClass === 'PALADIN' ? 1 : 0,
      absorb: 0,
      resources: [],
      buffs: [],
      threatTable: [],
      position: { x: pRole === 'TANK' ? 440 : 220, y: 180 },
      stats: {
        ...playerBaseStats,
        haste: LEVEL_80_MAX_HASTE,
      },
    },
  ];

  const TANK_POOL: Array<{ name: string; classId: ClassId }> = [
    { name: '瓦里安', classId: 'WARRIOR' },
    { name: '乌瑟尔', classId: 'PALADIN' },
    { name: '莫格莱尼', classId: 'DK' },
    { name: '布罗尔·熊皮', classId: 'DRUID' },
  ];
  const HEALER_POOL: Array<{ name: string; classId: ClassId }> = [
    { name: '先知努波顿', classId: 'SHAMAN' },
    { name: '安度因', classId: 'PRIEST' },
    { name: '玛法里奥', classId: 'DRUID' },
    { name: '莉亚德琳', classId: 'PALADIN' },
  ];
  const DPS_POOL: Array<{ name: string; classId: ClassId }> = [
    { name: '吉安娜', classId: 'MAGE' },
    { name: '希尔瓦娜斯', classId: 'HUNTER' },
    { name: '古尔丹之影', classId: 'WARLOCK' },
    { name: '瓦莉拉', classId: 'ROGUE' },
    { name: '萨尔', classId: 'SHAMAN' },
    { name: '萨鲁法尔', classId: 'WARRIOR' },
    { name: '本尼迪塔斯', classId: 'PRIEST' },
  ];

  const usedClasses = new Set<ClassId>([pClass]);
  const pickDistinct = (pool: Array<{ name: string; classId: ClassId }>) => {
    const found = pool.find(m => !usedClasses.has(m.classId)) || pool[0];
    usedClasses.add(found.classId);
    return found;
  };

  const aiTank = pRole === 'TANK' ? null : pickDistinct(TANK_POOL);
  const aiHealer = pRole === 'HEALER' ? null : pickDistinct(HEALER_POOL);
  const neededDps = pRole === 'DPS' ? 2 : 3;
  const aiDpsList: Array<{ name: string; classId: ClassId }> = [];
  for (let i = 0; i < neededDps; i++) {
    aiDpsList.push(pickDistinct(DPS_POOL));
  }

  if (aiTank) {
    const tMaxMp = getLv80MaxMp(aiTank.classId, 'TANK');
    party.push({
      id: 'ai_tank',
      name: aiTank.name,
      classId: aiTank.classId,
      role: 'TANK',
      isPlayer: false,
      isAlive: true,
      alive: true,
      hp: LEVEL_80_STATS.tankBaseHp,
      maxHp: LEVEL_80_STATS.tankBaseHp,
      mp: tMaxMp,
      maxMp: tMaxMp,
      rage: aiTank.classId === 'WARRIOR' || aiTank.classId === 'DRUID' ? 40 : 0,
      runicPower: 0,
      holyPower: aiTank.classId === 'PALADIN' ? 1 : 0,
      absorb: 0,
      resources: [],
      buffs: [],
      threatTable: [],
      position: { x: 440, y: 180 },
      stats: {
        ...createLevel80BaseStats('TANK'),
        haste: LEVEL_80_MAX_HASTE,
      },
    });
  }

  if (aiHealer) {
    party.push({
      id: 'ai_healer',
      name: aiHealer.name,
      classId: aiHealer.classId,
      role: 'HEALER',
      isPlayer: false,
      isAlive: true,
      alive: true,
      hp: LEVEL_80_STATS.dpsHealerBaseHp,
      maxHp: LEVEL_80_STATS.dpsHealerBaseHp,
      mp: LEVEL_80_STATS.healerBaseMp,
      maxMp: LEVEL_80_STATS.healerBaseMp,
      holyPower: aiHealer.classId === 'PALADIN' ? 1 : 0,
      absorb: 0,
      resources: [],
      buffs: [],
      threatTable: [],
      position: { x: 200, y: 200 },
      stats: {
        ...createLevel80BaseStats('HEALER'),
        haste: LEVEL_80_MAX_HASTE,
      },
    });
  }

  aiDpsList.forEach((dps, idx) => {
    const nameSeed = dps.name.split('').reduce((acc, c) => acc + c.charCodeAt(0), idx * 41);
    const apJitter = ((nameSeed % 9) - 4) * 45;
    const spJitter = (((nameSeed >> 2) % 9) - 4) * 45;
    const critJitter = (((nameSeed >> 4) % 7) - 3) * 0.01;
    const baseStats = createLevel80BaseStats('DPS');
    const dMaxMp = getLv80MaxMp(dps.classId, 'DPS');

    party.push({
      id: `ai_dps_${idx + 1}`,
      name: dps.name,
      classId: dps.classId,
      role: 'DPS',
      isPlayer: false,
      isAlive: true,
      alive: true,
      hp: LEVEL_80_STATS.dpsHealerBaseHp,
      maxHp: LEVEL_80_STATS.dpsHealerBaseHp,
      mp: dMaxMp,
      maxMp: dMaxMp,
      energy: dps.classId === 'ROGUE' ? 100 : 0,
      rage: dps.classId === 'WARRIOR' ? 40 : 0,
      focus: dps.classId === 'HUNTER' ? 100 : 0,
      runicPower: 0,
      holyPower: dps.classId === 'PALADIN' ? 1 : 0,
      absorb: 0,
      resources: [],
      buffs: [],
      threatTable: [],
      position: { x: 230 + idx * 30, y: 140 + idx * 30 },
      stats: {
        ...baseStats,
        attackPower: Math.round(baseStats.attackPower + apJitter),
        spellPower: Math.round(baseStats.spellPower + spJitter),
        critChance: Math.round((baseStats.critChance + critJitter) * 100) / 100,
        haste: LEVEL_80_MAX_HASTE,
      },
    });
  });

  if (pClass === 'DK' || pClass === 'MAGE' || pClass === 'HUNTER' || pClass === 'WARLOCK') {
    const petName =
      pClass === 'DK' ? '食尸鬼' :
      pClass === 'MAGE' ? '水元素' :
      pClass === 'HUNTER' ? '幽灵狼' : '恶魔卫士';
    party.push({
      id: 'player_pet',
      name: petName,
      classId: 'NPC',
      role: 'DPS',
      isPlayer: false,
      isPet: true,
      ownerId: 'p1_player',
      isAlive: true,
      alive: true,
      hp: LEVEL_80_STATS.petBaseHp,
      maxHp: LEVEL_80_STATS.petBaseHp,
      absorb: 0,
      resources: [],
      buffs: [],
      threatTable: [],
      position: { x: (pRole === 'TANK' ? 440 : 180) - 20, y: 180 },
      stats: {
        ...createLevel80BaseStats('DPS'),
        attackPower: 2600,
        spellPower: 2400,
        haste: LEVEL_80_MAX_HASTE,
      },
    });
  }

  for (const u of party) {
    applyFinalize(u);
    engine.addUnit(u);
  }
  return party;
}
