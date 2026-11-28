import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import { spawnCombatUnit } from '../../engine/UnitSpawn.js';
import { pickWeightedBossTarget } from '../core/BossTargetPicker.js';

export const RIFLEMAN_SUMMON = 'willey_scarlet_rifleman';

export type WilleyAiState = {
  willeyFightMs?: number;
  willeyAddAcc?: number;
  skills?: BossSkill[];
};

function living(engine: any) {
  return engine.friendlyUnits.filter((u: any) => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

/** 开炮清火枪手（玩家/测试可调） */
export function fireWilleyCannon(engine: any, bossAi: WilleyAiState) {
  let killed = 0;
  for (const e of engine.enemyUnits) {
    if (e.summonSpellId !== RIFLEMAN_SUMMON) continue;
    if (!(e.alive ?? e.isAlive) || (e.hp ?? 0) <= 0) continue;
    e.hp = 0;
    e.alive = false;
    e.isAlive = false;
    killed++;
  }
  engine.effectsManager?.addFloatingText({
    targetId: engine.bossUnit?.id || 'willey',
    text: killed > 0 ? `💣 开炮！清掉 ${killed} 名火枪手` : '开炮（无目标）',
    category: 'CRIT',
    isCrit: killed > 0,
  });
  return killed;
}

export const WilleyEncounter: BossEncounterModule = {
  id: 'willey',
  name: '炮手威利',
  dungeonId: 'stratholme',
  tier: '5man',

  createSkills(bossAi: any): BossSkill[] {
    const ai = bossAi as WilleyAiState;
    return [
      {
        id: 'knockback',
        name: '击退',
        castTimeMs: 0,
        cooldownMs: 14_000,
        lastCastMs: -5000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 80,
        targetKind: 'MELEE_TARGET',
        description: '击退主坦（注意别撞增援）',
        execute: (boss, engine) => {
          const tank = living(engine).find((u: any) => u.role === 'TANK');
          if (!tank) return;
          engine.dealDamage(boss, tank, 20_000, 'PHYSICAL', false, '击退');
          engine.knockbackUnit(boss, tank, 180, '击退');
        },
      },
      {
        id: 'willey_shot',
        name: '火枪射击',
        castTimeMs: 1500,
        cooldownMs: 10_000,
        lastCastMs: -3000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 320,
        targetKind: 'RANGED_TARGET',
        description: '点名射击',
        execute: (boss, engine) => {
          const pool = living(engine);
          const t = pickWeightedBossTarget(pool);
          if (t) engine.dealDamage(boss, t, 16_000, 'PHYSICAL', false, '火枪射击');
        },
      },
    ];
  },

  onTick(deltaMs, boss, engine, bossAiRaw) {
    const ai = bossAiRaw as WilleyAiState;
    ai.willeyFightMs = (ai.willeyFightMs || 0) + deltaMs;
    ai.willeyAddAcc = (ai.willeyAddAcc || 0) + deltaMs;

    if ((ai.willeyAddAcc || 0) >= 15_000) {
      ai.willeyAddAcc = 0;
      const bPos = boss.position || { x: 500, y: 200 };
      const n = 3;
      for (let i = 0; i < n; i++) {
        spawnCombatUnit(engine, {
          id: `rifle_${Date.now()}_${i}`,
          name: '血色火枪手',
          unitKind: 'ADD',
          role: 'ENEMY',
          classId: 'NPC',
          hp: 32_000,
          maxHp: 32_000,
          position: { x: bPos.x + 90, y: bPos.y - 40 + i * 30 },
          summonSpellId: RIFLEMAN_SUMMON,
        });
      }
      // AI 自动开炮（玩家需手动）；非玩家队伍视为有人开炮
      const hasPlayer = living(engine).some((u: any) => u.isPlayer);
      if (!hasPlayer) {
        fireWilleyCannon(engine, ai);
      } else {
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
          text: '🔫 火枪手增援！快开炮！',
          category: 'CRIT',
          isCrit: true,
        });
      }
    }

    // 存活火枪手打团
    const rifles = engine.enemyUnits.filter(
      (e: any) => e.summonSpellId === RIFLEMAN_SUMMON && (e.alive ?? e.isAlive) && (e.hp ?? 0) > 0,
    );
    if (rifles.length > 0 && Math.floor((ai.willeyFightMs || 0) / 2000) !== Math.floor(((ai.willeyFightMs || 0) - deltaMs) / 2000)) {
      for (const u of living(engine)) {
        engine.dealDamage(boss, u, 4000 * rifles.length, 'PHYSICAL', false, '火枪齐射');
      }
    }
  },
};
