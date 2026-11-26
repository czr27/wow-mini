import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';

type AshburyAiState = {
  asphyxiatePostDelay: number;
  stayTickAcc?: number;
  stayTicksDone?: number;
  asphyxTickAcc?: number;
  asphyxTicksDone?: number;
  asphyxStartHp?: Map<string, number>;
  skills: BossSkill[];
  currentCasting: { skill: BossSkill; elapsedMs: number } | null;
};

function applyStayTick(boss: any, engine: any) {
  const bossHeal = Math.round(boss.maxHp * 0.1);
  const allyHealRatio = 0.1;
  engine.healUnit(boss, boss, bossHeal, false, '暂缓处决');
  for (const u of engine.friendlyUnits) {
    if (u.alive ?? u.isAlive) {
      engine.healUnit(boss, u, Math.round(u.maxHp * allyHealRatio), false, '暂缓处决');
    }
  }
  engine.effectsManager?.addFloatingText({
    targetId: boss.id,
    text: '💚 暂缓处决跳字治疗',
    category: 'HEAL',
    isCrit: false,
  });
}

function removeAsphyxiateBuff(engine: any, u: any) {
  if (!u?.buffs?.length) return;
  if (engine?.auraManager?.removeBuff) {
    engine.auraManager.removeBuff(u, 'asphyxiate');
  } else {
    u.buffs = u.buffs.filter((b: any) => b.spellId !== 'asphyxiate');
  }
}

function applyAsphyxiateStun(engine: any, bossId: string, durationMs: number) {
  for (const u of engine.friendlyUnits) {
    if (!(u.alive ?? u.isAlive)) continue;
    removeAsphyxiateBuff(engine, u);
    engine.applyBuff(u, {
      id: `asphyxiate_${Date.now()}_${u.id}`,
      spellId: 'asphyxiate',
      name: '窒息（空中昏迷）',
      kind: 'DEBUFF',
      tags: ['CC', 'STUN'],
      moveSpeedMod: 0,
      sourceUnitId: bossId,
      targetUnitId: u.id,
      durationMs,
      remainingMs: durationMs,
      stacks: 1,
      maxStacks: 1,
      school: 'SHADOW',
    });
  }
}

function clearAsphyxiateStun(engine: any) {
  for (const u of engine.friendlyUnits) {
    removeAsphyxiateBuff(engine, u);
  }
}

/**
 * 每秒扣 (maxHp - 1) / 6；六跳累加恰为 maxHp-1，满血且无治疗时最终为 1。
 * 用「累计取整差」避免每跳 floor 后余 2 血；不是末跳直接设成 1。
 */
function applyAsphyxiateDrainTick(engine: any, _bossAi: AshburyAiState, tickIndex: number) {
  const totalTicks = 6;
  for (const u of engine.friendlyUnits) {
    if (!(u.alive ?? u.isAlive)) continue;
    const maxHp = Math.max(1, u.maxHp || u.hp);
    const pool = maxHp - 1;
    const dealtBefore = Math.round(((tickIndex - 1) * pool) / totalTicks);
    const dealtAfter = Math.round((tickIndex * pool) / totalTicks);
    const amount = Math.max(0, dealtAfter - dealtBefore);
    engine.drainHpTowardFloor(u, amount, 1, '窒息术');
  }
}

