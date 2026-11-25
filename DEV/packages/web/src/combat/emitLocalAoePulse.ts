import type { CombatEngine, Unit } from '@cata-raid-sim/engine';
import type { AoeVisualTone } from '@cata-raid-sim/engine';
import { isEnemyActorUnit } from '@cata-raid-sim/engine';
import { publishCombatEffectAlreadyApplied } from './networkCombatAuthority.js';

/**
 * Instant AoE → combat action with aoePulse + network AOE_PULSE for remotes.
 * Canvas draws a feathered class-color disc (not flat terrain rings).
 */
export function emitLocalAoePulse(
  engine: CombatEngine,
  opts: {
    actor: Unit;
    spellId: string;
    spellName?: string;
    targetId?: string | null;
    x: number;
    y: number;
    radius: number;
    tone?: AoeVisualTone;
    isHeal?: boolean;
  }
) {
  if (!(opts.radius > 0) || !Number.isFinite(opts.x) || !Number.isFinite(opts.y)) {
    return null;
  }
  const tone: AoeVisualTone =
    opts.tone ||
    (opts.isHeal
      ? 'HEAL'
      : isEnemyActorUnit(opts.actor)
        ? 'ENEMY'
        : 'FRIENDLY');
  const action = engine.logCombatAction({
    actorId: opts.actor.id,
    spellId: opts.spellId,
    spellName: opts.spellName,
    targetId: opts.targetId ?? null,
    kind: 'INSTANT',
    x: opts.x,
    y: opts.y,
    radius: opts.radius,
    aoePulse: true,
    visualTone: tone,
  });
  publishCombatEffectAlreadyApplied({
    sourceId: opts.actor.id,
    targetId: opts.targetId || opts.actor.id,
    spellId: opts.spellId,
    spellName: opts.spellName,
    kind: 'AOE_PULSE',
    x: opts.x,
    y: opts.y,
    radius: opts.radius,
    visualTone: tone,
  });
  return action;
}
