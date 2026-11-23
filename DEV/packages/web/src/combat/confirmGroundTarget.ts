import type { CombatEngine, Unit } from '@cata-raid-sim/engine';
import type { ActionSlot } from '../components/ActionBar.js';
import { isOffGcdSpell } from '../components/ActionBar.js';
import { SPELL_MANA_COSTS } from './spellCosts.js';

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
};

/** Place a ground-targeted spell at (x,y) and start CD/GCD. */
export function confirmGroundTarget(ctx: ConfirmGroundTargetCtx): void {
  const { engine, player, boss, slot, spellId, x, y, triggerCooldown, triggerGcd, clearGroundTarget } =
    ctx;
  const totalCdMs = slot?.totalCdMs || 0;

  const manaCost = SPELL_MANA_COSTS[spellId] || 0;
  if (manaCost > 0 && player.maxMp && player.maxMp > 0) {
    player.mp = Math.max(0, (player.mp ?? 0) - manaCost);
  }

  const triggerSlotCooldown = () => {
    if (totalCdMs > 0) triggerCooldown(spellId, totalCdMs);
    if (!isOffGcdSpell(spellId)) triggerGcd(spellId);
  };

  if (spellId === 'death_and_decay') {
    engine.effectsManager?.addGroundEffect({
      id: `dnd_${Date.now()}`,
      kind: 'DAMAGE_ZONE',
      spellId: 'death_and_decay',
      ownerId: player.id,
      x,
      y,
      radius: 60,
      colorHex: '#8B0000',
      remainingMs: 10000,
      tickIntervalMs: 1000,
      tickElapsedMs: 0,
      tickValue: 3200,
    });
    if (boss && (boss.alive ?? boss.isAlive)) {
      engine.threatManager.addThreat(boss.id, player.id, 15000);
    }
    triggerSlotCooldown();
    clearGroundTarget();
  } else if (spellId === 'healing_rain') {
    engine.effectsManager?.addGroundEffect({
      id: `hrain_${Date.now()}`,
      kind: 'HEAL_ZONE',
      spellId: 'healing_rain',
      ownerId: player.id,
      x,
      y,
      radius: 60,
      colorHex: '#4169E1',
      remainingMs: 10000,
      tickIntervalMs: 1000,
      tickElapsedMs: 0,
      tickValue: 3400,
    });
    triggerSlotCooldown();
    clearGroundTarget();
  } else if (spellId === 'spirit_link') {
    engine.effectsManager?.addGroundEffect({
      id: `slt_${Date.now()}`,
      kind: 'TOTEM',
      spellId: 'spirit_link',
      ownerId: player.id,
      x,
      y,
      radius: 55,
      colorHex: '#00CED1',
      remainingMs: 6000,
      tickIntervalMs: 1000,
      tickElapsedMs: 0,
      tickValue: 0,
    });
    triggerSlotCooldown();
    clearGroundTarget();
  } else if (spellId === 'healing_tide' || spellId === 'healing_tide_totem') {
    engine.effectsManager?.addGroundEffect({
      id: `htt_${Date.now()}`,
      kind: 'TOTEM',
      spellId: 'healing_tide',
      ownerId: player.id,
      x,
      y,
      radius: 70,
      colorHex: '#0EA5E9',
      remainingMs: 10000,
      tickIntervalMs: 2000,
      tickElapsedMs: 0,
      tickValue: 5200,
    });
    triggerSlotCooldown();
    clearGroundTarget();
  } else if (spellId === 'mana_tide' || spellId === 'mana_tide_totem') {
    engine.effectsManager?.addGroundEffect({
      id: `mtt_${Date.now()}`,
      kind: 'TOTEM',
      spellId: 'mana_tide',
      ownerId: player.id,
      x,
      y,
      radius: 70,
      colorHex: '#56CCF2',
      remainingMs: 12000,
      tickIntervalMs: 5000,
      tickElapsedMs: 0,
      tickValue: 0,
    });
    for (const u of engine.friendlyUnits) {
      if (u.alive || u.isAlive) {
        engine.applyBuff(u, {
          id: `mana_tide_${u.id}_${Date.now()}`,
          spellId: 'mana_tide',
          name: '法力之潮',
          kind: 'BUFF',
          tags: ['STAT'],
          sourceUnitId: player.id,
          targetUnitId: u.id,
          stacks: 1,
          maxStacks: 1,
          durationMs: 12000,
          remainingMs: 12000,
          school: 'NATURE',
        });
      }
    }
    triggerSlotCooldown();
    clearGroundTarget();
  }
}
