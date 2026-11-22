import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';

/**
 * 巨龙之魂 1号：莫卓克 (Morchok - 20人团本)
 * 特性机制：
 * - 大地践踏 (Stomp)：对全团造成高额物理震荡伤害
 * - 大地黑血沸腾 (Black Blood of the Earth)：召唤大地黑血沸腾喷涌，全团暗影AOE
 * - 击碎护甲 (Crush Armor)：重击主坦，击碎护甲
 */
export const MorchokEncounter: BossEncounterModule = {
  id: 'morchok',
  name: '莫卓克',
  dungeonId: 'dragon_soul',
  tier: '20man',

  createSkills(): BossSkill[] {
    return [
      {
        id: 'stomp',
        name: '大地践踏',
        castTimeMs: 2500,
        cooldownMs: 12000,
        lastCastMs: -6000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 250,
        targetKind: 'AOE',
        description: '莫卓克重踏大地，对全团所有目标造成 28,000 点物理震荡伤害',
        execute: (boss, engine) => {
          const living = engine.friendlyUnits.filter(u => (u.alive ?? true) && (u.isAlive ?? true));
          for (const u of living) {
            engine.dealDamage(boss, u, 28000, 'PHYSICAL', false, '大地践踏');
          }
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '💥 大地践踏！全团受创！',
            category: 'CRIT',
            isCrit: true,
          });
        },
      },
      {
        id: 'black_blood',
        name: '大地黑血沸腾',
        castTimeMs: 3000,
        cooldownMs: 22000,
        lastCastMs: -11000,
        interruptible: false,
        school: 'SHADOW',
        range: 360,
        targetKind: 'AOE',
        description: '莫卓克召唤大地黑血沸腾喷涌，全团受到 22,000 点暗影伤害',
        execute: (boss, engine) => {
          const living = engine.friendlyUnits.filter(u => (u.alive ?? true) && (u.isAlive ?? true));
          for (const u of living) {
            engine.dealDamage(boss, u, 22000, 'SHADOW', false, '大地黑血');
          }
        },
      },
      {
        id: 'crush_armor',
        name: '击碎护甲',
        castTimeMs: 0,
        cooldownMs: 12000,
        lastCastMs: -4000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 80,
        targetKind: 'MELEE_TARGET',
        description: '击碎主坦护甲，造成 38,000 点物理重击',
        execute: (boss, engine) => {
          const tank = engine.friendlyUnits.find(u => u.alive && u.role === 'TANK');
          if (tank) {
            engine.dealDamage(boss, tank, 38000, 'PHYSICAL', false, '击碎护甲');
          }
        },
      },
    ];
  },
};
