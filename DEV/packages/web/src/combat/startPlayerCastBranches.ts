import type { CombatEngine, Unit } from '@cata-raid-sim/engine';
import {
  getHastedCastTimeMs,
  getUnitHaste,
  LEVEL_80_MAX_HASTE,
} from '@cata-raid-sim/engine';
import type { ActionSlot, PlayerCastState } from '../components/ActionBar.js';

export type StartPlayerCastBranchesCtx = {
  engine: CombatEngine;
  player: Unit;
  slot: ActionSlot;
  effectiveFriendly: Unit;
  effectiveTarget: Unit;
  isInstantViaNs: boolean;
  maxAllowedRange: number;
  triggerSlotCooldown: (explicitCdMs?: number) => void;
  startPlayerCast: (state: PlayerCastState) => void;
  onFriendlyUnitsChanged: () => void;
};

/**
 * Nature's Swiftness + hardcoded read-bar / channel starters.
 * Returns true if handled (caller should stop).
 */
export function startPlayerCastBranches(ctx: StartPlayerCastBranchesCtx): boolean {
  const {
    engine,
    player,
    slot,
    effectiveFriendly,
    effectiveTarget,
    isInstantViaNs,
    maxAllowedRange,
    triggerSlotCooldown,
    startPlayerCast,
    onFriendlyUnitsChanged,
  } = ctx;

    // ── Druid: Nature's Swiftness (自然迅捷) ──
    if (slot.spellId === 'natures_swiftness') {
      engine.applyBuff(player, {
        id: `ns_${Date.now()}`,
        spellId: 'natures_swiftness',
        name: '自然迅捷',
        kind: 'BUFF',
        tags: ['STAT'],
        sourceUnitId: player.id,
        targetUnitId: player.id,
        stacks: 1,
        maxStacks: 1,
        durationMs: 60000,
        remainingMs: 60000,
        school: 'NATURE',
      });
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '⚡ 自然迅捷已激活！(下一自然法术瞬发+50%治疗)',
        category: 'STATUS',
        isCrit: false,
      });
      triggerSlotCooldown();
      return true;
    }

    // ── Nature's Swiftness Instant Cast Consumption ──
    if (isInstantViaNs) {
      // 消耗自然迅捷 buff
      player.buffs = player.buffs.filter(b => b.spellId !== 'natures_swiftness');

      if (slot.spellId === 'healing_touch') {
        const target = effectiveFriendly;
        const isCrit = Math.random() < 0.35;
        const healVal = Math.round(34000 * 1.5);
        engine.healUnit(player, target, healVal, isCrit, '治疗之触 (自然迅捷)');
        engine.effectsManager?.addFloatingText({
          targetId: target.id,
          text: '⚡ 自然迅捷·治疗之触！',
          category: 'HEAL',
          isCrit: true,
        });
        triggerSlotCooldown();
        return true;
      } else if (slot.spellId === 'regrowth') {
        const target = effectiveFriendly;
        const isCrit = Math.random() < 0.3;
        const healVal = Math.round(16000 * 1.5);
        engine.healUnit(player, target, healVal, isCrit, '愈合 (自然迅捷)');
        engine.applyBuff(target, {
          id: `regrowth_${Date.now()}`,
          spellId: 'regrowth',
          name: '愈合 (HoT)',
          kind: 'BUFF',
          tags: ['HOT'],
          sourceUnitId: player.id,
          targetUnitId: target.id,
          stacks: 1,
          maxStacks: 1,
          durationMs: 6000,
          remainingMs: 6000,
          school: 'NATURE',
          tickIntervalMs: 2000,
          tickValue: 3200,
        });
        engine.effectsManager?.addFloatingText({
          targetId: target.id,
          text: '⚡ 自然迅捷·愈合！',
          category: 'HEAL',
          isCrit: true,
        });
        triggerSlotCooldown();
        return true;
      } else if (slot.spellId === 'nourish') {
        const target = effectiveFriendly;
        const isCrit = Math.random() < 0.25;
        const hasHot = target.buffs.some(b => ['rejuvenation', 'regrowth', 'lifebloom', 'wild_growth'].includes(b.spellId));
        const baseVal = hasHot ? Math.round(9500 * 1.2) : 9500;
        const healVal = Math.round(baseVal * 1.5);
        engine.healUnit(player, target, healVal, isCrit, '滋养 (自然迅捷)');
        engine.effectsManager?.addFloatingText({
          targetId: target.id,
          text: '⚡ 自然迅捷·滋养！',
          category: 'HEAL',
          isCrit: true,
        });
        triggerSlotCooldown();
        return true;
      } else if (slot.spellId === 'wrath') {
        if (effectiveTarget && (effectiveTarget.isAlive ?? effectiveTarget.alive) && effectiveTarget.hp > 0) {
          const isCrit = Math.random() < 0.3;
          engine.dealDamage(player, effectiveTarget, 13500, 'NATURE', isCrit, '愤怒 (自然迅捷)');
          engine.threatManager.addThreat(effectiveTarget.id, player.id, 13500);
          engine.effectsManager?.addFloatingText({
            targetId: effectiveTarget.id,
            text: '⚡ 自然迅捷·愤怒！',
            category: 'SPELL_NATURE',
            isCrit: true,
          });
        }
        triggerSlotCooldown();
        return true;
      } else if (slot.spellId === 'rebirth') {
        const deadTarget = effectiveFriendly;
        if (deadTarget && ((!deadTarget.isAlive && !deadTarget.alive) || deadTarget.hp <= 0)) {
          engine.resurrectUnit(deadTarget.id, 0.6, 0.6);
          engine.effectsManager?.addFloatingText({
            targetId: deadTarget.id,
            text: '⚡ 自然迅捷·复生！(瞬发战复)',
            category: 'HEAL',
            isCrit: true,
          });
          onFriendlyUnitsChanged();
        }
        triggerSlotCooldown(600000);
        return true;
      } else if (slot.spellId === 'revive') {
        const deadTarget = effectiveFriendly;
        // Always go through resurrectUnit so withNetworkVitals can publish RESURRECT
        if (deadTarget && engine.resurrectUnit(deadTarget.id, 0.35, 0.35)) {
          engine.effectsManager?.addFloatingText({
            targetId: deadTarget.id,
            text: '⚡ 自然迅捷·起死回生！',
            category: 'STATUS',
            isCrit: true,
          });
          onFriendlyUnitsChanged();
        }
        triggerSlotCooldown();
        return true;
      }
    }

    // Spells with Cast Bars or Channels (hasted cast times, including Bloodlust)
    const hasted = (baseMs: number) =>
      getHastedCastTimeMs(baseMs, getUnitHaste(player, LEVEL_80_MAX_HASTE));

    if (slot.spellId === 'fireball') {
      startPlayerCast({
        spellName: '火球术',
        spellId: 'fireball',
        progress: 0,
        elapsedMs: 0,
        totalMs: hasted(2250),
        targetId: effectiveTarget.id,
        isHarmful: true,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return true;
    } else if (slot.spellId === 'pyroblast') {
      startPlayerCast({
        spellName: '炎爆术',
        spellId: 'pyroblast',
        progress: 0,
        elapsedMs: 0,
        totalMs: hasted(3500),
        targetId: effectiveTarget.id,
        isHarmful: true,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return true;
    } else if (slot.spellId === 'frostbolt') {
      startPlayerCast({
        spellName: '寒冰箭',
        spellId: 'frostbolt',
        progress: 0,
        elapsedMs: 0,
        totalMs: hasted(2000),
        targetId: effectiveTarget.id,
        isHarmful: true,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return true;
    } else if (slot.spellId === 'arcane_blast') {
      startPlayerCast({
        spellName: '奥术冲击',
        spellId: 'arcane_blast',
        progress: 0,
        elapsedMs: 0,
        totalMs: hasted(2000),
        targetId: effectiveTarget.id,
        isHarmful: true,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return true;
    } else if (slot.spellId === 'arcane_missiles') {
      startPlayerCast({
        spellName: '奥术飞弹 (引导施法中...)',
        spellId: 'arcane_missiles',
        progress: 0,
        elapsedMs: 0,
        totalMs: hasted(2500),
        isChannel: true,
        targetId: effectiveTarget.id,
        isHarmful: true,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return true;
    } else if (slot.spellId === 'wrath') {
      startPlayerCast({
        spellName: '愤怒',
        spellId: 'wrath',
        progress: 0,
        elapsedMs: 0,
        totalMs: hasted(1500),
        targetId: effectiveTarget.id,
        isHarmful: true,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return true;
    } else if (slot.spellId === 'starfire') {
      startPlayerCast({
        spellName: '星火术',
        spellId: 'starfire',
        progress: 0,
        elapsedMs: 0,
        totalMs: hasted(2700),
        targetId: effectiveTarget.id,
        isHarmful: true,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return true;
    } else if (slot.spellId === 'starsurge') {
      startPlayerCast({
        spellName: '星涌术',
        spellId: 'starsurge',
        progress: 0,
        elapsedMs: 0,
        totalMs: hasted(2000),
        targetId: effectiveTarget.id,
        isHarmful: true,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 15000,
      });
      return true;
    } else if (slot.spellId === 'lightning_bolt') {
      startPlayerCast({
        spellName: '闪电箭',
        spellId: 'lightning_bolt',
        progress: 0,
        elapsedMs: 0,
        totalMs: hasted(2000),
        targetId: effectiveTarget.id,
        isHarmful: true,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return true;
    } else if (slot.spellId === 'lava_burst') {
      startPlayerCast({
        spellName: '熔岩爆裂',
        spellId: 'lava_burst',
        progress: 0,
        elapsedMs: 0,
        totalMs: hasted(1500),
        targetId: effectiveTarget.id,
        isHarmful: true,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 8000,
      });
      return true;
    } else if (slot.spellId === 'chain_lightning') {
      startPlayerCast({
        spellName: '闪电链',
        spellId: 'chain_lightning',
        progress: 0,
        elapsedMs: 0,
        totalMs: hasted(2000),
        targetId: effectiveTarget.id,
        isHarmful: true,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 3000,
      });
      return true;
    } else if (slot.spellId === 'healing_wave') {
      startPlayerCast({
        spellName: '治疗波',
        spellId: 'healing_wave',
        progress: 0,
        elapsedMs: 0,
        totalMs: hasted(2500),
        targetId: effectiveTarget.id,
        isHarmful: false,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return true;
    } else if (slot.spellId === 'healing_surge') {
      startPlayerCast({
        spellName: '治疗之涌',
        spellId: 'healing_surge',
        progress: 0,
        elapsedMs: 0,
        totalMs: hasted(1500),
        targetId: effectiveTarget.id,
        isHarmful: false,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return true;
    } else if (slot.spellId === 'greater_healing_wave') {
      startPlayerCast({
        spellName: '强效治疗波',
        spellId: 'greater_healing_wave',
        progress: 0,
        elapsedMs: 0,
        totalMs: hasted(2500),
        targetId: effectiveTarget.id,
        isHarmful: false,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return true;
    } else if (slot.spellId === 'nourish') {
      startPlayerCast({
        spellName: '滋养',
        spellId: 'nourish',
        progress: 0,
        elapsedMs: 0,
        totalMs: hasted(2500),
        targetId: effectiveTarget.id,
        isHarmful: false,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return true;
    } else if (slot.spellId === 'regrowth') {
      startPlayerCast({
        spellName: '愈合',
        spellId: 'regrowth',
        progress: 0,
        elapsedMs: 0,
        totalMs: hasted(1500),
        targetId: effectiveTarget.id,
        isHarmful: false,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return true;
    } else if (slot.spellId === 'healing_touch') {
      startPlayerCast({
        spellName: '治疗之触',
        spellId: 'healing_touch',
        progress: 0,
        elapsedMs: 0,
        totalMs: hasted(2500),
        targetId: effectiveTarget.id,
        isHarmful: false,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return true;
    } else if (slot.spellId === 'tranquility') {
      startPlayerCast({
        spellName: '宁静 (引导施法中...)',
        spellId: 'tranquility',
        progress: 0,
        elapsedMs: 0,
        totalMs: hasted(8000),
        isChannel: true,
        targetId: player.id,
        isHarmful: false,
        maxAllowedRange: 360,
        totalCdMs: slot.totalCdMs || 180000,
      });
      return true;
    } else if (slot.spellId === 'rebirth') {
      startPlayerCast({
        spellName: '复生 (战斗复活)',
        spellId: 'rebirth',
        progress: 0,
        elapsedMs: 0,
        totalMs: hasted(2000),
        targetId: effectiveTarget.id,
        isHarmful: false,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 600000,
      });
      return true;
    } else if (slot.spellId === 'revive' || slot.spellId === 'ancestral_spirit') {
      startPlayerCast({
        spellName: slot.name,
        spellId: slot.spellId,
        progress: 0,
        elapsedMs: 0,
        totalMs: hasted(3000),
        targetId: effectiveTarget.id,
        isHarmful: false,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return true;
    }

    // Instant / dispel / data-driven effects (extracted)
  return false;
}