/**
 * 影牙城堡 1号：亚什布里男爵 (Baron Ashbury)
 * 特性机制：
 * - 窒息术 (Asphyxiate)：6s 引导；全员空中昏迷无法行动；持续暗影压血至 1 点（不击杀）
 *   结束后：1s 停手（安全治疗）→ 5s 仅普攻仇恨目标 → 之后才允许其他技能
 * - 暂缓处决 (Stay of Execution)：引导跳字治疗（约每秒 10%），可打断截断后续跳
 * - 修补烂肉 (Mend Rotten Flesh)：首领大量自愈 25%，可打断
 * - 苦痛灾厄脉冲：全团暗影脉冲，30%血量以下狂暴形态伤害剧增
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
        castTimeMs: 6000,
        cooldownMs: 32000,
        lastCastMs: -22000,
        interruptible: false,
        school: 'SHADOW',
        range: 600,
        targetKind: 'AOE',
        description: '6秒引导：全员空中昏迷；每秒扣除 (最大生命-1)/6，满血无治疗则恰好剩 1 点',
        dbm: {
          advice: '全团窒息压血至 1 点，结束后安全抬血',
          voiceText: '准备抬血',
          severity: 'CRITICAL',
          roleHint: 'HEALER',
          preWarnMs: 3000,
        },
        execute: (boss, engine) => {
          // 六跳已按 (maxHp-1)/6 结算完；此处不再「末跳拍成 1」，只解除昏迷并进入后摇
          clearAsphyxiateStun(engine);

          // 窒息后：1s 停手（安全治疗窗）→ 5s 仅普攻仇恨目标 → 之后才允许其他技能
          // asphyxiatePostDelay 锁技能共 6s；healingGrace 仅前 1s 禁伤
          bossAi.asphyxiatePostDelay = 6000;
          if (engine) {
            engine.bossHealingGraceRemainingMs = 1000;
            engine.emitDbmAlert?.({
              title: '窒息结束：安全治疗窗',
              advice: '安全抬血',
              voiceText: '安全抬血',
              replaceKey: 'skill_ashbury_asphyxiate',
              severity: 'CRITICAL',
              roleHint: 'HEALER',
              spellId: 'asphyxiate_grace',
              bossId: 'ashbury',
              source: 'ENCOUNTER',
            });
          }

          const calamity = bossAi.skills.find((s: BossSkill) => s.id === 'calamity');
          if (calamity) {
            calamity.lastCastMs = engine.nowMs;
          }

          const stayOfExecution = bossAi.skills.find((s: BossSkill) => s.id === 'stay_of_execution');
          if (stayOfExecution) {
            stayOfExecution.lastCastMs = -100000;
          }
          bossAi.stayTickAcc = 0;
          bossAi.stayTicksDone = 0;
          bossAi.asphyxTickAcc = 0;
          bossAi.asphyxTicksDone = 0;
          bossAi.asphyxStartHp = new Map();

          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '🛡️ 窒息解除！1 秒后普攻仇恨目标，5 秒内不放技能！',
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
        description: '引导跳字治疗 Boss 与全团（约每秒 10%），打断可截断后续跳',
        execute: (_boss, engine) => {
          engine.effectsManager?.addFloatingText({
            targetId: _boss.id,
            text: '暂缓处决引导结束',
            category: 'STATUS',
            isCrit: false,
          });
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

  onTick(deltaMs, _boss, engine, bossAiRaw) {
    const bossAi = bossAiRaw as AshburyAiState;
    const casting = bossAi.currentCasting;

    // ── 窒息术 6s 引导：昏迷 + 逐步压血至 1 ──
    if (casting?.skill.id === 'asphyxiate') {
      if (casting.elapsedMs === 0) {
        bossAi.asphyxTickAcc = 0;
        bossAi.asphyxTicksDone = 0;
        bossAi.asphyxStartHp = new Map();
        applyAsphyxiateStun(engine, _boss.id, 6000);
        engine.effectsManager?.addFloatingText({
          targetId: _boss.id,
          text: '🌀 窒息术！全员空中昏迷！',
          category: 'STATUS',
          isCrit: true,
        });
      }
      // Keep stun buff alive for the channel
      for (const u of engine.friendlyUnits) {
        const buff = u.buffs?.find((b: any) => b.spellId === 'asphyxiate');
        if (buff) {
          buff.remainingMs = Math.max(buff.remainingMs, 6000 - casting.elapsedMs);
        }
      }
      bossAi.asphyxTickAcc = (bossAi.asphyxTickAcc || 0) + deltaMs;
      while ((bossAi.asphyxTickAcc || 0) >= 1000 && (bossAi.asphyxTicksDone || 0) < 6) {
        bossAi.asphyxTickAcc -= 1000;
        bossAi.asphyxTicksDone = (bossAi.asphyxTicksDone || 0) + 1;
        applyAsphyxiateDrainTick(engine, bossAi, bossAi.asphyxTicksDone);
      }
      return;
    }

    // ── 暂缓处决跳字 ──
    if (!casting || casting.skill.id !== 'stay_of_execution') {
      bossAi.stayTickAcc = 0;
      return;
    }
    if (casting.elapsedMs === 0) {
      bossAi.stayTickAcc = 0;
      bossAi.stayTicksDone = 0;
    }
    bossAi.stayTickAcc = (bossAi.stayTickAcc || 0) + deltaMs;
    while ((bossAi.stayTickAcc || 0) >= 1000 && (bossAi.stayTicksDone || 0) < 6) {
      bossAi.stayTickAcc -= 1000;
      bossAi.stayTicksDone = (bossAi.stayTicksDone || 0) + 1;
      const boss = engine.bossUnit || engine.enemyUnits.find(u => u.id === _boss.id) || _boss;
      applyStayTick(boss, engine);
    }
  },

  isActionLocked(bossAi: any): boolean {
    return bossAi.asphyxiatePostDelay > 0 || bossAi.currentCasting?.skill?.id === 'asphyxiate';
  },
};
