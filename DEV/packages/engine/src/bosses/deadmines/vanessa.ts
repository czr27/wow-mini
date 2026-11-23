import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import type { CombatEngine } from '../../engine/CombatEngine.js';
import type { Unit } from '../../types.js';
import { spawnCombatUnit } from '../../engine/UnitSpawn.js';

export const NIGHTMARE_WORGEN_SUMMON = 'vanessa_nightmare_worgen';

export type VanessaAiState = {
  vanessaFightMs?: number;
  vanessaPhase?: 'intro' | 'nightmare' | 'deck' | 'skip';
  vanessaNightmareWave?: number;
  vanessaNightmareAcc?: number;
  vanessaBlastAt?: number;
  vanessaDeflectionAcc?: number;
  skills?: BossSkill[];
};

function living(engine: CombatEngine): Unit[] {
  return engine.friendlyUnits.filter(u => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

function isBehindSafeEdge(u: Unit, boss: Unit): boolean {
  const b = boss.position || { x: 500, y: 200 };
  const p = u.position || { x: 0, y: 0 };
  // 甲板边缘安全：距 Boss 中心 > 130
  return Math.hypot(p.x - b.x, p.y - b.y) >= 130;
}

/**
 * 梵妮莎·范克里夫 — 仅英雄。普通难度配置已剔除本 Boss。
 */
export const VanessaEncounter: BossEncounterModule = {
  id: 'vanessa',
  name: '梵妮莎·范克里夫',
  dungeonId: 'deadmines',
  tier: '5man',

  createSkills(bossAi: any): BossSkill[] {
    const ai = bossAi as VanessaAiState;
    return [
      {
        id: 'deflection',
        name: '偏折',
        castTimeMs: 0,
        cooldownMs: 25_000,
        lastCastMs: -5_000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 80,
        targetKind: 'SELF',
        description: '偏折：对 Boss 直伤无效窗口，转打小怪',
        execute: (boss, engine) => {
          ai.vanessaDeflectionAcc = 5000;
          engine.applyBuff(boss, {
            id: `defl_${Date.now()}`,
            spellId: 'vanessa_deflection',
            name: '偏折',
            kind: 'BUFF',
            tags: ['STAT'],
            sourceUnitId: boss.id,
            targetUnitId: boss.id,
            durationMs: 5000,
            remainingMs: 5000,
            stacks: 1,
            maxStacks: 1,
          });
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '🛡️ 偏折！停手或打小怪！',
            category: 'STATUS',
            isCrit: true,
          });
        },
      },
      {
        id: 'fiery_blaze',
        name: '烈焰爆',
        castTimeMs: 3000,
        cooldownMs: 35_000,
        lastCastMs: -20_000,
        interruptible: false,
        school: 'FIRE',
        range: 400,
        targetKind: 'AOE',
        description: '读条后全场爆；站甲板边缘安全区',
        execute: (boss, engine) => {
          for (const u of living(engine)) {
            if (isBehindSafeEdge(u, boss)) continue;
            engine.dealDamage(boss, u, 45_000, 'FIRE', true, '烈焰爆');
          }
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '🔥 烈焰爆！边缘安全区可躲！',
            category: 'CRIT',
            isCrit: true,
          });
        },
      },
      {
        id: 'vanessa_strike',
        name: '毒刃',
        castTimeMs: 0,
        cooldownMs: 9000,
        lastCastMs: -2000,
        interruptible: false,
        school: 'NATURE',
        range: 80,
        targetKind: 'MELEE_TARGET',
        description: '坦打',
        execute: (boss, engine) => {
          const tank = living(engine).find(u => u.role === 'TANK');
          if (tank) engine.dealDamage(boss, tank, 30_000, 'NATURE', false, '毒刃');
        },
      },
    ];
  },

  onTick(deltaMs, boss, engine, bossAiRaw) {
    const ai = bossAiRaw as VanessaAiState;
    ai.vanessaFightMs = (ai.vanessaFightMs || 0) + deltaMs;

    // 非英雄：不应出现；若误进则立刻跳过式软化
    if (engine.difficulty === 'NORMAL') {
      if (ai.vanessaPhase !== 'skip') {
        ai.vanessaPhase = 'skip';
        boss.hp = 1;
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
          text: '普通难度无梵妮莎（请用英雄）',
          category: 'STATUS',
          isCrit: false,
        });
      }
      return;
    }

    if (!ai.vanessaPhase) {
      ai.vanessaPhase = 'nightmare';
      ai.vanessaNightmareWave = 1;
      ai.vanessaNightmareAcc = 0;
      spawnNightmarePack(engine, boss, 3);
      engine.effectsManager?.addFloatingText({
        targetId: boss.id,
        text: '📓 梦魇开始！救出家人（清狼人）！',
        category: 'CRIT',
        isCrit: true,
      });
    }

    if (ai.vanessaPhase === 'nightmare') {
      // 梦魇期间 Boss 锁血
      boss.hp = boss.maxHp;
      ai.vanessaNightmareAcc = (ai.vanessaNightmareAcc || 0) + deltaMs;
      const wave = ai.vanessaNightmareWave || 0;
      if (wave >= 1 && wave < 3) {
        const left = engine.enemyUnits.filter(
          e =>
            e.summonSpellId === NIGHTMARE_WORGEN_SUMMON &&
            (e.alive ?? e.isAlive) &&
            (e.hp ?? 0) > 0,
        );
        if (left.length === 0 && (ai.vanessaNightmareAcc || 0) >= 2000) {
          ai.vanessaNightmareWave = wave + 1;
          ai.vanessaNightmareAcc = 0;
          if ((ai.vanessaNightmareWave || 0) <= 3) {
            spawnNightmarePack(engine, boss, 3);
            engine.effectsManager?.addFloatingText({
              targetId: boss.id,
              text: `梦魇第 ${ai.vanessaNightmareWave} 波`,
              category: 'STATUS',
              isCrit: false,
            });
          }
        }
      }
      if ((ai.vanessaNightmareWave || 0) >= 3) {
        const left = engine.enemyUnits.filter(
          e =>
            e.summonSpellId === NIGHTMARE_WORGEN_SUMMON &&
            (e.alive ?? e.isAlive) &&
            (e.hp ?? 0) > 0,
        );
        if (left.length === 0) {
          ai.vanessaPhase = 'deck';
          boss.hp = boss.maxHp;
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '⚔️ 梦魇结束！甲板决战梵妮莎！',
            category: 'CRIT',
            isCrit: true,
          });
        }
      }
      return;
    }

    if ((ai.vanessaDeflectionAcc || 0) > 0) {
      ai.vanessaDeflectionAcc = Math.max(0, (ai.vanessaDeflectionAcc || 0) - deltaMs);
    }

    // 半血/25% 预告烈焰爆安全区
    if (boss.maxHp > 0) {
      const pct = boss.hp / boss.maxHp;
      if (pct <= 0.5 && ai.vanessaBlastAt == null) {
        ai.vanessaBlastAt = (ai.vanessaFightMs || 0) + 4000;
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
          text: '⚠️ 快到甲板边缘躲避烈焰爆！',
          category: 'STATUS',
          isCrit: true,
        });
      }
    }
  },

  isActionLocked(bossAi: any) {
    return (bossAi as VanessaAiState).vanessaPhase === 'nightmare';
  },
};

function spawnNightmarePack(engine: CombatEngine, boss: Unit, n: number) {
  const bPos = boss.position || { x: 500, y: 200 };
  for (let i = 0; i < n; i++) {
    spawnCombatUnit(engine, {
      id: `nw_${Date.now()}_${i}`,
      name: '狂怒狼人',
      unitKind: 'ADD',
      role: 'ENEMY',
      classId: 'NPC',
      hp: 40_000,
      maxHp: 40_000,
      position: { x: bPos.x - 80 + i * 50, y: bPos.y + 50 },
      summonSpellId: NIGHTMARE_WORGEN_SUMMON,
    });
  }
}
