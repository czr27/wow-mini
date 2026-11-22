import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';

/**
 * 影牙城堡 5号尾王：高弗雷勋爵 (Lord Godfrey)
 * 特性机制：
 * - 重伤 (Mortal Wound)：主坦致死打击，降低受疗且叠层最多6层
 * - 诅咒之弹 (Cursed Bullets)：随机2名后排成员强力诅咒与高额DOT，可打断与驱散
 * - 双枪弹幕 (Pistol Barrage)：60°红色扇形危险预警，3秒后扫射，扇形内秒杀级伤害，全场流弹受到波及
 */
export const GodfreyEncounter: BossEncounterModule = {
  id: 'godfrey',
  name: '高弗雷勋爵',
  dungeonId: 'shadowfang_keep',
  tier: '5man',

  createSkills(): BossSkill[] {
    return [
      {
        id: 'mortal_wound',
        name: '重伤',
        castTimeMs: 0,
        cooldownMs: 15000,
        lastCastMs: -5000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 80,
        targetKind: 'MELEE_TARGET',
        description: '降低主坦受疗叠层',
        execute: (boss, engine) => {
          const tank = engine.friendlyUnits.find(u => u.alive && u.role === 'TANK');
          if (tank) {
            engine.applyBuff(tank, {
              id: `debuff_mw_${Date.now()}`,
              spellId: 'mortal_wound',
              name: '重伤',
              kind: 'DEBUFF',
              tags: ['CC'],
              sourceUnitId: boss.id,
              targetUnitId: tank.id,
              durationMs: 20000,
              remainingMs: 20000,
              stacks: 1,
              maxStacks: 6,
            });
          }
        },
      },
      {
        id: 'cursed_bullets',
        name: '诅咒之弹',
        castTimeMs: 2000,
        cooldownMs: 16000,
        lastCastMs: -8000,
        interruptible: true,
        school: 'SHADOW',
        range: 320,
        targetKind: 'RANGED_TARGET',
        description: '强力多目标点名诅咒，造成22,000暗影伤害并附加每3秒6,500高额DOT，可打断与驱散',
        execute: (boss, engine) => {
          const nonTank = engine.friendlyUnits.filter(u => u.alive && u.role !== 'TANK');
          const pool = nonTank.length >= 2 ? nonTank : engine.friendlyUnits.filter(u => u.alive);
          const shuffled = [...pool].sort(() => Math.random() - 0.5);
          const targets = shuffled.slice(0, 2);

          for (const target of targets) {
            engine.dealDamage(boss, target, 22000, 'SHADOW', false, '诅咒之弹');
            engine.applyBuff(target, {
              id: `debuff_cb_${Date.now()}_${target.id}`,
              spellId: 'cursed_bullets',
              name: '诅咒之弹 (DoT)',
              kind: 'DEBUFF',
              tags: ['DOT'],
              sourceUnitId: boss.id,
              targetUnitId: target.id,
              durationMs: 15000,
              remainingMs: 15000,
              stacks: 1,
              maxStacks: 1,
              school: 'SHADOW',
              tickIntervalMs: 3000,
              tickValue: 6500,
            });
          }
        },
      },
      {
        id: 'pistol_barrage',
        name: '双枪弹幕',
        castTimeMs: 3000,
        cooldownMs: 32000,
        lastCastMs: -15000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 320,
        targetKind: 'RANGED_TARGET',
        description: '60°红色扇形预警后扫射全团，扇形内秒杀级伤害，全场流弹受到11,000物理波及',
        execute: (boss, engine) => {
          // 放置 60° 红色扇形地面警示区
          engine.effectsManager?.addGroundEffect({
            kind: 'CONE_WARNING',
            spellId: 'pistol_barrage',
            ownerId: boss.id,
            x: boss.position.x || 530,
            y: boss.position.y || 200,
            radius: 130,
            colorHex: '#FF0000',
            remainingMs: 3000,
          });

          // 3000ms 预警延迟后触发扇形致命伤害与全场流弹
          setTimeout(() => {
            if (!boss.alive || !boss.isAlive || boss.hp <= 0) return;
            for (const u of engine.friendlyUnits) {
              if (u.alive && u.isAlive) {
                const isInCone = engine.effectsManager.isPositionInHazard(u.position);
                if (isInCone) {
                  engine.dealDamage(boss, u, 32000, 'PHYSICAL', true, '双枪弹幕');
                } else {
                  // 全场流弹波及
                  engine.dealDamage(boss, u, 11000, 'PHYSICAL', false, '弹幕流弹飞溅');
                }
              }
            }
          }, 3000);
        },
      },
    ];
  },
};
