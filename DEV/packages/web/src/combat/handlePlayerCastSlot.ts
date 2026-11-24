import type {
  CombatEngine,
  Unit,
  GroundTargetState,
  SpellResourceCostBundle,
  BossAI,
  CharacterRecord,
} from '@cata-raid-sim/engine';
import type { NetworkCooldownTimeline } from '@cata-raid-sim/engine';
import {
  GROUND_TARGET_SPELL_DEFS,
  LEVEL_80_MAX_HASTE,
  getEffectiveGcdMs,
  getHastedCastTimeMs,
  getSpellByAnyId,
  getSpellGcdCategory,
  classifySpellCastMode,
  getCastLifecyclePolicy,
  isChanneledSpell,
  resolveCooldownSpellIds,
  isTotemUnit,
  isTotemGroundEffectId,
  isValidLifebloomTarget,
  getUnitHaste,
} from '@cata-raid-sim/engine';
import { deductPlayerResources } from '../hooks/usePlayerCastController.js';
import type { ActionSlot, PlayerCastState } from '../components/ActionBar.js';
import { isOffGcdSpell } from '../components/ActionBar.js';
import type { IncomingHealCast } from '../components/RaidFrames.js';
import { DEFAULT_SPELL_COOLDOWNS } from '../assets/defaultActionSlots.js';
import { syncUnitResources } from './unitResources.js';
import { checkCastSlotResources } from './castResourceGates.js';
import { executePlayerInstantEffects } from './executePlayerInstantEffects.js';
import { startPlayerCastBranches } from './startPlayerCastBranches.js';
import { computePlayerGcdMs } from './playerGcd.js';

/** Local CD map + shared-CD aliases — action-bar / cast gates. */
function asPlayerClassId(
  classId: CharacterRecord['classId'] | Unit['classId'] | null | undefined
): CharacterRecord['classId'] | undefined {
  if (!classId || classId === 'BOSS' || classId === 'NPC') return undefined;
  return classId;
}

export function getEffectivePlayerCooldownMs(
  spellId: string,
  opts: {
    slotCdRemainingMs?: number;
    playerCooldowns: Record<string, { cdRemainingMs: number; totalCdMs: number }>;
    /** @deprecated Guest CD is local-only; ignored if present */
    unitId?: string | null;
    /** @deprecated Guest CD is local-only; ignored if present */
    guestCdTimelines?: NetworkCooldownTimeline[] | null;
    classId?: CharacterRecord['classId'] | Unit['classId'];
  }
): number {
  let best = Math.max(0, opts.slotCdRemainingMs || 0);
  for (const id of resolveCooldownSpellIds(spellId, asPlayerClassId(opts.classId))) {
    best = Math.max(best, opts.playerCooldowns[id]?.cdRemainingMs || 0);
  }
  return best;
}

const FRIENDLY_SPELL_IDS = new Set([
  'rejuvenation', 'lifebloom', 'regrowth', 'healing_touch', 'nourish', 'swiftmend',
  'wild_growth', 'tranquility', 'rebirth', 'revive', 'natures_cure', 'riptide',
  'healing_wave', 'healing_surge', 'greater_healing_wave', 'chain_heal',
  'healing_rain', 'spirit_link', 'cleanse_spirit', 'ancestral_spirit',
  'innervate', 'remove_curse', 'remove_corruption', 'bone_shield',
  'vampiric_blood', 'pillar_of_frost', 'horn_of_winter', 'slice_and_dice',
  'adrenaline_rush', 'feint', 'bloodlust', 'time_warp', 'arcane_power',
  'arcane_brilliance', 'mark_of_the_wild', 'natures_swiftness',
]);

