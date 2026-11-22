// ============================================================
// [W-09] Zustand Game State Store
// ============================================================
import { create } from 'zustand';
import type {
  Unit,
  RunPhase,
  GroundEffect,
  FloatingCombatText,
  EncounterReport,
} from '@cata-raid-sim/engine';

// ── Boss State ────────────────────────────────────────────────
export interface BossState {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  phase: number;
  castBar?: {
    spellName: string;
    progressMs: number;
    totalMs: number;
    interruptible: boolean;
  };
  debuffs: Array<{
    id: string;
    name: string;
    icon?: string;
    remainingMs: number;
  }>;
  bossIndex: number;
  totalBosses: number;
}

// ── Wipe Vote State ───────────────────────────────────────────
export interface WipeVoteState {
  timerMs: number;
  votes: Record<string, 'RETRY' | 'FINISH' | null>;
}

// ── Game State ────────────────────────────────────────────────
export interface GameState {
  // Phase
  runPhase: RunPhase;
  // Units (raid members)
  units: Unit[];
  selectedUnitId: string | null;
  // Boss
  bossState: BossState | null;
  // Canvas effects
  groundEffects: GroundEffect[];
  floatingTexts: FloatingCombatText[];
  // Encounter history
  encounterReports: EncounterReport[];
  // Travel phase
  travelTargetBossName: string;
  travelRemainingMs: number;
  // Wipe vote
  wipeVote: WipeVoteState | null;
  // Instance info
  instanceTier: '5man' | '20man';
  dungeonName: string;
  totalDurationSec: number;
  // Player unit id
  playerUnitId: string | null;
}

// ── Actions ───────────────────────────────────────────────────
export interface GameActions {
  // Phase transitions
  setRunPhase: (phase: RunPhase) => void;
  startNextBoss: () => void;
  // Unit management
  setUnits: (units: Unit[]) => void;
  updateUnit: (unitId: string, partial: Partial<Unit>) => void;
  selectTarget: (unitId: string | null) => void;
  // Boss
  setBossState: (boss: BossState | null) => void;
  updateBossHp: (hp: number) => void;
  setBossPhase: (phase: number) => void;
  setBossCastBar: (cast: BossState['castBar'] | undefined) => void;
  // Spell casting
  castSpell: (spellId: string, targetId?: string) => void;
  // Ground effects
  addGroundEffect: (effect: GroundEffect) => void;
  removeGroundEffect: (effectId: string) => void;
  setGroundEffects: (effects: GroundEffect[]) => void;
  // Floating texts
  addFloatingText: (text: FloatingCombatText) => void;
  expireFloatingTexts: (nowMs: number) => void;
  // Reports
  addEncounterReport: (report: EncounterReport) => void;
  // Travel
  setTravelState: (bossName: string, remainingMs: number) => void;
  tickTravel: (deltaMs: number) => void;
  // Wipe vote
  startWipeVote: (unitIds: string[]) => void;
  submitWipeVote: (unitId: string, choice: 'RETRY' | 'FINISH') => void;
  clearWipeVote: () => void;
  // Reset
  resetForRetry: () => void;
  setInstanceTier: (tier: '5man' | '20man') => void;
  setDungeonName: (name: string) => void;
  tickTotalDuration: (deltaMs: number) => void;
  setPlayerUnitId: (id: string) => void;
}

export type FullGameStore = GameState & GameActions;

// ── SCT lifetime cutoff (ms) ──────────────────────────────────
const SCT_LIFETIME_MS = 2000;

// ── Default initial state ─────────────────────────────────────
const initialState: GameState = {
  runPhase: 'LOBBY',
  units: [],
  selectedUnitId: null,
  bossState: null,
  groundEffects: [],
  floatingTexts: [],
  encounterReports: [],
  travelTargetBossName: '',
  travelRemainingMs: 0,
  wipeVote: null,
  instanceTier: '5man',
  dungeonName: '影牙城堡',
  totalDurationSec: 0,
  playerUnitId: null,
};

