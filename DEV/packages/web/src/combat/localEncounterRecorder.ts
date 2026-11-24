/**
 * Guest-side local encounter recording for dungeon settlement.
 * Clients register boss/clear data from their own mirrored combatStats —
 * no dependency on host broadcasting encounterReports.
 */
import {
  ReportManager,
  type CombatEngine,
  type EncounterReport,
  type RunStateMachine,
  type Unit,
} from '@cata-raid-sim/engine';

const reportMgrSingleton = new ReportManager();

type RawCombatStats = {
  damageDealt: number;
  healingDone: number;
  overhealDone: number;
  damageTaken: number;
  interruptCount: number;
  skillDamage: Record<string, number>;
  skillHealing: Record<string, number>;
  skillDamageTaken: Record<string, number>;
};

export type LocalEncounterRecorder = {
  lastBossIndex: number;
  lastBossAlive: boolean | null;
  lastPhase: string | null;
  bossCombatStartMs: number;
  baselineByUnit: Map<string, RawCombatStats>;
  /** Boss indexes already finalized as KILL locally */
  recordedKillIndexes: Set<number>;
};

export function createLocalEncounterRecorder(): LocalEncounterRecorder {
  return {
    lastBossIndex: -1,
    lastBossAlive: null,
    lastPhase: null,
    bossCombatStartMs: 0,
    baselineByUnit: new Map(),
    recordedKillIndexes: new Set(),
  };
}

const recordersByRsm = new WeakMap<RunStateMachine, LocalEncounterRecorder>();

/** One recorder per RunStateMachine instance (new run → new RSM → fresh recorder). */
export function getLocalEncounterRecorder(rsm: RunStateMachine): LocalEncounterRecorder {
  let s = recordersByRsm.get(rsm);
  if (!s) {
    s = createLocalEncounterRecorder();
    recordersByRsm.set(rsm, s);
  }
  return s;
}

export function resetLocalEncounterRecorder(state: LocalEncounterRecorder): void {
  state.lastBossIndex = -1;
  state.lastBossAlive = null;
  state.lastPhase = null;
  state.bossCombatStartMs = 0;
  state.baselineByUnit.clear();
  state.recordedKillIndexes.clear();
}

function readRawStats(u: Unit): RawCombatStats {
  const s = u.combatStats;
  return {
    damageDealt: Math.max(0, s?.damageDealt || 0),
    healingDone: Math.max(0, s?.healingDone || 0),
    overhealDone: Math.max(0, s?.overhealDone || 0),
    damageTaken: Math.max(0, s?.damageTaken || 0),
    interruptCount: Math.max(0, s?.interruptCount || 0),
    skillDamage: { ...(s?.skillDamage || {}) },
    skillHealing: { ...(s?.skillHealing || {}) },
    skillDamageTaken: { ...(s?.skillDamageTaken || {}) },
  };
}

function diffMaps(
  cur: Record<string, number> | undefined,
  base: Record<string, number> | undefined
): Record<string, number> {
  const out: Record<string, number> = {};
  const keys = new Set([...Object.keys(cur || {}), ...Object.keys(base || {})]);
  for (const k of keys) {
    const v = Math.max(0, (cur?.[k] || 0) - (base?.[k] || 0));
    if (v > 0) out[k] = v;
  }
  return out;
}

function captureBaseline(state: LocalEncounterRecorder, units: Unit[]): void {
  state.baselineByUnit.clear();
  for (const u of units) {
    if (u.isPet) continue;
    state.baselineByUnit.set(u.id, readRawStats(u));
  }
}

function unitsWithDeltaStats(units: Unit[], baseline: Map<string, RawCombatStats>): Unit[] {
  return units
    .filter((u) => !u.isPet)
    .map((u) => {
      const cur = readRawStats(u);
      const b = baseline.get(u.id);
      return {
        ...u,
        combatStats: {
          damageDealt: Math.max(0, cur.damageDealt - (b?.damageDealt || 0)),
          healingDone: Math.max(0, cur.healingDone - (b?.healingDone || 0)),
          overhealDone: Math.max(0, cur.overhealDone - (b?.overhealDone || 0)),
          damageTaken: Math.max(0, cur.damageTaken - (b?.damageTaken || 0)),
          interruptCount: Math.max(0, cur.interruptCount - (b?.interruptCount || 0)),
          skillDamage: diffMaps(cur.skillDamage, b?.skillDamage),
          skillHealing: diffMaps(cur.skillHealing, b?.skillHealing),
          skillDamageTaken: diffMaps(cur.skillDamageTaken, b?.skillDamageTaken),
        },
      } as Unit;
    });
}

