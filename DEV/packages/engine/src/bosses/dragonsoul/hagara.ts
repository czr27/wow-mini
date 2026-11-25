import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import type { CombatEngine } from '../../engine/CombatEngine.js';
import type { Unit } from '../../types.js';
import { spawnCombatUnit } from '../../engine/UnitSpawn.js';

export const ICE_TOMB_SPELL_ID = 'ice_tomb';
export const ICE_TOMB_ADD_SUMMON = 'hagara_ice_tomb';
export const CONDUCTIVE_CRYSTAL_SUMMON = 'hagara_conductive_crystal';

export type HagaraPhase = 'main' | 'frost' | 'lightning';

export type HagaraAiState = {
  hagaraFightMs?: number;
  hagaraPhase?: HagaraPhase;
  hagaraPhaseAcc?: number;
  hagaraNextSpecial?: 'frost' | 'lightning';
  hagaraRingTickAcc?: number;
  hagaraWaterTickAcc?: number;
  hagaraSpecialAcc?: number;
  skills?: BossSkill[];
  currentCasting?: { skill: BossSkill; elapsedMs: number } | null;
};

function livingFriendlies(engine: CombatEngine): Unit[] {
  return engine.friendlyUnits.filter(u => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0));
}

function clearPhaseAdds(engine: CombatEngine) {
  for (const e of [...engine.enemyUnits]) {
    if (
      e.summonSpellId === ICE_TOMB_ADD_SUMMON ||
      e.summonSpellId === CONDUCTIVE_CRYSTAL_SUMMON
    ) {
      e.hp = 0;
      e.alive = false;
      e.isAlive = false;
    }
  }
  for (const u of engine.friendlyUnits) {
    if (!u.buffs?.length) continue;
    u.buffs = u.buffs.filter(b => b.spellId !== ICE_TOMB_SPELL_ID);
  }
}

function enterFrostPhase(boss: Unit, engine: CombatEngine, ai: HagaraAiState) {
  ai.hagaraPhase = 'frost';
  ai.hagaraPhaseAcc = 25_000;
  ai.hagaraRingTickAcc = 0;
  clearPhaseAdds(engine);

  const living = livingFriendlies(engine);
  const nonTank = living.filter(u => u.role !== 'TANK');
  const pool = nonTank.length >= 2 ? nonTank : living;
  const tombs = [...pool].sort(() => Math.random() - 0.5).slice(0, Math.min(2, pool.length));

  for (const u of tombs) {
    engine.applyBuff(u, {
      id: `ice_tomb_${Date.now()}_${u.id}`,
      spellId: ICE_TOMB_SPELL_ID,
      name: '冰霜之墓',
      kind: 'DEBUFF',
      tags: ['CC', 'STUN', 'DEBUFF'],
      sourceUnitId: boss.id,
      targetUnitId: u.id,
      durationMs: 25_000,
      remainingMs: 25_000,
      stacks: 1,
      maxStacks: 1,
      school: 'FROST',
    });
    const pos = u.position || { x: 300, y: 220 };
    spawnCombatUnit(engine, {
      id: `ice_tomb_add_${u.id}_${Date.now()}`,
      name: `冰墓(${u.name})`,
      unitKind: 'ADD',
      role: 'ENEMY',
      classId: 'NPC',
      hp: living.length >= 15 ? 180_000 : 55_000,
      maxHp: living.length >= 15 ? 180_000 : 55_000,
      position: { x: pos.x + 8, y: pos.y },
      summonSpellId: ICE_TOMB_ADD_SUMMON,
    });
  }

  const bPos = boss.position || { x: 500, y: 200 };
  // 安全环：内圈半径 70，外圈危险
  engine.effectsManager?.addGroundEffect({
    kind: 'DAMAGE_ZONE',
    spellId: 'hagara_ice_ring',
    ownerId: boss.id,
    x: bPos.x,
    y: bPos.y,
    radius: 160,
    colorHex: '#7DD3FC',
    remainingMs: 25_000,
  });

  engine.emitDbmAlert?.({
    title: '冰霜阶段',
    advice: '打破冰墓，躲冰壁垒内圈',
    voiceText: '躲冰壁垒',
    replaceKey: 'hagara_phase',
    severity: 'WARN',
    spellId: 'hagara_frost',
    bossId: boss.id,
    source: 'ENCOUNTER',
  });
  engine.effectsManager?.addFloatingText({
    targetId: boss.id,
    text: '❄️ 冰霜阶段！打破冰墓，站在冰环内圈！',
    category: 'CRIT',
    isCrit: true,
  });
}

