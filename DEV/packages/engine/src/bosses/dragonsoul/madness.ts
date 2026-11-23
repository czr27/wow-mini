import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import type { CombatEngine } from '../../engine/CombatEngine.js';
import type { Unit } from '../../types.js';
import { spawnCombatUnit } from '../../engine/UnitSpawn.js';

export type MadnessLimb = 'arm_left' | 'arm_right' | 'wing_left' | 'wing_right';

export const LIMB_SUMMON = 'madness_limb';
export const ELEMENTIUM_BOLT_SUMMON = 'madness_elementium_bolt';

export type MadnessAiState = {
  madnessFightMs?: number;
  madnessPhase?: 'limbs' | 'torso' | 'enrage';
  madnessLimbIndex?: number;
  madnessLimbOrder?: MadnessLimb[];
  madnessLimbHp?: number;
  madnessCataclysmAt?: number;
  skills?: BossSkill[];
  currentCasting?: { skill: BossSkill; elapsedMs: number } | null;
};

const LIMB_NAMES: Record<MadnessLimb, string> = {
  arm_left: '左臂',
  arm_right: '右臂',
  wing_left: '左翼',
  wing_right: '右翼',
};

function living(engine: CombatEngine): Unit[] {
  return engine.friendlyUnits.filter(u => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

function spawnCurrentLimb(boss: Unit, engine: CombatEngine, ai: MadnessAiState) {
  for (const e of engine.enemyUnits) {
    if (e.summonSpellId === LIMB_SUMMON) {
      e.hp = 0;
      e.alive = false;
      e.isAlive = false;
    }
  }
  const order = ai.madnessLimbOrder || [];
  const idx = ai.madnessLimbIndex || 0;
  if (idx >= order.length) return;
  const limb = order[idx];
  const raid = living(engine).length;
  const hp = raid >= 15 ? 2_500_000 : 800_000;
  ai.madnessLimbHp = hp;
  const bPos = boss.position || { x: 500, y: 200 };
  spawnCombatUnit(engine, {
    id: `limb_${limb}_${Date.now()}`,
    name: `死亡之翼·${LIMB_NAMES[limb]}`,
    unitKind: 'ADD',
    role: 'ENEMY',
    classId: 'NPC',
    hp,
    maxHp: hp,
    position: { x: bPos.x + (idx % 2 === 0 ? -100 : 100), y: bPos.y + 40 },
    summonSpellId: LIMB_SUMMON,
  });
  engine.effectsManager?.addFloatingText({
    targetId: boss.id,
    text: `🦾 平台：摧毁${LIMB_NAMES[limb]}！(${idx + 1}/${order.length})`,
    category: 'CRIT',
    isCrit: true,
  });
}

/**
 * 死亡之翼的疯狂：四肢平台 → 躯干终局 → 大灾变硬狂暴
 */
export const MadnessEncounter: BossEncounterModule = {
  id: 'madness',
  name: '死亡之翼的疯狂',
  dungeonId: 'dragon_soul',
  tier: '20man',

  createSkills(bossAi: any): BossSkill[] {
    const ai = bossAi as MadnessAiState;
    return [
      {
        id: 'elementium_bolt',
        name: '源质箭',
        castTimeMs: 2500,
        cooldownMs: 30_000,
        lastCastMs: -10_000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 400,
        targetKind: 'AOE',
        description: '召唤源质箭；未击杀则落地重创',
        execute: (boss, engine) => {
          const bPos = boss.position || { x: 500, y: 200 };
          const hp = living(engine).length >= 15 ? 180_000 : 55_000;
          spawnCombatUnit(engine, {
            id: `bolt_${Date.now()}`,
            name: '源质箭',
            unitKind: 'ADD',
            role: 'ENEMY',
            classId: 'NPC',
            hp,
            maxHp: hp,
            position: { x: bPos.x, y: bPos.y - 80 },
            summonSpellId: ELEMENTIUM_BOLT_SUMMON,
            despawnAtElapsedMs: (engine.elapsed || 0) + 12_000,
          });
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '☄️ 源质箭！尽快击杀！',
            category: 'STATUS',
            isCrit: true,
          });
        },
      },
      {
        id: 'agonizing_pain',
        name: '剧痛',
        castTimeMs: 0,
        cooldownMs: 12_000,
        lastCastMs: -4000,
        interruptible: false,
        school: 'SHADOW',
        range: 360,
        targetKind: 'AOE',
        description: '平台压力 AOE',
        execute: (boss, engine) => {
          for (const u of living(engine)) {
            engine.dealDamage(boss, u, 11_000, 'SHADOW', false, '剧痛');
          }
        },
      },
      {
        id: 'cataclysm',
        name: '大灾变',
        castTimeMs: 8000,
        cooldownMs: 999_999_999,
        lastCastMs: -999_999_999,
        interruptible: false,
        school: 'FIRE',
        range: 600,
        targetKind: 'AOE',
        description: '硬狂暴灭团',
        execute: (boss, engine) => {
          ai.madnessPhase = 'enrage';
          for (const u of living(engine)) {
            engine.dealDamage(boss, u, 999_999, 'FIRE', true, '大灾变');
          }
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '💥 大灾变！世界终结！',
            category: 'CRIT',
            isCrit: true,
          });
        },
      },
      {
        id: 'torso_assault',
        name: '躯干打击',
        castTimeMs: 0,
        cooldownMs: 10_000,
        lastCastMs: -100_000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 80,
        targetKind: 'MELEE_TARGET',
        description: '躯干阶段坦打',
        execute: (boss, engine) => {
          if (ai.madnessPhase !== 'torso') return;
          const tank = living(engine).find(u => u.role === 'TANK');
          if (tank) engine.dealDamage(boss, tank, 42_000, 'PHYSICAL', false, '躯干打击');
        },
      },
    ];
  },

  onTick(deltaMs, boss, engine, bossAiRaw) {
    const ai = bossAiRaw as MadnessAiState;
    ai.madnessFightMs = (ai.madnessFightMs || 0) + deltaMs;

    if (!ai.madnessPhase) {
      ai.madnessPhase = 'limbs';
      ai.madnessLimbOrder = ['arm_left', 'wing_left', 'arm_right', 'wing_right'];
      ai.madnessLimbIndex = 0;
      // 四肢阶段 Boss 本体近乎不可集火：锁血在 100%
      boss.hp = boss.maxHp;
      spawnCurrentLimb(boss, engine, ai);
    }

    if (ai.madnessPhase === 'limbs') {
      // 锁本体血量
      boss.hp = boss.maxHp;
      const limb = engine.enemyUnits.find(
        e => e.summonSpellId === LIMB_SUMMON && (e.alive ?? e.isAlive) && (e.hp ?? 0) > 0,
      );
      if (!limb) {
        ai.madnessLimbIndex = (ai.madnessLimbIndex || 0) + 1;
        if ((ai.madnessLimbIndex || 0) >= (ai.madnessLimbOrder?.length || 4)) {
          ai.madnessPhase = 'torso';
          ai.madnessCataclysmAt = (ai.madnessFightMs || 0) + 120_000;
          for (const s of ai.skills || []) {
            if (s.id === 'torso_assault') s.lastCastMs = -999_999;
          }
          // 躯干可打：掉到 35%
          boss.hp = Math.round(boss.maxHp * 0.35);
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '💀 四肢尽毁！躯干暴露！120 秒内击杀！',
            category: 'CRIT',
            isCrit: true,
          });
        } else {
          spawnCurrentLimb(boss, engine, ai);
        }
      }
    }

    // 源质箭落地
    for (const e of engine.enemyUnits) {
      if (e.summonSpellId !== ELEMENTIUM_BOLT_SUMMON) continue;
      if ((e as any)._boltLanded) continue;
      const despawn = e.despawnAtElapsedMs;
      if (despawn != null && (engine.elapsed || 0) >= despawn - 50) {
        if ((e.alive ?? e.isAlive) && (e.hp ?? 0) > 0) {
          (e as any)._boltLanded = true;
          for (const u of living(engine)) {
            engine.dealDamage(boss, u, 35_000, 'PHYSICAL', true, '源质箭落地');
          }
        }
      }
    }

    if (ai.madnessPhase === 'torso' && ai.madnessCataclysmAt != null) {
      if ((ai.madnessFightMs || 0) >= ai.madnessCataclysmAt && !ai.currentCasting) {
        const cata = ai.skills?.find(s => s.id === 'cataclysm');
        if (cata) {
          ai.currentCasting = { skill: cata, elapsedMs: 0 };
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '⚠️ 大灾变读条！',
            category: 'CRIT',
            isCrit: true,
          });
        }
      }
    }
  },

  isActionLocked(bossAi: any) {
    return (bossAi as MadnessAiState).madnessPhase === 'enrage';
  },
};