function bossAliveOf(engine: CombatEngine): boolean | null {
  const b = engine.bossUnit;
  if (!b) return null;
  return !!(b.isAlive ?? b.alive) && b.hp > 0;
}

function upsertLocalKill(
  rsm: RunStateMachine,
  report: EncounterReport,
  state: LocalEncounterRecorder
): void {
  const idx = report.bossIndex;
  const existing = rsm.encounterReports.findIndex(
    (e) => e.bossIndex === idx && e.result === 'KILL'
  );
  if (existing >= 0) {
    // Prefer local delta report (may replace a host stub/gap later)
    rsm.encounterReports[existing] = report;
  } else {
    rsm.encounterReports.push(report);
  }
  rsm.encounterReports.sort((a, b) => a.bossIndex - b.bossIndex);
  state.recordedKillIndexes.add(idx);
}

function recordKillAtIndex(
  state: LocalEncounterRecorder,
  rsm: RunStateMachine,
  engine: CombatEngine,
  bossIndex: number,
  nowMs: number
): void {
  if (state.recordedKillIndexes.has(bossIndex)) return;
  const bossMeta = rsm.dungeon.bosses[bossIndex];
  if (!bossMeta) return;
  const durationSec = Math.max(
    1,
    state.bossCombatStartMs > 0 ? (nowMs - state.bossCombatStartMs) / 1000 : 1
  );
  const deltaUnits = unitsWithDeltaStats(engine.friendlyUnits, state.baselineByUnit);
  const report = reportMgrSingleton.generateEncounterReport(
    bossIndex,
    bossMeta.id,
    bossMeta.name,
    'KILL',
    durationSec,
    0,
    deltaUnits
  );
  upsertLocalKill(rsm, report, state);
}

/**
 * Guest: observe host combat snapshots and append local KILL reports from mirrored stats.
 */
export function noteGuestCombatSnapshot(opts: {
  state: LocalEncounterRecorder;
  rsm: RunStateMachine;
  engine: CombatEngine;
  nowMs?: number;
}): void {
  const { state, rsm, engine } = opts;
  const nowMs = opts.nowMs ?? Date.now();
  const phase = rsm.phase;
  const bossIndex = rsm.currentBossIndex;
  const alive = bossAliveOf(engine);

  // Entering a boss fight → capture baseline for deltas
  if (phase === 'BOSS_COMBAT') {
    const indexChanged = bossIndex !== state.lastBossIndex;
    const enteredCombat = state.lastPhase !== 'BOSS_COMBAT';
    if (indexChanged || enteredCombat || state.baselineByUnit.size === 0) {
      // If we skipped recording the previous boss kill (missed death frame), finalize it
      if (
        indexChanged &&
        state.lastBossIndex >= 0 &&
        state.lastPhase === 'BOSS_COMBAT' &&
        !state.recordedKillIndexes.has(state.lastBossIndex)
      ) {
        recordKillAtIndex(state, rsm, engine, state.lastBossIndex, nowMs);
      }
      captureBaseline(state, engine.friendlyUnits);
      state.bossCombatStartMs = nowMs;
    }
  }

  // Boss died while we were in combat → record kill
  if (
    phase === 'BOSS_COMBAT' &&
    state.lastBossAlive === true &&
    alive === false &&
    bossIndex >= 0
  ) {
    recordKillAtIndex(state, rsm, engine, bossIndex, nowMs);
  }

  // Advanced to travel / next boss without seeing the death frame
  if (
    (phase === 'TRAVEL_RECOVERY' || phase === 'SUMMARY') &&
    state.lastPhase === 'BOSS_COMBAT' &&
    state.lastBossIndex >= 0 &&
    !state.recordedKillIndexes.has(state.lastBossIndex)
  ) {
    recordKillAtIndex(state, rsm, engine, state.lastBossIndex, nowMs);
  }

  // Cleared SUMMARY: ensure every boss has a local KILL (stubs for hot-join gaps)
  if (phase === 'SUMMARY' && rsm.isCleared) {
    ensureLocalKillCoverage(state, rsm, engine, nowMs);
  }

  state.lastBossIndex = bossIndex;
  state.lastBossAlive = alive;
  state.lastPhase = phase;
}