function enterLightningPhase(boss: Unit, engine: CombatEngine, ai: HagaraAiState) {
  ai.hagaraPhase = 'lightning';
  ai.hagaraPhaseAcc = 30_000;
  ai.hagaraWaterTickAcc = 0;
  clearPhaseAdds(engine);

  const bPos = boss.position || { x: 500, y: 200 };
  const living = livingFriendlies(engine);
  const crystalHp = living.length >= 15 ? 220_000 : 70_000;
  const offsets = [
    { x: -110, y: -40 },
    { x: 110, y: -40 },
    { x: -70, y: 100 },
    { x: 70, y: 100 },
  ];
  for (let i = 0; i < offsets.length; i++) {
    spawnCombatUnit(engine, {
      id: `crystal_${Date.now()}_${i}`,
      name: `传导水晶 ${i + 1}`,
      unitKind: 'ADD',
      role: 'ENEMY',
      classId: 'NPC',
      hp: crystalHp,
      maxHp: crystalHp,
      position: { x: bPos.x + offsets[i].x, y: bPos.y + offsets[i].y },
      summonSpellId: CONDUCTIVE_CRYSTAL_SUMMON,
    });
  }
  engine.emitDbmAlert?.({
    title: '闪电阶段',
    advice: '连线导雷击杀传导水晶',
    voiceText: '连线导雷',
    replaceKey: 'hagara_phase',
    severity: 'WARN',
    spellId: 'hagara_lightning',
    bossId: boss.id,
    source: 'ENCOUNTER',
  });
  engine.effectsManager?.addFloatingText({
    targetId: boss.id,
    text: '⚡ 闪电阶段！击杀传导水晶结束风暴！',
    category: 'CRIT',
    isCrit: true,
  });
}

function returnToMain(boss: Unit, engine: CombatEngine, ai: HagaraAiState) {
  clearPhaseAdds(engine);
  ai.hagaraPhase = 'main';
  ai.hagaraPhaseAcc = 0;
  ai.hagaraNextSpecial = ai.hagaraNextSpecial === 'frost' ? 'lightning' : 'frost';
  engine.effectsManager?.addFloatingText({
    targetId: boss.id,
    text: '阶段结束，回到主阶段',
    category: 'STATUS',
    isCrit: false,
  });
}

/**
 * 巨龙之魂 4号：缚风者哈甲拉
 * - 主阶段：冰箭齐射 + 集中打击
 * - 冰霜阶段：冰墓（可击破 ADD）+ 冰环边缘伤害
 * - 闪电阶段：传导水晶；水晶存活时水域导电掉血；打光水晶结束阶段
 */
