import { useEffect, useRef, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
import type {
  CharacterRecord,
  CombatEngine,
  RunStateMachine,
  Unit,
  GroundEffect,
  FloatingCombatText,
  BossAI as BossAIType,
  NetworkCastTimeline,
  NetworkCooldownTimeline,
  NetworkGcdTimeline,
  NetworkVoteState,
  PlayerInputPayload,
  AIPersonality,
  DbmAlert,
} from '@cata-raid-sim/engine';
import type { PlayerCastState } from '../components/ActionBar.js';
import type { IncomingHealCast } from '../components/RaidFrames.js';
import type { NetworkRoomFacade } from '../net/NetworkRoomFacade.js';
import {
  runCombatTickFrame,
  type CombatTickCtx,
  type CombatTickMutableState,
} from '../combat/runCombatTick.js';
import type { AiActiveCast } from '../combat/aiCombatExecutor.js';
import type { CompanionCastHud } from '../combat/castLifecycleNet.js';

/** Grouped refs for the 20Hz tick (keeps App call-site readable). */
export type CombatTickRefs = {
  rsmRef: MutableRefObject<RunStateMachine | null>;
  engineRef: MutableRefObject<CombatEngine>;
  isNetworkGuestRef: MutableRefObject<boolean>;
  isNetworkHostRef: MutableRefObject<boolean>;
  guestCastTimelinesRef: MutableRefObject<NetworkCastTimeline[]>;
  guestGcdTimelinesRef: MutableRefObject<NetworkGcdTimeline[]>;
  guestCdTimelinesRef: MutableRefObject<NetworkCooldownTimeline[]>;
  companionCastsRef?: MutableRefObject<Record<string, CompanionCastHud>>;
  guestBossOverheadSkillRef?: MutableRefObject<string | null>;
  playerCastRef: MutableRefObject<PlayerCastState | null>;
  pendingGuestInputsRef: MutableRefObject<PlayerInputPayload[]>;
  activeRoomIdRef: MutableRefObject<string | null>;
  lastWipePhaseBroadcastRef: MutableRefObject<string | null>;
  lastCombatBroadcastMsRef: MutableRefObject<number>;
  prevRunPhaseRef: MutableRefObject<string | null>;
  approachedBossIdRef: MutableRefObject<string | null>;
  roomFacadeRef: MutableRefObject<NetworkRoomFacade>;
  bossAiRef: MutableRefObject<BossAIType | null>;
  lastBossAttackTickRef: MutableRefObject<number>;
  castTargetIdRef: MutableRefObject<string | null>;
  pendingCastSlotRef: MutableRefObject<number | null>;
  lastPlayerMoveMsRef: MutableRefObject<number>;
  aiHealerCastsRef: MutableRefObject<Record<string, AiActiveCast>>;
  aiCooldownsRef: MutableRefObject<Record<string, number>>;
  lastPlayerAttackTickRef: MutableRefObject<number>;
  lastPetAttackTickRef: MutableRefObject<number>;
};

export type CombatTickSetters = {
  setPlayerCast: Dispatch<SetStateAction<PlayerCastState | null>>;
  setPlayerGcdRemainingMs: Dispatch<SetStateAction<number>>;
  setPlayerGcdTotalMs: Dispatch<SetStateAction<number>>;
  setPlayerCooldowns: Dispatch<SetStateAction<Record<string, { cdRemainingMs: number; totalCdMs: number }>>>;
  setCompanionCasts: Dispatch<
    SetStateAction<
      Record<
        string,
        {
          spellName: string;
          progress: number;
          spellId?: string;
          totalMs?: number;
          interruptible?: boolean;
          endFlash?: 'success' | 'interrupt';
          flashUntilMs?: number;
        }
      >
    >
  >;
  setGuestBossCasting?: Dispatch<
    SetStateAction<{
      spellName: string;
      spellId?: string;
      elapsedMs: number;
      castTimeMs: number;
      interruptible: boolean;
    } | null>
  >;
  setWipeVoteTimerMs: Dispatch<SetStateAction<number>>;
  setIsApproaching: Dispatch<SetStateAction<boolean>>;
  setGroundEffects: Dispatch<SetStateAction<GroundEffect[]>>;
  setFloatingTexts: Dispatch<SetStateAction<FloatingCombatText[]>>;
  setBossUnit: Dispatch<SetStateAction<Unit | undefined>>;
  setFriendlyUnits: Dispatch<SetStateAction<Unit[]>>;
  setBossTargetId: Dispatch<SetStateAction<string | null>>;
  setFocusTargetId: Dispatch<SetStateAction<string | null>>;
  setSelectedTargetId: Dispatch<SetStateAction<string | null>>;
  setRevivingUnitId: Dispatch<SetStateAction<string | null>>;
  setReviveProgress: Dispatch<SetStateAction<number>>;
  setIncomingHeals: Dispatch<SetStateAction<Record<string, number>>>;
  setIncomingCasts: Dispatch<SetStateAction<Record<string, IncomingHealCast[]>>>;
  setWaitingQueueRoomId: Dispatch<SetStateAction<string | null>>;
  setActiveRoomId: Dispatch<SetStateAction<string | null>>;
  setRunPhase: Dispatch<SetStateAction<any>>;
  setTravelRemainingMs: Dispatch<SetStateAction<number>>;
  setTotalDurationSec: Dispatch<SetStateAction<number>>;
  setTargetBossName: Dispatch<SetStateAction<string>>;
  setIsCorpseRunning: Dispatch<SetStateAction<boolean>>;
  setCorpseRunTimerMs: Dispatch<SetStateAction<number>>;
};

export type CombatTickCallbacks = {
  clearPlayerIncomingCast: () => void;
  handleCastSlot: (slotIdx: number) => void;
  resolvePlayerCast: (spellId: string, totalCdMs?: number) => boolean;
  triggerCooldown: (spellId: string, totalCdMs: number) => void;
  getPredictedHealAmount: (spellId: string, caster?: Unit) => number;
  getUnitAIPersonality: (u: Unit) => AIPersonality;
  inferAiSpecForUnit: (u: Unit) => string;
  isAiCdReady: (unitId: string, spellId: string, cdMs: number) => boolean;
  markAiCdUsed: (unitId: string, spellId: string) => void;
  notifyOom: (u: Unit, engine: CombatEngine) => void;
  onDbmAlerts?: (alerts: DbmAlert[]) => void;
};

/** Grouped deps for useCombatTick (flattened into CombatTickCtx inside the hook). */
export type CombatTickDeps = {
  runPhase: string;
  isApproaching: boolean;
  currentChar: CharacterRecord | null | undefined;
  wipeNetworkVote: NetworkVoteState | null;
  activeRoomId: string | null;
  waitingQueueRoomId: string | null;
  focusTargetId: string | null;
  refs: CombatTickRefs;
  setters: CombatTickSetters;
  callbacks: CombatTickCallbacks;
};

function flattenCombatTickDeps(deps: CombatTickDeps): CombatTickCtx {
  return {
    runPhase: deps.runPhase,
    isApproaching: deps.isApproaching,
    currentChar: deps.currentChar,
    wipeNetworkVote: deps.wipeNetworkVote,
    activeRoomId: deps.activeRoomId,
    waitingQueueRoomId: deps.waitingQueueRoomId,
    focusTargetId: deps.focusTargetId,
    ...deps.refs,
    ...deps.setters,
    ...deps.callbacks,
  };
}

/**
 * 20Hz combat orchestration (P8).
 * Interval resets tickCount/reviveTimerMs when runPhase or isApproaching changes.
 */
export function useCombatTick(deps: CombatTickDeps) {
  const ctxRef = useRef(flattenCombatTickDeps(deps));
  ctxRef.current = flattenCombatTickDeps(deps);

  const { runPhase, isApproaching } = deps;

  useEffect(() => {
    const state: CombatTickMutableState = { tickCount: 0, reviveTimerMs: 0 };
    const timer = setInterval(() => {
      runCombatTickFrame(ctxRef.current, state);
    }, 50);
    return () => clearInterval(timer);
  }, [runPhase, isApproaching]);
}
