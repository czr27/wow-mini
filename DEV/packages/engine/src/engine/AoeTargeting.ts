/**
 * Spatial AoE / smart-heal target selection.
 * Yard→px scale matches ClassRegistry: 80≈10yd, 120≈15yd (WG), 240≈30yd, 320≈40yd.
 */
import {
  RANGE_10YD_PX,
  RANGE_15YD_PX,
  RANGE_30YD_PX,
  RANGE_40YD_PX,
  RANGE_MELEE_PX,
  isCasterRadiusRaidBuffSpellId,
  isRaidWideBuffSpellId,
} from '../classes/ClassRegistry.js';

export type AoeCenterMode = 'TARGET' | 'CASTER' | 'RAID';

export interface AoeUnitLike {
  id: string;
  hp: number;
  maxHp: number;
  alive?: boolean;
  isAlive?: boolean;
  position?: { x: number; y: number };
  /** Pets / guardians are not raid-frame friendlies for smart heals (WG / CoH / …). */
  isPet?: boolean;
  unitKind?: string;
  role?: string;
}

export interface SpellAoeSplashProfile {
  /** Splash / jump radius in canvas px (0 for raid-wide) */
  radiusPx: number;
  /** Whose position anchors the splash circle; RAID = entire living raid */
  centerMode: AoeCenterMode;
  /** Max targets (after spatial filter + injury sort) */
  maxTargets: number;
  /**
   * chain_heal: sequential jumps of radiusPx from last hit.
   * smart_radius: all candidates within radius of a single center.
   * raid_wide: every living ally (MotW / Arcane Brilliance / …).
   */
  mode: 'smart_radius' | 'chain_jump' | 'raid_wide';
}

function spellKey(id: string): string {
  return (id || '').toLowerCase();
}

/** Cata-calibrated splash profile; null = not a multi-target spatial heal/damage splash. */
export function resolveSpellAoeSplash(
  spellId: string,
  opts?: {
    maxAoeTargets?: number;
    targetType?: string;
    school?: string;
    isPhysicalMeleeAoe?: boolean;
    isRaidBuff?: boolean;
  }
): SpellAoeSplashProfile | null {
  const id = spellKey(spellId);
  const short = id.includes('_') ? id.replace(/^[^_]+_/, '') : id;
  const maxDefault = opts?.maxAoeTargets && opts.maxAoeTargets > 0 ? opts.maxAoeTargets : 5;

  // ── Raid buffs: MotW etc. (30yd cast elsewhere) → whole raid; Horn → 30yd around caster
  if (isCasterRadiusRaidBuffSpellId(id) || isCasterRadiusRaidBuffSpellId(short)) {
    return { radiusPx: RANGE_30YD_PX, centerMode: 'CASTER', maxTargets: 40, mode: 'smart_radius' };
  }
  if (isRaidWideBuffSpellId(id) || isRaidWideBuffSpellId(short) || opts?.isRaidBuff) {
    return { radiusPx: 0, centerMode: 'RAID', maxTargets: 40, mode: 'raid_wide' };
  }

  // ── Wild Growth: selected ally = center, 15yd, up to 5 lowest HP% ─
  if (short === 'wild_growth' || id.includes('wild_growth')) {
    return { radiusPx: RANGE_15YD_PX, centerMode: 'TARGET', maxTargets: maxDefault, mode: 'smart_radius' };
  }

  // ── Other smart heals: 40yd cast, 30yd splash around target ────
  if (
    short === 'circle_of_healing' ||
    id.includes('circle_of_healing') ||
    short === 'prayer_of_healing' ||
    id.includes('prayer_of_healing') ||
    short === 'holy_radiance' ||
    id.includes('holy_radiance')
  ) {
    return { radiusPx: RANGE_30YD_PX, centerMode: 'TARGET', maxTargets: maxDefault, mode: 'smart_radius' };
  }

  // ── Caster-centered heals ─────────────────────────────────────
  if (short === 'light_of_dawn' || id.includes('light_of_dawn')) {
    // Cata: 30yd frontal cone — approximated as 30yd circle around caster
    return { radiusPx: RANGE_30YD_PX, centerMode: 'CASTER', maxTargets: maxDefault, mode: 'smart_radius' };
  }
  if (short === 'tranquility' || id.includes('tranquility')) {
    return { radiusPx: RANGE_40YD_PX, centerMode: 'CASTER', maxTargets: Math.max(maxDefault, 10), mode: 'smart_radius' };
  }

  // ── Chain heal: ~10yd jump between targets ────────────────────
  if (short === 'chain_heal' || id.includes('chain_heal')) {
    return { radiusPx: RANGE_10YD_PX, centerMode: 'TARGET', maxTargets: 4, mode: 'chain_jump' };
  }

  // ── Generic SMART/AOE ally without specific id → 30yd from target
  if (opts?.targetType === 'SMART_ALLY' || opts?.targetType === 'AOE_ALLY') {
    return { radiusPx: RANGE_30YD_PX, centerMode: 'TARGET', maxTargets: maxDefault, mode: 'smart_radius' };
  }

  // ── Melee enemy AoE around caster (Blood Boil, Swipe, Whirlwind…)
  if (opts?.isPhysicalMeleeAoe || (opts?.targetType === 'AOE_ENEMY' && opts?.school === 'PHYSICAL')) {
    return { radiusPx: RANGE_MELEE_PX + 40, centerMode: 'CASTER', maxTargets: maxDefault, mode: 'smart_radius' };
  }

  return null;
}

