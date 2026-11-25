/**
 * Helpers to spawn pets / dungeon adds into CombatEngine for room-shared sync.
 * unitKind is mirrored in NetworkUnitSnapshot so guests keep identity.
 */
import type { ClassId, RoleId, Unit, UnitStats } from '../types.js';
import type { CombatEngine } from './CombatEngine.js';

export type CombatUnitKind = 'PLAYER' | 'AI' | 'PET' | 'ADD' | 'NPC' | 'BOSS';

export interface SpawnUnitOpts {
  id: string;
  name: string;
  classId?: ClassId | 'BOSS' | 'NPC';
  role?: RoleId | 'ENEMY';
  /** Semantic kind for sync / AI skip / canvas */
  unitKind: CombatUnitKind;
  ownerId?: string;
  hp?: number;
  maxHp?: number;
  position?: { x: number; y: number };
  stats?: Partial<UnitStats>;
  isPlayer?: boolean;
  isHumanControlled?: boolean;
  despawnAtElapsedMs?: number;
  summonSpellId?: string;
}

/** Timed combat pets (wolves / gargoyle) keyed by short or full spell id. */
export interface TimedSummonDef {
  /** Canonical short id stored on the unit */
  spellId: string;
  names: string[];
  durationMs: number;
  hp?: number;
  /** Offset ring radius from owner (px) */
  offsetPx?: number;
  classId?: ClassId | 'BOSS' | 'NPC';
}

const TIMED_SUMMON_BY_ID: Record<string, TimedSummonDef> = {
  feral_spirit: {
    spellId: 'feral_spirit',
    names: ['幽魂之狼', '幽魂之狼'],
    durationMs: 30_000,
    hp: 45_000,
    offsetPx: 36,
    classId: 'SHAMAN',
  },
  shaman_feral_spirit: {
    spellId: 'feral_spirit',
    names: ['幽魂之狼', '幽魂之狼'],
    durationMs: 30_000,
    hp: 45_000,
    offsetPx: 36,
    classId: 'SHAMAN',
  },
  summon_gargoyle: {
    spellId: 'summon_gargoyle',
    names: ['黑锋石像鬼'],
    durationMs: 30_000,
    hp: 60_000,
    offsetPx: 48,
    classId: 'DK',
  },
  dk_summon_gargoyle: {
    spellId: 'summon_gargoyle',
    names: ['黑锋石像鬼'],
    durationMs: 30_000,
    hp: 60_000,
    offsetPx: 48,
    classId: 'DK',
  },
};

export function resolveTimedSummonDef(spellId: string): TimedSummonDef | null {
  if (!spellId) return null;
  if (TIMED_SUMMON_BY_ID[spellId]) return TIMED_SUMMON_BY_ID[spellId];
  const short = spellId.includes('_') ? spellId.replace(/^[a-z]+_/, '') : spellId;
  return TIMED_SUMMON_BY_ID[short] || TIMED_SUMMON_BY_ID[spellId] || null;
}

export function isTimedSummonSpellId(spellId: string): boolean {
  return resolveTimedSummonDef(spellId) != null;
}

const DEFAULT_STATS: UnitStats = {
  attackPower: 4000,
  spellPower: 0,
  critChance: 0.15,
  haste: 0.3,
  armor: 8000,
  spellResist: 0,
  block: 0,
  parry: 0.05,
  dodge: 0.05,
  mastery: 0.1,
  versatility: 0,
  speed: 1,
};

export function createSpawnedUnit(opts: SpawnUnitOpts): Unit {
  const maxHp = opts.maxHp ?? opts.hp ?? 50_000;
  const hp = opts.hp ?? maxHp;
  const isEnemy = opts.unitKind === 'ADD' || opts.unitKind === 'NPC' || opts.unitKind === 'BOSS' || opts.role === 'ENEMY';
  const unit: Unit = {
    id: opts.id,
    name: opts.name,
    classId: opts.classId || (isEnemy ? 'NPC' : 'HUNTER'),
    role: opts.role || (isEnemy ? 'ENEMY' : 'DPS'),
    isPlayer: !!opts.isPlayer,
    isHumanControlled: !!opts.isHumanControlled,
    isPet: opts.unitKind === 'PET',
    ownerId: opts.ownerId,
    unitKind: opts.unitKind,
    isAlive: true,
    alive: true,
    hp,
    maxHp,
    absorb: 0,
    buffs: [],
    threatTable: [],
    resources: [],
    stats: { ...DEFAULT_STATS, ...(opts.stats || {}) },
    position: opts.position ? { ...opts.position } : { x: 200, y: 200 },
    despawnAtElapsedMs: opts.despawnAtElapsedMs,
    summonSpellId: opts.summonSpellId,
  };
  return unit;
}