// ── Store ─────────────────────────────────────────────────────
export const useGameStore = create<FullGameStore>((set, get) => ({
  ...initialState,

  // Phase
  setRunPhase: (phase) => set({ runPhase: phase }),

  startNextBoss: () => {
    // Phase will be set by engine; here we prep UI
    set({ groundEffects: [], floatingTexts: [] });
  },

  // Units
  setUnits: (units) => set({ units }),

  updateUnit: (unitId, partial) =>
    set((state) => ({
      units: state.units.map((u) => (u.id === unitId ? { ...u, ...partial } : u)),
    })),

  selectTarget: (unitId) => set({ selectedUnitId: unitId }),

  // Boss
  setBossState: (boss) => set({ bossState: boss }),

  updateBossHp: (hp) =>
    set((state) =>
      state.bossState ? { bossState: { ...state.bossState, hp } } : {}
    ),

  setBossPhase: (phase) =>
    set((state) =>
      state.bossState ? { bossState: { ...state.bossState, phase } } : {}
    ),

  setBossCastBar: (castBar) =>
    set((state) =>
      state.bossState ? { bossState: { ...state.bossState, castBar } } : {}
    ),

  // Spell cast — dispatched to engine; store just records request
  castSpell: (_spellId, _targetId) => {
    // Engine integration point: in full impl, engine processes and updates state
    // For now UI can call this and engine adapter subscribes
  },

  // Ground effects
  addGroundEffect: (effect) =>
    set((state) => ({ groundEffects: [...state.groundEffects, effect] })),

  removeGroundEffect: (effectId) =>
    set((state) => ({
      groundEffects: state.groundEffects.filter((e) => e.id !== effectId),
    })),

  setGroundEffects: (effects) => set({ groundEffects: effects }),

  // Floating texts
  addFloatingText: (text) =>
    set((state) => ({ floatingTexts: [...state.floatingTexts, text] })),

  expireFloatingTexts: (nowMs) =>
    set((state) => ({
      floatingTexts: state.floatingTexts.filter(
        (t) => nowMs - t.createdAtMs < SCT_LIFETIME_MS
      ),
    })),

  // Reports
  addEncounterReport: (report) =>
    set((state) => ({ encounterReports: [...state.encounterReports, report] })),

  // Travel
  setTravelState: (bossName, remainingMs) =>
    set({ travelTargetBossName: bossName, travelRemainingMs: remainingMs }),

  tickTravel: (deltaMs) =>
    set((state) => ({
      travelRemainingMs: Math.max(0, state.travelRemainingMs - deltaMs),
    })),

  // Wipe vote
  startWipeVote: (unitIds) =>
    set({
      runPhase: 'WIPE_VOTE',
      wipeVote: {
        timerMs: 15000,
        votes: Object.fromEntries(unitIds.map((id) => [id, null])),
      },
    }),

  submitWipeVote: (unitId, choice) =>
    set((state) => {
      if (!state.wipeVote) return {};
      return {
        wipeVote: {
          ...state.wipeVote,
          votes: { ...state.wipeVote.votes, [unitId]: choice },
        },
      };
    }),

  clearWipeVote: () => set({ wipeVote: null }),

  // Reset for retry
  resetForRetry: () =>
    set((state) => ({
      wipeVote: null,
      groundEffects: [],
      floatingTexts: [],
      runPhase: 'TRAVEL_RECOVERY',
      travelRemainingMs: 12000,
      travelTargetBossName: state.bossState?.name ?? '',
    })),

  setInstanceTier: (tier) => set({ instanceTier: tier }),
  setDungeonName: (name) => set({ dungeonName: name }),

  tickTotalDuration: (deltaMs) =>
    set((state) => ({
      totalDurationSec: state.totalDurationSec + deltaMs / 1000,
    })),

  setPlayerUnitId: (id) => set({ playerUnitId: id }),
}));
