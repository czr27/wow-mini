import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';

/**
 * 巨龙之魂 5号：奥卓克希昂 (Ultraxion - 20人高压心跳检测)
 * 特性机制：
 * - 不稳定的畸变脉冲 (Unstable Monstrosity)：暮光能量极度紊乱，每6秒对全团爆发出剧烈暗影脉冲
 * - 暮光审判 (Hour of Twilight)：毁灭性的全团暗影爆发，全员承受致命高压暗影伤害
 */
export const UltraxionEncounter: BossEncounterModule = {
  id: 'ultraxion',
  name: '奥卓克希昂',
  dungeonId: 'dragon_soul',
  tier: '20man',

  createSkills(): BossSkill[] {
    return [
      {
        id: 'unstable_monstrosity',
        name: '不稳定的畸变脉冲',
        castTimeMs: 1000,
        cooldownMs: 6000,
        lastCastMs: -3000,
        interruptible: false,
        school: 'SHADOW',
        range: 360,
        targetKind: 'AOE',
        description: '暮光能量极不稳定，每6秒对全团20人爆发出剧烈暗影脉冲，造成 24,000 点暗影伤害',
        execute: (boss, engine) => {
          const living = engine.friendlyUnits.filter(u => (u.alive ?? true) && (u.isAlive ?? true));
          for (const u of living) {
            engine.dealDamage(boss, u, 24000, 'SHADOW', false, '不稳定的畸变');
          }
        },
      },
      {
        id: 'hour_of_twilight',
        name: '暮光审判',
        castTimeMs: 4000,
        cooldownMs: 28000,
        lastCastMs: -14000,
        interruptible: false,
        school: 'SHADOW',
        range: 450,
        targetKind: 'AOE',
        description: '毁灭性的暮光审判，全团受到 42,000 点致命暗影伤害！',
        execute: (boss, engine) => {
          const living = engine.friendlyUnits.filter(u => (u.alive ?? true) && (u.isAlive ?? true));
          for (const u of living) {
            engine.dealDamage(boss, u, 42000, 'SHADOW', true, '暮光审判');
          }
        },
      },
    ];
  },
};
