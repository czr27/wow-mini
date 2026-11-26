import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import { spawnCombatUnit } from '../../engine/UnitSpawn.js';

export const UNDEAD_ADD_SUMMON = 'ramstein_undead';

export type RamsteinAiState = {
  ramFightMs?: number;
  ramAddAcc?: number;
  skills?: BossSkill[];
};

function living(engine: any) {
  return engine.friendlyUnits.filter((u: any) => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

export const RamsteinEncounter: BossEncounterModule = {
  id: 'ramstein',
  name: '屠宰房助手拉姆斯登',
  dungeonId: 'stratholme',
  tier: '5man',

  createSkills(): BossSkill[] {
    return [
      {
        id: 'trample',
        name: '践踏',
        castTimeMs: 2000,
        cooldownMs: 14_000,
        lastCastMs: -5000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 120,
        targetKind: 'AOE',
        description: '近距践踏',
        execute: (boss, engine) => {
          const bPos = boss.position || { x: 500, y: 200 };
          for (const u of living(engine)) {
            const d = Math.hypot((u.position?.x || 0) - bPos.x, (u.position?.y || 0) - bPos.y);
            if (d <= 90) engine.dealDamage(boss, u, 22_000, 'PHYSICAL', true, '践踏');
          }
        },
      },
      {
        id: 'knockout',
        name: '重殴',
        castTimeMs: 0,
        cooldownMs: 10_000,
        lastCastMs: -3000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 80,
        targetKind: 'MELEE_TARGET',
        description: '坦打',
        execute: (boss, engine) => {
          const tank = living(engine).find((u: any) => u.role === 'TANK');
          if (tank) engine.dealDamage(boss, tank, 32_000, 'PHYSICAL', false, '重殴');
        },
      },
    ];
  },

  onTick(deltaMs, boss, engine, bossAiRaw) {
    const ai = bossAiRaw as RamsteinAiState;
    ai.ramFightMs = (ai.ramFightMs || 0) + deltaMs;
    ai.ramAddAcc = (ai.ramAddAcc || 0) + deltaMs;
    if ((ai.ramAddAcc || 0) >= 20_000) {
      ai.ramAddAcc = 0;
      const bPos = boss.position || { x: 500, y: 200 };
      for (let i = 0; i < 2; i++) {
        spawnCombatUnit(engine, {
          id: `undead_${Date.now()}_${i}`,
          name: '屠宰场亡灵',
          unitKind: 'ADD',
          role: 'ENEMY',
          classId: 'NPC',
          hp: 40_000,
          maxHp: 40_000,
          position: { x: bPos.x - 60 + i * 50, y: bPos.y + 50 },
          summonSpellId: UNDEAD_ADD_SUMMON,
        });
      }
      engine.effectsManager?.addFloatingText({
        targetId: boss.id,
        text: '🧟 亡灵增援！',
        category: 'STATUS',
        isCrit: false,
      });
    }
  },
};
