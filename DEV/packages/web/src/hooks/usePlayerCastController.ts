import {
  getSpellByAnyId,
  LEVEL_80_MAX_HASTE,
  getHastedCastTimeMs,
  type CombatEngine,
  type Unit,
  type SpellResourceCostBundle,
} from '@cata-raid-sim/engine';
import type { PlayerCastState } from '../components/ActionBar.js';
import { emitLocalAoePulse } from '../combat/emitLocalAoePulse.js';

/**
 * usePlayerCastController — 玩家施法/引导资源校验、扣除与引导跳数结算模块
 *
 * 从 App.tsx 抽离的核心领域逻辑，严格遵守 CastLifecycle 三态契约：
 * - 读条（CASTED）：起手仅校验，完成才扣资源与触发冷却；打断 0 消耗 0 冷却。
 * - 引导（CHANNELED）：起手即扣资源与触发冷却，周期结算每跳效果；打断保留冷却与消耗，结束不重复进 CD。
 * - 瞬发（INSTANT）：起手即扣资源、进冷却并结算。
 */

export function hasSufficientPlayerResources(
  player: Unit,
  costs: SpellResourceCostBundle
): { ok: boolean; errorText?: string; floatText?: string } {
  if ((costs.mana ?? 0) > 0 && player.maxMp && player.maxMp > 0) {
    if ((player.mp ?? 0) < (costs.mana ?? 0)) {
      return { ok: false, errorText: '法力值不足', floatText: '⚠️ 法力值不足！' };
    }
  }
  if ((costs.energy ?? 0) > 0 && player.classId === 'ROGUE') {
    if ((player.energy ?? 100) < (costs.energy ?? 0)) {
      return { ok: false, errorText: '能量不足', floatText: '⚠️ 能量值不足！' };
    }
  }
  if ((costs.rage ?? 0) > 0 && (player.classId === 'WARRIOR' || (player.classId === 'DRUID' && player.role === 'TANK'))) {
    if ((player.rage ?? 0) < (costs.rage ?? 0)) {
      return { ok: false, errorText: '怒气不足', floatText: '⚠️ 怒气不足！' };
    }
  }
  if ((costs.focus ?? 0) > 0 && player.classId === 'HUNTER') {
    if ((player.focus ?? 100) < (costs.focus ?? 0)) {
      return { ok: false, errorText: '集中值不足', floatText: '⚠️ 集中值不足！' };
    }
  }
  if ((costs.runicPower ?? 0) > 0 && player.classId === 'DK') {
    if ((player.runicPower ?? 0) < (costs.runicPower ?? 0)) {
      return { ok: false, errorText: '符能不足', floatText: '⚠️ 符能不足！' };
    }
  }
  if ((costs.holyPower ?? 0) > 0 && player.classId === 'PALADIN') {
    if ((player.holyPower ?? 0) < (costs.holyPower ?? 0)) {
      return { ok: false, errorText: '神圣能量不足', floatText: '⚠️ 神圣能量不足！' };
    }
  }
  return { ok: true };
}

export function deductPlayerResources(
  player: Unit,
  costs: SpellResourceCostBundle,
  syncUnitResources: (unit: Unit) => void
): void {
  if ((costs.mana ?? 0) > 0 && player.maxMp && player.maxMp > 0) {
    player.mp = Math.max(0, (player.mp ?? 0) - (costs.mana ?? 0));
  }
  if ((costs.energy ?? 0) > 0 && player.classId === 'ROGUE') {
    player.energy = Math.max(0, (player.energy ?? 100) - (costs.energy ?? 0));
  }
  if ((costs.rage ?? 0) > 0 && (player.classId === 'WARRIOR' || (player.classId === 'DRUID' && player.role === 'TANK'))) {
    player.rage = Math.max(0, (player.rage ?? 0) - (costs.rage ?? 0));
  }
  if ((costs.focus ?? 0) > 0 && player.classId === 'HUNTER') {
    player.focus = Math.max(0, (player.focus ?? 100) - (costs.focus ?? 0));
  }
  if ((costs.runicPower ?? 0) > 0 && player.classId === 'DK') {
    player.runicPower = Math.max(0, (player.runicPower ?? 0) - (costs.runicPower ?? 0));
  }
  if ((costs.holyPower ?? 0) > 0 && player.classId === 'PALADIN') {
    player.holyPower = Math.max(0, (player.holyPower ?? 0) - (costs.holyPower ?? 0));
  }
  syncUnitResources(player);
}

