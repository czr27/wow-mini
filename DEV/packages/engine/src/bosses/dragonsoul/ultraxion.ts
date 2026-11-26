import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import type { CombatEngine } from '../../engine/CombatEngine.js';
import type { Unit } from '../../types.js';
import { pickWeightedBossTarget } from '../core/BossTargetPicker.js';

/** 暮光领域 buff id */
export const TWILIGHT_REALM_SPELL_ID = 'twilight_realm';
/** 凋零之光 debuff id */
export const FADING_LIGHT_SPELL_ID = 'fading_light';
/** 英勇意志离开领域后的默认持续 */
export const HEROIC_WILL_OUT_MS = 5000;
/** 英勇意志冷却 */
export const HEROIC_WILL_CD_MS = 25_000;
/** 硬狂暴（暮光爆发） */
export const TWILIGHT_ERUPTION_MS = 6 * 60 * 1000;

export type UltraxionAiState = {
  ultraxFightMs?: number;
  ultraxRealmSeeded?: boolean;
  /** 指定吃暮光时刻分摊的单位 id */
  ultraxSoakIds?: string[];
  ultraxWillCdMs?: Map<string, number>;
  /** 离开领域直到该战斗时间戳再自动回进 */
  ultraxOutUntilMs?: Map<string, number>;
  ultraxFadingAcc?: number;
  /** 单位 → 凋零之光剩余 ms（独立于 aura 移除时机） */
  ultraxFadingLeftMs?: Map<string, number>;
  ultraxEnraged?: boolean;
  ultraxHourFail?: boolean;
};

