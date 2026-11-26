import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import type { CombatEngine } from '../../engine/CombatEngine.js';
import type { Unit } from '../../types.js';
import { spawnCombatUnit } from '../../engine/UnitSpawn.js';
import { pickWeightedBossTarget } from '../core/BossTargetPicker.js';

export const VAPOR_SUMMON = 'ripsnarl_vapor';

export type RipsnarlAiState = {
  ripFightMs?: number;
  ripPhase?: 'deck' | 'fog';
  ripFogAcc?: number;
  ripVaporAcc?: number;
  skills?: BossSkill[];
};

function living(engine: CombatEngine): Unit[] {
  return engine.friendlyUnits.filter(u => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

export const RipsnarlEncounter: BossEncounterModule = {
  id: 'ripsnarl',
  name: '撕心船长利普斯纳尔',
  dungeonId: 'deadmines',
  tier: '5man',

  createSkills(bossAi: any): BossSkill[] {
    const ai = bossAi as RipsnarlAiState;
    return [
      {
        id: 'ripsnarl_strike',
        name: '撕心打击',
        castTimeMs: 0,
        cooldownMs: 10_000,
        lastCastMs: -3000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 80,
        targetKind: 'MELEE_TARGET',
        description: '甲板阶段坦打',
        execute: (boss, engine) => {
          const tank = living(engine).find(u => u.role === 'TANK');
          if (tank) engine.dealDamage(boss, tank, 28_000, 'PHYSICAL', false, '撕心打击');
        },
      },
      {
        id: 'go_for_throat',
        name: '撕喉冲锋',
        castTimeMs: 1200,
        cooldownMs: 16_000,
        lastCastMs: -6000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 320,
        targetKind: 'RANGED_TARGET',
        description: '冲锋后排并造成恐惧短控',
        execute: (boss, engine) => {
          const pool = living(engine).filter(u => u.role !== 'TANK');
          const t = pickWeightedBossTarget(pool);
          if (!t) return;
          engine.dealDamage(boss, t, 18_000, 'PHYSICAL', false, '撕喉冲锋');
          engine.applyBuff(t, {
            id: `fear_${Date.now()}`,
            spellId: 'ripsnarl_fear',
            name: '恐惧',
            kind: 'DEBUFF',
            tags: ['STUN', 'DEBUFF'],
            moveSpeedMod: 0,
            sourceUnitId: boss.id,
            targetUnitId: t.id,
            durationMs: 2500,
            remainingMs: 2500,
            stacks: 1,
            maxStacks: 1,
            school: 'SHADOW',
          });
        },
      },
      {
        id: 'swirling_vapors',
        name: '迷雾降临',
        castTimeMs: 2000,
        cooldownMs: 45_000,
        lastCastMs: -35_000,
        interruptible: false,
        school: 'SHADOW',
        range: 400,
        targetKind: 'AOE',
        description: '进入迷雾：优先点杀蒸汽',
        execute: (boss, engine) => {
          ai.ripPhase = 'fog';
          ai.ripFogAcc = 20_000;
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '🌫️ 迷雾！优先点杀蒸汽！',
            category: 'CRIT',
            isCrit: true,
          });
        },
      },
    ];
  },

  onTick(deltaMs, boss, engine, bossAiRaw) {
    const ai = bossAiRaw as RipsnarlAiState;
    ai.ripFightMs = (ai.ripFightMs || 0) + deltaMs;
    if (!ai.ripPhase) ai.ripPhase = 'deck';

    if (ai.ripPhase === 'fog') {
      ai.ripFogAcc = Math.max(0, (ai.ripFogAcc || 0) - deltaMs);
      ai.ripVaporAcc = (ai.ripVaporAcc || 0) + deltaMs;
      if ((ai.ripVaporAcc || 0) >= 5000) {
        ai.ripVaporAcc = 0;
        const bPos = boss.position || { x: 500, y: 200 };
        const existing = engine.enemyUnits.filter(
          e => e.summonSpellId === VAPOR_SUMMON && (e.alive ?? e.isAlive) && (e.hp ?? 0) > 0,
        );
        if (existing.length < 4) {
          spawnCombatUnit(engine, {
            id: `vapor_${Date.now()}`,
            name: '蒸汽',
            unitKind: 'ADD',
            role: 'ENEMY',
            classId: 'NPC',
            hp: 35_000,
            maxHp: 35_000,
            position: {
              x: bPos.x + (Math.random() - 0.5) * 160,
              y: bPos.y + (Math.random() - 0.5) * 100,
            },
            summonSpellId: VAPOR_SUMMON,
          });
        }
      }

      // 蒸汽长大：存活越久对团伤越高
      if (Math.floor((ai.ripFightMs || 0) / 1000) !== Math.floor(((ai.ripFightMs || 0) - deltaMs) / 1000)) {
        const vapors = engine.enemyUnits.filter(
          e => e.summonSpellId === VAPOR_SUMMON && (e.alive ?? e.isAlive) && (e.hp ?? 0) > 0,
        );
        for (const v of vapors) {
          const ageStacks = Math.min(5, Math.floor(((v as any)._vaporAge || 0) / 3) + 1);
          (v as any)._vaporAge = ((v as any)._vaporAge || 0) + 1;
          const dmg = 4000 * ageStacks;
          for (const u of living(engine)) {
            engine.dealDamage(boss, u, dmg, 'SHADOW', false, '蒸汽压迫');
          }
        }
      }

      if ((ai.ripFogAcc || 0) <= 0) {
        ai.ripPhase = 'deck';
        for (const e of engine.enemyUnits) {
          if (e.summonSpellId === VAPOR_SUMMON) {
            e.hp = 0;
            e.alive = false;
            e.isAlive = false;
          }
        }
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
          text: '迷雾散去',
          category: 'STATUS',
          isCrit: false,
        });
      }
    }
  },

  isActionLocked(bossAi: any) {
    return (bossAi as RipsnarlAiState).ripPhase === 'fog';
  },
};