/** Spawn and register; returns the unit. */
export function spawnCombatUnit(engine: CombatEngine, opts: SpawnUnitOpts): Unit {
  const unit = createSpawnedUnit(opts);
  engine.addUnit(unit);
  if (unit.unitKind === 'ADD' && unit.role === 'ENEMY') {
    engine.emitDbmAlert?.({
      title: `增援：${unit.name}`,
      advice: '先杀小怪',
      voiceText: '先杀小怪',
      replaceKey: `add_${unit.name}`,
      severity: 'WARN',
      roleHint: 'DPS',
      spellId: opts.summonSpellId,
      source: 'RUNTIME',
      dedupeKey: `add_${unit.name}`,
      cooldownMs: 8000,
    });
  }
  return unit;
}

export function resolveUnitKind(u: {
  isPet?: boolean;
  isPlayer?: boolean;
  isHumanControlled?: boolean;
  role?: string;
  unitKind?: CombatUnitKind;
  classId?: string;
}): CombatUnitKind {
  if (u.unitKind) return u.unitKind;
  if (u.isPet) return 'PET';
  if (u.classId === 'BOSS' || (u.role === 'ENEMY' && u.classId === 'BOSS')) return 'BOSS';
  if (u.role === 'ENEMY') return 'ADD';
  if (u.isPlayer || u.isHumanControlled) return 'PLAYER';
  return 'AI';
}

/**
 * Totems are ground FX (candle markers) or, if ever mirrored as units,
 * identifiable by summon spell / name / placement id prefix.
 * Lifebloom and most single-ally heals must never land on them.
 */
export function isTotemUnit(u: {
  id?: string;
  name?: string;
  summonSpellId?: string;
  unitKind?: string;
} | null | undefined): boolean {
  if (!u) return false;
  const sid = (u.summonSpellId || '').toLowerCase();
  const name = (u.name || '').toLowerCase();
  const id = (u.id || '').toLowerCase();
  if (sid.includes('totem')) return true;
  if (name.includes('totem') || name.includes('图腾')) return true;
  if (id.includes('totem')) return true;
  // Placement ids from confirmGroundTarget / AI / network GROUND_CAST
  if (/^(htt|slt|mtt|wft)_/.test(id)) return true;
  return false;
}

/** True if this engine id is an active TOTEM ground effect (not a raid member). */
export function isTotemGroundEffectId(
  engine: { effectsManager?: { groundEffects?: Array<{ id: string; kind?: string }> } } | null | undefined,
  id: string | null | undefined
): boolean {
  if (!engine || !id) return false;
  const list = engine.effectsManager?.groundEffects;
  if (!list || list.length === 0) return false;
  return list.some((g) => g.id === id && g.kind === 'TOTEM');
}

/**
 * Lifebloom: living friendly (player/AI/pet OK); enemies & totems never valid.
 */
export function isValidLifebloomTarget(
  u: Unit | null | undefined,
  engine?: { effectsManager?: { groundEffects?: Array<{ id: string; kind?: string }> } } | null
): boolean {
  if (!u) return false;
  if (u.role === 'ENEMY' || u.classId === 'BOSS' || u.unitKind === 'BOSS' || u.unitKind === 'ADD') {
    return false;
  }
  if (!(u.isAlive ?? u.alive) || u.hp <= 0) return false;
  if (isTotemUnit(u)) return false;
  if (engine && isTotemGroundEffectId(engine, u.id)) return false;
  return true;
}

/** Remove prior timed pets from the same owner+spell before re-summon. */
export function despawnOwnerTimedSummons(
  engine: CombatEngine,
  ownerId: string,
  spellId?: string
): string[] {
  const canonical = spellId ? resolveTimedSummonDef(spellId)?.spellId : undefined;
  const removed: string[] = [];
  for (const u of engine.getAllUnits()) {
    if (!u.isPet || u.ownerId !== ownerId || u.despawnAtElapsedMs == null) continue;
    if (canonical && u.summonSpellId && u.summonSpellId !== canonical) continue;
    removed.push(u.id);
    engine.removeUnit(u.id);
  }
  return removed;
}

