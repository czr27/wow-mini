import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';

/**
 * 巨龙之魂通用 20人团本高压模版
 * 适用于：督军佐诺兹 (Zon'ozz), 不眠的约萨希 (Yor'sahj), 缚风者哈甲拉 (Hagara),
 * 战争领主黑角 (Blackhorn), 死亡之翼的背脊 (Spine), 死亡之翼的疯狂 (Madness)
 */
export function createDragonSoulGenericEncounter(bossId: string, bossName: string): BossEncounterModule {
  return {
    id: bossId,
    name: bossName,
    dungeonId: 'dragon_soul',
    tier: '20man',

    createSkills(): BossSkill[] {
      return [
        {
          id: 'twilight_eruption',
          name: '暮光喷涌脉冲',
          castTimeMs: 1500,
          cooldownMs: 10000,
          lastCastMs: -5000,
          interruptible: false,
          school: 'SHADOW',
          range: 360,
          targetKind: 'AOE',
          description: '巨龙之魂首领暗影能量喷涌，对全团造成 22,000 点暗影伤害',
          execute: (boss, engine) => {
            const living = engine.friendlyUnits.filter(u => (u.alive ?? true) && (u.isAlive ?? true));
            for (const u of living) {
              engine.dealDamage(boss, u, 22000, 'SHADOW', false, '暮光喷涌');
            }
          },
        },
        {
          id: 'shadow_strike',
          name: '巨龙重击',
          castTimeMs: 0,
          cooldownMs: 12000,
          lastCastMs: -4000,
          interruptible: false,
          school: 'PHYSICAL',
          range: 80,
          targetKind: 'MELEE_TARGET',
          description: '对主坦造成 36,000 点物理重击',
          execute: (boss, engine) => {
            const tank = engine.friendlyUnits.find(u => u.alive && u.role === 'TANK');
            if (tank) {
              engine.dealDamage(boss, tank, 36000, 'PHYSICAL', false, '巨龙重击');
            }
          },
        },
      ];
    },
  };
}