export const HagaraEncounter: BossEncounterModule = {
  id: 'hagara',
  name: '缚风者哈甲拉',
  dungeonId: 'dragon_soul',
  tier: '20man',

  createSkills(bossAi: any): BossSkill[] {
    const ai = bossAi as HagaraAiState;
    return [
      {
        id: 'ice_lance_volley',
        name: '冰枪齐射',
        castTimeMs: 1800,
        cooldownMs: 10_000,
        lastCastMs: -4000,
        interruptible: false,
        school: 'FROST',
        range: 360,
        targetKind: 'AOE',
        description: '主阶段全团冰霜齐射',
        execute: (boss, engine) => {
          if (ai.hagaraPhase && ai.hagaraPhase !== 'main') return;
          for (const u of livingFriendlies(engine)) {
            engine.dealDamage(boss, u, 16_000, 'FROST', false, '冰枪齐射');
          }
        },
      },
      {
        id: 'focused_assault',
        name: '集中打击',
        castTimeMs: 0,
        cooldownMs: 12_000,
        lastCastMs: -3000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 80,
        targetKind: 'MELEE_TARGET',
        description: '主阶段重击主坦',
        execute: (boss, engine) => {
          if (ai.hagaraPhase && ai.hagaraPhase !== 'main') return;
          const tank = livingFriendlies(engine).find(u => u.role === 'TANK');
          if (tank) engine.dealDamage(boss, tank, 36_000, 'PHYSICAL', false, '集中打击');
        },
      },
      {
        id: 'enter_frost_phase',
        name: '冰霜之墓',
        castTimeMs: 2500,
        cooldownMs: 55_000,
        lastCastMs: -45_000,
        interruptible: false,
        school: 'FROST',
        range: 400,
        targetKind: 'AOE',
        description: '进入冰霜阶段：冰墓 + 冰环',
        execute: (boss, engine) => {
          if (ai.hagaraPhase && ai.hagaraPhase !== 'main') return;
          if (ai.hagaraNextSpecial && ai.hagaraNextSpecial !== 'frost') return;
          enterFrostPhase(boss, engine, ai);
        },
      },
      {
        id: 'enter_lightning_phase',
        name: '闪电风暴',
        castTimeMs: 2500,
        cooldownMs: 55_000,
        lastCastMs: -20_000,
        interruptible: false,
        school: 'NATURE',
        range: 400,
        targetKind: 'AOE',
        description: '进入闪电阶段：传导水晶',
        execute: (boss, engine) => {
          if (ai.hagaraPhase && ai.hagaraPhase !== 'main') return;
          if (ai.hagaraNextSpecial === 'frost') return;
          enterLightningPhase(boss, engine, ai);
        },
      },
    ];
  },

  onTick(deltaMs, boss, engine, bossAiRaw) {
    const ai = bossAiRaw as HagaraAiState;
    ai.hagaraFightMs = (ai.hagaraFightMs || 0) + deltaMs;
    if (!ai.hagaraPhase) ai.hagaraPhase = 'main';
    if (!ai.hagaraNextSpecial) ai.hagaraNextSpecial = 'frost';

    // 冰墓被打碎 → 解除对应玩家昏迷
    if (ai.hagaraPhase === 'frost') {
      for (const u of engine.friendlyUnits) {
        const tombBuff = u.buffs?.find(b => b.spellId === ICE_TOMB_SPELL_ID);
        if (!tombBuff) continue;
        const addAlive = engine.enemyUnits.some(
          e =>
            e.summonSpellId === ICE_TOMB_ADD_SUMMON &&
            (e.alive ?? e.isAlive) &&
            (e.hp ?? 0) > 0 &&
            e.id.includes(u.id),
        );
        if (!addAlive) {
          u.buffs = u.buffs.filter(b => b.spellId !== ICE_TOMB_SPELL_ID);
          engine.effectsManager?.addFloatingText({
            targetId: u.id,
            text: '❄️ 冰墓已破！',
            category: 'STATUS',
            isCrit: false,
          });
        }
      }

      // 冰环：距 Boss 70–160 之间持续掉血（贴太近或太远都不安全：简化为 >90 掉血）
      ai.hagaraRingTickAcc = (ai.hagaraRingTickAcc || 0) + deltaMs;
      const bPos = boss.position || { x: 500, y: 200 };
      while ((ai.hagaraRingTickAcc || 0) >= 1000) {
        ai.hagaraRingTickAcc! -= 1000;
        for (const u of livingFriendlies(engine)) {
          if (u.buffs?.some(b => b.spellId === ICE_TOMB_SPELL_ID)) continue;
          const d = dist(u.position || { x: 0, y: 0 }, bPos);
          if (d > 90) {
            engine.dealDamage(boss, u, 12_000, 'FROST', false, '冰环');
          }
        }
      }

      ai.hagaraPhaseAcc = Math.max(0, (ai.hagaraPhaseAcc || 0) - deltaMs);
      const tombsLeft = engine.enemyUnits.filter(
        e => e.summonSpellId === ICE_TOMB_ADD_SUMMON && (e.alive ?? e.isAlive) && (e.hp ?? 0) > 0,
      );
      if (tombsLeft.length === 0 || (ai.hagaraPhaseAcc || 0) <= 0) {
        returnToMain(boss, engine, ai);
      }
    }

    if (ai.hagaraPhase === 'lightning') {
      ai.hagaraWaterTickAcc = (ai.hagaraWaterTickAcc || 0) + deltaMs;
      const crystals = engine.enemyUnits.filter(
        e =>
          e.summonSpellId === CONDUCTIVE_CRYSTAL_SUMMON &&
          (e.alive ?? e.isAlive) &&
          (e.hp ?? 0) > 0,
      );
      while ((ai.hagaraWaterTickAcc || 0) >= 1000) {
        ai.hagaraWaterTickAcc! -= 1000;
        if (crystals.length === 0) break;
        for (const u of livingFriendlies(engine)) {
          engine.dealDamage(boss, u, 10_000, 'NATURE', false, '导电水面');
        }
      }
      ai.hagaraPhaseAcc = Math.max(0, (ai.hagaraPhaseAcc || 0) - deltaMs);
      if (crystals.length === 0 || (ai.hagaraPhaseAcc || 0) <= 0) {
        returnToMain(boss, engine, ai);
      }
    }
  },

  isActionLocked(bossAi: any): boolean {
    const phase = (bossAi as HagaraAiState).hagaraPhase;
    return phase === 'frost' || phase === 'lightning';
  },
};