/** 计算区间 (prevElapsed, newElapsed] 内应当触发的引导跳数（结束时自动补齐因取整缺失的尾跳） */
function countTriggeredChannelTicks(
  prevElapsed: number,
  newElapsed: number,
  totalMs: number,
  totalTicks: number
): number {
  const safeTotal = Math.max(1, totalMs);
  const safeTicks = Math.max(1, totalTicks);
  const tickInterval = safeTotal / safeTicks;
  const prevCount = Math.min(safeTicks, Math.floor(Math.max(0, prevElapsed) / tickInterval));
  const nextCount =
    newElapsed >= safeTotal
      ? safeTicks
      : Math.min(safeTicks, Math.floor(Math.max(0, newElapsed) / tickInterval));
  return Math.max(0, nextCount - prevCount);
}

/**
 * 结算引导技能在 `[prevElapsed, newElapsed]` 区间内触发的周期跳数（覆盖全 10 职业所有引导技能）
 */
export function processPlayerChannelTick(
  prev: PlayerCastState,
  newElapsed: number,
  engine: CombatEngine,
  player: Unit,
  syncUnitResources: (unit: Unit) => void
): void {
  if (!player || (!player.isAlive && !player.alive)) return;

  const boss = engine.bossUnit;
  const targetUnit =
    (prev.targetId && engine.friendlyUnits.find(u => u.id === prev.targetId)) ||
    (prev.targetId && engine.enemyUnits.find(u => u.id === prev.targetId)) ||
    (prev.isHarmful ? boss : player);

  if (prev.spellId === 'tranquility' || prev.spellId === 'druid_tranquility') {
    const ticks = countTriggeredChannelTicks(prev.elapsedMs, newElapsed, prev.totalMs, 4);
    for (let i = 0; i < ticks; i++) {
      for (const u of engine.friendlyUnits) {
        if ((u.alive || u.isAlive) && u.hp > 0) {
          engine.healUnit(player, u, 12000, Math.random() < 0.25, '宁静');
        }
      }
      emitLocalAoePulse(engine, {
        actor: player,
        spellId: 'druid_tranquility',
        spellName: '宁静',
        targetId: player.id,
        x: player.position?.x ?? 200,
        y: player.position?.y ?? 200,
        radius: 360,
        isHeal: true,
        tone: 'HEAL',
      });
    }
    return;
  }

  if (prev.spellId === 'divine_hymn' || prev.spellId === 'priest_divine_hymn') {
    const ticks = countTriggeredChannelTicks(prev.elapsedMs, newElapsed, prev.totalMs, 4);
    for (let i = 0; i < ticks; i++) {
      const injured = engine.friendlyUnits
        .filter(u => (u.alive || u.isAlive) && u.hp > 0)
        .sort((a, b) => a.hp / Math.max(1, a.maxHp) - b.hp / Math.max(1, b.maxHp))
        .slice(0, 5);
      for (const u of injured) {
        engine.healUnit(player, u, 11500, Math.random() < 0.25, '神圣赞美诗');
      }
      emitLocalAoePulse(engine, {
        actor: player,
        spellId: 'priest_divine_hymn',
        spellName: '神圣赞美诗',
        targetId: player.id,
        x: player.position?.x ?? 200,
        y: player.position?.y ?? 200,
        radius: 360,
        isHeal: true,
        tone: 'HEAL',
      });
    }
    return;
  }

  if (prev.spellId === 'arcane_missiles' || prev.spellId === 'mage_arcane_missiles') {
    const ticks = countTriggeredChannelTicks(prev.elapsedMs, newElapsed, prev.totalMs, 5);
    for (let i = 0; i < ticks; i++) {
      const enemy = targetUnit && targetUnit.role === 'ENEMY' ? targetUnit : boss;
      if (enemy && (enemy.isAlive || enemy.alive) && enemy.hp > 0) {
        engine.dealDamage(player, enemy, 5500, 'ARCANE', Math.random() < 0.3, '奥术飞弹');
        engine.threatManager.addThreat(enemy.id, player.id, 5500);
      }
    }
    return;
  }

  if (prev.spellId === 'evocation' || prev.spellId === 'mage_evocation') {
    const ticks = countTriggeredChannelTicks(prev.elapsedMs, newElapsed, prev.totalMs, 3);
    for (let i = 0; i < ticks; i++) {
      const maxMp = player.maxMp ?? 35000;
      const gain = Math.round(maxMp * 0.2);
      player.mp = Math.min(maxMp, (player.mp ?? 0) + gain);
      syncUnitResources(player);
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: `+${gain} 法力 (唤醒)`,
        category: 'STATUS',
        isCrit: false,
      });
    }
    return;
  }

  // Generic ClassRegistry channeled spells (Penance, Mind Flay, Mind Sear, Drain Soul, Army of the Dead, etc.)
  const norm = getSpellByAnyId(prev.spellId, player.classId);
  const pulseCount = norm?.id.includes('penance') ? 3 : 4;
  const ticks = countTriggeredChannelTicks(prev.elapsedMs, newElapsed, prev.totalMs, pulseCount);
  for (let i = 0; i < ticks; i++) {
    if (norm?.isHeal) {
      const healTarget = targetUnit && targetUnit.role !== 'ENEMY' ? targetUnit : player;
      const perTick = Math.max(2500, Math.round((norm.directHeal || 12000) / pulseCount));
      if (norm.isAOE) {
        for (const u of engine.friendlyUnits) {
          if ((u.alive || u.isAlive) && u.hp > 0) {
            engine.healUnit(player, u, perTick, Math.random() < 0.25, norm.name);
          }
        }
        emitLocalAoePulse(engine, {
          actor: player,
          spellId: norm.id,
          spellName: norm.name,
          targetId: player.id,
          x: player.position?.x ?? 200,
          y: player.position?.y ?? 200,
          radius: 300,
          isHeal: true,
          tone: 'HEAL',
        });
      } else if (healTarget && (healTarget.alive || healTarget.isAlive) && healTarget.hp > 0) {
        engine.healUnit(player, healTarget, perTick, Math.random() < 0.25, norm.name);
      }
    } else {
      const enemy = targetUnit && targetUnit.role === 'ENEMY' ? targetUnit : boss;
      if (enemy && (enemy.isAlive || enemy.alive) && enemy.hp > 0) {
        const perTick = Math.max(2000, Math.round((norm?.directDamage || 10000) / pulseCount));
        const isCrit = Math.random() < 0.28;
        engine.dealDamage(player, enemy, perTick, norm?.school || 'SHADOW', isCrit, norm?.name || prev.spellName);
        engine.threatManager.addThreat(enemy.id, player.id, perTick);
      }
    }
  }
}

export function getPlayerChannelDurationMs(spellId: string, classId: Unit['classId'], haste: number): number {
  const norm = getSpellByAnyId(spellId, classId);
  const baseMs = norm?.channelDurationMs && norm.channelDurationMs > 0
    ? norm.channelDurationMs
    : spellId === 'tranquility'
    ? 8000
    : spellId === 'arcane_missiles'
    ? 2500
    : 3000;
  return getHastedCastTimeMs(baseMs, haste ?? LEVEL_80_MAX_HASTE);
}
