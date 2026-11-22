import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';

/**
 * 影牙城堡 3号：指挥官斯普林瓦尔 (Commander Springvale)
 * 特性机制：
 * - 背信之盾 (Shield of the Perfidious)：坦克正面大额顺劈
 * - 邪恶充能脉冲 (Unholy Empowerment)：全团暗影脉冲
 * - 暗绿亵渎 (Desecration)：在一名玩家脚下生成暗绿亵渎毒圈，按范围生效，团队必须迅速走出规避
 */
export const SpringvaleEncounter: BossEncounterModule = {
  id: 'springvale',
  name: '指挥官斯普林瓦尔',
  dungeonId: 'shadowfang_keep',
  tier: '5man',

  createSkills(): BossSkill[] {
    return [
      {
        id: 'shield_of_perfidious',
        name: '背信之盾',
        castTimeMs: 1500,
        cooldownMs: 18000,
        lastCastMs: -8000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 80,
        targetKind: 'MELEE_TARGET',
        description: '正面顺劈斩高额伤害',
        execute: (boss, engine) => {
          const tank = engine.friendlyUnits.find(u => u.alive && u.role === 'TANK');
          if (tank) {
            engine.dealDamage(boss, tank, 35000, 'PHYSICAL', false, '背信之盾');
          }
        },
      },
      {
        id: 'unholy_empowerment',
        name: '邪恶充能脉冲',
        castTimeMs: 2000,
        cooldownMs: 15000,
        lastCastMs: -5000,
        interruptible: false,
        school: 'SHADOW',
        range: 360,
        targetKind: 'AOE',
        description: '释放体内积聚的邪恶亡灵能量，对全团造成 16,000 点暗影伤害',
        execute: (boss, engine) => {
          const living = engine.friendlyUnits.filter(u => (u.alive ?? true) && (u.isAlive ?? true));
          for (const u of living) {
            engine.dealDamage(boss, u, 16000, 'SHADOW', false, '邪恶充能');
          }
        },
      },
      {
        id: 'desecration',
        name: '暗绿亵渎',
        castTimeMs: 1000,
        cooldownMs: 20000,
        lastCastMs: -5000,
        interruptible: false,
        school: 'SHADOW',
        range: 320,
        targetKind: 'RANGED_TARGET',
        description: '在一名玩家脚下生成暗绿亵渎毒圈，按范围生效，必须迅速走出！',
        execute: (boss, engine) => {
          const living = engine.friendlyUnits.filter(u => u.alive);
          const target = living[Math.floor(Math.random() * living.length)] || engine.friendlyUnits[0];
          const targetPos = target ? target.position : { x: 420, y: 220 };
          engine.effectsManager?.addGroundEffect({
            kind: 'DAMAGE_ZONE',
            spellId: 'desecration',
            ownerId: boss.id,
            x: targetPos.x,
            y: targetPos.y,
            radius: 50,
            colorHex: '#006400',
            remainingMs: 12000,
            tickIntervalMs: 1000,
            tickValue: 4800,
          });
        },
      },
    ];
  },
};
