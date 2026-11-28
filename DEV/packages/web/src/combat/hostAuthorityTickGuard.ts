/**
 * On host: foreign (guest) seats must not be mutated by local sim ticks.
 * Freeze vitals/position/buffs around engine.tick; park foreign-owned ground FX
 * so host does not evaluate their heal/damage into anyone.
 */
import type { Buff, CombatEngine, Unit } from '@cata-raid-sim/engine';
import { getCombatAuthorityContext } from './networkCombatAuthority.js';

type FrozenSeat = {
  id: string;
  isAlive: boolean;
  alive: boolean;
  hp: number;
  maxHp: number;
  mp?: number;
  maxMp?: number;
  energy?: number;
  rage?: number;
  runicPower?: number;
  focus?: number;
  absorb: number;
  position: { x: number; y: number };
  buffs: Buff[];
  runes?: Unit['runes'];
};

function shouldFreeze(u: Unit): boolean {
  // Host and guest: only local-authority seats tick vitals/buffs/countdown.
  return !getCombatAuthorityContext().isUnitLocalAuthority(u.id);
}

function capture(u: Unit): FrozenSeat {
  return {
    id: u.id,
    isAlive: !!(u.isAlive ?? u.alive),
    alive: !!(u.alive ?? u.isAlive),
    hp: u.hp,
    maxHp: u.maxHp,
    mp: u.mp,
    maxMp: u.maxMp,
    energy: u.energy,
    rage: u.rage,
    runicPower: u.runicPower,
    focus: u.focus,
    absorb: u.absorb ?? 0,
    position: { ...(u.position || { x: 0, y: 0 }) },
    buffs: (u.buffs || []).map((b) => ({ ...b })),
    runes: u.runes ? u.runes.map((r) => ({ ...r })) : undefined,
  };
}

function restore(engine: CombatEngine, f: FrozenSeat): void {
  const u = engine.getUnit(f.id);
  if (!u) return;
  u.isAlive = f.isAlive;
  u.alive = f.alive;
  u.hp = f.hp;
  u.maxHp = f.maxHp;
  u.mp = f.mp;
  u.maxMp = f.maxMp;
  u.energy = f.energy;
  u.rage = f.rage;
  u.runicPower = f.runicPower;
  u.focus = f.focus;
  u.absorb = f.absorb;
  // Keep resources[] in lockstep with convenience fields (engine.tick regen touches both)
  if (u.resources?.length) {
    for (const res of u.resources) {
      if (res.kind === 'MANA' && f.mp != null) res.current = f.mp;
      else if (res.kind === 'ENERGY' && f.energy != null) res.current = f.energy;
      else if (res.kind === 'RAGE' && f.rage != null) res.current = f.rage;
      else if (res.kind === 'RUNIC_POWER' && f.runicPower != null) res.current = f.runicPower;
      else if (res.kind === 'FOCUS' && f.focus != null) res.current = f.focus;
    }
  }
  u.position = { ...f.position };
  u.buffs = f.buffs.map((b) => ({ ...b }));
  if (f.runes) u.runes = f.runes.map((r) => ({ ...r }));
}

/**
 * Run sim without rewriting non-authority seats or ticking their ground FX.
 * Host: freeze guest humans. Guest: freeze everyone else (recipient owns buff countdown).
 */
export function withHostAuthorityOnlySim<T>(engine: CombatEngine, fn: () => T): T {
  const { isNetworkHost, isNetworkGuest, isUnitLocalAuthority, localPlayerId, activeRoomId } =
    getCombatAuthorityContext();
  if ((!isNetworkHost && !isNetworkGuest) || !activeRoomId) return fn();

  const frozenUnits = engine.getAllUnits().filter(shouldFreeze);
  const frozen = frozenUnits.map(capture);
  // Clear non-authority buffs during local tick so AuraManager never ticks foreign
  // HoTs/DoTs on AI/Boss (which would double-credit local combatStats & spawn ghost SCT).
  for (const u of frozenUnits) {
    u.buffs = [];
  }
  const em = engine.effectsManager;
  const parkedGround: any[] = [];
  if (em?.groundEffects?.length) {
    const keep: any[] = [];
    for (const g of em.groundEffects) {
      const ownerOk =
        isUnitLocalAuthority(g.ownerId) || (localPlayerId && g.ownerId === localPlayerId);
      if (ownerOk) keep.push(g);
      else parkedGround.push(g);
    }
    em.groundEffects = keep;
  }

  try {
    return fn();
  } finally {
    for (const f of frozen) restore(engine, f);
    if (em && parkedGround.length) {
      em.groundEffects = [...(em.groundEffects || []), ...parkedGround];
    }
  }
}
