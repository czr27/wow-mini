import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';

function living(engine: any) {
  return engine.friendlyUnits.filter((u: any) => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

export const VishasEncounter: BossEncounterModule = {
  id: 'vishas',
  name: '审讯员韦沙斯',
  dungeonId: 'scarlet_monastery',
  tier: '5man',
  createSkills(): BossSkill[] {
    return [
      {
        id: 'shadow_word_pain',
        name: '暗言术：痛',
        castTimeMs: 0,
        cooldownMs: 8000,
        lastCastMs: -2000,
        interruptible: false,
        school: 'SHADOW',
        range: 320,
        targetKind: 'RANGED_TARGET',
        description: '可驱散暗影 DoT',
        execute: (boss, engine) => {
          const pool = living(engine);
          const t = pool[Math.floor(Math.random() * Math.max(1, pool.length))];
          if (!t) return;
          engine.applyBuff(t, {
            id: `swp_${Date.now()}`,
            spellId: 'shadow_word_pain',
            name: '暗言术：痛',
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
        id: 'vishas_smite',
        name: '惩击',
        castTimeMs: 1500,
        cooldownMs: 6000,
        lastCastMs: -1000,
        interruptible: true,
        school: 'SHADOW',
        range: 80,
        targetKind: 'MELEE_TARGET',
        description: '对主坦暗影打击',
        execute: (boss, engine) => {
          const tank = living(engine).find((u: any) => u.role === 'TANK');
          if (tank) engine.dealDamage(boss, tank, 22_000, 'SHADOW', false, '惩击');
        },
      },
    ];
  },
};
