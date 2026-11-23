/**
 * Public barrel for the player cast pipeline (App should import from here).
 *
 * - `combat/resolvePlayerCast.ts` — read-bar completion
 * - `combat/startPlayerCastBranches.ts` — Nature's Swiftness + hardcoded cast/channel starters
 * - `combat/executePlayerInstantEffects.ts` — dispel / instant / data-driven
 * - `combat/handlePlayerCastSlot.ts` — guest / GCD / CD / resources / reticle / targeting
 * - `combat/castResourceGates.ts` / `sharedCooldowns.ts` / `playerGcd.ts`
 */

export { resolvePlayerCast } from '../combat/resolvePlayerCast.js';
export type { ResolvePlayerCastCtx } from '../combat/resolvePlayerCast.js';
export { startPlayerCastBranches } from '../combat/startPlayerCastBranches.js';
export type { StartPlayerCastBranchesCtx } from '../combat/startPlayerCastBranches.js';
export { executePlayerInstantEffects } from '../combat/executePlayerInstantEffects.js';
export type { InstantEffectsCtx } from '../combat/executePlayerInstantEffects.js';
export { handlePlayerCastSlot } from '../combat/handlePlayerCastSlot.js';
export type { HandlePlayerCastSlotCtx } from '../combat/handlePlayerCastSlot.js';
export { checkCastSlotResources, buildSpellCostBundle } from '../combat/castResourceGates.js';
export { applySharedCooldown } from '../combat/sharedCooldowns.js';
export { computePlayerGcdMs } from '../combat/playerGcd.js';