/** Guest → host CAST target: mirror host friendly/hostile retarget; never send boss for heals. */
export function resolveGuestOutboundTargetId(opts: {
  spellId: string;
  classId?: CharacterRecord['classId'];
  selectedTargetId: string | null;
  bossTargetId: string | null;
  playerId: string;
  bossId: string | null;
  engine: CombatEngine;
}): string | null {
  const { spellId, classId, selectedTargetId, bossTargetId, playerId, bossId, engine } = opts;
  const norm = getSpellByAnyId(spellId, classId) || getSpellByAnyId(spellId);
  const isFriendlySpell =
    FRIENDLY_SPELL_IDS.has(spellId) ||
    Boolean(
      norm &&
        (norm.isHeal ||
          norm.isHot ||
          norm.isShield ||
          norm.isResurrect ||
          norm.isDispel ||
          norm.isBuff ||
          norm.isDefensive ||
          norm.isResourceRestore ||
          norm.targetType === 'SELF' ||
          norm.targetType === 'SINGLE_ALLY' ||
          norm.targetType === 'SMART_ALLY' ||
          norm.targetType === 'AOE_ALLY')
    );

  if (isFriendlySpell) {
    if (selectedTargetId) {
      const ally = engine.friendlyUnits.find((u) => u.id === selectedTargetId);
      if (ally && !isTotemUnit(ally)) return ally.id;
    }
    return playerId || null;
  }

  if (selectedTargetId) {
    const enemy = engine.enemyUnits.find(
      (u) => u.id === selectedTargetId && (u.isAlive ?? u.alive) && u.hp > 0
    );
    if (enemy) return enemy.id;
  }
  return bossTargetId || bossId || selectedTargetId || playerId || null;
}

export type HandlePlayerCastSlotCtx = {
  getPlayerSlots: () => ActionSlot[];
  engine: CombatEngine;
  currentChar: CharacterRecord | null | undefined;
  isNetworkGuest: boolean;
  netConnected: boolean;
  activeRoomId: string | null;
  /** Host CD timelines (guest only) — must gate casts the same way UI shows CDs */
  guestCdTimelinesRef?: { current: NetworkCooldownTimeline[] };
  sendNetworkCast: (payload: {
    kind: 'CAST' | 'GROUND_CAST' | 'SUMMON';
    playerId: string;
    spellId: string;
    spellName?: string;
    slotIndex?: number;
    targetId?: string | null;
    x?: number;
    y?: number;
    spawnKind?: 'PET' | 'ADD' | 'NPC';
  }) => void;
  bossTargetId: string | null;
  playerCast: PlayerCastState | null;
  playerGcdRemainingMs: number;
  playerCooldowns: Record<string, { cdRemainingMs: number; totalCdMs: number }>;
  groundTargetState: GroundTargetState | null;
  setGroundTargetState: (s: GroundTargetState | null) => void;
  lastPlayerMoveMs: number;
  selectedTargetId: string | null;
  setSelectedTargetId: (id: string | null) => void;
  setCastTargetId: (id: string | null) => void;
  runPhase: string;
  setAutoApproachTarget: (
    v: { targetX: number; targetY: number; desiredDist: number; pendingSlotIdx: number } | null
  ) => void;
  isApproaching: boolean;
  setIsApproaching: (v: boolean) => void;
  setPlayerGcdRemainingMs: (ms: number) => void;
  setPlayerGcdTotalMs: (ms: number) => void;
  triggerCooldown: (spellId: string, totalCdMs: number) => void;
  playerCastRef: { current: PlayerCastState | null };
  setPlayerCast: (s: PlayerCastState | null) => void;
  getPredictedHealAmount: (spellId: string, caster?: Unit) => number;
  setIncomingCasts: (
    updater: (prev: Record<string, IncomingHealCast[]>) => Record<string, IncomingHealCast[]>
  ) => void;
  setIncomingHeals: (updater: (prev: Record<string, number>) => Record<string, number>) => void;
  onFriendlyUnitsChanged: () => void;
  bossAi: BossAI | null;
  handleDispelUnit: (targetUnitId?: string | null) => void;
  onScreenShake: (ms: number) => void;
};

/**
 * Player cast-slot gate orchestration (network guest / GCD / CD / resources /
 * ground reticle / movement / targeting / range / lifecycle start).
 * Effect tables live in startPlayerCastBranches + executePlayerInstantEffects.
 */
