/**
 * Ring buffer of recent combat actions for host→guest FX sync.
 * Guests can play cast/ground/summon VFX from these even before full unit ticks land.
 */

export type CombatActionKind =
  | 'CAST_START'
  | 'CAST_LAND'
  | 'INSTANT'
  | 'GROUND_PLACE'
  | 'SUMMON'
  | 'INTERRUPT'
  | 'DISPEL';

export interface CombatActionEvent {
  id: string;
  atMs: number;
  actorId: string;
  spellId: string;
  spellName?: string;
  targetId?: string | null;
  kind: CombatActionKind;
  x?: number;
  y?: number;
  /** Spawned unit id (pet / add / totem entity) */
  spawnedUnitId?: string;
  /** Ground effect id when kind is GROUND_PLACE */
  groundEffectId?: string;
  /** Instant / persistent AoE ring radius in canvas px */
  radius?: number;
  /** When true, clients spawn a fill-only AoE ring (no edge stroke) */
  aoePulse?: boolean;
  /** HEAL=green, FRIENDLY=yellow, ENEMY=red */
  visualTone?: 'HEAL' | 'FRIENDLY' | 'ENEMY';
}

const MAX_ACTIONS = 48;

export class CombatActionLog {
  private events: CombatActionEvent[] = [];

  push(partial: Omit<CombatActionEvent, 'id' | 'atMs'> & { id?: string; atMs?: number }): CombatActionEvent {
    const ev: CombatActionEvent = {
      id: partial.id || `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      atMs: partial.atMs ?? Date.now(),
      actorId: partial.actorId,
      spellId: partial.spellId,
      spellName: partial.spellName,
      targetId: partial.targetId,
      kind: partial.kind,
      x: partial.x,
      y: partial.y,
      spawnedUnitId: partial.spawnedUnitId,
      groundEffectId: partial.groundEffectId,
      radius: partial.radius,
      aoePulse: partial.aoePulse,
      visualTone: partial.visualTone,
    };
    this.events.push(ev);
    if (this.events.length > MAX_ACTIONS) {
      this.events.splice(0, this.events.length - MAX_ACTIONS);
    }
    return ev;
  }

  /** Drain copy for snapshot (keeps last N for late joiners optionally). */
  snapshot(sinceMs?: number): CombatActionEvent[] {
    if (sinceMs == null) return this.events.map(e => ({ ...e }));
    return this.events.filter(e => e.atMs >= sinceMs).map(e => ({ ...e }));
  }

  /** Take and clear — use when embedding into a COMBAT_STATE broadcast. */
  drain(): CombatActionEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  clear(): void {
    this.events = [];
  }
}
