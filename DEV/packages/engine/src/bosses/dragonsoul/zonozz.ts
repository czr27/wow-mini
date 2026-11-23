import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import type { CombatEngine } from '../../engine/CombatEngine.js';
import type { Unit } from '../../types.js';
import { spawnCombatUnit } from '../../engine/UnitSpawn.js';

export const DISRUPTING_SHADOWS_ID = 'disrupting_shadows';
export const VOID_TENTACLE_SUMMON = 'zonozz_void_tentacle';
export const FOCUSED_ANGER_ID = 'focused_anger';

export type ZonozzAiState = {
  zonozzFightMs?: number;
  zonozzPhase?: 'main' | 'void';
  zonozzPhaseAcc?: number;
  zonozzBallCarrierId?: string;
  zonozzBallResolveAt?: number;
  zonozzAngerStacks?: number;
  skills?: BossSkill[];
};

function living(engine: CombatEngine): Unit[] {
  return engine.friendlyUnits.filter(u => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

function dist(a: { x?: number; y?: number }, b: { x?: number; y?: number }) {
  return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0));
}

/**
 * 督军佐诺兹：黑光传球撞 Boss 叠易伤；虚空阶段清触须
 */
export const ZonozzEncounter: BossEncounterModule = {
  id: 'zonozz',
  name: '督军佐诺兹',
  dungeonId: 'dragon_soul',
  tier: '20man',

  createSkills(bossAi: any): BossSkill[] {
    const ai = bossAi as ZonozzAiState;
    return [
      {
        id: 'psychic_drain',
        name: '心灵汲取',
        castTimeMs: 2000,
        cooldownMs: 14_000,
        lastCastMs: -5000,
        interruptible: true,
        school: 'SHADOW',
        range: 360,
        targetKind: 'AOE',
        description: '主阶段全团暗影压力',
        execute: (boss, engine) => {
          if (ai.zonozzPhase === 'void') return;
          for (const u of living(engine)) {
            engine.dealDamage(boss, u, 14_000, 'SHADOW', false, '心灵汲取');
          }
        },
      },
      {
        id: 'disrupting_shadows',
        name: '干扰之影',
        castTimeMs: 0,
        cooldownMs: 18_000,
        lastCastMs: -8000,
        interruptible: false,
        school: 'SHADOW',
        range: 320,
        targetKind: 'RANGED_TARGET',
        description: '点名后排暗影 DoT（可驱散）',
        execute: (boss, engine) => {
          if (ai.zonozzPhase === 'void') return;
          const pool = living(engine).filter(u => u.role !== 'TANK');
          const t = pool[Math.floor(Math.random() * Math.max(1, pool.length))];
          if (!t) return;
          engine.applyBuff(t, {
            id: `ds_${Date.now()}_${t.id}`,
            spellId: DISRUPTING_SHADOWS_ID,
            name: '干扰之影',
            kind: 'DEBUFF',
            tags: ['DOT', 'DEBUFF'],
            sourceUnitId: boss.id,
            targetUnitId: t.id,
            durationMs: 12_000,
            remainingMs: 12_000,
            stacks: 1,
            maxStacks: 1,
            school: 'SHADOW',
            tickIntervalMs: 2000,
            tickValue: 4500,
          });
        },
      },
      {
        id: 'black_blood_ball',
        name: '黑光球',
        castTimeMs: 1500,
        cooldownMs: 28_000,
        lastCastMs: -10_000,
        interruptible: false,
        school: 'SHADOW',
        range: 400,
        targetKind: 'AOE',
        description: '传球：持球者靠近 Boss 撞上叠易伤；失败则全团重创',
        execute: (boss, engine) => {
          if (ai.zonozzPhase === 'void') return;
          const carriers = living(engine).filter(u => u.role === 'DPS' || u.role === 'HEALER');
          const carrier = carriers[Math.floor(Math.random() * Math.max(1, carriers.length))] || living(engine)[0];
          if (!carrier) return;
          ai.zonozzBallCarrierId = carrier.id;
          ai.zonozzBallResolveAt = (ai.zonozzFightMs || 0) + 8000;
          engine.effectsManager?.addFloatingText({
            targetId: carrier.id,
            text: '⚫ 黑光球！靠近 Boss 传球撞击！',
            category: 'STATUS',
            isCrit: true,
          });
        },
      },
      {
        id: 'void_diffusion',
        name: '虚空扩散',
        castTimeMs: 3000,
        cooldownMs: 55_000,
        lastCastMs: -40_000,
        interruptible: false,
        school: 'SHADOW',
        range: 400,
        targetKind: 'AOE',
        description: '进入虚空阶段，召唤触须；清完回主阶段',
        execute: (boss, engine) => {
          ai.zonozzPhase = 'void';
          ai.zonozzPhaseAcc = 30_000;
          const n = living(engine).length >= 15 ? 6 : 3;
          const bPos = boss.position || { x: 500, y: 200 };
          for (let i = 0; i < n; i++) {
            spawnCombatUnit(engine, {
              id: `tentacle_${Date.now()}_${i}`,
              name: `虚空触须 ${i + 1}`,
              unitKind: 'ADD',
              role: 'ENEMY',
              classId: 'NPC',
              hp: living(engine).length >= 15 ? 160_000 : 50_000,
              maxHp: living(engine).length >= 15 ? 160_000 : 50_000,
              position: {
                x: bPos.x + (i % 3) * 60 - 60,
                y: bPos.y + Math.floor(i / 3) * 50 + 40,
              },
              summonSpellId: VOID_TENTACLE_SUMMON,
            });
          }
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '🌑 虚空阶段！清触须！',
            category: 'CRIT',
            isCrit: true,
          });
        },
      },
    ];
  },

  onTick(deltaMs, boss, engine, bossAiRaw) {
    const ai = bossAiRaw as ZonozzAiState;
    ai.zonozzFightMs = (ai.zonozzFightMs || 0) + deltaMs;
    if (!ai.zonozzPhase) ai.zonozzPhase = 'main';

    // 黑光球结算
    if (ai.zonozzBallCarrierId && ai.zonozzBallResolveAt != null) {
      if ((ai.zonozzFightMs || 0) >= ai.zonozzBallResolveAt) {
        const carrier = living(engine).find(u => u.id === ai.zonozzBallCarrierId);
        const near =
          carrier && dist(carrier.position || {}, boss.position || {}) <= 100;
        if (near) {
          ai.zonozzAngerStacks = (ai.zonozzAngerStacks || 0) + 1;
          const stacks = ai.zonozzAngerStacks;
          const existing = boss.buffs?.find(b => b.spellId === FOCUSED_ANGER_ID);
          if (existing) {
            existing.stacks = stacks;
            existing.remainingMs = 60_000;
          } else {
            engine.applyBuff(boss, {
              id: `anger_${Date.now()}`,
              spellId: FOCUSED_ANGER_ID,
              name: `专注愤怒 (${stacks})`,
              kind: 'DEBUFF',
              tags: ['DEBUFF'],
              sourceUnitId: carrier!.id,
              targetUnitId: boss.id,
              durationMs: 60_000,
              remainingMs: 60_000,
              stacks,
              maxStacks: 99,
              school: 'SHADOW',
            });
          }
          // 易伤窗口：额外打 Boss 一下表现爆发
          engine.dealDamage(carrier!, boss, 80_000 * stacks, 'SHADOW', true, '黑光撞击');
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: `💥 黑光撞击！易伤 ${stacks} 层！`,
            category: 'CRIT',
            isCrit: true,
          });
        } else {
          for (const u of living(engine)) {
            engine.dealDamage(boss, u, 28_000, 'SHADOW', true, '黑光失败');
          }
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '💀 黑光未撞上 Boss！',
            category: 'CRIT',
            isCrit: true,
          });
        }
        ai.zonozzBallCarrierId = undefined;
        ai.zonozzBallResolveAt = undefined;
      }
    }

    if (ai.zonozzPhase === 'void') {
      ai.zonozzPhaseAcc = Math.max(0, (ai.zonozzPhaseAcc || 0) - deltaMs);
      const tents = engine.enemyUnits.filter(
        e => e.summonSpellId === VOID_TENTACLE_SUMMON && (e.alive ?? e.isAlive) && (e.hp ?? 0) > 0,
      );
      // 触须存活时轻微打团
      if (tents.length > 0 && Math.floor((ai.zonozzFightMs || 0) / 1000) !== Math.floor(((ai.zonozzFightMs || 0) - deltaMs) / 1000)) {
        for (const u of living(engine)) {
          engine.dealDamage(boss, u, 6000, 'SHADOW', false, '虚空地带');
        }
      }
      if (tents.length === 0 || (ai.zonozzPhaseAcc || 0) <= 0) {
        for (const t of tents) {
          t.hp = 0;
          t.alive = false;
          t.isAlive = false;
        }
        ai.zonozzPhase = 'main';
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
          text: '虚空消退，继续传球！',
          category: 'STATUS',
          isCrit: false,
        });
      }
    }
  },

  isActionLocked(bossAi: any) {
    return (bossAi as ZonozzAiState).zonozzPhase === 'void';
  },
};
