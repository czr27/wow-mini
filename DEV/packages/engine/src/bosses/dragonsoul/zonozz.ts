import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import type { CombatEngine } from '../../engine/CombatEngine.js';
import type { Unit } from '../../types.js';
import { spawnCombatUnit } from '../../engine/UnitSpawn.js';
import { pickWeightedBossTarget } from '../core/BossTargetPicker.js';

export const DISRUPTING_SHADOWS_ID = 'disrupting_shadows';
export const VOID_TENTACLE_SUMMON = 'zonozz_void_tentacle';
export const FOCUSED_ANGER_ID = 'focused_anger';
export const BLACK_BLOOD_CARRIER_ID = 'black_blood_ball_carrier';
export const ZONOZZ_BALL_TARGET_GROUND_ID = 'zonozz_ball_target';

const ZONOZZ_BALL_DURATION_MS = 8000;
const ZONOZZ_BALL_EARLY_COLLIDE_MS = 1500;
const ZONOZZ_BALL_HIT_RADIUS = 100;

export type ZonozzAiState = {
  zonozzFightMs?: number;
  zonozzPhase?: 'main' | 'void';
  zonozzPhaseAcc?: number;
  zonozzBallCarrierId?: string;
  zonozzBallSpawnedAt?: number;
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
          const t = pickWeightedBossTarget(pool);
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
        dbm: {
          advice: '分摊撞球传回Boss',
          voiceText: '分摊撞球',
          severity: 'WARN',
        },
        execute: (boss, engine) => {
          if (ai.zonozzPhase === 'void') return;
          const carriers = living(engine).filter(u => u.role === 'DPS' || u.role === 'HEALER');
          const carrier = pickWeightedBossTarget(carriers) || pickWeightedBossTarget(living(engine));
          if (!carrier) return;
          const nowFight = ai.zonozzFightMs || 0;
          ai.zonozzBallCarrierId = carrier.id;
          ai.zonozzBallSpawnedAt = nowFight;
          ai.zonozzBallResolveAt = nowFight + ZONOZZ_BALL_DURATION_MS;

          // Clear any leftover ball carrier buffs / boss target rings
          for (const u of engine.friendlyUnits) {
            if (u.buffs?.length) {
              u.buffs = u.buffs.filter(b => b.spellId !== BLACK_BLOOD_CARRIER_ID);
            }
          }
          if (engine.effectsManager?.groundEffects) {
            engine.effectsManager.groundEffects = engine.effectsManager.groundEffects.filter(
              g => g.spellId !== ZONOZZ_BALL_TARGET_GROUND_ID,
            );
          }

          // Visible carrier buff (syncs to guests + shows in HUD + canvas orb)
          engine.applyBuff(carrier, {
            id: `bbb_${Date.now()}_${carrier.id}`,
            spellId: BLACK_BLOOD_CARRIER_ID,
            name: '⚫ 黑光球 (靠近Boss撞击)',
            kind: 'DEBUFF',
            tags: ['DEBUFF'],
            sourceUnitId: boss.id,
            targetUnitId: carrier.id,
            durationMs: ZONOZZ_BALL_DURATION_MS,
            remainingMs: ZONOZZ_BALL_DURATION_MS,
            stacks: 1,
            maxStacks: 1,
            school: 'SHADOW',
          });

          // Visible 100px target ring around Boss (syncs to guests)
          const bPos = boss.position || { x: 500, y: 200 };
          engine.effectsManager?.addGroundEffect({
            id: `${ZONOZZ_BALL_TARGET_GROUND_ID}_${Date.now()}`,
            kind: 'HEAL_ZONE',
            spellId: ZONOZZ_BALL_TARGET_GROUND_ID,
            ownerId: boss.id,
            x: bPos.x,
            y: bPos.y,
            radius: ZONOZZ_BALL_HIT_RADIUS,
            colorHex: '#A855F7',
            remainingMs: ZONOZZ_BALL_DURATION_MS,
            tickIntervalMs: 1000,
            tickValue: 0,
          });

          engine.emitDbmAlert?.({
            title: `⚫ 黑光球点名：${carrier.name}`,
            advice: carrier.isPlayer
              ? '你身上有黑光球！立刻移动进入 Boss 紫色圆环撞击！'
              : `持球者 ${carrier.name} 需在 8 秒内进入 Boss 紫色圆环撞击！`,
            voiceText: '分摊撞球',
            severity: 'WARN',
            roleHint: 'ALL',
            spellId: 'black_blood_ball',
            source: 'RUNTIME',
            dedupeKey: 'zonozz_black_blood_ball',
            cooldownMs: 3000,
          });

          engine.effectsManager?.addFloatingText({
            targetId: carrier.id,
            text: '⚫ 黑光球！进入 Boss 紫圈撞击！',
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
              name: '虚空触须',
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

    // 黑光球追踪、AI 跑位与撞击结算
    if (ai.zonozzBallCarrierId && ai.zonozzBallResolveAt != null) {
      const carrier = living(engine).find(u => u.id === ai.zonozzBallCarrierId);
      const bPos = boss.position || { x: 500, y: 200 };

      // Keep target ring centered on Boss
      const targetRing = engine.effectsManager?.groundEffects?.find(
        g => g.spellId === ZONOZZ_BALL_TARGET_GROUND_ID,
      );
      if (targetRing) {
        targetRing.x = bPos.x;
        targetRing.y = bPos.y;
      }

      // AI carrier runs toward Boss to collide the orb
      if (carrier && !carrier.isPlayer && !carrier.isHumanControlled && carrier.position) {
        const dx = bPos.x - carrier.position.x;
        const dy = bPos.y - carrier.position.y;
        const d = Math.hypot(dx, dy);
        if (d > 45) {
          const step = Math.min(d - 45, (110 * Math.max(0, deltaMs)) / 1000);
          carrier.position = {
            x: carrier.position.x + (dx / d) * step,
            y: carrier.position.y + (dy / d) * step,
          };
        }
      }

      const near = !!(carrier && dist(carrier.position || {}, bPos) <= ZONOZZ_BALL_HIT_RADIUS);
      const timedOut = (ai.zonozzFightMs || 0) >= ai.zonozzBallResolveAt;
      const canEarlyCollide =
        near && (ai.zonozzFightMs || 0) >= (ai.zonozzBallSpawnedAt || 0) + ZONOZZ_BALL_EARLY_COLLIDE_MS;

      if (timedOut || canEarlyCollide) {
        if (near && carrier) {
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
              sourceUnitId: carrier.id,
              targetUnitId: boss.id,
              durationMs: 60_000,
              remainingMs: 60_000,
              stacks,
              maxStacks: 99,
              school: 'SHADOW',
            });
          }
          // 易伤窗口：额外打 Boss 一下表现爆发
          engine.dealDamage(carrier, boss, 80_000 * stacks, 'SHADOW', true, '黑光撞击');
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

        // Cleanup carrier buff & target ring
        for (const u of engine.friendlyUnits) {
          if (u.buffs?.length) {
            u.buffs = u.buffs.filter(b => b.spellId !== BLACK_BLOOD_CARRIER_ID);
          }
        }
        if (engine.effectsManager?.groundEffects) {
          engine.effectsManager.groundEffects = engine.effectsManager.groundEffects.filter(
            g => g.spellId !== ZONOZZ_BALL_TARGET_GROUND_ID,
          );
        }
        ai.zonozzBallCarrierId = undefined;
        ai.zonozzBallSpawnedAt = undefined;
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
