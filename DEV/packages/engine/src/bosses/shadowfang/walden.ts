import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';

/**
 * 影牙城堡 4号：沃登勋爵 (Lord Walden)
 * 特性机制：
 * - 三色魔药轮替 (Potion Catalyst)：
 *    * 剧毒催化剂（绿药）：玩家必须保持移动，停滞超过1.5s受持续剧毒
 *    * 凝固毒素（红药）：玩家必须绝对静止，移动则受到高额引爆伤害
 * - 寒冰碎片爆轰 (Ice Shards)：全团冰霜伤害
 */
export const WaldenEncounter: BossEncounterModule = {
  id: 'walden',
  name: '沃登勋爵',
  dungeonId: 'shadowfang_keep',
  tier: '5man',

  createSkills(): BossSkill[] {
    let potionIndex = 0;
    return [
      {
        id: 'potion_catalyst',
        name: '三色魔药投掷',
        castTimeMs: 1500,
        cooldownMs: 14000,
        lastCastMs: -4000,
        interruptible: false,
        school: 'NATURE',
        range: 320,
        targetKind: 'AOE',
        description: '剧毒催化剂(必须走动)/凝固毒素(必须静止)强力DOT，急需治疗与驱散',
        execute: (boss, engine) => {
          const types = ['剧毒催化剂(绿药-必须走动)', '凝固毒素(红药-必须静止)', '三色魔药催化'] as const;
          const currentType = types[potionIndex % 3];
          potionIndex++;
          for (const u of engine.friendlyUnits) {
            if (u.alive) {
              engine.applyBuff(u, {
                id: `potion_${Date.now()}_${u.id}`,
                spellId: 'potion_catalyst',
                name: currentType,
                kind: 'DEBUFF',
                tags: ['DOT'],
                sourceUnitId: boss.id,
                targetUnitId: u.id,
                durationMs: 10000,
                remainingMs: 10000,
                stacks: 1,
                maxStacks: 1,
                school: currentType.includes('红') ? 'FIRE' : 'NATURE',
                tickIntervalMs: 2000,
                tickValue: currentType.includes('红') ? 7500 : 5500,
              });
              engine.dealDamage(boss, u, 14000, 'NATURE', false, '三色魔药');
            }
          }
        },
      },
      {
        id: 'ice_shards',
        name: '寒冰碎片爆轰',
        castTimeMs: 1500,
        cooldownMs: 16000,
        lastCastMs: -8000,
        interruptible: false,
        school: 'FROST',
        range: 320,
        targetKind: 'AOE',
        description: '投掷凝华冰霜药剂，全团受到 18,000 点冰霜伤害',
        execute: (boss, engine) => {
          const living = engine.friendlyUnits.filter(u => (u.alive ?? true) && (u.isAlive ?? true));
          for (const u of living) {
            engine.dealDamage(boss, u, 18000, 'FROST', false, '寒冰碎片');
          }
        },
      },
    ];
  },
};
