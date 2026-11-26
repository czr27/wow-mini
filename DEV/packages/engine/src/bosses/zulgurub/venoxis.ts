import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import type { CombatEngine } from '../../engine/CombatEngine.js';
import type { Unit } from '../../types.js';
import { spawnCombatUnit } from '../../engine/UnitSpawn.js';
import { pickWeightedBossTarget, pickWeightedBossTargets } from '../core/BossTargetPicker.js';

export const TOXIC_LINK_ID = 'toxic_link';
export const BLOODVENOM_SUMMON = 'venoxis_bloodvenom';

export type VenoxisAiState = {
  venoxisFightMs?: number;
  venoxisPhase?: 'human' | 'snake' | 'withdrawal';
  venoxisLinkAcc?: number;
  venoxisLinkGraceMs?: number;
  venoxisPoolAcc?: number;
  venoxisWithdrawalMs?: number;
  venoxisWithdrawalDone?: boolean;
  skills?: BossSkill[];
  currentCasting?: { skill: BossSkill; elapsedMs: number } | null;
};

function living(engine: CombatEngine): Unit[] {
  return engine.friendlyUnits.filter(u => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

function dist(a: { x?: number; y?: number }, b: { x?: number; y?: number }) {
  return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0));
}

export const VenoxisEncounter: BossEncounterModule = {
  id: 'venoxis',
  name: '高阶祭司温诺希斯',
  dungeonId: 'zulgurub',
  tier: '5man',

  createSkills(bossAi: any): BossSkill[] {
    const ai = bossAi as VenoxisAiState;
    return [
      {
        id: 'whispers_of_hethiss',
        name: '赫希斯低语',
        castTimeMs: 2500,
        cooldownMs: 8000,
        lastCastMs: -1000,
        interruptible: true,
        school: 'NATURE',
        range: 360,
        targetKind: 'AOE',
        description: '必须打断；未打断则全团重毒伤',
        execute: (boss, engine) => {
          if (ai.venoxisPhase === 'withdrawal') return;
          for (const u of living(engine)) {
            engine.dealDamage(boss, u, 22_000, 'NATURE', true, '赫希斯低语');
          }
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '💀 低语未打断！',
            category: 'CRIT',
            isCrit: true,
          });
        },
      },
      {
        id: 'toxic_link',
        name: '毒性链接',
        castTimeMs: 1000,
        cooldownMs: 18_000,
        lastCastMs: -8000,
        interruptible: false,
        school: 'NATURE',
        range: 320,
        targetKind: 'AOE',
        description: '点两人：距离过近持续掉血，拉开扯断',
        dbm: {
          advice: '毒液连线，拉开扯断',
          voiceText: '拉开扯断',
          severity: 'WARN',
        },
        execute: (boss, engine) => {
          if (ai.venoxisPhase === 'withdrawal') return;
          const pool = living(engine).filter(u => u.role !== 'TANK');
          const picks = pickWeightedBossTargets(pool, 2);
          if (picks.length < 2) return;
          for (const u of picks) {
            engine.applyBuff(u, {
              id: `tlink_${Date.now()}_${u.id}`,
              spellId: TOXIC_LINK_ID,
              name: '毒性链接',
              kind: 'DEBUFF',
              tags: ['DEBUFF'],
              sourceUnitId: boss.id,
              targetUnitId: u.id,
              durationMs: 12_000,
              remainingMs: 12_000,
              stacks: 1,
              maxStacks: 1,
              school: 'NATURE',
            });
            engine.effectsManager?.addFloatingText({
              targetId: u.id,
              text: '🟢 毒性链接！拉开！',
              category: 'STATUS',
              isCrit: true,
            });
          }
        },
      },
      {
        id: 'venomous_effusion',
        name: '毒液喷溅',
        castTimeMs: 0,
        cooldownMs: 10_000,
        lastCastMs: -3000,
        interruptible: false,
        school: 'NATURE',
        range: 80,
        targetKind: 'MELEE_TARGET',
        description: '坦打',
        execute: (boss, engine) => {
          const tank = living(engine).find(u => u.role === 'TANK');
          if (tank) engine.dealDamage(boss, tank, 26_000, 'NATURE', false, '毒液喷溅');
        },
      },
    ];
  },

  onTick(deltaMs, boss, engine, bossAiRaw) {
    const ai = bossAiRaw as VenoxisAiState;
    ai.venoxisFightMs = (ai.venoxisFightMs || 0) + deltaMs;
    if (!ai.venoxisPhase) ai.venoxisPhase = 'human';

    // 毒性链接：过近掉血，拉开 ≥80 扯断（仅剩 1 人时也自动解除）
    const linked = living(engine).filter(u => u.buffs?.some(b => b.spellId === TOXIC_LINK_ID));
    if (linked.length === 1) {
      engine.auraManager.removeBuff(linked[0], TOXIC_LINK_ID);
    } else if (linked.length >= 2) {
      const d = dist(linked[0].position || {}, linked[1].position || {});
      if (d >= 80) {
        for (const u of linked) {
          engine.auraManager.removeBuff(u, TOXIC_LINK_ID);
          engine.effectsManager?.addFloatingText({
            targetId: u.id,
            text: '⚡ 毒性链接已扯断！',
            category: 'STATUS',
            isCrit: true,
          });
        }
      } else if (Math.floor((ai.venoxisFightMs || 0) / 1000) !== Math.floor(((ai.venoxisFightMs || 0) - deltaMs) / 1000)) {
        for (const u of linked) {
          engine.dealDamage(boss, u, 4500, 'NATURE', false, '毒性链接');
        }
      }
    }

    // 半血 → 蛇神
    if (ai.venoxisPhase === 'human' && boss.maxHp > 0 && boss.hp / boss.maxHp <= 0.5) {
      ai.venoxisPhase = 'snake';
      engine.effectsManager?.addFloatingText({
        targetId: boss.id,
        text: '🐍 蛇神祝福！躲毒池、转背吐息！',
        category: 'CRIT',
        isCrit: true,
      });
    }

    if (ai.venoxisPhase === 'snake') {
      ai.venoxisPoolAcc = (ai.venoxisPoolAcc || 0) + deltaMs;
      if ((ai.venoxisPoolAcc || 0) >= 6000) {
        ai.venoxisPoolAcc = 0;
        const fri = living(engine);
        const t = pickWeightedBossTarget(fri);
        const pos = t?.position || { x: 400, y: 220 };
        engine.effectsManager?.addGroundEffect({
          kind: 'DAMAGE_ZONE',
          spellId: 'venoxis_acid_pool',
          ownerId: boss.id,
          x: pos.x,
          y: pos.y,
          radius: 45,
          colorHex: '#84CC16',
          remainingMs: 10_000,
          tickIntervalMs: 1000,
          tickValue: 9000,
        });
      }

      // 20% → 回坛戒断易伤 + 血毒触须（仅触发一次）
      if (!ai.venoxisWithdrawalDone && boss.maxHp > 0 && boss.hp / boss.maxHp <= 0.2) {
        ai.venoxisWithdrawalDone = true;
        ai.venoxisPhase = 'withdrawal';
        ai.venoxisWithdrawalMs = 12_000;
        const bPos = boss.position || { x: 500, y: 200 };
        for (let i = 0; i < 3; i++) {
          spawnCombatUnit(engine, {
            id: `bv_${Date.now()}_${i}`,
            name: '血毒触须',
            unitKind: 'ADD',
            role: 'ENEMY',
            classId: 'NPC',
            hp: 40_000,
            maxHp: 40_000,
            position: { x: bPos.x - 60 + i * 50, y: bPos.y + 50 },
            summonSpellId: BLOODVENOM_SUMMON,
          });
        }
        engine.applyBuff(boss, {
          id: `vw_${Date.now()}`,
          spellId: 'venom_withdrawal',
          name: '毒液戒断（易伤）',
          kind: 'DEBUFF',
          tags: ['DEBUFF'],
          sourceUnitId: boss.id,
          targetUnitId: boss.id,
          durationMs: 12_000,
          remainingMs: 12_000,
          stacks: 1,
          maxStacks: 1,
          school: 'NATURE',
        });
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
          text: '💥 毒液戒断！100% 易伤爆发窗！',
          category: 'CRIT',
          isCrit: true,
        });
      }
    }

    if (ai.venoxisPhase === 'withdrawal') {
      ai.venoxisWithdrawalMs = Math.max(0, (ai.venoxisWithdrawalMs || 0) - deltaMs);
      // 易伤：额外对 Boss 造成真实伤害表现由 DPS 自然打；触须存活打团
      const tents = engine.enemyUnits.filter(
        e => e.summonSpellId === BLOODVENOM_SUMMON && (e.alive ?? e.isAlive) && (e.hp ?? 0) > 0,
      );
      if (tents.length > 0 && Math.floor((ai.venoxisFightMs || 0) / 1000) !== Math.floor(((ai.venoxisFightMs || 0) - deltaMs) / 1000)) {
        for (const u of living(engine)) {
          engine.dealDamage(boss, u, 2500 * tents.length, 'NATURE', false, '血毒触须');
        }
      }
      if ((ai.venoxisWithdrawalMs || 0) <= 0) {
        ai.venoxisPhase = 'snake';
        for (const e of tents) {
          e.hp = 0;
          e.alive = false;
          e.isAlive = false;
        }
      }
    }
  },
};
