import type { CombatEngine, NetworkCooldownTimeline, Unit } from '@cata-raid-sim/engine';
import { GROUND_TARGET_SPELL_DEFS, RANGE_40YD_PX } from '@cata-raid-sim/engine';
import type { ActionSlot } from '../components/ActionBar.js';
import { isOffGcdSpell } from '../components/ActionBar.js';
import { SPELL_MANA_COSTS } from './spellCosts.js';
import { getEffectivePlayerCooldownMs } from './handlePlayerCastSlot.js';

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

  // Guest: only send intent + local CD/GCD UX; host resolves FX/heal
  if (ctx.isNetworkGuest && ctx.netConnected && ctx.activeRoomId && ctx.playerId && ctx.sendGroundCast) {
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
    ctx.sendGroundCast({
      kind: 'GROUND_CAST',
      playerId: ctx.playerId,
      spellId,
      spellName: slot?.name,
      x,
      y,
      targetId: boss?.id ?? null,
    });
    if (totalCdMs > 0) triggerCooldown(spellId, totalCdMs);
    if (!isOffGcdSpell(spellId)) triggerGcd(spellId);
    clearGroundTarget();
    return;
  }

  const manaCost = SPELL_MANA_COSTS[spellId] || 0;
  if (manaCost > 0 && player.maxMp && player.maxMp > 0) {
    player.mp = Math.max(0, (player.mp ?? 0) - manaCost);
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
    engine.logCombatAction({
      actorId: player.id,
      spellId: opts.spellId,
      spellName: slot?.name,
      kind: 'GROUND_PLACE',
      x,
      y,
      groundEffectId: id,
      targetId: boss?.id ?? null,
    });
  };

  if (spellId === 'death_and_decay') {
    placeAndLog({
      idPrefix: 'dnd',
      kind: 'DAMAGE_ZONE',
      spellId: 'death_and_decay',
      radius: groundRadius('death_and_decay', 60),
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
  } else if (spellId === 'spirit_link' || spellId === 'spirit_link_totem') {
    placeAndLog({
      idPrefix: 'slt',
      kind: 'TOTEM',
      spellId: 'spirit_link',
      radius: groundRadius('spirit_link', 80),
      colorHex: '#00CED1',
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
      colorHex: '#0EA5E9',
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
      colorHex: '#56CCF2',
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
      colorHex: '#E0E0E0',
      remainingMs: 300000,
      tickIntervalMs: 1000,
      tickValue: 0,
    });
    triggerSlotCooldown();
    clearGroundTarget();
  }
}
