/**
 * When a player/AI seat leaves: host (and peers on REPLACE/HOT_SWAP) strip that
 * owner's pets/summons and ground/totem FX so nothing orphaned remains.
 */
import type { CombatEngine } from '@cata-raid-sim/engine';
import { reportUnitDespawn } from './summonReport.js';

export type ClearOwnerSpawnsResult = {
  removedUnitIds: string[];
  removedGroundIds: string[];
};

export function clearOwnerCombatSpawns(
  engine: CombatEngine,
  ownerId: string,
  opts?: { reportDespawn?: boolean }
): ClearOwnerSpawnsResult {
  const removedUnitIds: string[] = [];
  const removedGroundIds: string[] = [];
  if (!ownerId) return { removedUnitIds, removedGroundIds };

  const owned = engine
    .getAllUnits()
    .filter((u) => u.id !== ownerId && u.ownerId === ownerId);
  for (const u of owned) {
    if (opts?.reportDespawn) {
      reportUnitDespawn({ ownerId, unitId: u.id, spellId: 'owner_leave_cleanup' });
    }
    engine.removeUnit(u.id);
    removedUnitIds.push(u.id);
  }

  const em = engine.effectsManager;
  if (em?.groundEffects?.length) {
    const kept: typeof em.groundEffects = [];
    for (const g of em.groundEffects) {
      if (g.ownerId === ownerId) {
        removedGroundIds.push(g.id);
      } else {
        kept.push(g);
      }
    }
    em.groundEffects = kept;
  }

  return { removedUnitIds, removedGroundIds };
}
