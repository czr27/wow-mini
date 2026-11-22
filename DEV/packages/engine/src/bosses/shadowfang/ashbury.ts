import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';

/**
 * 影牙城堡 1号：亚什布里男爵 (Baron Ashbury)
 * 特性机制：
 * - 窒息术 (Asphyxiate)：将全员生命强制抽干至 1 点，并触发 3 秒绝对安全治疗窗口
 * - 暂缓处决 (Stay of Execution)：窒息后立即自愈全团及自身，必须被打断以防回血
 * - 修补烂肉 (Mend Rotten Flesh)：首领大量自愈 25%，可打断
 * - 苦痛灾厄脉冲 (Pain and Suffering / Calamity)：全团暗影脉冲，30%血量以下狂暴形态伤害剧增
 */
export const AshburyEncounter: BossEncounterModule = {
  id: 'ashbury',
  name: '亚什布里男爵',
  dungeonId: 'shadowfang_keep',
  tier: '5man',

  createSkills(bossAi: any): BossSkill[] {
    return [
      {
        id: 'asphyxiate',
        name: '窒息术',
        castTimeMs: 4000,
        cooldownMs: 32000,
        lastCastMs: -22000,
        interruptible: false,
        school: 'SHADOW',
        range: 600,
        targetKind: 'AOE',
        description: '引导锁住全团，并将全员生命值强制抽干至 1 点！',
        execute: (boss, engine) => {
          for (const u of engine.friendlyUnits) {
            if (u.alive) {
              const drainDmg = Math.max(0, u.hp - 1);
              engine.dealDamage(boss, u, drainDmg, 'SHADOW', false, '窒息术');
            }
          }
          // 3.0s 安全治疗窗口：首领硬直，跳过一切动作并全面禁止伤害
          bossAi.asphyxiatePostDelay = 3000;
          if (engine) {
            engine.bossHealingGraceRemainingMs = 3000;
          }

          // 保护机制：推迟苦痛灾厄技能冷却，防止治疗窗口一结束立刻爆轰造成灭团
          const calamity = bossAi.skills.find((s: BossSkill) => s.id === 'calamity');
          if (calamity) {
            calamity.lastCastMs = engine.nowMs;
          }

          // 预备“暂缓处决”：确保治疗窗口结束后首领首要施放自愈全场技能
          const stayOfExecution = bossAi.skills.find((s: BossSkill) => s.id === 'stay_of_execution');
          if (stayOfExecution) {
            stayOfExecution.lastCastMs = -100000;
          }

          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '🛡️ 窒息解除！进入 3 秒安全治疗窗口！',
            category: 'STATUS',
            isCrit: true,
          });
        },
      },
      {
        id: 'stay_of_execution',
        name: '暂缓处决',
        castTimeMs: 6000,
        cooldownMs: 30000,
        lastCastMs: -15000,
        interruptible: true,
        school: 'SHADOW',
        range: 600,
        targetKind: 'SELF',
        description: '窒息术后自愈全场并自愈Boss自身，必须被打断以防Boss回满血！',
        execute: (boss, engine) => {
          const healAmt = Math.round(boss.maxHp * 0.25);
          engine.healUnit(boss, boss, healAmt, false, '暂缓处决');
          for (const u of engine.friendlyUnits) {
            if (u.alive) {
              engine.healUnit(boss, u, Math.round(u.maxHp * 0.35), false, '暂缓处决');
            }
          }
        },
      },
      {
        id: 'mend_rotten_flesh',
        name: '修补烂肉',
        castTimeMs: 2500,
        cooldownMs: 26000,
        lastCastMs: -10000,
        interruptible: true,
        school: 'SHADOW',
        range: 600,
        targetKind: 'SELF',
        description: 'Boss大量自愈25%，必须被打断',
        execute: (boss, engine) => {
          const healAmt = Math.round(boss.maxHp * 0.25);
          engine.healUnit(boss, boss, healAmt, false, '修补烂肉');
        },
      },
      {
        id: 'calamity',
        name: '苦痛灾厄脉冲',
        castTimeMs: 1500,
        cooldownMs: 12000,
        lastCastMs: -6000,
        interruptible: false,
        school: 'SHADOW',
        range: 360,
        targetKind: 'AOE',
        description: '向全团释放暗影苦痛灾厄，全团持续掉血，30%血量以下狂暴形态伤害剧增！',
        execute: (boss, engine) => {
          const isArchangel = boss.hp < boss.maxHp * 0.3;
          const pulseDmg = isArchangel ? 22000 : 14000;
          const living = engine.friendlyUnits.filter(u => (u.alive ?? true) && (u.isAlive ?? true));
          for (const u of living) {
            engine.dealDamage(boss, u, pulseDmg, 'SHADOW', false, '苦痛灾厄');
          }
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: isArchangel ? '💀 黑暗大天使 苦痛灾厄爆轰！' : '苦痛灾厄脉冲！',
            category: 'CRIT',
            isCrit: isArchangel,
          });
        },
      },
    ];
  },

  isActionLocked(bossAi: any): boolean {
    return bossAi.asphyxiatePostDelay > 0;
  },
};