/**
 * Spawn timed combat pets for known summon spells (feral spirit / gargoyle).
 * Returns spawned units (empty if spellId is not a timed summon).
 */
export function spawnTimedSummons(
  engine: CombatEngine,
  caster: Unit,
  spellId: string,
  opts?: { x?: number; y?: number; atElapsedMs?: number }
): Unit[] {
  const def = resolveTimedSummonDef(spellId);
  if (!def) return [];

  despawnOwnerTimedSummons(engine, caster.id, def.spellId);

  const now = opts?.atElapsedMs ?? engine.elapsed;
  const expireAt = now + def.durationMs;
  const ox = opts?.x ?? caster.position?.x ?? 200;
  const oy = opts?.y ?? caster.position?.y ?? 200;
  const ring = def.offsetPx ?? 40;
  const spawned: Unit[] = [];

  for (let i = 0; i < def.names.length; i++) {
    const angle = (Math.PI * 2 * i) / Math.max(1, def.names.length) - Math.PI / 2;
    const unit = spawnCombatUnit(engine, {
      id: `summon_${def.spellId}_${caster.id}_${now}_${i}`,
      name: def.names[i],
      classId: def.classId || caster.classId,
      role: 'DPS',
      unitKind: 'PET',
      ownerId: caster.id,
      hp: def.hp ?? 40_000,
      maxHp: def.hp ?? 40_000,
      position: {
        x: ox + Math.cos(angle) * ring,
        y: oy + Math.sin(angle) * ring,
      },
      despawnAtElapsedMs: expireAt,
      summonSpellId: def.spellId,
      stats: {
        attackPower: Math.round((caster.stats?.attackPower || 4000) * 0.45),
        spellPower: Math.round((caster.stats?.spellPower || 0) * 0.45),
        critChance: 0.2,
        haste: caster.stats?.haste ?? 0.3,
        armor: 6000,
        spellResist: 0,
        block: 0,
        parry: 0,
        dodge: 0.05,
        mastery: 0.1,
        versatility: 0,
        speed: 1,
      },
    });
    spawned.push(unit);
  }
  return spawned;
}

/** Host tick: remove expired timed summons. Returns removed unit ids. */
export function tickTimedSummons(engine: CombatEngine): string[] {
  const now = engine.elapsed;
  const removed: string[] = [];
  for (const u of engine.getAllUnits()) {
    if (u.despawnAtElapsedMs == null) continue;
    if (now < u.despawnAtElapsedMs) continue;
    removed.push(u.id);
    engine.removeUnit(u.id);
  }
  return removed;
}

/**
 * Keep pets near their owner so host unit snapshots broadcast movement.
 * Timed summons use a small ring; permanent pets (no despawn) stay ~28px offset.
 */
export function syncPetFollowPositions(engine: CombatEngine): void {
  const owners = new Map<string, Unit>();
  for (const u of engine.getAllUnits()) {
    if (!u.isPet || !u.ownerId) continue;
    let owner = owners.get(u.ownerId);
    if (!owner) {
      owner = engine.getUnit(u.ownerId);
      if (owner) owners.set(u.ownerId, owner);
    }
    if (!owner || !(owner.isAlive ?? owner.alive)) continue;

    const siblings = engine
      .getAllUnits()
      .filter((p) => p.isPet && p.ownerId === u.ownerId && (p.isAlive ?? p.alive));
    const idx = siblings.findIndex((p) => p.id === u.id);
    if (idx < 0) continue;
    const ring = u.despawnAtElapsedMs != null ? 36 : 28;
    const angle = (Math.PI * 2 * idx) / Math.max(1, siblings.length) - Math.PI / 2;
    const tx = (owner.position?.x ?? 0) + Math.cos(angle) * ring;
    const ty = (owner.position?.y ?? 0) + Math.sin(angle) * ring;
    const cx = u.position?.x ?? tx;
    const cy = u.position?.y ?? ty;
    const dist = Math.hypot(tx - cx, ty - cy);
    // Catch up hard when far (owner dashed); soft lerp when nearby
    const t = dist > 90 ? 0.85 : 0.45;
    u.position = {
      x: cx + (tx - cx) * t,
      y: cy + (ty - cy) * t,
    };
  }
}