export function unitAlive(u: AoeUnitLike): boolean {
  return (u.isAlive ?? u.alive ?? true) && u.hp > 0;
}

/** Raid/party friendlies for smart heals — exclude pets/adds/enemies. */
export function isHealSplashAlly(u: AoeUnitLike): boolean {
  if (u.isPet || u.unitKind === 'PET' || u.unitKind === 'ADD') return false;
  if (u.role === 'ENEMY') return false;
  return true;
}

export function distPx(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Sort by lowest HP%, then largest missing HP. */
export function sortByInjury<T extends AoeUnitLike>(units: T[]): T[] {
  return [...units].sort((a, b) => {
    const pctA = a.hp / Math.max(1, a.maxHp);
    const pctB = b.hp / Math.max(1, b.maxHp);
    if (Math.abs(pctA - pctB) > 0.0001) return pctA - pctB;
    return a.hp - a.maxHp - (b.hp - b.maxHp);
  });
}

/**
 * Pick up to maxTargets living allies inside radius of center.
 * Sorted by injury (lowest HP% first) — full-HP allies are always eligible and fill
 * remaining slots when fewer than maxTargets are injured (Wild Growth etc.).
 * Primary/fallback is always kept when alive and in range.
 */
export function selectInjuredAlliesInRadius<T extends AoeUnitLike>(opts: {
  allies: T[];
  center: { x: number; y: number };
  radiusPx: number;
  maxTargets: number;
  /**
   * When true (default): sort injured first but still include full-HP to fill maxTargets.
   * When false: ignore HP% and take any in-range allies (stable id order via sortByInjury still).
   */
  preferInjured?: boolean;
  fallback?: T;
  /** When false, keep pets in the pool (default: exclude pets from smart heals) */
  includePets?: boolean;
}): T[] {
  const maxT = Math.max(1, opts.maxTargets);
  const living = opts.allies.filter(
    (u) => unitAlive(u) && (opts.includePets ? true : isHealSplashAlly(u))
  );
  const inRange = living.filter((u) => {
    const p = u.position ?? opts.center;
    return distPx(p, opts.center) <= opts.radiusPx;
  });

  // Always draw from full in-range pool so full-HP can benefit when nobody is injured
  let chosen = sortByInjury(inRange).slice(0, maxT);

  // Guarantee primary/fallback stays on the list when in splash range (cast-on-self / cast-on-tank)
  const fb = opts.fallback;
  if (fb && unitAlive(fb) && (opts.includePets || isHealSplashAlly(fb))) {
    const fbInRange =
      inRange.some((u) => u.id === fb.id) ||
      distPx(fb.position ?? opts.center, opts.center) <= opts.radiusPx;
    if (fbInRange && !chosen.some((u) => u.id === fb.id)) {
      chosen = [fb as T, ...chosen.filter((u) => u.id !== fb.id)].slice(0, maxT);
    }
  }

  if (chosen.length === 0 && fb && unitAlive(fb)) {
    return [fb];
  }
  return chosen;
}

/**
 * Chain heal / chain lightning style: start at seed, then jump to most injured
 * ally within jumpRadius of the *last* hit, never repeating.
 */
export function selectChainJumpTargets<T extends AoeUnitLike>(opts: {
  allies: T[];
  seed: T;
  jumpRadiusPx: number;
  maxTargets: number;
  /** Only jump to injured (hp < max); seed always included */
  injuredOnlyJumps?: boolean;
}): T[] {
  const living = opts.allies.filter((u) => unitAlive(u) && isHealSplashAlly(u));
  const chosen: T[] = [];
  const seen = new Set<string>();

  const seed = living.find((u) => u.id === opts.seed.id) || opts.seed;
  if (!unitAlive(seed) || !isHealSplashAlly(seed)) return [];
  chosen.push(seed);
  seen.add(seed.id);

  let cursor = seed.position ?? { x: 0, y: 0 };
  const injuredOnly = opts.injuredOnlyJumps !== false;

  while (chosen.length < opts.maxTargets) {
    const candidates = living.filter((u) => {
      if (seen.has(u.id)) return false;
      if (injuredOnly && u.hp >= u.maxHp) return false;
      const p = u.position ?? cursor;
      return distPx(p, cursor) <= opts.jumpRadiusPx;
    });
    if (candidates.length === 0) break;
    const next = sortByInjury(candidates)[0];
    chosen.push(next);
    seen.add(next.id);
    cursor = next.position ?? cursor;
  }
  return chosen;
}

/** Resolve center point for a splash profile. */
export function resolveAoeCenter(
  profile: SpellAoeSplashProfile,
  casterPos: { x: number; y: number },
  targetPos: { x: number; y: number }
): { x: number; y: number } {
  return profile.centerMode === 'CASTER' ? casterPos : targetPos;
}

/**
 * Raid buff recipients: MotW/Arcane/Fort/Kings → all living allies;
 * Horn/Battle Shout → living allies within 30yd of caster.
 */
export function selectRaidBuffTargets<T extends AoeUnitLike>(opts: {
  spellId: string;
  allies: T[];
  caster: T;
  isRaidBuff?: boolean;
}): T[] {
  const living = opts.allies.filter(unitAlive);
  const profile = resolveSpellAoeSplash(opts.spellId, { isRaidBuff: opts.isRaidBuff, maxAoeTargets: 40 });
  if (!profile || profile.mode === 'raid_wide' || profile.centerMode === 'RAID') {
    return living;
  }
  if (profile.centerMode === 'CASTER') {
    const center = opts.caster.position ?? { x: 0, y: 0 };
    return living.filter(u => distPx(u.position ?? center, center) <= profile.radiusPx);
  }
  return living;
}

/**
 * High-level: select heal targets for a spell id given caster/target positions.
 */
export function selectAoeHealTargets<T extends AoeUnitLike>(opts: {
  spellId: string;
  allies: T[];
  caster: T;
  primaryTarget: T;
  maxAoeTargets?: number;
  targetType?: string;
}): T[] {
  const profile = resolveSpellAoeSplash(opts.spellId, {
    maxAoeTargets: opts.maxAoeTargets,
    targetType: opts.targetType,
  });
  if (!profile) {
    return selectInjuredAlliesInRadius({
      allies: opts.allies,
      center: opts.primaryTarget.position ?? { x: 0, y: 0 },
      radiusPx: RANGE_30YD_PX,
      maxTargets: opts.maxAoeTargets || 5,
      fallback: opts.primaryTarget,
    });
  }

  if (profile.mode === 'chain_jump') {
    return selectChainJumpTargets({
      allies: opts.allies,
      seed: opts.primaryTarget,
      jumpRadiusPx: profile.radiusPx,
      maxTargets: profile.maxTargets,
    });
  }

  const center = resolveAoeCenter(
    profile,
    opts.caster.position ?? { x: 0, y: 0 },
    opts.primaryTarget.position ?? opts.caster.position ?? { x: 0, y: 0 }
  );
  const sid = (opts.spellId || '').toLowerCase();
  // 野性成长：选中单位只定圆心，不强制占治疗名额；严格按范围内血量%最低选取
  const isWildGrowth = sid === 'wild_growth' || sid.includes('wild_growth');
  return selectInjuredAlliesInRadius({
    allies: opts.allies,
    center,
    radiusPx: profile.radiusPx,
    maxTargets: profile.maxTargets,
    fallback: isWildGrowth ? undefined : opts.primaryTarget,
  });
}

export function selectAoeEnemyTargets<T extends AoeUnitLike>(opts: {
  spellId: string;
  enemies: T[];
  caster: T;
  maxAoeTargets?: number;
  school?: string;
  targetType?: string;
}): T[] {
  const profile = resolveSpellAoeSplash(opts.spellId, {
    maxAoeTargets: opts.maxAoeTargets,
    school: opts.school,
    targetType: opts.targetType || 'AOE_ENEMY',
    isPhysicalMeleeAoe: opts.school === 'PHYSICAL',
  });
  const radius = profile?.radiusPx ?? RANGE_30YD_PX;
  const center = opts.caster.position ?? { x: 0, y: 0 };
  const maxT = profile?.maxTargets ?? opts.maxAoeTargets ?? 5;
  return opts.enemies
    .filter(unitAlive)
    .filter(e => distPx(e.position ?? center, center) <= radius)
    .slice(0, maxT);
}
