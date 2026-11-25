/**
 * Push combat actions into the canvas FX pipeline (hit FX / class AoE pulses).
 * Used by local logCombatAction hooks and remote APPLY of cast/AoE/ground effects.
 */
import type { CombatActionEvent, NetworkCombatAction } from '@cata-raid-sim/engine';

export function dispatchCombatFxActions(
  actions: Array<CombatActionEvent | NetworkCombatAction>,
  extra?: { roomId?: string | null; local?: boolean }
): void {
  if (!actions.length || typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('cata_combat_actions', {
      detail: {
        actions,
        roomId: extra?.roomId,
        local: extra?.local,
      },
    })
  );
}
