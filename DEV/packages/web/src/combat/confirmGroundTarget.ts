import type { CombatEngine, NetworkCooldownTimeline, Unit } from '@cata-raid-sim/engine';
import { GROUND_TARGET_SPELL_DEFS, RANGE_40YD_PX } from '@cata-raid-sim/engine';
import type { ActionSlot } from '../components/ActionBar.js';
import { isOffGcdSpell } from '../components/ActionBar.js';
import { SPELL_MANA_COSTS } from './spellCosts.js';
import { getEffectivePlayerCooldownMs } from './handlePlayerCastSlot.js';
import { spendDkResourcesForSpell } from './dkResources.js';
import { getSpellByAnyId } from '@cata-raid-sim/engine';

export type ConfirmGroundTargetCtx = {
  engine: CombatEngine;
  player: Unit;
  boss: Unit | undefined;
  slot: ActionSlot | undefined;
  spellId: string;
  x: number;
  y: number;
  triggerCooldown: (spellId: string, totalCdMs: number) => void;
  triggerGcd: (spellId?: string) => void;
  clearGroundTarget: () => void;
  /** Network guest: forward placement to host instead of resolving locally */
  isNetworkGuest?: boolean;
  netConnected?: boolean;
  activeRoomId?: string | null;
  playerId?: string | null;
  playerCooldowns?: Record<string, { cdRemainingMs: number; totalCdMs: number }>;
  guestCdTimelines?: NetworkCooldownTimeline[] | null;
  sendGroundCast?: (payload: {
    kind: 'GROUND_CAST';
    playerId: string;
    spellId: string;
    spellName?: string;
    x: number;
    y: number;
    targetId?: string | null;
  }) => void;
};

function groundRadius(spellId: string, fallback: number): number {
  return GROUND_TARGET_SPELL_DEFS[spellId]?.radius ?? fallback;
}

