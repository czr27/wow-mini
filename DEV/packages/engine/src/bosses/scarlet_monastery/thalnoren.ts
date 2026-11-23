import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';

function living(engine: any) {
  return engine.friendlyUnits.filter((u: any) => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

export const ThalnorenEncounter: BossEncounterModule = {
  id: 'thalnoren',
  name: '血法师萨尔诺斯',
  dungeonId: 'scarlet_monastery',
  tier: '5man',
  createSkills(): BossSkill[] {
    return [
      {
        id: 'fire_nova',
        name: '火焰新星',
        castTimeMs: 2000,
        cooldownMs: 12_000,
        lastCastMs: -4000,
        interruptible: false,
        school: 'FIRE',
        range: 120,
        targetKind: 'AOE',
        description: '近距火焰新星；近战注意撤离',
        execute: (boss, engine) => {
          const bPos = boss.position || { x: 500, y: 200 };
          for (const u of living(engine)) {
            const d = Math.hypot((u.position?.x || 0) - bPos.x, (u.position?.y || 0) - bPos.y);
            if (d <= 90) engine.dealDamage(boss, u, 20_000, 'FIRE', true, '火焰新星');
          }
        },
      },
      {
        id: 'flame_spike',
        name: '烈焰尖刺',
        castTimeMs: 1500,
        cooldownMs: 10_000,
        lastCastMs: -2000,
        interruptible: true,
        school: 'FIRE',
        range: 320,
        targetKind: 'RANGED_TARGET',
        description: '点名火焰箭',
        execute: (boss, engine) => {
          const pool = living(engine).filter((u: any) => u.role !== 'TANK');
          const t = pool[Math.floor(Math.random() * Math.max(1, pool.length))];
          if (t) engine.dealDamage(boss, t, 18_000, 'FIRE', false, '烈焰尖刺');
        },
      },
      {
        id: 'thalnoren_strike',
        name: '火焰打击',
        castTimeMs: 0,
        cooldownMs: 9000,
        lastCastMs: -3000,
        interruptible: false,
        school: 'FIRE',
        range: 80,
        targetKind: 'MELEE_TARGET',
        description: '坦打',
        execute: (boss, engine) => {
          const tank = living(engine).find((u: any) => u.role === 'TANK');
          if (tank) engine.dealDamage(boss, tank, 24_000, 'FIRE', false, '火焰打击');
        },
      },
    ];
  },
};