function livingFriendlies(engine: CombatEngine): Unit[] {
  return engine.friendlyUnits.filter(u => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

export function isInTwilightRealm(u: Unit): boolean {
  return !!u.buffs?.some(b => b.spellId === TWILIGHT_REALM_SPELL_ID);
}

function ensureMaps(ai: UltraxionAiState) {
  if (!ai.ultraxWillCdMs) ai.ultraxWillCdMs = new Map();
  if (!ai.ultraxOutUntilMs) ai.ultraxOutUntilMs = new Map();
  if (!ai.ultraxFadingLeftMs) ai.ultraxFadingLeftMs = new Map();
}

export function enterTwilightRealm(engine: CombatEngine, u: Unit, sourceId = 'ultraxion') {
  if (!(u.alive ?? u.isAlive)) return;
  u.buffs = (u.buffs || []).filter(b => b.spellId !== TWILIGHT_REALM_SPELL_ID);
  engine.applyBuff(u, {
    id: `twilight_realm_${u.id}`,
    spellId: TWILIGHT_REALM_SPELL_ID,
    name: '暮光领域',
    kind: 'BUFF',
    tags: ['STAT'],
    sourceUnitId: sourceId,
    targetUnitId: u.id,
    durationMs: 999_999,
    remainingMs: 999_999,
    stacks: 1,
    maxStacks: 1,
    school: 'SHADOW',
  });
}

export function leaveTwilightRealm(u: Unit, engine?: CombatEngine) {
  if (!u.buffs?.length) return;
  if (engine?.auraManager?.removeBuff) {
    engine.auraManager.removeBuff(u, TWILIGHT_REALM_SPELL_ID);
  } else {
    u.buffs = u.buffs.filter(b => b.spellId !== TWILIGHT_REALM_SPELL_ID);
  }
}

/**
 * 英勇意志：短暂离开暮光领域。成功返回 true。
 * 玩家/AI/测试均可调用。
 */
export function useHeroicWill(
  engine: CombatEngine,
  bossAi: UltraxionAiState,
  unit: Unit,
  outMs = HEROIC_WILL_OUT_MS,
): boolean {
  ensureMaps(bossAi);
  const fightMs = bossAi.ultraxFightMs || 0;
  const cdLeft = bossAi.ultraxWillCdMs!.get(unit.id) || 0;
  if (cdLeft > 0) return false;
  if (!isInTwilightRealm(unit)) return false;

  leaveTwilightRealm(unit, engine);
  bossAi.ultraxWillCdMs!.set(unit.id, HEROIC_WILL_CD_MS);
  bossAi.ultraxOutUntilMs!.set(unit.id, fightMs + outMs);
  engine.effectsManager?.addFloatingText({
    targetId: unit.id,
    text: '英勇意志：离开暮光领域',
    category: 'STATUS',
    isCrit: false,
  });
  return true;
}

function monstrosityIntervalMs(fightMs: number): number {
  // 起始 6s，每分钟 -1s，下限 1s
  const steps = Math.floor(fightMs / 60_000);
  return Math.max(1000, 6000 - steps * 1000);
}

function pickSoakGroup(living: Unit[], count: number): string[] {
  const tanks = living.filter(u => u.role === 'TANK');
  const others = living.filter(u => u.role !== 'TANK');
  const picks: Unit[] = [];
  if (tanks[0]) picks.push(tanks[0]);
  for (const u of others) {
    if (picks.length >= count) break;
    picks.push(u);
  }
  while (picks.length < count && picks.length < living.length) {
    const u = living[picks.length];
    if (u && !picks.includes(u)) picks.push(u);
    else break;
  }
  return picks.map(u => u.id);
}

function applyFadingLight(engine: CombatEngine, boss: Unit, ai: UltraxionAiState, target: Unit, durationMs: number) {
  ensureMaps(ai);
  target.buffs = (target.buffs || []).filter(b => b.spellId !== FADING_LIGHT_SPELL_ID);
  engine.applyBuff(target, {
    id: `fading_light_${Date.now()}_${target.id}`,
    spellId: FADING_LIGHT_SPELL_ID,
    name: '凋零之光',
    kind: 'DEBUFF',
    tags: ['DEBUFF'],
    sourceUnitId: boss.id,
    targetUnitId: target.id,
    durationMs,
    remainingMs: durationMs,
    stacks: 1,
    maxStacks: 1,
    school: 'SHADOW',
  });
  ai.ultraxFadingLeftMs!.set(target.id, durationMs);
  engine.emitDbmAlert?.({
    title: '凋零之光',
    advice: '点名者到期前点英勇意志离场',
    voiceText: '点离领域',
    replaceKey: 'ultraxion_fading_light',
    severity: 'CRITICAL',
    spellId: FADING_LIGHT_SPELL_ID,
    bossId: boss.id,
    source: 'ENCOUNTER',
  });
  engine.effectsManager?.addFloatingText({
    targetId: target.id,
    text: '⚠️ 凋零之光！到期前离开暮光领域！',
    category: 'STATUS',
    isCrit: true,
  });
}

/**
 * 巨龙之魂 5号：奥卓克希昂 (Ultraxion)
 * - 暮光领域 + 英勇意志进出
 * - 不稳定的畸变：间隔 6s→1s 加速；仅领域内分摊
 * - 暮光时刻：指定人数分摊，余人须离开；无人分摊则失败
 * - 凋零之光：计时结束仍在领域内则秒杀
 * - 6 分钟暮光爆发硬狂暴
 */
export const UltraxionEncounter: BossEncounterModule = {
  id: 'ultraxion',
  name: '奥卓克希昂',
  dungeonId: 'dragon_soul',
  tier: '20man',

  createSkills(bossAi: UltraxionAiState): BossSkill[] {
    const ai = bossAi;
    return [
      {
        id: 'unstable_monstrosity',
        name: '不稳定的畸变脉冲',
        castTimeMs: 800,
        cooldownMs: 6000,
        lastCastMs: -3000,
        interruptible: false,
        school: 'SHADOW',
        range: 360,
        targetKind: 'AOE',
        description: '领域内近距分摊暗影脉冲；战斗越久间隔越短（6s→1s）',
        execute: (boss, engine) => {
          const living = livingFriendlies(engine);
          const inRealm = living.filter(isInTwilightRealm);
          // 总池按编制缩放：5 人约 48k，20 人约 120k，领域内均摊
          const pool = living.length >= 15 ? 120_000 : 48_000;
          if (inRealm.length === 0) {
            engine.effectsManager?.addFloatingText({
              targetId: boss.id,
              text: '畸变：领域内无人（未分摊）',
              category: 'STATUS',
              isCrit: false,
            });
          } else {
            const each = Math.max(1, Math.round(pool / inRealm.length));
            for (const u of inRealm) {
              engine.dealDamage(boss, u, each, 'SHADOW', false, '不稳定的畸变');
            }
          }
          const interval = monstrosityIntervalMs(ai.ultraxFightMs || 0);
          const skill = ai as { skills?: BossSkill[] };
          const mono = skill.skills?.find(s => s.id === 'unstable_monstrosity');
          if (mono) mono.cooldownMs = interval;
        },
      },
      {
        id: 'hour_of_twilight',
        name: '暮光时刻',
        castTimeMs: 5000,
        cooldownMs: 45_000,
        lastCastMs: -20_000,
        interruptible: false,
        school: 'SHADOW',
        range: 450,
        targetKind: 'AOE',
        description: '指定分摊组留在领域内吸收；余人须英勇意志离开；无人分摊则失败',
        dbm: {
          advice: '分摊或点英勇意志离开领域',
          voiceText: '暮光时刻',
          severity: 'CRITICAL',
          preWarnMs: 0,
        },
        execute: (boss, engine) => {
          const living = livingFriendlies(engine);
          const soakIds = new Set(ai.ultraxSoakIds || []);
          const soakers = living.filter(u => soakIds.has(u.id) && isInTwilightRealm(u));
          // 误留领域的非分摊者吃重击
          for (const u of living) {
            if (soakIds.has(u.id)) continue;
            if (isInTwilightRealm(u)) {
              engine.dealDamage(boss, u, 85_000, 'SHADOW', true, '暮光时刻(未离开)');
            }
          }
          if (soakers.length === 0) {
            ai.ultraxHourFail = true;
            for (const u of living) {
              engine.dealDamage(boss, u, 999_999, 'SHADOW', true, '暮光时刻(无人分摊)');
            }
            engine.effectsManager?.addFloatingText({
              targetId: boss.id,
              text: '💀 暮光时刻无人分摊！守护者陨落！',
              category: 'CRIT',
              isCrit: true,
            });
            return;
          }
          const soakPool = living.length >= 15 ? 180_000 : 90_000;
          const each = Math.max(1, Math.round(soakPool / soakers.length));
          for (const u of soakers) {
            engine.dealDamage(boss, u, each, 'SHADOW', true, '暮光时刻');
          }
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: `🌑 暮光时刻：${soakers.length} 人分摊`,
            category: 'CRIT',
            isCrit: true,
          });
          ai.ultraxSoakIds = undefined;
        },
      },
      {
        id: 'twilight_eruption',
        name: '暮光爆发',
        castTimeMs: 5000,
        cooldownMs: 999_999_999,
        lastCastMs: 0,
        interruptible: false,
        school: 'SHADOW',
        range: 600,
        targetKind: 'AOE',
        description: '约 6 分钟硬狂暴：全团灭团',
        execute: (boss, engine) => {
          ai.ultraxEnraged = true;
          for (const u of livingFriendlies(engine)) {
            engine.dealDamage(boss, u, 999_999, 'SHADOW', true, '暮光爆发');
          }
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '💥 暮光爆发！硬狂暴灭团！',
            category: 'CRIT',
            isCrit: true,
          });
        },
      },
    ];
  },

  onTick(deltaMs, boss, engine, bossAiRaw) {
    const ai = bossAiRaw as UltraxionAiState & { skills: BossSkill[]; currentCasting: { skill: BossSkill; elapsedMs: number } | null };
    ensureMaps(ai);
    ai.ultraxFightMs = (ai.ultraxFightMs || 0) + deltaMs;

    // 开战灌入暮光领域
    if (!ai.ultraxRealmSeeded) {
      ai.ultraxRealmSeeded = true;
      for (const u of livingFriendlies(engine)) {
        enterTwilightRealm(engine, u, boss.id);
      }
      engine.effectsManager?.addFloatingText({
        targetId: boss.id,
        text: '🌀 进入暮光领域！使用英勇意志可短暂离开',
        category: 'STATUS',
        isCrit: true,
      });
    }

    // 冷却与自动回进领域
    for (const u of engine.friendlyUnits) {
      const cd = Math.max(0, (ai.ultraxWillCdMs!.get(u.id) || 0) - deltaMs);
      ai.ultraxWillCdMs!.set(u.id, cd);
      const outUntil = ai.ultraxOutUntilMs!.get(u.id);
      if (outUntil != null && (ai.ultraxFightMs || 0) >= outUntil) {
        ai.ultraxOutUntilMs!.delete(u.id);
        if ((u.alive ?? u.isAlive) && (u.hp ?? 0) > 0 && !isInTwilightRealm(u)) {
          enterTwilightRealm(engine, u, boss.id);
          engine.effectsManager?.addFloatingText({
            targetId: u.id,
            text: '重新进入暮光领域',
            category: 'STATUS',
            isCrit: false,
          });
        }
      }
    }

    // 动态刷新畸变 CD 展示（即使尚未施放）
    const mono = ai.skills?.find(s => s.id === 'unstable_monstrosity');
    if (mono) mono.cooldownMs = monstrosityIntervalMs(ai.ultraxFightMs || 0);

    // 暮光时刻读条开始时点名分摊组，并让非分摊 AI 自动英勇意志
    const casting = ai.currentCasting;
    if (casting?.skill.id === 'hour_of_twilight') {
      if (!ai.ultraxSoakIds) {
        const living = livingFriendlies(engine);
        const soakCount = living.length >= 15 ? 5 : Math.min(2, living.length);
        ai.ultraxSoakIds = pickSoakGroup(living, soakCount);
        for (const u of living) {
          const isSoak = ai.ultraxSoakIds.includes(u.id);
          engine.effectsManager?.addFloatingText({
            targetId: u.id,
            text: isSoak ? '🛡️ 暮光时刻：留下分摊！' : '🏃 暮光时刻：离开领域！',
            category: 'STATUS',
            isCrit: isSoak,
          });
        }
      }
      // AI / 非玩家：非分摊者提前离开
      for (const u of livingFriendlies(engine)) {
        if (u.isPlayer) continue;
        if (ai.ultraxSoakIds?.includes(u.id)) continue;
        if (isInTwilightRealm(u)) useHeroicWill(engine, ai, u);
      }
    }

    // 凋零之光：约每 40s 点名坦克 + 1 随机
    ai.ultraxFadingAcc = (ai.ultraxFadingAcc || 0) + deltaMs;
    if ((ai.ultraxFadingAcc || 0) >= 40_000) {
      ai.ultraxFadingAcc = 0;
      const living = livingFriendlies(engine);
      const tank = pickWeightedBossTarget(living.filter(u => u.role === 'TANK'));
      const others = living.filter(u => u.id !== tank?.id);
      const random = pickWeightedBossTarget(others);
      const duration = 8000;
      if (tank) applyFadingLight(engine, boss, ai, tank, duration);
      if (random) applyFadingLight(engine, boss, ai, random, duration);
    }

    // 推进凋零计时；到期仍在领域 → 秒杀；AI 提前离开
    for (const [uid, left] of [...(ai.ultraxFadingLeftMs || new Map())]) {
      const next = left - deltaMs;
      const u = engine.friendlyUnits.find(x => x.id === uid);
      if (!u || !(u.alive ?? u.isAlive) || (u.hp ?? 0) <= 0) {
        ai.ultraxFadingLeftMs!.delete(uid);
        continue;
      }
      if (next <= 0) {
        ai.ultraxFadingLeftMs!.delete(uid);
        u.buffs = (u.buffs || []).filter(b => b.spellId !== FADING_LIGHT_SPELL_ID);
        if (isInTwilightRealm(u)) {
          engine.dealDamage(boss, u, 999_999, 'SHADOW', true, '凋零之光');
          engine.effectsManager?.addFloatingText({
            targetId: u.id,
            text: '💀 凋零之光到期（仍在领域）',
            category: 'CRIT',
            isCrit: true,
          });
        }
        continue;
      }
      ai.ultraxFadingLeftMs!.set(uid, next);
      // AI 在剩余 <2.5s 时自动英勇意志
      if (!u.isPlayer && next <= 2500 && isInTwilightRealm(u)) {
        useHeroicWill(engine, ai, u);
      }
    }

    // 6 分钟硬狂暴：强制开始暮光爆发读条（若尚未）
    if (!ai.ultraxEnraged && (ai.ultraxFightMs || 0) >= TWILIGHT_ERUPTION_MS) {
      const erupt = ai.skills?.find(s => s.id === 'twilight_eruption');
      if (erupt && !ai.currentCasting) {
        erupt.lastCastMs = engine.nowMs;
        // 下一帧 BaseBossAI 会选中；若其它技能占着，直接开读条
        ai.currentCasting = { skill: erupt, elapsedMs: 0 };
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
          text: '⚠️ 暮光爆发读条！硬狂暴！',
          category: 'CRIT',
          isCrit: true,
        });
      }
    }
  },
};