function makeStubKill(rsm: RunStateMachine, bossIndex: number): EncounterReport {
  const bossMeta = rsm.dungeon.bosses[bossIndex];
  return {
    bossIndex,
    bossId: bossMeta?.id || `boss_${bossIndex}`,
    bossName: bossMeta?.name || `Boss ${bossIndex + 1}`,
    result: 'KILL',
    durationSec: 0,
    wipesBeforeKill: 0,
    unitStats: [],
  };
}

/**
 * Hot-join / missed frames: fill missing KILL slots when dungeon is cleared.
 * Personal stats come only from fights the client actually recorded.
 */
export function ensureLocalKillCoverage(
  state: LocalEncounterRecorder,
  rsm: RunStateMachine,
  engine: CombatEngine,
  nowMs = Date.now()
): void {
  const n = rsm.dungeon.bosses?.length || 0;
  for (let i = 0; i < n; i++) {
    const hasKill = rsm.encounterReports.some((e) => e.bossIndex === i && e.result === 'KILL');
    if (hasKill) {
      state.recordedKillIndexes.add(i);
      continue;
    }
    // Last boss just died into SUMMARY — try one live delta record
    if (i === rsm.currentBossIndex && state.baselineByUnit.size > 0) {
      recordKillAtIndex(state, rsm, engine, i, nowMs);
      if (state.recordedKillIndexes.has(i)) continue;
    }
    upsertLocalKill(rsm, makeStubKill(rsm, i), state);
  }
}

/**
 * Merge host-broadcast reports only into gaps (never wipe local deltas).
 */
export function mergeHostEncounterReports(
  rsm: RunStateMachine,
  hostReports: EncounterReport[]
): void {
  if (!Array.isArray(hostReports) || hostReports.length === 0) return;
  const byIndex = new Map<number, EncounterReport>();
  for (const e of rsm.encounterReports) {
    if (e.result === 'KILL') byIndex.set(e.bossIndex, e);
  }
  for (const h of hostReports) {
    if (h.result !== 'KILL') continue;
    const local = byIndex.get(h.bossIndex);
    // Keep local if it has real personal/party stats; host fills empty stubs / missing
    if (local && local.unitStats.length > 0) continue;
    byIndex.set(h.bossIndex, h);
  }
  const keepNonKills = rsm.encounterReports.filter((e) => e.result !== 'KILL');
  rsm.encounterReports = [...keepNonKills, ...byIndex.values()].sort(
    (a, b) => a.bossIndex - b.bossIndex
  );
}

/**
 * Encounters used for certificate claim / server register.
 * Uses local (and gap-filled) reports; does not require host broadcast.
 */
export function encountersForCertificateClaim(
  rsm: RunStateMachine,
  engine: CombatEngine,
  recorder?: LocalEncounterRecorder | null
): EncounterReport[] {
  if (rsm.isCleared && recorder) {
    ensureLocalKillCoverage(recorder, rsm, engine);
  }
  // If still empty but we have live units, synthesize slices for personal stats
  if (rsm.encounterReports.length === 0 && engine.friendlyUnits.length > 0) {
    const bosses = rsm.dungeon.bosses || [];
    const dur = Math.max(1, rsm.totalRunDurationSec || 1);
    const friends = engine.friendlyUnits.filter((u) => !u.isPet);
    if (bosses.length === 0) {
      return [
        reportMgrSingleton.generateEncounterReport(0, 'unknown', 'Unknown', 'KILL', dur, 0, friends),
      ];
    }
    for (let i = 0; i < bosses.length; i++) {
      const b = bosses[i];
      rsm.encounterReports.push(
        reportMgrSingleton.generateEncounterReport(
          i,
          b.id,
          b.name,
          'KILL',
          Math.max(1, dur / bosses.length),
          0,
          i === bosses.length - 1 ? friends : []
        )
      );
    }
  }
  return rsm.encounterReports;
}