export function handlePlayerCastSlot(slotIdx: number, ctx: HandlePlayerCastSlotCtx): void {
  const slots = ctx.getPlayerSlots();
  const slot = slots.find(s => s.slotIdx === slotIdx);
  if (!slot) return;

  const engine = ctx.engine;
  const player = engine.friendlyUnits.find(u => u.isPlayer) || (ctx.currentChar ? engine.getUnit(ctx.currentChar.id) : undefined);
  const boss = engine.bossUnit;

  // Asphyxiate / hard stun: cannot act
  if (player && engine.isUnitCrowdControlled?.(player)) {
    engine.effectsManager?.addFloatingText({
      targetId: player.id,
      text: '昏迷中，无法行动！',
      category: 'STATUS',
      isCrit: false,
    });
    return;
  }

  // Network guest: ground spells still open local reticle; other casts → host only
  // (HoT/DoT/dmg/heal come back via host COMBAT_STATE; avoids double-apply)
  if (ctx.isNetworkGuest && ctx.netConnected && ctx.activeRoomId && ctx.currentChar) {
    // Gate on slot UI CD + local map + host timelines (aliases). UI can show timeline CD
    // while playerCooldowns[slot] is still 0 — must not send CAST in that case.
    const guestCdRem = getEffectivePlayerCooldownMs(slot.spellId, {
      slotCdRemainingMs: slot.cdRemainingMs,
      playerCooldowns: ctx.playerCooldowns,
      unitId: ctx.currentChar.id,
      guestCdTimelines: ctx.guestCdTimelinesRef?.current,
      classId: ctx.currentChar.classId,
    });
    if (guestCdRem > 0) {
      engine.effectsManager?.addFloatingText({
        targetId: player?.id || ctx.currentChar.id,
        text: '法术还在冷却中！',
        category: 'STATUS',
        isCrit: false,
      });
      return;
    }
    const groundDef = GROUND_TARGET_SPELL_DEFS[slot.spellId];
    if (groundDef) {
      if (ctx.groundTargetState && ctx.groundTargetState.spellId === slot.spellId) {
        ctx.setGroundTargetState(null);
        return;
      }
      ctx.setGroundTargetState({
        slotIdx,
        spellId: slot.spellId,
        name: slot.name,
        radius: groundDef.radius,
        color: groundDef.color,
        maxRange: groundDef.maxRange,
      });
      return;
    }
    // Ignore re-press while a casted read-bar is already running (channels may clip).
    // Prefer ref — React state can lag one frame after optimistic setPlayerCast.
    const activeGuestCast = ctx.playerCastRef.current || ctx.playerCast;
    if (activeGuestCast && !activeGuestCast.isChannel) {
      return;
    }
    const isOffGcdGuest = isOffGcdSpell(slot.spellId);
    if (!isOffGcdGuest && ctx.playerGcdRemainingMs > 0) {
      engine.effectsManager?.addFloatingText({
        targetId: player?.id || ctx.currentChar.id,
        text: '公共冷却中！',
        category: 'STATUS',
        isCrit: false,
      });
      return;
    }
    // Friendly heals/HoTs/buffs must NOT fall back to bossTargetId/boss — that
    // hijacked guest heals onto the boss and made cast-heals/HoTs look broken.
    const targetId = resolveGuestOutboundTargetId({
      spellId: slot.spellId,
      classId: ctx.currentChar.classId,
      selectedTargetId: ctx.selectedTargetId,
      bossTargetId: ctx.bossTargetId,
      playerId: player?.id || ctx.currentChar.id,
      bossId: boss?.id || null,
      engine,
    });
    const totalCdMs =
      (slot.totalCdMs && slot.totalCdMs > 0
        ? slot.totalCdMs
        : DEFAULT_SPELL_COOLDOWNS[slot.spellId]) ||
      getSpellByAnyId(slot.spellId, ctx.currentChar.classId)?.cooldownMs ||
      0;
    if (totalCdMs > 0) ctx.triggerCooldown(slot.spellId, totalCdMs);
    if (!isOffGcdGuest) {
      const gcdMs = computePlayerGcdMs(
        slot.spellId,
        ctx.currentChar.classId,
        getUnitHaste(player, LEVEL_80_MAX_HASTE)
      );
      if (gcdMs > 0) {
        ctx.setPlayerGcdRemainingMs(gcdMs);
        ctx.setPlayerGcdTotalMs(gcdMs);
      }
    }
    // Guest owns their cast bar locally (wall clock). Host only resolves effects / interrupt.
    const guestNorm =
      getSpellByAnyId(slot.spellId, ctx.currentChar.classId) || getSpellByAnyId(slot.spellId);
    const guestCastMode = classifySpellCastMode({
      spellId: slot.spellId,
      castTimeMs: guestNorm?.castTimeMs,
      channelDurationMs: guestNorm?.channelDurationMs,
    });
    if (guestCastMode === 'CASTED' || guestCastMode === 'CHANNELED') {
      const haste = getUnitHaste(player, LEVEL_80_MAX_HASTE);
      const rawMs =
        guestCastMode === 'CHANNELED'
          ? Math.max(
              1,
              guestNorm?.channelDurationMs || guestNorm?.castTimeMs || 4000
            )
          : Math.max(1, guestNorm?.castTimeMs || 1500);
      // Must use ESM import — browser Vite has no `require`, which threw and
      // skipped both local cast-bar setup and sendNetworkCast for 读条技能.
      const totalMs = getHastedCastTimeMs(rawMs, haste);
      const isHarmful = !!(guestNorm?.isDamage || guestNorm?.isDot) && !guestNorm?.isHeal;
      const nowMs = Date.now();
      const optimistic: PlayerCastState = {
        spellId: slot.spellId,
        spellName: slot.name,
        totalMs,
        elapsedMs: 0,
        progress: 0,
        startedAtMs: nowMs,
        targetId: targetId || undefined,
        isChannel: guestCastMode === 'CHANNELED',
        isHarmful,
      };
      ctx.playerCastRef.current = optimistic;
      ctx.setPlayerCast(optimistic);
    }
    ctx.sendNetworkCast({
      kind: 'CAST',
      playerId: ctx.currentChar.id,
      spellId: slot.spellId,
      spellName: slot.name,
      slotIndex: slotIdx,
      targetId,
    });
    return;
  }

  if (!player || (!player.isAlive && !player.alive)) return;

  // ── Re-cast Guard: Ignore redundant keypresses while casting read-bar spell ──
  if (ctx.playerCast && !ctx.playerCast.isChannel) {
    return;
  }

  // ── Check GCD (Off-GCD spells ignore GCD and do not trigger GCD) ──
  const isOffGcd = isOffGcdSpell(slot.spellId);
  if (!isOffGcd && ctx.playerGcdRemainingMs > 0) {
    engine.effectsManager?.addFloatingText({
      targetId: player.id,
      text: '公共冷却中！',
      category: 'STATUS',
      isCrit: false,
    });
    return;
  }

  // ── Check Cooldown (aliases: bloodlust ↔ heroism, etc.) ───────────
  if (
    getEffectivePlayerCooldownMs(slot.spellId, {
      slotCdRemainingMs: slot.cdRemainingMs,
      playerCooldowns: ctx.playerCooldowns,
      classId: player.classId,
    }) > 0
  ) {
    engine.effectsManager?.addFloatingText({
      targetId: player.id,
      text: '法术还在冷却中！',
      category: 'STATUS',
      isCrit: false,
    });
    return;
  }

  const normSlotSpell = getSpellByAnyId(slot.spellId, player.classId);

  // ── Resource gates (mana / energy / rage / focus / runic / holy power) ──
  const resourceGate = checkCastSlotResources(player, slot.spellId, normSlotSpell);
  if (!resourceGate.ok) {
    window.dispatchEvent(new CustomEvent('cata_ui_error', { detail: { text: resourceGate.errorText || '资源不足' } }));
    engine.effectsManager?.addFloatingText({
      targetId: player.id,
      text: resourceGate.floatText || '⚠️ 资源不足！',
      category: 'STATUS',
      isCrit: false,
    });
    return;
  }
  const { mana: manaCost = 0, energy: energyCost = 0, rage: rageCost = 0, focus: focusCost = 0, runicPower: runicCost = 0, holyPower: holyPowerCost = 0 } = resourceGate.costs;

  // ── Ground-Targeted Spells (Reticle follows mouse, click ground to cast, right-click/ESC to cancel) ──
  const groundDef = GROUND_TARGET_SPELL_DEFS[slot.spellId];
  if (groundDef) {
    if (ctx.groundTargetState && ctx.groundTargetState.spellId === slot.spellId) {
      ctx.setGroundTargetState(null);
      return;
    }
    ctx.setGroundTargetState({
      slotIdx,
      spellId: slot.spellId,
      name: slot.name,
      radius: groundDef.radius,
      color: groundDef.color,
      maxRange: groundDef.maxRange,
    });
    engine.effectsManager?.addFloatingText({
      targetId: player.id,
      text: `🎯 鼠标指定位置释放【${slot.name}】(右键或ESC取消)`,
      category: 'STATUS',
      isCrit: false,
    });
    return;
  }

  // ── Guard Against Casting while Moving & Classify Spell Lifecycle ──
  const isMoving = Date.now() - ctx.lastPlayerMoveMs < 250;
  const isHardcodedCastOrChannel = [
    'fireball', 'pyroblast', 'frostbolt', 'arcane_blast', 'arcane_missiles',
    'wrath', 'starfire', 'starsurge', 'lightning_bolt', 'lava_burst',
    'chain_lightning', 'healing_wave', 'healing_surge', 'greater_healing_wave',
    'chain_heal', 'nourish', 'regrowth', 'healing_touch', 'tranquility',
    'rebirth', 'revive', 'ancestral_spirit', 'redemption', 'resurrection',
  ].includes(slot.spellId);

  const hasNaturesSwiftness = player.buffs.some(b => b.spellId === 'natures_swiftness');
  const isNatureInstantable = ['healing_touch', 'rebirth', 'regrowth', 'nourish', 'wrath', 'revive'].includes(slot.spellId);
  const isInstantViaNs = hasNaturesSwiftness && isNatureInstantable;

  const isSlotChanneled = isChanneledSpell({
    spellId: slot.spellId,
    castTimeMs: normSlotSpell?.castTimeMs,
    channelDurationMs: normSlotSpell?.channelDurationMs,
    isInstantOverride: isInstantViaNs,
  });

  const castMode = classifySpellCastMode({
    spellId: slot.spellId,
    castTimeMs: isHardcodedCastOrChannel && !isSlotChanneled
      ? Math.max(1500, normSlotSpell?.castTimeMs || 1500)
      : normSlotSpell?.castTimeMs,
    channelDurationMs: normSlotSpell?.channelDurationMs,
    isChannel: isSlotChanneled,
    isInstantOverride: isInstantViaNs,
  });
  const castLifecycle = getCastLifecyclePolicy(castMode);
  const isCastOrChannel = castMode !== 'INSTANT';

  if (isMoving && isCastOrChannel && !isInstantViaNs) {
    engine.effectsManager?.addFloatingText({
      targetId: player.id,
      text: '⚠️ 移动中无法施法！',
      category: 'STATUS',
      isCrit: false,
    });
    return;
  }

  // ── Smart Target Redirection (Friendly -> Self fallback, Hostile -> Nearest Enemy fallback) ──
  const isFriendlySpell =
    [
      'rejuvenation', 'lifebloom', 'regrowth', 'healing_touch', 'nourish', 'swiftmend',
      'wild_growth', 'tranquility', 'rebirth', 'revive', 'natures_cure', 'riptide',
      'healing_wave', 'healing_surge', 'greater_healing_wave', 'chain_heal',
      'healing_rain', 'spirit_link', 'cleanse_spirit', 'ancestral_spirit',
      'innervate', 'remove_curse', 'remove_corruption', 'bone_shield',
      'vampiric_blood', 'pillar_of_frost', 'horn_of_winter', 'slice_and_dice',
      'adrenaline_rush', 'feint', 'bloodlust', 'time_warp', 'arcane_power',
      'arcane_brilliance', 'mark_of_the_wild', 'natures_swiftness',
    ].includes(slot.spellId) ||
    Boolean(
      normSlotSpell &&
        (normSlotSpell.isHeal ||
          normSlotSpell.isShield ||
          normSlotSpell.isResurrect ||
          normSlotSpell.isDispel ||
          normSlotSpell.isDefensive ||
          normSlotSpell.isResourceRestore)
    );

  let effectiveTarget: Unit = player;

  if (isFriendlySpell) {
    if (
      slot.spellId === 'revive' ||
      slot.spellId === 'ancestral_spirit' ||
      slot.spellId === 'rebirth' ||
      slot.spellId === 'redemption' ||
      slot.spellId === 'resurrection' ||
      normSlotSpell?.isResurrect
    ) {
      const deadAlly = ctx.selectedTargetId
        ? engine.friendlyUnits.find(u => u.id === ctx.selectedTargetId && ((!u.isAlive && !u.alive) || u.hp <= 0))
        : engine.friendlyUnits.find(u => (!u.isAlive && !u.alive) || u.hp <= 0);
      if (!deadAlly) {
        engine.effectsManager?.addFloatingText({
          targetId: player.id,
          text: '❌ 没有需要复活的阵亡目标',
          category: 'STATUS',
          isCrit: false,
        });
        return;
      }
      effectiveTarget = deadAlly;
    } else {
      const hoveredFriendly = null;
      const selectedRaw = ctx.selectedTargetId
        ? engine.friendlyUnits.find((u) => u.id === ctx.selectedTargetId)
        : null;
      const selectedIsTotem =
        !!ctx.selectedTargetId &&
        (isTotemGroundEffectId(engine, ctx.selectedTargetId) ||
          (selectedRaw ? isTotemUnit(selectedRaw) : false));
      // 生命绽放：友方有效；图腾不可作为目标
      if (slot.spellId === 'lifebloom' && selectedIsTotem) {
        engine.effectsManager?.addFloatingText({
          targetId: player.id,
          text: '❌ 无法对图腾施放生命绽放',
          category: 'STATUS',
          isCrit: false,
        });
        return;
      }
      const selectedFriendly =
        selectedRaw &&
        !isTotemUnit(selectedRaw) &&
        (slot.spellId !== 'lifebloom' || isValidLifebloomTarget(selectedRaw, engine))
          ? selectedRaw
          : null;
      effectiveTarget = hoveredFriendly || selectedFriendly || player;
      if (slot.spellId === 'lifebloom' && !isValidLifebloomTarget(effectiveTarget, engine)) {
        engine.effectsManager?.addFloatingText({
          targetId: player.id,
          text: '❌ 生命绽放需要有效的友方目标',
          category: 'STATUS',
          isCrit: false,
        });
        return;
      }
    }
  } else {
    const selectedEnemy = ctx.selectedTargetId
      ? engine.enemyUnits.find(u => u.id === ctx.selectedTargetId && (u.isAlive ?? u.alive) && u.hp > 0)
      : null;

    if (selectedEnemy) {
      effectiveTarget = selectedEnemy;
    } else {
      const livingEnemies = engine.enemyUnits.filter(u => (u.isAlive ?? u.alive) && u.hp > 0);
      if (livingEnemies.length === 0) {
        engine.effectsManager?.addFloatingText({
          targetId: player.id,
          text: '❌ 没有可攻击的目标 (敌方首领已阵亡)',
          category: 'STATUS',
          isCrit: false,
        });
        return;
      }

      let nearestEnemy = livingEnemies[0];
      let minDist = Infinity;
      const pX = player.position?.x ?? 180;
      const pY = player.position?.y ?? 190;
      for (const enemy of livingEnemies) {
        const eX = enemy.position?.x ?? 520;
        const eY = enemy.position?.y ?? 190;
        const dist = Math.hypot(eX - pX, eY - pY);
        if (dist < minDist) {
          minDist = dist;
          nearestEnemy = enemy;
        }
      }

      effectiveTarget = nearestEnemy;
      if (boss && nearestEnemy.id === boss.id) {
        effectiveTarget = boss;
      }
      if (ctx.selectedTargetId !== effectiveTarget.id) {
        ctx.setSelectedTargetId(effectiveTarget.id);
      }
    }
  }
  ctx.setCastTargetId(effectiveTarget.id);
  const effectiveFriendly = effectiveTarget;

  // ── Check Out-of-Combat-Only Spell Restriction ────────────────────
  if (
    slot.spellId === 'revive' ||
    slot.spellId === 'ancestral_spirit' ||
    slot.spellId === 'redemption' ||
    slot.spellId === 'resurrection' ||
    normSlotSpell?.isOutOfCombatOnly
  ) {
    if (ctx.runPhase === 'BOSS_COMBAT') {
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '❌ 无法在战斗中使用！(仅非战斗状态可用)',
        category: 'STATUS',
        isCrit: false,
      });
      return;
    }
  }

  // ── Distance Check & Auto-approach Target ─────────────────────────
  const isSelfOrPartyWide =
    [
      'bone_shield', 'vampiric_blood', 'pillar_of_frost', 'horn_of_winter',
      'slice_and_dice', 'adrenaline_rush', 'feint', 'bloodlust', 'time_warp',
      'arcane_power', 'tranquility', 'natures_swiftness',
    ].includes(slot.spellId) ||
    Boolean(normSlotSpell && (normSlotSpell.isDefensive || normSlotSpell.isResourceRestore));

  const isMelee =
    [
      'death_strike', 'heart_strike', 'rune_strike', 'mind_freeze', 'sinister_strike',
      'eviscerate', 'kick', 'obliterate', 'frost_strike', 'mutilate', 'envenom',
    ].includes(slot.spellId) ||
    Boolean(normSlotSpell && normSlotSpell.school === 'PHYSICAL' && normSlotSpell.classId !== 'HUNTER' && !normSlotSpell.isTaunt && !normSlotSpell.isDefensive && !normSlotSpell.isHeal);
  // Prefer NormalizedSpell.rangePx (MotW=240≈30yd); fallback 320≈40yd
  const maxAllowedRange = isMelee
    ? 80
    : normSlotSpell && normSlotSpell.rangePx > 0
      ? normSlotSpell.rangePx
      : 320;

  if (!isSelfOrPartyWide) {
    const tX = effectiveTarget.position?.x ?? 520;
    const tY = effectiveTarget.position?.y ?? 190;
    const pX = player.position?.x ?? 180;
    const pY = player.position?.y ?? 190;
    const distToTarget = Math.hypot(tX - pX, tY - pY);

    if (distToTarget > maxAllowedRange) {
      window.dispatchEvent(new CustomEvent('cata_ui_error', { detail: { text: '目标太远了' } }));
      ctx.setAutoApproachTarget({
        targetX: tX,
        targetY: tY,
        desiredDist: maxAllowedRange - 20,
        pendingSlotIdx: slotIdx,
      });
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '🏃 距离不足，正在自动靠近目标...',
        category: 'STATUS',
        isCrit: false,
      });
      return;
    } else {
      ctx.setAutoApproachTarget(null);
    }
  }

  // If player casts an ability while in staging approach, trigger combat pull
  if (ctx.isApproaching) {
    ctx.setIsApproaching(false);
  }

  // ── Target Liveness Check ─────────────────────────────────────────
  const isRevive =
    slot.spellId === 'revive' ||
    slot.spellId === 'ancestral_spirit' ||
    slot.spellId === 'rebirth' ||
    slot.spellId === 'redemption' ||
    slot.spellId === 'resurrection' ||
    Boolean(normSlotSpell?.isResurrect);
  const isTargetAlive = (effectiveTarget.isAlive ?? effectiveTarget.alive) && effectiveTarget.hp > 0;
  if (!isRevive && !isTargetAlive) {
    engine.effectsManager?.addFloatingText({
      targetId: player.id,
      text: '❌ 目标已死亡',
      category: 'STATUS',
      isCrit: false,
    });
    return;
  }
  if (isRevive && isTargetAlive) {
    engine.effectsManager?.addFloatingText({
      targetId: player.id,
      text: '❌ 目标不需要复活',
      category: 'STATUS',
      isCrit: false,
    });
    return;
  }

  // ── Swiftmend Prerequisite Check (目标身上必须有回春术或愈合，否则无法施放且不扣蓝不进CD) ──
  if (slot.spellId === 'swiftmend') {
    const hasRejuvOrRegrowth = effectiveFriendly.buffs.some(b => b.spellId === 'rejuvenation' || b.spellId === 'regrowth');
    if (!hasRejuvOrRegrowth) {
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '❌ 目标身上没有回春术或愈合！无法施放迅捷治愈',
        category: 'STATUS',
        isCrit: false,
      });
      return;
    }
  }

  // ── Deduct Resource (INSTANT & CHANNELED immediately; CASTED defers until cast completion) ──
  const spellCostBundle: SpellResourceCostBundle = {
    mana: manaCost,
    energy: energyCost,
    rage: rageCost,
    focus: focusCost,
    runicPower: runicCost,
    holyPower: holyPowerCost,
  };

  if (castLifecycle.deductResourceOnStart) {
    deductPlayerResources(player, spellCostBundle, syncUnitResources);
  }

  if (!isOffGcd && castLifecycle.triggerGcdOnStart) {
    const gcdCat = getSpellGcdCategory(slot.spellId, player.classId);
    const gcdMs = getEffectiveGcdMs(gcdCat, getUnitHaste(player, LEVEL_80_MAX_HASTE));
    if (gcdMs > 0) {
      ctx.setPlayerGcdRemainingMs(gcdMs);
      ctx.setPlayerGcdTotalMs(gcdMs);
      engine.cooldownManager?.startGcd?.(player.id, gcdMs);
    }
  }

  const triggerSlotCooldown = (explicitCdMs?: number) => {
    const defaultCd = DEFAULT_SPELL_COOLDOWNS[slot.spellId] || normSlotSpell?.cooldownMs || 0;
    const cd = explicitCdMs ?? ((slot.totalCdMs && slot.totalCdMs > 0) ? slot.totalCdMs : defaultCd);
    if (cd > 0) {
      ctx.triggerCooldown(slot.spellId, cd);
    }
  };

  const startPlayerCast = (newCast: PlayerCastState) => {
    const effectiveIsChannel = Boolean(newCast.isChannel || isSlotChanneled);
    const castStateWithLifecycle: PlayerCastState = {
      ...newCast,
      isChannel: effectiveIsChannel,
      deferredCosts: effectiveIsChannel ? undefined : spellCostBundle,
    };
    // 引导技能起手立即触发冷却（读条技能不进CD，直到读完结算成功才进CD）
    if (effectiveIsChannel) {
      triggerSlotCooldown(newCast.totalCdMs && newCast.totalCdMs > 0 ? newCast.totalCdMs : undefined);
    }
    ctx.playerCastRef.current = castStateWithLifecycle;
    ctx.setPlayerCast(castStateWithLifecycle);
    if (!castStateWithLifecycle.isHarmful && !castStateWithLifecycle.isChannel && castStateWithLifecycle.targetId) {
      const pAmt = ctx.getPredictedHealAmount(castStateWithLifecycle.spellId, player);
      if (pAmt > 0) {
        const castObj: IncomingHealCast = {
          casterId: player.id || 'p1_player',
          casterName: player.name || '勇士',
          spellName: castStateWithLifecycle.spellName,
          amount: pAmt,
          progress: 0,
          classId: player.classId || 'DRUID',
        };
        ctx.setIncomingCasts((prev) => {
          const existing = prev[castStateWithLifecycle.targetId!]?.filter(c => c.casterId !== (player.id || 'p1_player')) || [];
          return {
            ...prev,
            [castStateWithLifecycle.targetId!]: [...existing, castObj],
          };
        });
        ctx.setIncomingHeals((prev) => ({
          ...prev,
          [castStateWithLifecycle.targetId!]: (prev[castStateWithLifecycle.targetId!] || 0) + pAmt,
        }));
      }
      // ST heal cast start → snowflake form FX
      engine.logCombatAction({
        actorId: player.id,
        spellId: castStateWithLifecycle.spellId,
        spellName: castStateWithLifecycle.spellName,
        kind: 'CAST_START',
        targetId: castStateWithLifecycle.targetId,
        visualTone: 'HEAL',
      });
    }
  };

  if (
    startPlayerCastBranches({
      engine,
      player,
      slot,
      effectiveFriendly,
      effectiveTarget,
      isInstantViaNs,
      maxAllowedRange,
      triggerSlotCooldown,
      startPlayerCast,
      onFriendlyUnitsChanged: ctx.onFriendlyUnitsChanged,
    })
  ) {
    return;
  }


  const handledInstant = executePlayerInstantEffects({
    engine,
    player,
    boss,
    slot,
    normSlotSpell,
    effectiveFriendly,
    effectiveTarget,
    isFriendlySpell,
    selectedTargetId: ctx.selectedTargetId,
    bossAi: ctx.bossAi,
    triggerSlotCooldown,
    startPlayerCast,
    handleDispelUnit: ctx.handleDispelUnit,
    onScreenShake: ctx.onScreenShake,
    onFriendlyUnitsChanged: ctx.onFriendlyUnitsChanged,
  });
  if (handledInstant) return;

}
