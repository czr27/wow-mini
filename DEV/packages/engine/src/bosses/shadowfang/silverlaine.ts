import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import type { Unit } from '../../types.js';

/**
 * 影牙城堡 2号：席瓦莱恩男爵 (Baron Silverlaine)
 * 特性机制：
 * - 降受疗诅咒 (Cursed Veins)：对主坦及随机队员施加降低受疗75%的诅咒与持续DOT，急需驱散
 * - 阴影面纱脉冲 (Veil of Shadows)：全团暗影脉冲
 * - 召唤狼人之灵 (Summon Worgen)：突袭撕咬后排治疗与输出
 */
export const SilverlaineEncounter: BossEncounterModule = {
  id: 'silverlaine',
  name: '席瓦莱恩男爵',
  dungeonId: 'shadowfang_keep',
  tier: '5man',

  createSkills(): BossSkill[] {
    return [
      {
        id: 'cursed_veins',
        name: '降受疗诅咒',
        castTimeMs: 1500,
        cooldownMs: 18000,
        lastCastMs: -9000,
        interruptible: true,
        school: 'SHADOW',
        range: 320,
        targetKind: 'RANGED_TARGET',
        description: '对主坦及随机队员施加降受疗75%诅咒与暗影DOT，持续15秒，急需驱散！',
        execute: (boss, engine) => {
          const tank = engine.friendlyUnits.find(u => u.alive && u.role === 'TANK') || engine.friendlyUnits[0];
          const nonTanks = engine.friendlyUnits.filter(u => u.alive && u.role !== 'TANK');
          const extraTarget = nonTanks[Math.floor(Math.random() * nonTanks.length)];
          const targets = [tank, extraTarget].filter((t, idx, arr): t is Unit => Boolean(t) && arr.indexOf(t) === idx);

          for (const target of targets) {
            engine.applyBuff(target, {
              id: `debuff_curse_${Date.now()}_${target.id}`,
              spellId: 'cursed_veins',
              name: '降受疗诅咒',
              kind: 'DEBUFF',
              tags: ['CC', 'DOT'],
              sourceUnitId: boss.id,
              targetUnitId: target.id,
              durationMs: 15000,
              remainingMs: 15000,
              stacks: 1,
              maxStacks: 1,
              school: 'SHADOW',
              tickIntervalMs: 2000,
              tickValue: 4000,
            });
          }
        },
      },
      {
        id: 'veil_of_shadows',
        name: '阴影面纱脉冲',
        castTimeMs: 1500,
        cooldownMs: 14000,
        lastCastMs: -7000,
        interruptible: false,
        school: 'SHADOW',
        range: 360,
        targetKind: 'AOE',
        description: '向全团释放席瓦莱恩阴影面纱，造成 15,000 点暗影伤害',
        execute: (boss, engine) => {
          const living = engine.friendlyUnits.filter(u => (u.alive ?? true) && (u.isAlive ?? true));
          for (const u of living) {
            engine.dealDamage(boss, u, 15000, 'SHADOW', false, '阴影面纱');
          }
        },
      },
      {
        id: 'summon_worgen',
        name: '召唤狼人之灵',
        castTimeMs: 1500,
        cooldownMs: 25000,
        lastCastMs: -5000,
        interruptible: false,
        school: 'SHADOW',
        range: 320,
        targetKind: 'RANGED_TARGET',
        description: '召唤先祖狼人之灵突袭后排治疗/DPS',
        execute: (boss, engine) => {
          const nonTank = engine.friendlyUnits.filter(u => u.alive && u.role !== 'TANK');
          const target = nonTank[Math.floor(Math.random() * nonTank.length)] || engine.friendlyUnits[0];
          if (target) {
            engine.dealDamage(boss, target, 26000, 'PHYSICAL', false, '狼人之灵');
            engine.effectsManager?.addFloatingText({
              targetId: target.id,
              text: '狼人之灵 突袭撕咬！',
              category: 'CRIT',
              isCrit: true,
            });
          }
        },
      },
    ];
  },
};