/** Place a ground-targeted spell at (x,y) and start CD/GCD. */
export function confirmGroundTarget(ctx: ConfirmGroundTargetCtx): void {
  const { engine, player, boss, slot, spellId, x, y, triggerCooldown, triggerGcd, clearGroundTarget } =
    ctx;
  const totalCdMs = slot?.totalCdMs || 0;

  // Guest: resolve locally (sharded authority) — ground/totems owned by caster
  if (ctx.isNetworkGuest && ctx.netConnected && ctx.activeRoomId && ctx.playerId) {
    const cdRem = getEffectivePlayerCooldownMs(spellId, {
      slotCdRemainingMs: slot?.cdRemainingMs,
      playerCooldowns: ctx.playerCooldowns || {},
      unitId: ctx.playerId,
      guestCdTimelines: ctx.guestCdTimelines,
      classId: player.classId,
    });
    if (cdRem > 0) {
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '法术还在冷却中！',
        category: 'STATUS',
        isCrit: false,
      });
      clearGroundTarget();
      return;
    }
    // Fall through to local placeAndLog path below
  }

  const normGround = getSpellByAnyId(spellId, player.classId);
  const manaCost =
    normGround?.resourceKind === 'MANA'
      ? normGround.resourceCostAmount
      : (SPELL_MANA_COSTS[spellId] || 0);
  if (manaCost > 0 && player.maxMp && player.maxMp > 0) {
    player.mp = Math.max(0, (player.mp ?? 0) - manaCost);
  }
  if (player.classId === 'DK') {
    const norm = getSpellByAnyId(spellId, player.classId);
    if (!spendDkResourcesForSpell(engine, player, spellId, norm)) {
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '⚠️ 符文不足！',
        category: 'STATUS',
        isCrit: false,
      });
      clearGroundTarget();
      return;
    }
  }

  const triggerSlotCooldown = () => {
    if (totalCdMs > 0) triggerCooldown(spellId, totalCdMs);
    if (!isOffGcdSpell(spellId)) triggerGcd(spellId);
  };

  const placeAndLog = (opts: {
    idPrefix: string;
    kind: 'DAMAGE_ZONE' | 'HEAL_ZONE' | 'TOTEM';
    spellId: string;
    radius: number;
    colorHex: string;
    remainingMs: number;
    tickIntervalMs: number;
    tickValue: number;
  }) => {
    const id = `${opts.idPrefix}_${Date.now()}`;
    engine.effectsManager?.addGroundEffect({
      id,
      kind: opts.kind,
      spellId: opts.spellId,
      ownerId: player.id,
      x,
      y,
      radius: opts.radius,
      colorHex: opts.colorHex,
      remainingMs: opts.remainingMs,
      tickIntervalMs: opts.tickIntervalMs,
      tickElapsedMs: 0,
      tickValue: opts.tickValue,
    });
    // Network: installSummonReporters hooks addGroundEffect → GROUND_PLACE summon report.
    // Remotes draw the received summon; do not re-publish from skill settle here.
    engine.logCombatAction({
      actorId: player.id,
      spellId: opts.spellId,
      spellName: slot?.name,
      kind: 'GROUND_PLACE',
      x,
      y,
      groundEffectId: id,
      radius: opts.radius,
      targetId: null,
    });
  };

  if (spellId === 'death_and_decay' || spellId === 'dnd' || spellId === 'dk_dnd') {
    placeAndLog({
      idPrefix: 'dnd',
      kind: 'DAMAGE_ZONE',
      spellId: 'death_and_decay',
      radius: groundRadius(spellId, groundRadius('death_and_decay', 60)),
      colorHex: '#8B0000',
      remainingMs: 10000,
      tickIntervalMs: 1000,
      tickValue: 3200,
    });
    if (boss && (boss.alive ?? boss.isAlive)) {
      engine.threatManager.addThreat(boss.id, player.id, 15000);
    }
    triggerSlotCooldown();
    clearGroundTarget();
  } else if (spellId === 'healing_rain') {
    placeAndLog({
      idPrefix: 'hrain',
      kind: 'HEAL_ZONE',
      spellId: 'healing_rain',
      radius: groundRadius('healing_rain', 60),
      colorHex: '#10B981',
      remainingMs: 10000,
      tickIntervalMs: 1000,
      tickValue: 3400,
    });
    triggerSlotCooldown();
    clearGroundTarget();
  } else if (spellId === 'lightwell' || spellId === 'priest_lightwell') {
    placeAndLog({
      idPrefix: 'lw',
      kind: 'TOTEM',
      spellId: 'lightwell',
      radius: groundRadius(spellId, groundRadius('lightwell', 80)),
      colorHex: '#10B981',
      remainingMs: 180_000,
      tickIntervalMs: 2000,
      tickValue: 2800,
    });
    triggerSlotCooldown();
    clearGroundTarget();
  } else if (spellId === 'blizzard' || spellId === 'mage_blizzard') {
    placeAndLog({
      idPrefix: 'bliz',
      kind: 'DAMAGE_ZONE',
      spellId: 'blizzard',
      radius: groundRadius(spellId, groundRadius('blizzard', 80)),
      colorHex: '#EF4444',
      remainingMs: 8000,
      tickIntervalMs: 1000,
      tickValue: 2100,
    });
    triggerSlotCooldown();
    clearGroundTarget();
  } else if (spellId === 'spirit_link' || spellId === 'spirit_link_totem') {
    placeAndLog({
      idPrefix: 'slt',
      kind: 'TOTEM',
      spellId: 'spirit_link',
      radius: groundRadius('spirit_link', 80),
      colorHex: '#EAB308',
      remainingMs: 6000,
      tickIntervalMs: 1000,
      tickValue: 0,
    });
    triggerSlotCooldown();
    clearGroundTarget();
  } else if (
    spellId === 'healing_tide' ||
    spellId === 'healing_tide_totem' ||
    spellId === 'shaman_healing_tide_totem'
  ) {
    placeAndLog({
      idPrefix: 'htt',
      kind: 'TOTEM',
      spellId: 'healing_tide',
      radius: groundRadius('healing_tide', RANGE_40YD_PX), // 40 码
      colorHex: '#10B981',
      remainingMs: 10000,
      tickIntervalMs: 2000,
      tickValue: 5200,
    });
    triggerSlotCooldown();
    clearGroundTarget();
  } else if (spellId === 'mana_tide' || spellId === 'mana_tide_totem') {
    // Buffs are applied each tick only to allies inside radius (EffectsManager)
    placeAndLog({
      idPrefix: 'mtt',
      kind: 'TOTEM',
      spellId: 'mana_tide',
      radius: groundRadius('mana_tide', 80),
      colorHex: '#EAB308',
      remainingMs: 12000,
      tickIntervalMs: 5000,
      tickValue: 0,
    });
    triggerSlotCooldown();
    clearGroundTarget();
  } else if (spellId === 'windfury_totem' || spellId === 'windfury') {
    placeAndLog({
      idPrefix: 'wft',
      kind: 'TOTEM',
      spellId: 'windfury_totem',
      radius: groundRadius('windfury_totem', 80),
      colorHex: '#EAB308',
      remainingMs: 300000,
      tickIntervalMs: 1000,
      tickValue: 0,
    });
    triggerSlotCooldown();
    clearGroundTarget();
  }
}
