import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  CombatEngine,
  RunStateMachine,
  RunPhase,
  AccountManager,
  LeaderboardManager,
  ReportManager,
  SHADOWFANG_KEEP_CONFIG,
  getDungeonConfig,
  SELECTABLE_DUNGEONS,
  ClassId,
  Unit,
  GroundEffect,
  FloatingCombatText,
  DungeonClearCertificate,
  DungeonDifficulty,
  CustomDifficultySettings,
  DEFAULT_CUSTOM_DIFFICULTY,
  LeaderboardEntry,
  BossAI,
  type AIPersonality,
  GroundTargetState,
  roomManager,
  type LobbyRoom,
  getRoleBySpec,
  DUNGEON_ROLE_QUOTAS,
  LEVEL_80_MAX_HASTE,
  getSpellByAnyId,
  getUnitHaste,
  RANGE_40YD_PX,
  useHeroicWill,
} from '@cata-raid-sim/engine';
import {
  hasSufficientPlayerResources,
  deductPlayerResources,
  processPlayerChannelTick,
} from './hooks/usePlayerCastController.js';
import { useRoomLobby } from './hooks/useRoomLobby.js';
import { useCombatTick } from './hooks/useCombatTick.js';
import { useNetworkRoomSync } from './hooks/useNetworkRoomSync.js';

import { WaitingQueueOverlay } from './components/room/index.js';
import { netClient } from './net/NetClient.js';
import { resolveGameApiBaseUrl } from './net/apiBase.js';
import { NetworkRoomFacade } from './net/NetworkRoomFacade.js';
import type {
  LobbyRoom as NetLobbyRoom,
  NetworkCastTimeline,
  NetworkCombatSnapshot,
  NetworkCooldownTimeline,
  NetworkGcdTimeline,
  NetworkVoteState,
  PlayerInputPayload,
  VoteResultPayload,
} from '@cata-raid-sim/engine';

import { AuthAndCharacterModal, CLASS_COLORS } from './components/AuthAndCharacterModal.js';
import { ClearCertificateModal } from './components/ClearCertificateModal.js';
import { LeaderboardModal } from './components/LeaderboardModal.js';
import { SkillBookModal } from './components/SkillBookModal.js';
import { IncomingHealCast, CLASS_COLORS_CATA } from './components/RaidFrames.js';
import { ActionSlot, PlayerCastState } from './components/ActionBar.js';
import { WipeVoteModal } from './components/WipeVoteModal.js';
import { SummaryPage } from './components/SummaryPage.js';
import { getDefaultActionSlots, DEFAULT_SPELL_COOLDOWNS } from './assets/defaultActionSlots.js';
import { SPELL_TOOLTIPS, initArtResourceIcons, subscribeToIconChanges } from './assets/pixelIcons.js';
import { GameLoadingScreen } from './components/GameLoadingScreen.js';
import {
  SPELL_MANA_COSTS,
  SPELL_ENERGY_COSTS,
  SPELL_RAGE_COSTS,
  SPELL_RUNIC_COSTS,
} from './combat/spellCosts.js';
import { syncUnitResources } from './combat/unitResources.js';
import { getDkRunesRequired, hasReadyDkRunes } from './combat/dkResources.js';
import { setupRaidUnits as setupRaidUnitsCore } from './combat/setupRaidUnits.js';
import {
  assignRaidSquads,
  getAltSquadTarget,
  raidRosterKey,
  resolveRaidSquads,
} from './combat/raidSquads.js';
import {
  applySharedCooldown,
  computePlayerGcdMs,
  resolvePlayerCast as resolvePlayerCastCore,
  handlePlayerCastSlot,
} from './hooks/usePlayerCastActions.js';
import { type AiActiveCast } from './combat/aiCombatExecutor.js';
import { confirmGroundTarget } from './combat/confirmGroundTarget.js';
import { clearMazeSync, setMazeSyncRoomId } from './combat/mazeSyncBridge.js';
import { dispelUnit } from './combat/dispelUnit.js';
import { pickNearestHostileExcluding } from './combat/tabTargetHostile.js';
import {
  getPredictedHealAmount as getPredictedHealAmountCore,
  isAiCdReady as isAiCdReadyCore,
  markAiCdUsed as markAiCdUsedCore,
  inferAiSpecForUnit,
  getOrCreateUnitAIPersonality,
  notifyOom as notifyOomCore,
} from './combat/aiUnitHelpers.js';
import { publishCastInterrupt } from './combat/castLifecycleNet.js';
import { LobbyScreen, CombatHudScreen } from './screens/index.js';

export function App() {
  // Singletons
  const accountMgrRef = useRef<AccountManager>(new AccountManager());
  const leaderboardMgrRef = useRef<LeaderboardManager>(new LeaderboardManager());
  const reportMgrRef = useRef<ReportManager>(new ReportManager());
  const engineRef = useRef<CombatEngine>(new CombatEngine());
  const rsmRef = useRef<RunStateMachine | null>(null);
  const bossAiRef = useRef<BossAI | null>(null);
  const approachedBossIdRef = useRef<string | null>(null);
  const lastPlayerMoveMsRef = useRef<number>(Date.now());
  const castTargetIdRef = useRef<string | null>(null);
  const pendingCastSlotRef = useRef<number | null>(null);
  const lastBossAttackTickRef = useRef<number>(0);
  const lastPlayerAttackTickRef = useRef<number>(0);
  const lastPetAttackTickRef = useRef<number>(0);
  const lastOomWarningMsRef = useRef<Record<string, number>>({});
  const aiCooldownsRef = useRef<Record<string, number>>({});
  const playerCastRef = useRef<PlayerCastState | null>(null);
  const aiHealerCastsRef = useRef<Record<string, AiActiveCast>>({});

  const getPredictedHealAmount = (spellId: string, caster?: Unit): number =>
    getPredictedHealAmountCore(spellId, caster);

  const clearPlayerIncomingCast = () => {
    const pUnit = engineRef.current.friendlyUnits.find(u => u.isPlayer);
    const pId = pUnit?.id || 'p1_player';

    setIncomingCasts((prev) => {
      const nextCasts: Record<string, IncomingHealCast[]> = {};
      const nextHeals: Record<string, number> = {};
      let changed = false;
      for (const [targetId, casts] of Object.entries(prev)) {
        const remaining = casts.filter(c => c.casterId !== pId);
        if (remaining.length !== casts.length) changed = true;
        if (remaining.length > 0) {
          nextCasts[targetId] = remaining;
          nextHeals[targetId] = remaining.reduce((sum, c) => sum + c.amount, 0);
        }
      }
      if (changed) {
        setIncomingHeals(nextHeals);
        return nextCasts;
      }
      return prev;
    });
  };

  const isAiCdReady = (unitId: string, spellKey: string, cdMs: number): boolean =>
    isAiCdReadyCore(aiCooldownsRef.current, unitId, spellKey, cdMs);

  const markAiCdUsed = (unitId: string, spellKey: string): void => {
    markAiCdUsedCore(aiCooldownsRef.current, unitId, spellKey);
  };

  const aiPersonalitiesRef = useRef<Map<string, AIPersonality>>(new Map());
  const getUnitAIPersonality = (u: Unit): AIPersonality =>
    getOrCreateUnitAIPersonality(aiPersonalitiesRef.current, u);

  const notifyOom = (unit: Unit, engine: CombatEngine) => {
    notifyOomCore(lastOomWarningMsRef.current, unit, engine);
  };


  // App UI States
  const [account, setAccount] = useState(() => accountMgrRef.current.getCurrentAccount());
  const [selectedCharId, setSelectedCharId] = useState<string | null>(() => accountMgrRef.current.getCurrentCharacter()?.id || null);
  const [viewingCert, setViewingCert] = useState<DungeonClearCertificate | null>(null);
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);
  const [showHeaderDeleteConfirm, setShowHeaderDeleteConfirm] = useState(false);
  const [headerDeletePassword, setHeaderDeletePassword] = useState('');
  const [headerDeleteError, setHeaderDeleteError] = useState<string | null>(null);
  const [headerDeleteBusy, setHeaderDeleteBusy] = useState(false);
  const [authOpenRequest, setAuthOpenRequest] = useState<{
    mode: 'login' | 'register';
    id: number;
  } | null>(null);
  /** 别处登录 / 心跳踢下线：立刻展示，不依赖 window.alert */
  const [sessionKickNotice, setSessionKickNotice] = useState<string | null>(null);
  const [isCertClaimed, setIsCertClaimed] = useState(false);

  // Combat runtime state
  const [runPhase, setRunPhase] = useState<'LOBBY' | 'TRAVEL_RECOVERY' | 'BOSS_COMBAT' | 'WIPE_VOTE' | 'SUMMARY'>('LOBBY');
  const [isApproaching, setIsApproaching] = useState(false);
  const [friendlyUnits, setFriendlyUnits] = useState<Unit[]>([]);
  const [bossUnit, setBossUnit] = useState<Unit | undefined>(undefined);
  const [bossTargetId, setBossTargetId] = useState<string | null>(null);
  const [groundEffects, setGroundEffects] = useState<GroundEffect[]>([]);
  const [floatingTexts, setFloatingTexts] = useState<FloatingCombatText[]>([]);
  const [guestBossCasting, setGuestBossCasting] = useState<{
    spellName: string;
    spellId?: string;
    description?: string;
    school?: string;
    elapsedMs: number;
    castTimeMs: number;
    interruptible: boolean;
  } | null>(null);
  const lastMoveBroadcastMsRef = useRef(0);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [hoveredTargetId, setHoveredTargetId] = useState<string | null>(null);
  const [playerCooldowns, setPlayerCooldowns] = useState<Record<string, { cdRemainingMs: number; totalCdMs: number }>>({});
  const [playerGcdRemainingMs, setPlayerGcdRemainingMs] = useState(0);
  const [playerGcdTotalMs, setPlayerGcdTotalMs] = useState(1000);
  const [incomingHeals, setIncomingHeals] = useState<Record<string, number>>({});
  const [incomingCasts, setIncomingCasts] = useState<Record<string, IncomingHealCast[]>>({});
  const [travelRemainingMs, setTravelRemainingMs] = useState(15000);
  const [wipeVoteTimerMs, setWipeVoteTimerMs] = useState(15000);
  const [totalDurationSec, setTotalDurationSec] = useState(0);
  const [targetBossName, setTargetBossName] = useState('亚什布里男爵');
  const [screenShake, setScreenShake] = useState(false);

  // Dynamic Cast and Resurrection States
  const [playerCast, setPlayerCast] = useState<PlayerCastState | null>(null);
  const [companionCasts, setCompanionCasts] = useState<
    Record<string, { spellName: string; progress: number; spellId?: string }>
  >({});
  const [revivingUnitId, setRevivingUnitId] = useState<string | null>(null);
  const [reviveProgress, setReviveProgress] = useState(0);
  const [isCorpseRunning, setIsCorpseRunning] = useState(false);
  const [corpseRunTimerMs, setCorpseRunTimerMs] = useState(0);
  const [groundTargetState, setGroundTargetState] = useState<GroundTargetState | null>(null);
  const [customSlotLayout, setCustomSlotLayout] = useState<ActionSlot[] | null>(null);
  /** Which char+spec `customSlotLayout` belongs to — prevents stale skills after character switch. */
  const customSlotOwnerRef = useRef<string | null>(null);
  const [isSkillBookOpen, setIsSkillBookOpen] = useState(false);
  const [dungeonTier, setDungeonTier] = useState<'5man' | '20man'>(() => {
    const initChar = accountMgrRef.current.getCurrentCharacter();
    if (initChar?.lastDungeonTier) return initChar.lastDungeonTier;
    try {
      const saved = localStorage.getItem('cata_dungeon_tier');
      if (saved === '5man' || saved === '20man') return saved;
    } catch {}
    return '5man';
  });
  const [selectedDungeonId, setSelectedDungeonId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('cata_dungeon_id');
      if (saved && SELECTABLE_DUNGEONS.some(d => d.id === saved)) return saved;
    } catch {}
    return 'shadowfang_keep';
  });
  const [dungeonDifficulty, setDungeonDifficulty] = useState<DungeonDifficulty>(() => {
    const initChar = accountMgrRef.current.getCurrentCharacter();
    if (initChar?.lastDungeonDifficulty) return initChar.lastDungeonDifficulty;
    try {
      const saved = localStorage.getItem('cata_dungeon_difficulty');
      if (saved === 'NORMAL' || saved === 'HEROIC' || saved === 'CUSTOM') {
        return saved;
      }
    } catch {}
    return 'NORMAL';
  });
  const [customDifficulty, setCustomDifficulty] = useState<CustomDifficultySettings>(() => {
    const initChar = accountMgrRef.current.getCurrentCharacter();
    if (initChar?.lastCustomDifficulty) return { ...DEFAULT_CUSTOM_DIFFICULTY, ...initChar.lastCustomDifficulty };
    try {
      const raw = localStorage.getItem('cata_custom_difficulty_settings');
      if (raw) {
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_CUSTOM_DIFFICULTY, ...parsed };
      }
    } catch {}
    return DEFAULT_CUSTOM_DIFFICULTY;
  });
  const [focusTargetId, setFocusTargetId] = useState<string | null>(null);
  /** 20-man: selected squad for Alt+1~5 (0=小队1). 5-man always squad 0. */
  const [selectedSquadIndex, setSelectedSquadIndex] = useState(0);
  /** Stable squad id lists; re-rolled when roster identity changes. */
  const [raidSquadIds, setRaidSquadIds] = useState<string[][]>([]);
  const raidRosterKeyRef = useRef('');
  const isShiftPressedRef = useRef(false);
  const [autoApproachTarget, setAutoApproachTarget] = useState<{ targetX: number; targetY: number; desiredDist: number; pendingSlotIdx: number } | null>(null);
  const prevRunPhaseRef = useRef<RunPhase>('LOBBY');

  // Host: paint AoE rings as soon as actionLog records a pulse (boss/AI/player)
  useEffect(() => {
    const engine = engineRef.current;
    engine.onCombatAction = (ev) => {
      if (!ev.aoePulse) return;
      window.dispatchEvent(
        new CustomEvent('cata_combat_actions', { detail: { actions: [ev], local: true } })
      );
    };
    return () => {
      engine.onCombatAction = null;
    };
  }, []);

  // Global Shift key tracking for Focus targeting
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') isShiftPressedRef.current = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') isShiftPressedRef.current = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const currentChar = account?.characters.find(c => c.id === selectedCharId) || account?.characters[0] || null;

  // Persisted Raid Target Marks per account character (新开本对同名称玩家的标记保存在账号角色中)
  const [savedRaidMarks, setSavedRaidMarks] = useState<Record<string, string>>(() => {
    return currentChar ? accountMgrRef.current.getSavedRaidMarks(currentChar.id) : {};
  });

  useEffect(() => {
    if (currentChar) {
      setSavedRaidMarks(accountMgrRef.current.getSavedRaidMarks(currentChar.id));
    }
  }, [currentChar?.id]);

  const handleSetRaidMark = useCallback((targetUnitName: string, mark: string | null) => {
    setSavedRaidMarks((prev) => {
      const next = { ...prev };
      if (mark) {
        next[targetUnitName] = mark;
      } else {
        delete next[targetUnitName];
      }
      if (currentChar) {
        accountMgrRef.current.saveRaidTargetMark(currentChar.id, targetUnitName, mark);
      }
      return next;
    });
  }, [currentChar]);

  // Initialize Run State Machine
  useEffect(() => {
    const engine = engineRef.current;
    const rsm = new RunStateMachine(SHADOWFANG_KEEP_CONFIG, engine, reportMgrRef.current);
    rsmRef.current = rsm;
  }, []);

  // Dungeon Lobby & Room State
  const [lobbySubView, setLobbySubView] = useState<'AUTH_CHAR' | 'ROOM_LIST' | 'ROOM_DETAIL'>('AUTH_CHAR');
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [waitingQueueRoomId, setWaitingQueueRoomId] = useState<string | null>(null);
  const [, setRoomsTick] = useState<number>(0);
  const [netConnected, setNetConnected] = useState(false);
  const [wipeNetworkVote, setWipeNetworkVote] = useState<NetworkVoteState | null>(null);
  const [skipTravelVote, setSkipTravelVote] = useState<NetworkVoteState | null>(null);
  const [myWipeVote, setMyWipeVote] = useState<'RETRY' | 'FINISH' | null>(null);
  const [mySkipVote, setMySkipVote] = useState<'YES' | 'NO' | null>(null);
  const guestCastTimelinesRef = useRef<NetworkCastTimeline[]>([]);
  const guestCdTimelinesRef = useRef<NetworkCooldownTimeline[]>([]);
  const guestGcdTimelinesRef = useRef<NetworkGcdTimeline[]>([]);
  const applyWipeVoteResultRef = useRef<(choice: 'RETRY' | 'FINISH') => void>(() => {});
  const lastWipePhaseBroadcastRef = useRef<string | null>(null);
  const roomFacadeRef = useRef(new NetworkRoomFacade(roomManager));
  const isNetworkGuestRef = useRef(false);
  const isNetworkHostRef = useRef(false);
  const activeRoomIdRef = useRef<string | null>(null);
  const waitingQueueRoomIdRef = useRef<string | null>(null);
  const pendingGuestInputsRef = useRef<PlayerInputPayload[]>([]);
  const lastCombatBroadcastMsRef = useRef(0);
  const lastInterruptSpellRef = useRef<string | null>(null);
  const startAdventureRef = useRef<(overrides?: {
    tier?: '5man' | '20man';
    difficulty?: DungeonDifficulty;
    customDiff?: CustomDifficultySettings;
    activeRoom?: LobbyRoom;
  }) => void>(() => {});
  const customDifficultyRef = useRef(customDifficulty);
  customDifficultyRef.current = customDifficulty;
  const setupRaidUnitsRef = useRef<(
    char: NonNullable<typeof currentChar>,
    tier?: '5man' | '20man',
    diff?: DungeonDifficulty,
    customDiff?: CustomDifficultySettings,
    activeRoom?: LobbyRoom
  ) => void>(() => {});

  useEffect(() => {
    activeRoomIdRef.current = activeRoomId;
    setMazeSyncRoomId(activeRoomId);
  }, [activeRoomId]);

  useEffect(() => {
    waitingQueueRoomIdRef.current = waitingQueueRoomId;
  }, [waitingQueueRoomId]);

  // Ensure any AI-only rooms are always cleaned up on mount
  useEffect(() => {
    roomManager.cleanupAiOnlyRooms();
  }, []);

  useNetworkRoomSync({
    currentChar,
    account,
    accountMgrRef,
    roomFacadeRef,
    rsmRef,
    engineRef,
    isNetworkHostRef,
    isNetworkGuestRef,
    activeRoomIdRef,
    waitingQueueRoomIdRef,
    setupRaidUnitsRef,
    customDifficultyRef,
    startAdventureRef,
    guestCastTimelinesRef,
    guestCdTimelinesRef,
    guestGcdTimelinesRef,
    playerCastRef,
    pendingGuestInputsRef,
    applyWipeVoteResultRef,
    setNetConnected,
    setRoomsTick,
    setAccount,
    setSelectedCharId,
    setActiveRoomId,
    setLobbySubView,
    setRunPhase,
    setIsApproaching,
    setSessionKickNotice,
    setAuthOpenRequest,
    setWaitingQueueRoomId,
    setDungeonTier,
    setSelectedDungeonId,
    setDungeonDifficulty,
    setCustomDifficulty,
    setFriendlyUnits,
    setBossUnit,
    setPlayerCast,
    setCompanionCasts,
    setBossTargetId,
    setPlayerGcdRemainingMs,
    setPlayerGcdTotalMs,
    setTravelRemainingMs,
    setWipeNetworkVote,
    setSkipTravelVote,
    setMyWipeVote,
    setMySkipVote,
    setGroundEffects,
    setFloatingTexts,
    setGuestBossCasting,
  });

  // ── [Game Load] 启动：下载 ART 图标 + 拉取账号，显示加载进度界面 ──
  const [, setArtIconRevision] = useState(0);
  const [bootLoading, setBootLoading] = useState(true);
  const [bootPercent, setBootPercent] = useState(0);
  const [bootLabel, setBootLabel] = useState('正在启动…');

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribeToIconChanges(() => {
      setArtIconRevision((prev) => prev + 1);
    });

    (async () => {
      try {
        const accountPromise = accountMgrRef.current.loadFromServer().then((success) => {
          if (cancelled) return;
          if (success) {
            const curAcc = accountMgrRef.current.getCurrentAccount();
            setAccount(curAcc ? { ...curAcc } : null);
            const curChar = accountMgrRef.current.getCurrentCharacter();
            if (curChar) setSelectedCharId(curChar.id);
          }
        });

        await initArtResourceIcons((p) => {
          if (cancelled) return;
          // Reserve top ~8% for account sync after art download
          setBootPercent(Math.min(92, p.percent * 0.92));
          setBootLabel(p.label);
        });

        if (!cancelled) {
          setBootLabel('同步账号数据…');
          setBootPercent(94);
        }
        await accountPromise;

        if (!cancelled) {
          setBootPercent(100);
          setBootLabel('进入游戏');
          // Brief beat so 100% is visible
          await new Promise((r) => setTimeout(r, 180));
          setBootLoading(false);
        }
      } catch (e) {
        console.warn('[Boot] 资源加载异常，仍进入游戏:', e);
        if (!cancelled) setBootLoading(false);
      }
    })();

    if (typeof import.meta !== 'undefined' && (import.meta as any).hot) {
      (import.meta as any).hot.on('art-resources-changed', () => {
        initArtResourceIcons();
      });
    }
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.difficulty = dungeonDifficulty;
      engineRef.current.customDifficulty = customDifficulty;
    }
  }, [dungeonDifficulty, customDifficulty]);

  // Setup party units based on selected character and dungeon tier (5man vs 20man)
  const setupRaidUnits = (
    char: typeof currentChar,
    tier: '5man' | '20man' = dungeonTier,
    diff: DungeonDifficulty = dungeonDifficulty,
    customDiff: CustomDifficultySettings = customDifficulty,
    activeRoom?: LobbyRoom
  ) => {
    setPlayerCooldowns({});
    playerCastRef.current = null;
    clearPlayerIncomingCast();
    setPlayerCast(null);
    const party = setupRaidUnitsCore({
      engine: engineRef.current,
      char,
      tier,
      diff,
      customDiff,
      activeRoom,
    });
    setFriendlyUnits(party);
  };
  setupRaidUnitsRef.current = setupRaidUnits;

  const handleCustomDifficultyChange = (settings: CustomDifficultySettings) => {
    setCustomDifficulty(settings);
    try {
      localStorage.setItem('cata_custom_difficulty_settings', JSON.stringify(settings));
    } catch {}
    if (currentChar) {
      accountMgrRef.current.saveDungeonPreferences(currentChar.id, dungeonTier, dungeonDifficulty, settings);
      setAccount({ ...accountMgrRef.current.getCurrentAccount()! });
      if (runPhase === 'LOBBY') {
        setupRaidUnits(currentChar, dungeonTier, dungeonDifficulty, settings);
      }
    }
  };

  const {
    handleLeaveActiveRoom,
    handleCreateRoom,
    handleJoinRoom,
    handleJoinWaitingQueue,
    handleQuickJoin,
    handleStartGameFromRoom,
  } = useRoomLobby({
    currentChar,
    activeRoomId,
    dungeonDifficulty,
    customDifficulty,
    roomFacadeRef,
    isNetworkHostRef,
    isNetworkGuestRef,
    engineRef,
    rsmRef,
    setRunPhase,
    startAdventureRef,
    setActiveRoomId,
    setLobbySubView,
    setRoomsTick,
    setWaitingQueueRoomId,
    setFriendlyUnits,
    setDungeonTier,
    setDungeonDifficulty,
    setCustomDifficulty,
    onCustomDifficultyChange: handleCustomDifficultyChange,
  });

  // Sync character's saved dungeon preferences on character switch
  useEffect(() => {
    if (currentChar) {
      const tier = currentChar.lastDungeonTier || '5man';
      const diff = currentChar.lastDungeonDifficulty || 'NORMAL';
      const customDiff = currentChar.lastCustomDifficulty || DEFAULT_CUSTOM_DIFFICULTY;
      setDungeonTier(tier);
      setDungeonDifficulty(diff);
      setCustomDifficulty(customDiff);
      if (runPhase === 'LOBBY') {
        setupRaidUnits(currentChar, tier, diff, customDiff);
      }
    }
  }, [currentChar?.id]);

  // Main 20Hz Tick loop (50ms)
  // Handle WASD movement callback  // Handle WASD movement callback (cancels casts and checks red potion penalty)
  const handlePlayerMove = () => {
    lastPlayerMoveMsRef.current = Date.now();
    // Moving immediately cancels any active player cast or channel
    if (playerCastRef.current) {
      const cancelled = playerCastRef.current;
      playerCastRef.current = null;
      setPlayerCast(null);
      pendingCastSlotRef.current = null;
      engineRef.current.effectsManager?.addFloatingText({
        targetId: currentChar?.id || 'p1_player',
        text: '移动打断施法',
        category: 'STATUS',
        isCrit: false,
      });
      clearPlayerIncomingCast();
      if (currentChar) {
        publishCastInterrupt({
          unitId: currentChar.id,
          spellId: cancelled.spellId,
          spellName: cancelled.spellName,
          targetId: cancelled.targetId || currentChar.id,
        });
      }
      if (isNetworkGuestRef.current && netClient.connected && activeRoomIdRef.current && currentChar) {
        netClient.sendPlayerInput(activeRoomIdRef.current, {
          kind: 'INTERRUPT',
          playerId: currentChar.id,
          spellId: cancelled.spellId,
        });
      }
    }

    // Check Lord Walden Red Potion penalty: Moving deals lethal damage!
    const engine = engineRef.current;
    const player = engine.friendlyUnits.find(u => u.isPlayer);
    if (player && (player.isAlive || player.alive) && player.buffs.some(b => b.spellId === 'toxic_coagulant')) {
      engine.dealDamage(engine.bossUnit || player, player, 18000, 'NATURE', false);
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '红色药剂惩罚！移动造成致命伤害！-18,000',
        category: 'SPELL_NATURE',
        isCrit: true,
      });
    }
  };

  // Handle ESC or manual cast cancellation
  const handleCancelPlayerCast = () => {
    pendingCastSlotRef.current = null;
    if (playerCastRef.current) {
      const cancelled = playerCastRef.current;
      const spellId = cancelled.spellId;
      playerCastRef.current = null;
      setPlayerCast(null);
      if (currentChar) {
        engineRef.current.interruptCast(currentChar.id);
        publishCastInterrupt({
          unitId: currentChar.id,
          spellId,
          spellName: cancelled.spellName,
          targetId: cancelled.targetId || currentChar.id,
        });
        if (netClient.connected && activeRoomIdRef.current) {
          if (isNetworkGuestRef.current) {
            netClient.sendPlayerInput(activeRoomIdRef.current, {
              kind: 'INTERRUPT',
              playerId: currentChar.id,
              spellId,
            });
          } else {
            netClient.sendCastInterrupt(activeRoomIdRef.current, currentChar.id, spellId);
          }
        }
      }
      engineRef.current.effectsManager?.addFloatingText({
        targetId: currentChar?.id || 'p1_player',
        text: '施法已取消',
        category: 'STATUS',
        isCrit: false,
      });
      clearPlayerIncomingCast();
    }
  };

  // Trigger spell cooldown (with shared cooldown group propagation)
  const triggerCooldown = (spellId: string, totalCdMs: number) => {
    setPlayerCooldowns((prev) => applySharedCooldown(prev, spellId, totalCdMs));
  };

  // Trigger Global Cooldown (GCD) using authentic Lv.80 Cataclysm GCD grouping
  const triggerGcd = (spellId?: string) => {
    const engine = engineRef.current;
    const player = engine.friendlyUnits.find(u => u.isPlayer);
    const gcdMs = computePlayerGcdMs(
      spellId,
      player?.classId,
      getUnitHaste(player, LEVEL_80_MAX_HASTE)
    );
    if (gcdMs <= 0) return;
    setPlayerGcdRemainingMs(gcdMs);
    setPlayerGcdTotalMs(gcdMs);
    if (player) {
      engine.cooldownManager?.startGcd?.(player.id, gcdMs);
    }
  };

  // Resolve completed cast from player - effect table lives in combat/resolvePlayerCast.ts
  const resolvePlayerCast = (spellId: string, totalCdMs?: number): boolean => {
    return resolvePlayerCastCore(spellId, totalCdMs, {
      engine: engineRef.current,
      castTargetId: castTargetIdRef.current,
      selectedTargetId,
      onScreenShake: (ms) => {
        setScreenShake(true);
        setTimeout(() => setScreenShake(false), ms);
      },
      onFriendlyUnitsChanged: () => {
        setFriendlyUnits([...engineRef.current.friendlyUnits]);
      },
      onTriggerCooldown: triggerCooldown,
    });
  };

  const handleDispelUnit = (targetUnitId?: string | null) => {
    // Guest: report only — host resolves & broadcasts; avoid local double-apply
    if (isNetworkGuestRef.current && netClient.connected && activeRoomIdRef.current && currentChar) {
      netClient.sendPlayerInput(activeRoomIdRef.current, {
        kind: 'DISPEL',
        playerId: currentChar.id,
        targetId: targetUnitId || selectedTargetId || currentChar.id,
      });
      return;
    }
    const engine = engineRef.current;
    const player = engine.friendlyUnits.find(u => u.isPlayer);
    if (!player) return;
    dispelUnit({
      engine,
      player,
      classId: currentChar?.classId,
      lastSpec: currentChar?.lastSpec,
      playerGcdRemainingMs,
      playerCooldowns,
      selectedTargetId,
      targetUnitId,
      triggerCooldown,
      triggerGcd,
    });
  };

  /** Guest WASD/click-move → host (throttled). Host broadcasts positions in COMBAT_STATE. */
  const handleNetworkMovePosition = (x: number, y: number) => {
    if (!isNetworkGuestRef.current || !netClient.connected || !activeRoomIdRef.current || !currentChar) return;
    const now = Date.now();
    if (now - lastMoveBroadcastMsRef.current < 80) return;
    lastMoveBroadcastMsRef.current = now;
    netClient.sendPlayerInput(activeRoomIdRef.current, {
      kind: 'MOVE',
      playerId: currentChar.id,
      x,
      y,
    });
  };

  // Helper to load spec custom action slot layout from character record or localStorage
  const loadSpecCustomSlots = (charId?: string, specId?: string, classId?: ClassId): ActionSlot[] | null => {
    if (!charId || !specId || !classId) return null;
    try {
      const savedRaw = localStorage.getItem(`cata_slots_${charId}_${specId}`);
      if (savedRaw) {
        const parsed = JSON.parse(savedRaw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    const char = account?.characters.find(c => c.id === charId) || currentChar;
    if (char?.specSlotLayouts?.[specId]) {
      const layout = char.specSlotLayouts[specId];
      const defaults = getDefaultActionSlots(classId, specId);
      const res: ActionSlot[] = [];
      for (const [idxStr, spellId] of Object.entries(layout)) {
        const slotIdx = parseInt(idxStr, 10);
        const spellTip = SPELL_TOOLTIPS[spellId];
        const defaultSlot = defaults.find(d => d.spellId === spellId);
        res.push({
          slotIdx,
          spellId,
          name: defaultSlot?.name || spellTip?.name || spellId,
          iconText: defaultSlot?.iconText || (spellTip?.name || spellId).slice(0, 1),
          totalCdMs: defaultSlot?.totalCdMs || 0,
          cdRemainingMs: 0,
          colorHex: defaultSlot?.colorHex || '#38BDF8',
        });
      }
      if (res.length > 0) return res;
    }
    return null;
  };

  const slotOwnerKey = (charId: string, specId: string) => `${charId}|${specId}`;

  /** Reload action-bar cache for a character/spec (must run on character select, not only on spec click). */
  const reloadCustomSlotLayout = (charId: string, specId: string, classId: ClassId) => {
    customSlotOwnerRef.current = slotOwnerKey(charId, specId);
    setCustomSlotLayout(loadSpecCustomSlots(charId, specId, classId));
  };

  // Helper to persist custom slots to both memory state, localStorage and AccountManager
  const persistCustomSlots = (newSlots: ActionSlot[], targetCharId?: string, targetSpecId?: string) => {
    const cid = targetCharId || currentChar?.id;
    const sid = targetSpecId || currentChar?.lastSpec;
    if (cid === currentChar?.id && sid === currentChar?.lastSpec) {
      customSlotOwnerRef.current = slotOwnerKey(cid, sid);
      setCustomSlotLayout([...newSlots]);
    }
    if (!cid || !sid) return;
    try {
      localStorage.setItem(`cata_slots_${cid}_${sid}`, JSON.stringify(newSlots));
    } catch {}
    const layoutMap: Record<number, string> = {};
    for (const s of newSlots) {
      layoutMap[s.slotIdx] = s.spellId;
    }
    accountMgrRef.current.saveSpecSlotLayout(cid, sid, layoutMap);
    const acc = accountMgrRef.current.getCurrentAccount();
    if (acc) setAccount({ ...acc });
  };

  // Skill slot actions mapped to class AND active spec (Supports 3 Action Bars: 36 slots)
  const getPlayerSlots = (targetCharId?: string, targetSpecId?: string): ActionSlot[] => {
    const char = targetCharId
      ? (accountMgrRef.current.getCharacters().find(c => c.id === targetCharId) || currentChar)
      : currentChar;
    if (!char) return [];
    const spec = targetSpecId || char.lastSpec;
    const isCurrentActive = (!targetCharId || targetCharId === currentChar?.id) && (!targetSpecId || targetSpecId === currentChar?.lastSpec);
    const layoutOwnsCurrent =
      !!customSlotLayout &&
      customSlotOwnerRef.current === slotOwnerKey(char.id, spec);
    const baseSlots = (isCurrentActive && layoutOwnsCurrent && customSlotLayout)
      || loadSpecCustomSlots(char.id, spec, char.classId)
      || getDefaultActionSlots(char.classId, spec);
    return baseSlots.map(s => {
      const defaultCd = DEFAULT_SPELL_COOLDOWNS[s.spellId] || 0;
      const totalCdMs = (s.totalCdMs && s.totalCdMs > 0) ? s.totalCdMs : defaultCd;
      const cdRemainingMs = isCurrentActive ? (playerCooldowns[s.spellId]?.cdRemainingMs || 0) : 0;
      return {
        ...s,
        totalCdMs: playerCooldowns[s.spellId]?.totalCdMs || totalCdMs,
        cdRemainingMs,
      };
    });
  };

  // Swap action slots (Draggable action bar rearrangement across 36 slots)
  const handleSwapSlots = (srcIdx: number, destIdx: number, targetCharId?: string, targetSpecId?: string) => {
    const slots = [...getPlayerSlots(targetCharId, targetSpecId)];
    const srcSlot = slots.find(s => s.slotIdx === srcIdx);
    const destSlot = slots.find(s => s.slotIdx === destIdx);

    if (srcSlot && destSlot) {
      srcSlot.slotIdx = destIdx;
      destSlot.slotIdx = srcIdx;
    } else if (srcSlot) {
      srcSlot.slotIdx = destIdx;
    }
    persistCustomSlots(slots, targetCharId, targetSpecId);
  };

  // Assign spell to slot (from Spellbook drag-and-drop)
  const handleAssignSlot = (slotIdx: number, spellId: string, targetCharId?: string, targetSpecId?: string) => {
    const slots = [...getPlayerSlots(targetCharId, targetSpecId)];
    const spellTip = SPELL_TOOLTIPS[spellId];
    const existingIdx = slots.findIndex(s => s.slotIdx === slotIdx);
    const char = targetCharId
      ? (accountMgrRef.current.getCharacters().find(c => c.id === targetCharId) || currentChar)
      : currentChar;
    const charColor = char?.classId ? CLASS_COLORS_CATA[char.classId] : '#38BDF8';
    const defaultCdMs = DEFAULT_SPELL_COOLDOWNS[spellId] || 0;
    const newSlot: ActionSlot = {
      slotIdx,
      spellId,
      name: spellTip?.name || spellId,
      iconText: (spellTip?.name || spellId).slice(0, 1),
      totalCdMs: defaultCdMs,
      cdRemainingMs: 0,
      colorHex: charColor || '#38BDF8',
    };
    if (existingIdx >= 0) {
      slots[existingIdx] = newSlot;
    } else {
      slots.push(newSlot);
    }
    persistCustomSlots(slots, targetCharId, targetSpecId);
  };

  // Clear an action slot (when dragged off the action bar / dropped outside)
  const handleClearSlot = (slotIdx: number, targetCharId?: string, targetSpecId?: string) => {
    const slots = getPlayerSlots(targetCharId, targetSpecId).filter(s => s.slotIdx !== slotIdx);
    persistCustomSlots(slots, targetCharId, targetSpecId);
  };

  // Out-of-range calculation for player spells
  const outOfRangeSpells = useMemo(() => {
    const engine = engineRef.current;
    const player = engine.friendlyUnits.find(u => u.isPlayer);
    const boss = engine.bossUnit;
    const res: Record<string, boolean> = {};
    if (!player) return res;

    const pX = player.position.x || 180;
    const pY = player.position.y || 160;

    // Selected target or player for friendly heals
    const target = selectedTargetId
      ? engine.friendlyUnits.find(u => u.id === selectedTargetId) || player
      : player;
    const tX = target.position.x || 180;
    const tY = target.position.y || 160;
    const distToTarget = Math.hypot(tX - pX, tY - pY);

    // Boss distance for offensive spells
    const bX = boss?.position.x || 520;
    const bY = boss?.position.y || 200;
    const distToBoss = Math.hypot(bX - pX, bY - pY);

    // Melee spells (range <= 80px)
    const meleeSpells = [
      'death_strike', 'heart_strike', 'rune_strike', 'mind_freeze', 'sinister_strike',
      'eviscerate', 'kick', 'obliterate', 'frost_strike', 'mutilate', 'envenom'
    ];
    for (const sp of meleeSpells) {
      res[sp] = distToBoss > 80;
    }

    // Ranged attack spells (range <= RANGE_40YD_PX ≈40yd)
    const rangedAttackSpells = [
      'fireball', 'living_bomb', 'pyroblast', 'combustion', 'counterspell',
      'death_and_decay', 'dark_command', 'howling_blast', 'starsurge', 'wrath',
      'starfire', 'moonfire', 'sunfire', 'lightning_bolt', 'lava_burst',
      'chain_lightning', 'flame_shock', 'earth_shock', 'frostbolt', 'ice_lance',
      'deep_freeze', 'frozen_orb', 'arcane_blast', 'arcane_missiles', 'arcane_barrage'
    ];
    for (const sp of rangedAttackSpells) {
      res[sp] = distToBoss > RANGE_40YD_PX;
    }

    // Friendly targeted spells (range <= RANGE_40YD_PX ≈40yd)
    const healSpells = [
      'rejuvenation', 'lifebloom', 'swiftmend', 'wild_growth', 'regrowth', 'healing_touch',
      'rebirth', 'revive', 'riptide', 'healing_wave', 'chain_heal', 'ancestral_spirit', 'innervate',
      'nourish', 'healing_surge', 'greater_healing_wave', 'natures_cure', 'cleanse_spirit', 'remove_curse', 'remove_corruption'
    ];
    for (const sp of healSpells) {
      res[sp] = distToTarget > RANGE_40YD_PX;
    }

    // Dynamic range check for ALL 10 Cataclysm classes' slotted spells
    for (const slot of getPlayerSlots()) {
      if (res[slot.spellId] !== undefined) continue;
      const norm = getSpellByAnyId(slot.spellId, player.classId);
      if (!norm) continue;
      if (norm.isDefensive || norm.isResourceRestore) {
        res[slot.spellId] = false;
      } else if (norm.isRaidBuff || (norm.isBuff && !norm.isDamage)) {
        // MotW 30yd to ally; Horn/Battle Shout self (rangePx=0)
        res[slot.spellId] = (norm.rangePx || 0) > 0 && distToTarget > norm.rangePx;
      } else if (norm.isHeal || norm.isShield || norm.isDispel || norm.isResurrect) {
        res[slot.spellId] = distToTarget > (norm.rangePx || RANGE_40YD_PX);
      } else if (norm.school === 'PHYSICAL' && norm.classId !== 'HUNTER' && !norm.isTaunt) {
        res[slot.spellId] = distToBoss > 80;
      } else {
        res[slot.spellId] = distToBoss > (norm.rangePx || RANGE_40YD_PX);
      }
    }

    return res;
  }, [friendlyUnits, bossUnit, selectedTargetId]);

  // Compute resource insufficiency (Mana / Energy / Rage / Focus / Runic Power / Holy Power)
  const { insufficientResourceSpells, spellResourceErrors } = useMemo(() => {
    const engine = engineRef.current;
    const player = engine.friendlyUnits.find(u => u.isPlayer);
    const insufficient: Record<string, boolean> = {};
    const errors: Record<string, string> = {};
    if (!player) return { insufficientResourceSpells: insufficient, spellResourceErrors: errors };

    const curMp = player.mp ?? player.resources?.find(r => r.kind === 'MANA')?.current ?? 0;
    const curEnergy = player.energy ?? player.resources?.find(r => r.kind === 'ENERGY')?.current ?? 100;
    const curRage = player.rage ?? 0;
    const curFocus = player.focus ?? 100;
    const curRunic = player.runicPower ?? 0;
    const curHolyPower = player.holyPower ?? 0;

    const slots = getPlayerSlots();
    for (const slot of slots) {
      const spId = slot.spellId;
      const norm = getSpellByAnyId(spId, player.classId);

      const manaCost = SPELL_MANA_COSTS[spId] ?? (norm?.resourceKind === 'MANA' ? norm.resourceCostAmount : 0);
      if (manaCost > 0 && player.maxMp && player.maxMp > 0 && curMp < manaCost) {
        insufficient[spId] = true;
        errors[spId] = '法力值不足';
        continue;
      }
      const energyCost = SPELL_ENERGY_COSTS[spId] ?? (norm?.resourceKind === 'ENERGY' ? norm.resourceCostAmount : 0);
      if (energyCost > 0 && player.classId === 'ROGUE' && curEnergy < energyCost) {
        insufficient[spId] = true;
        errors[spId] = '能量不足';
        continue;
      }
      const rageCost = SPELL_RAGE_COSTS[spId] ?? (norm?.resourceKind === 'RAGE' ? norm.resourceCostAmount : 0);
      if (rageCost > 0 && (player.classId === 'WARRIOR' || (player.classId === 'DRUID' && player.role === 'TANK')) && curRage < rageCost) {
        insufficient[spId] = true;
        errors[spId] = '怒气不足';
        continue;
      }
      const focusCost = norm?.resourceKind === 'FOCUS' ? norm.resourceCostAmount : 0;
      if (focusCost > 0 && player.classId === 'HUNTER' && curFocus < focusCost) {
        insufficient[spId] = true;
        errors[spId] = '集中值不足';
        continue;
      }
      const runicCost = SPELL_RUNIC_COSTS[spId] ?? (norm?.resourceKind === 'RUNIC_POWER' ? norm.resourceCostAmount : 0);
      if (runicCost > 0 && player.classId === 'DK' && curRunic < runicCost) {
        insufficient[spId] = true;
        errors[spId] = '符能不足';
        continue;
      }
      if (player.classId === 'DK') {
        const runeReq =
          (norm?.runesRequired as Array<'BLOOD' | 'FROST' | 'UNHOLY'> | undefined) ||
          getDkRunesRequired(spId, player.classId);
        if (runeReq.length > 0 && !hasReadyDkRunes(player, runeReq)) {
          insufficient[spId] = true;
          errors[spId] = '符文不足';
          continue;
        }
      }
      const hpCost = norm?.resourceKind === 'HOLY_POWER' ? norm.resourceCostAmount : 0;
      if (hpCost > 0 && player.classId === 'PALADIN' && curHolyPower < hpCost) {
        insufficient[spId] = true;
        errors[spId] = '神圣能量不足';
        continue;
      }
    }
    return { insufficientResourceSpells: insufficient, spellResourceErrors: errors };
  }, [friendlyUnits]);

  // Rebuild squads when roster identity / tier changes (20-man random; 5-man single)
  useEffect(() => {
    const roster = raidRosterKey(friendlyUnits);
    const key = roster ? `${dungeonTier}|${roster}` : '';
    if (!key) {
      setRaidSquadIds([]);
      raidRosterKeyRef.current = '';
      return;
    }
    if (key === raidRosterKeyRef.current) return;
    raidRosterKeyRef.current = key;
    const squads = assignRaidSquads(friendlyUnits, dungeonTier === '20man');
    setRaidSquadIds(squads.map((s) => s.map((u) => u.id)));
    setSelectedSquadIndex(0);
  }, [friendlyUnits, dungeonTier]);

  const raidSquads = useMemo(
    () => resolveRaidSquads(raidSquadIds, friendlyUnits),
    [raidSquadIds, friendlyUnits]
  );

  // Global Alt+1 ~ Alt+5 → currently selected squad's 1st~5th member
  // Tab → nearest living hostile that is not the current target
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.altKey && e.key >= '1' && e.key <= '5') {
        const digit = parseInt(e.key, 10);
        const target = getAltSquadTarget(raidSquads, selectedSquadIndex, digit);
        if (target) {
          setSelectedTargetId(target.id);
          e.preventDefault();
        }
        return;
      }
      if (e.code === 'Tab' || e.key === 'Tab') {
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        const engine = engineRef.current;
        const player =
          engine.friendlyUnits.find((u) => u.isPlayer) ||
          engine.friendlyUnits[0];
        if (!player?.position) return;
        const next = pickNearestHostileExcluding({
          enemies: engine.enemyUnits,
          from: player.position,
          excludeId: selectedTargetId,
        });
        if (!next) return;
        setSelectedTargetId(next.id);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [raidSquads, selectedSquadIndex, selectedTargetId]);

  // Cast Player Spell (P6e: gates in combat/handlePlayerCastSlot)
  const handleCastSlot = (slotIdx: number) => {
    handlePlayerCastSlot(slotIdx, {
      getPlayerSlots,
      engine: engineRef.current,
      currentChar,
      isNetworkGuest: isNetworkGuestRef.current,
      netConnected: netClient.connected,
      activeRoomId: activeRoomIdRef.current,
      guestCdTimelinesRef,
      sendNetworkCast: (payload) => {
        const roomId = activeRoomIdRef.current;
        if (!roomId) return;
        netClient.sendPlayerInput(roomId, payload);
      },
      bossTargetId,
      playerCast,
      playerGcdRemainingMs,
      playerCooldowns,
      groundTargetState,
      setGroundTargetState,
      lastPlayerMoveMs: lastPlayerMoveMsRef.current,
      selectedTargetId,
      setSelectedTargetId,
      setCastTargetId: (id) => { castTargetIdRef.current = id; },
      runPhase,
      setAutoApproachTarget,
      isApproaching,
      setIsApproaching,
      setPlayerGcdRemainingMs,
      setPlayerGcdTotalMs,
      triggerCooldown,
      playerCastRef,
      setPlayerCast,
      getPredictedHealAmount,
      setIncomingCasts,
      setIncomingHeals,
      onFriendlyUnitsChanged: () => setFriendlyUnits([...engineRef.current.friendlyUnits]),
      bossAi: bossAiRef.current,
      handleDispelUnit,
      onScreenShake: (ms) => {
        setScreenShake(true);
        setTimeout(() => setScreenShake(false), ms);
      },
    });
  };


  useCombatTick({
    runPhase,
    isApproaching,
    currentChar,
    wipeNetworkVote,
    activeRoomId,
    waitingQueueRoomId,
    focusTargetId,
    refs: {
      rsmRef,
      engineRef,
      isNetworkGuestRef,
      isNetworkHostRef,
      guestCastTimelinesRef,
      guestGcdTimelinesRef,
      guestCdTimelinesRef,
      playerCastRef,
      pendingGuestInputsRef,
      activeRoomIdRef,
      lastWipePhaseBroadcastRef,
      lastCombatBroadcastMsRef,
      prevRunPhaseRef,
      approachedBossIdRef,
      roomFacadeRef,
      bossAiRef,
      lastBossAttackTickRef,
      castTargetIdRef,
      pendingCastSlotRef,
      lastPlayerMoveMsRef,
      aiHealerCastsRef,
      aiCooldownsRef,
      lastPlayerAttackTickRef,
      lastPetAttackTickRef,
    },
    setters: {
      setPlayerCast,
      setPlayerGcdRemainingMs,
      setPlayerGcdTotalMs,
      setPlayerCooldowns,
      setCompanionCasts,
      setWipeVoteTimerMs,
      setIsApproaching,
      setGroundEffects,
      setFloatingTexts,
      setBossUnit,
      setFriendlyUnits,
      setBossTargetId,
      setFocusTargetId,
      setSelectedTargetId,
      setRevivingUnitId,
      setReviveProgress,
      setIncomingHeals,
      setIncomingCasts,
      setWaitingQueueRoomId,
      setActiveRoomId,
      setRunPhase,
      setTravelRemainingMs,
      setTotalDurationSec,
      setTargetBossName,
      setIsCorpseRunning,
      setCorpseRunTimerMs,
    },
    callbacks: {
      clearPlayerIncomingCast,
      handleCastSlot,
      resolvePlayerCast,
      triggerCooldown,
      getPredictedHealAmount,
      getUnitAIPersonality,
      inferAiSpecForUnit,
      isAiCdReady,
      markAiCdUsed,
      notifyOom,
    },
  });

  const handleConfirmGroundTarget = (slotIdx: number, spellId: string, x: number, y: number) => {
    const engine = engineRef.current;
    const player = engine?.friendlyUnits.find(u => u.isPlayer);
    if (!engine || !player) return;
    const slots = getPlayerSlots(selectedCharId, currentChar?.lastSpec);
    const slot = slots.find(s => s.slotIdx === slotIdx) || slots[slotIdx];
    confirmGroundTarget({
      engine,
      player,
      boss: engine.bossUnit,
      slot,
      spellId,
      x,
      y,
      triggerCooldown,
      triggerGcd,
      clearGroundTarget: () => setGroundTargetState(null),
      isNetworkGuest: isNetworkGuestRef.current,
      netConnected: netClient.connected,
      activeRoomId: activeRoomIdRef.current,
      playerId: currentChar?.id ?? null,
      playerCooldowns,
      guestCdTimelines: guestCdTimelinesRef.current,
      sendGroundCast: (payload) => {
        const roomId = activeRoomIdRef.current;
        if (!roomId) return;
        netClient.sendPlayerInput(roomId, payload);
      },
    });
  };

  // Global Escape & Right-click listener to cancel ground targeting or active cast
  // Ultraxion: V = 英勇意志（短暂离开暮光领域）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape') {
        if (groundTargetState) {
          setGroundTargetState(null);
        } else if (playerCastRef.current) {
          handleCancelPlayerCast();
        }
      }
      if ((e.key === 'v' || e.key === 'V') && runPhase === 'BOSS_COMBAT') {
        const engine = engineRef.current;
        const bossAi = bossAiRef.current;
        const player = engine?.friendlyUnits.find(u => u.isPlayer);
        if (engine && bossAi && player && engine.bossUnit?.id === 'ultraxion') {
          if (useHeroicWill(engine, bossAi as any, player)) {
            e.preventDefault();
            setFriendlyUnits([...engine.friendlyUnits]);
          }
        }
      }
    };
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 2 && groundTargetState) {
        setGroundTargetState(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handleMouseDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handleMouseDown);
    };
  }, [groundTargetState, runPhase]);

  // Claim Clear Certificate & Submit to World Leaderboards (Strictly requires full clear)
  const handleClaimCertificate = useCallback(() => {
    const rsm = rsmRef.current;
    if (!rsm || !currentChar) return;
    if (!rsm.checkIsCleared()) return;
    if (isCertClaimed) return;

    const cert = reportMgrRef.current.createClearCertificate(
      rsm.dungeon.id,
      rsm.dungeon.name,
      currentChar.name,
      currentChar.classId,
      currentChar.lastSpec,
      rsm.totalRunDurationSec,
      rsm.encounterReports,
      currentChar.id
    );

    // 1. Add to character records
    accountMgrRef.current.addClearCertificate(currentChar.id, cert);
    // 2. Submit to world rankings
    leaderboardMgrRef.current.submitRunCertificate(cert);

    setIsCertClaimed(true);
    setAccount({ ...accountMgrRef.current.getCurrentAccount()! });
  }, [currentChar, isCertClaimed]);

  // Auto-claim reward certificate when entering SUMMARY phase after full dungeon clear
  useEffect(() => {
    if (runPhase === 'SUMMARY') {
      const rsm = rsmRef.current;
      if (rsm && rsm.checkIsCleared() && !isCertClaimed) {
        handleClaimCertificate();
      }
    }
  }, [runPhase, isCertClaimed, handleClaimCertificate]);

  // 离开行军阶段时清掉跳过投票面板，避免下一轮 TRAVEL 残留上一轮投票 UI
  useEffect(() => {
    if (runPhase !== 'TRAVEL_RECOVERY') {
      setSkipTravelVote(null);
      setMySkipVote(null);
    }
  }, [runPhase]);

  // 投票已超时但未收到 VOTE_RESULT 时本地收起面板，防止卡死残留
  useEffect(() => {
    if (!skipTravelVote || skipTravelVote.resolved || runPhase !== 'TRAVEL_RECOVERY') return;
    const left =
      skipTravelVote.timeoutMs - (Date.now() - skipTravelVote.startedAtMs);
    if (left <= 0) {
      setSkipTravelVote(null);
      setMySkipVote(null);
      return;
    }
    const t = setTimeout(() => {
      setSkipTravelVote(null);
      setMySkipVote(null);
    }, left + 50);
    return () => clearTimeout(t);
  }, [skipTravelVote, runPhase]);

  const handleReturnToLobby = () => {
    const rsm = rsmRef.current;
    const engine = engineRef.current;
    if (rsm) {
      rsm.phase = 'LOBBY';
    }
    if (engine) {
      engine.reset();
    }
    setSkipTravelVote(null);
    setMySkipVote(null);
    setWipeNetworkVote(null);
    setMyWipeVote(null);
    // Host return / leave destroys room; guests just leave
    if (activeRoomId && currentChar) {
      if (isNetworkHostRef.current || (!netClient.connected && roomManager.getRoom(activeRoomId)?.hostId === currentChar.id)) {
        roomFacadeRef.current.closeRoom(activeRoomId, 'host_left');
      } else {
        roomFacadeRef.current.leaveRoom(activeRoomId, currentChar.id);
      }
    } else if (activeRoomId) {
      roomFacadeRef.current.closeRoom(activeRoomId, 'destroyed');
    }
    roomManager.cleanupAiOnlyRooms();
    isNetworkGuestRef.current = false;
    isNetworkHostRef.current = false;
    setActiveRoomId(null);
    setLobbySubView('ROOM_LIST');
    setRoomsTick(t => t + 1);

    setRunPhase('LOBBY');
    setPlayerCooldowns({});
    playerCastRef.current = null;
    clearPlayerIncomingCast();
    setPlayerCast(null);
    setCompanionCasts({});
    setIncomingHeals({});
    setIncomingCasts({});
    setBossTargetId(null);
    setFocusTargetId(null);
    setBossUnit(undefined);
    setGroundEffects([]);
    setFloatingTexts([]);
    setRevivingUnitId(null);
    setReviveProgress(0);
    approachedBossIdRef.current = null;
    setIsApproaching(false);
    if (currentChar) {
      setupRaidUnits(currentChar, dungeonTier, dungeonDifficulty, customDifficulty);
    }
    // Closing a room must not drop the account WebSocket — re-assert link
    netClient.ensureConnected();
    if (netClient.connected) {
      setNetConnected(true);
    }
  };

  const applyWipeVoteResult = (choice: 'RETRY' | 'FINISH') => {
    const rsm = rsmRef.current;
    const engine = engineRef.current;
    if (!rsm || !engine) return;

    rsm.handleWipeVoteChoice(choice);
    setWipeNetworkVote(null);
    setMyWipeVote(null);

    if (choice === 'FINISH') {
      // Wipe finish: destroy room for everyone (host leave / close)
      if (activeRoomId) {
        if (isNetworkHostRef.current || !netClient.connected) {
          roomFacadeRef.current.closeRoom(activeRoomId, 'wipe_finish');
        } else {
          roomFacadeRef.current.leaveRoom(activeRoomId, currentChar?.id || '');
        }
      }
      roomManager.cleanupAiOnlyRooms();
      isNetworkGuestRef.current = false;
      isNetworkHostRef.current = false;
      setActiveRoomId(null);
      setLobbySubView('ROOM_LIST');
      setRoomsTick(t => t + 1);
    } else if (choice === 'RETRY') {
      // 1. 全体友方单位完全重置至 100% 满状态 (isAlive, alive, full HP/MP/energy, runes, 清空护盾与debuff)
      for (const u of engine.friendlyUnits) {
        u.isAlive = true;
        u.alive = true;
        u.hp = u.maxHp;
        u.mp = u.maxMp;
        u.energy = 100;
        u.absorb = 0;
        u.buffs = [];
        u.threatTable = [];
        if (u.runes) {
          for (const r of u.runes) {
            r.cooldownMs = 0;
          }
        }
      }
      // 2. 技能 CD 全面重置（动作条倒计时扇面与引擎 CD 清零）
      engine.resetCooldowns();
      setPlayerCooldowns({});
      playerCastRef.current = null;
      clearPlayerIncomingCast();
      setPlayerCast(null);
      setCompanionCasts({});
      setIncomingHeals({});
      setIncomingCasts({});

      // 3. 清理仇恨、地面伤害法阵与目标标记
      engine.threatManager.resetAll();
      engine.effectsManager.clearAll();
      setGroundEffects([]);
      setFloatingTexts([]);
      setBossTargetId(null);
      setFocusTargetId(null);
      setRevivingUnitId(null);
      setReviveProgress(0);
      approachedBossIdRef.current = null;
      setIsApproaching(false);

      // 4. 重置首领单位为满血
      const bossConfig = rsm.getCurrentBoss();
      if (bossConfig) {
        engine.spawnBoss(bossConfig.id, bossConfig.name, bossConfig.hp);
        setBossUnit(engine.bossUnit ? { ...engine.bossUnit } : undefined);
      }

      setFriendlyUnits([...engine.friendlyUnits]);
    }

    setRunPhase(rsm.phase);
  };
  applyWipeVoteResultRef.current = applyWipeVoteResult;

  const handleWipeVote = (choice: 'RETRY' | 'FINISH') => {
    if (netClient.connected && activeRoomIdRef.current) {
      setMyWipeVote(choice);
      netClient.castVote(activeRoomIdRef.current, 'WIPE', choice);
      return;
    }
    applyWipeVoteResult(choice);
  };

  const handleSkipTravelRequest = () => {
    if (netClient.connected && activeRoomIdRef.current && currentChar) {
      const roomId = activeRoomIdRef.current;
      const room =
        roomFacadeRef.current.getRoom(roomId) || roomManager.getRoom(roomId);
      const eligible = room
        ? room.members.filter((m) => m.isPlayer && !m.isAi).map((m) => m.id)
        : [currentChar.id];
      if (!eligible.includes(currentChar.id)) eligible.push(currentChar.id);
      // 乐观更新：房主点跳过立刻显示 1 票，等服务端 VOTE_STATE 校准
      setSkipTravelVote({
        kind: 'SKIP_TRAVEL',
        roomId,
        startedAtMs: Date.now(),
        timeoutMs: 10_000,
        votes: { [currentChar.id]: 'YES' },
        eligiblePlayerIds: eligible,
        resolved: false,
        result: null,
      });
      setMySkipVote('YES');
      // 点「跳过」即视为同意：服务端记发起票，客户端再补投 YES 防止票数漏记
      netClient.requestSkipTravel(roomId, currentChar.id);
      netClient.castVote(roomId, 'SKIP_TRAVEL', 'YES');
      return;
    }
    rsmRef.current?.fastForwardTravel();
    if (rsmRef.current) {
      setRunPhase(rsmRef.current.phase);
      // Same frame as phase flip — avoid one BOSS_COMBAT tick without PULL_APPROACH (scale/snap jump)
      if (rsmRef.current.phase === 'BOSS_COMBAT') setIsApproaching(true);
    }
  };

  const handleSkipTravelVote = (choice: 'YES' | 'NO') => {
    if (!activeRoomIdRef.current || !currentChar) return;
    const myId = currentChar.id;
    setMySkipVote(choice);
    // 乐观更新同意/反对计数，避免等 VOTE_STATE 期间界面卡在旧票数
    setSkipTravelVote((prev) => {
      if (!prev || prev.resolved || prev.kind !== 'SKIP_TRAVEL') return prev;
      const eligible = prev.eligiblePlayerIds.includes(myId)
        ? prev.eligiblePlayerIds
        : [...prev.eligiblePlayerIds, myId];
      return {
        ...prev,
        eligiblePlayerIds: eligible,
        votes: { ...prev.votes, [myId]: choice },
      };
    });
    netClient.castVote(activeRoomIdRef.current, 'SKIP_TRAVEL', choice);
  };

  const handleStartAdventure = (overrides?: {
    tier?: '5man' | '20man';
    difficulty?: DungeonDifficulty;
    customDiff?: CustomDifficultySettings;
    activeRoom?: LobbyRoom;
  }) => {
    if (!currentChar) return;
    // keep ref fresh for WS ROOM_START handler
    const engine = engineRef.current;
    const rsm = rsmRef.current;

    const effectiveTier = overrides?.tier ?? dungeonTier;
    const effectiveDiff = overrides?.difficulty ?? dungeonDifficulty;
    const effectiveCustomDiff = overrides?.customDiff ?? customDifficulty;
    const effectiveRoom = overrides?.activeRoom ?? (activeRoomId ? (roomFacadeRef.current.getRoom(activeRoomId) || roomManager.getRoom(activeRoomId)) : undefined);

    // Sync player's spec if they changed it in the room before starting
    let effectiveSpec = currentChar.lastSpec;
    if (effectiveRoom) {
      const playerRoomMember = effectiveRoom.members.find(m => m.id === currentChar.id);
      if (playerRoomMember && playerRoomMember.spec !== currentChar.lastSpec) {
        effectiveSpec = playerRoomMember.spec;
        accountMgrRef.current.setCharacterSpec(currentChar.id, effectiveSpec);
        const updatedAcc = accountMgrRef.current.getCurrentAccount();
        if (updatedAcc) setAccount({ ...updatedAcc });
      }
    }

    // 1. 重置技能 CD 与读条施法状态，固化加载当前专精自定义动作条布局
    setCustomSlotLayout(loadSpecCustomSlots(currentChar.id, effectiveSpec, currentChar.classId));
    setPlayerCooldowns({});
    playerCastRef.current = null;
    clearPlayerIncomingCast();
    setPlayerCast(null);
    setCompanionCasts({});
    setIncomingHeals({});
    setIncomingCasts({});
    setBossTargetId(null);
    setFocusTargetId(null);
    setRevivingUnitId(null);
    setReviveProgress(0);
    setGroundEffects([]);
    setFloatingTexts([]);
    approachedBossIdRef.current = null;
    setIsApproaching(false);

    // 2. 使用房间内准备好的成员、副本规模与难度初始化队伍（首进即生效，不再被覆盖）
    setupRaidUnits(currentChar, effectiveTier, effectiveDiff, effectiveCustomDiff, effectiveRoom);

    // 3. 引擎系统重置 (CD、仇恨、地面法阵、DK符文)
    if (engine) {
      engine.difficulty = effectiveDiff;
      engine.customDifficulty = effectiveCustomDiff;
      engine.resetCooldowns();
      engine.threatManager.resetAll();
      engine.effectsManager.clearAll();
      for (const u of engine.friendlyUnits) {
        u.isAlive = true;
        u.alive = true;
        u.hp = u.maxHp;
        u.mp = u.maxMp;
        u.energy = u.classId === 'ROGUE' ? 100 : (u.energy ?? 0);
        u.absorb = 0;
        u.buffs = [];
        u.threatTable = [];
        if (u.runes) {
          for (const r of u.runes) r.cooldownMs = 0;
        }
      }
    }

    // 4. 副本状态机启动 — 立刻同步行军时钟，避免画布首帧用上一局残留 rem 把小怪判成墓碑
    if (rsm) {
      const dungeonIdFromRoom = effectiveRoom?.dungeonId;
      const resolvedDungeonId =
        dungeonIdFromRoom ||
        (effectiveTier === '20man' ? 'dragon_soul' : selectedDungeonId || 'shadowfang_keep');
      rsm.dungeon = getDungeonConfig(resolvedDungeonId, effectiveDiff);
      setSelectedDungeonId(resolvedDungeonId);
      setDungeonTier(rsm.dungeon.tier);
      try {
        localStorage.setItem('cata_dungeon_id', resolvedDungeonId);
        localStorage.setItem('cata_dungeon_tier', rsm.dungeon.tier);
      } catch {}
      rsm.startRun();
      setTravelRemainingMs(rsm.travelRemainingMs);
      setRunPhase(rsm.phase);
      setIsCertClaimed(false);
      setFocusTargetId(null);
    }

    // 5. 本房间副本视觉/迷宫镜像独立重置（不影响其他房间实例）
    setMazeSyncRoomId(effectiveRoom?.id ?? activeRoomIdRef.current);
    clearMazeSync(effectiveRoom?.id ?? activeRoomIdRef.current);
    if (engine) {
      engine.actionLog.clear();
      setFriendlyUnits([...engine.friendlyUnits]);
    }
  };
  startAdventureRef.current = handleStartAdventure;

  const handleExportJson = () => {
    const rsm = rsmRef.current;
    if (!rsm) return;
    const json = reportMgrRef.current.exportJson({
      dungeonId: rsm.dungeon.id,
      dungeonName: rsm.dungeon.name,
      exportedAtIso: new Date().toISOString(),
      totalDurationSec: rsm.totalRunDurationSec,
      encounters: rsm.encounterReports,
    });
    const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ShadowfangKeep_Report_${Date.now()}.json`;
    link.click();
  };

  const targetUnit = friendlyUnits.find(u => u.id === bossTargetId);
  const isBossTargetOT = targetUnit ? targetUnit.role !== 'TANK' : false;
  const deadUnits = friendlyUnits.filter(u => (!u.isAlive && !u.alive) || u.hp <= 0);

  if (bootLoading) {
    return <GameLoadingScreen percent={bootPercent} label={bootLabel} />;
  }

  return (
    <div className="w-full h-screen max-h-screen bg-[#0c0c16] text-gray-100 flex flex-col font-sans select-none overflow-hidden">
      
      {/* Top Header Navigation Bar */}
      <header className="h-14 shrink-0 border-b border-[#252542] bg-[#121224]/90 px-6 flex items-center justify-between backdrop-blur z-40">
        <div className="flex items-center space-x-3">
          <span className="text-2xl">🐉</span>
          <h1 className="font-extrabold text-amber-300 text-xl sm:text-2xl tracking-wide leading-none">
            魔兽大灾变模拟器
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <div
            className={`h-8 inline-flex items-center px-3 text-xs rounded-lg border font-bold ${
              netConnected
                ? 'border-emerald-600/60 text-emerald-300 bg-emerald-950/40'
                : 'border-amber-700/60 text-amber-200 bg-amber-950/40'
            }`}
            title={
              netConnected
                ? '已连接游戏服务器（账号/房间/战斗均由服务端管理，含 localhost）'
                : '未连接游戏服务器。请用启动脚本打开服务端（:3001）；不存在单机本地模式'
            }
          >
            {netConnected ? '服务器已连接' : '未连接服务器'}
          </div>
          {currentChar && (() => {
            const role = getRoleBySpec(currentChar.classId, currentChar.lastSpec);
            const roleIcon = role === 'TANK' ? '🛡️' : role === 'HEALER' ? '💚' : '⚔️';
            const roleLabel = role === 'TANK' ? '坦克' : role === 'HEALER' ? '治疗' : '输出';
            return (
              <div
                onClick={() => {
                  if (runPhase !== 'LOBBY') {
                    handleReturnToLobby();
                  } else if (activeRoomId) {
                    handleLeaveActiveRoom();
                  }
                  setLobbySubView('AUTH_CHAR');
                }}
                className="h-8 inline-flex items-center space-x-1.5 bg-[#1b1b34] border border-[#3b3b5c] px-3 rounded-lg text-xs font-bold cursor-pointer hover:border-amber-400 transition"
                title={`点击返回主页与角色切换（${roleLabel}）`}
              >
                <span className="text-gray-400">当前角色:</span>
                <span style={{ color: CLASS_COLORS[currentChar.classId] || '#fbbf24' }}>
                  {currentChar.name}
                </span>
                <span className="text-[11px] leading-none" aria-label={roleLabel}>
                  {roleIcon}
                </span>
              </div>
            );
          })()}

          {runPhase !== 'LOBBY' && runPhase !== 'SUMMARY' && (() => {
            const cfg = rsmRef.current?.dungeon || getDungeonConfig(selectedDungeonId, dungeonDifficulty);
            const dungeonLabel = `${cfg.name.replace(/（.*）/, '')} (${cfg.tier === '20man' ? '20人' : '5人'})`;
            const diffLabel =
              dungeonDifficulty === 'HEROIC'
                ? '英雄模式'
                : dungeonDifficulty === 'CUSTOM'
                  ? '自定义模式'
                  : '普通模式';
            return (
              <div
                className="h-8 inline-flex items-center space-x-1.5 px-3 text-xs rounded-lg font-bold shadow border bg-black/60 border-amber-500/50 text-amber-200 pointer-events-none select-none opacity-90"
                title="副本进行中，模式与难度已锁定，不可切换"
                aria-disabled="true"
              >
                <span aria-hidden>🔒</span>
                <span>{dungeonLabel}</span>
                <span className="text-amber-500/70">·</span>
                <span>{diffLabel}</span>
              </div>
            );
          })()}

          {!account ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setLobbySubView('AUTH_CHAR');
                  setAuthOpenRequest({ mode: 'login', id: Date.now() });
                }}
                className="h-8 inline-flex items-center px-3 text-xs bg-[#1e2a44] hover:bg-[#263556] rounded-lg transition border border-sky-700/50 text-sky-200 font-semibold"
                title="登录账号"
              >
                登录
              </button>
              <button
                type="button"
                onClick={() => {
                  setLobbySubView('AUTH_CHAR');
                  setAuthOpenRequest({ mode: 'register', id: Date.now() });
                }}
                className="h-8 inline-flex items-center px-3 text-xs bg-emerald-800/80 hover:bg-emerald-700 rounded-lg transition border border-emerald-500/40 text-emerald-100 font-semibold"
                title="注册新账号"
              >
                注册
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  accountMgrRef.current.logout();
                  netClient.disconnect();
                  setAccount(null);
                  setSelectedCharId(null);
                  setNetConnected(false);
                  setActiveRoomId(null);
                  setLobbySubView('AUTH_CHAR');
                  setRunPhase('LOBBY');
                }}
                className="h-8 inline-flex items-center px-3 text-xs bg-slate-700 hover:bg-slate-600 rounded-lg transition border border-slate-500 text-slate-200 font-semibold"
                title="注销当前登录会话"
              >
                注销
              </button>
              <button
                type="button"
                onClick={() => {
                  setHeaderDeletePassword('');
                  setHeaderDeleteError(null);
                  setShowHeaderDeleteConfirm(true);
                }}
                className="h-8 inline-flex items-center px-3 text-xs bg-red-950/70 hover:bg-red-900 rounded-lg transition border border-red-700/50 text-red-200 font-semibold"
                title="从服务器永久删除此账号"
              >
                删除账号
              </button>
            </>
          )}

          <button
            onClick={() => setIsLeaderboardOpen(true)}
            className="h-8 inline-flex items-center space-x-1 px-3 text-xs bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold shadow"
          >
            <span>🏆</span>
            <span>世界排行</span>
          </button>

          {runPhase !== 'LOBBY' && (
            <button
              onClick={handleReturnToLobby}
              className="h-8 inline-flex items-center px-3 text-xs bg-slate-700 hover:bg-slate-600 rounded-lg text-gray-300 border border-slate-500 font-bold"
            >
              返回大厅
            </button>
          )}
        </div>
      </header>

      {/* Main Game Screen Router */}
      <main
        className={`flex-1 min-h-0 flex flex-col relative w-full ${
          runPhase === 'LOBBY'
            ? 'p-0 overflow-hidden'
            : runPhase === 'SUMMARY'
            ? 'p-4 items-center justify-center overflow-auto'
            : 'p-0 overflow-hidden'
        }`}
      >
        {runPhase === 'LOBBY' ? (
          <LobbyScreen
            subView={lobbySubView}
            currentChar={currentChar}
            rooms={roomFacadeRef.current.listRooms()}
            activeRoom={
              activeRoomId
                ? (roomFacadeRef.current.getRoom(activeRoomId) || roomManager.getRoom(activeRoomId) || null)
                : null
            }
            customDifficulty={customDifficulty}
            roomFacade={roomFacadeRef.current}
            onChangeCustomDifficulty={handleCustomDifficultyChange}
            onCreateRoom={handleCreateRoom}
            onJoinRoom={handleJoinRoom}
            onJoinWaitingQueue={handleJoinWaitingQueue}
            onQuickJoin={handleQuickJoin}
            onLeaveRoom={handleLeaveActiveRoom}
            onStartGame={handleStartGameFromRoom}
            onRefreshRoom={() => setRoomsTick(t => t + 1)}
            onBackToCharacterSelect={() => setLobbySubView('AUTH_CHAR')}
            authPanel={(
              <AuthAndCharacterModal
            currentAccountName={account?.username || '未登录'}
            authOpenRequest={authOpenRequest}
            sessionKickNotice={sessionKickNotice}
            onDismissSessionKickNotice={() => setSessionKickNotice(null)}
            characters={account?.characters || []}
            selectedCharId={selectedCharId}
            onSelectCharacter={(id) => {
              setSelectedCharId(id);
              accountMgrRef.current.selectCharacter(id);
              const targetChar = account?.characters.find(c => c.id === id);
              if (targetChar) {
                const tier = targetChar.lastDungeonTier || '5man';
                const diff = targetChar.lastDungeonDifficulty || 'NORMAL';
                const customDiff = targetChar.lastCustomDifficulty || DEFAULT_CUSTOM_DIFFICULTY;
                setDungeonTier(tier);
                setDungeonDifficulty(diff);
                setCustomDifficulty(customDiff);
                reloadCustomSlotLayout(targetChar.id, targetChar.lastSpec, targetChar.classId);
                setupRaidUnits(targetChar, tier, diff, customDiff);
              } else {
                customSlotOwnerRef.current = null;
                setCustomSlotLayout(null);
              }
            }}
            onCreateCharacter={async (name, cls, spec) => {
              const result = await accountMgrRef.current.tryCreateCharacterWithServer(
                name,
                cls,
                spec,
                resolveGameApiBaseUrl()
              );
              if (result.ok === false) {
                return { success: false, error: result.error };
              }
              const newChar = result.character;
              const updatedAcc = accountMgrRef.current.getCurrentAccount();
              setAccount(updatedAcc ? { ...updatedAcc } : null);
              setSelectedCharId(newChar.id);
              const tier = newChar.lastDungeonTier || '5man';
              const diff = newChar.lastDungeonDifficulty || 'NORMAL';
              const customDiff = newChar.lastCustomDifficulty || DEFAULT_CUSTOM_DIFFICULTY;
              setDungeonTier(tier);
              setDungeonDifficulty(diff);
              setCustomDifficulty(customDiff);
              reloadCustomSlotLayout(newChar.id, newChar.lastSpec, newChar.classId);
              setupRaidUnits(newChar, tier, diff, customDiff);
              return { success: true };
            }}
            onDeleteCharacter={(id) => {
              accountMgrRef.current.deleteCharacter(id);
              const updatedAcc = accountMgrRef.current.getCurrentAccount();
              setAccount(updatedAcc ? { ...updatedAcc } : null);
              const nextChar = accountMgrRef.current.getCurrentCharacter();
              setSelectedCharId(nextChar?.id || null);
              if (nextChar) {
                const tier = nextChar.lastDungeonTier || '5man';
                const diff = nextChar.lastDungeonDifficulty || 'NORMAL';
                const customDiff = nextChar.lastCustomDifficulty || DEFAULT_CUSTOM_DIFFICULTY;
                setDungeonTier(tier);
                setDungeonDifficulty(diff);
                setCustomDifficulty(customDiff);
                reloadCustomSlotLayout(nextChar.id, nextChar.lastSpec, nextChar.classId);
                setupRaidUnits(nextChar, tier, diff, customDiff);
              } else {
                customSlotOwnerRef.current = null;
                setCustomSlotLayout(null);
              }
            }}
            onChangeSpec={(id, spec) => {
              accountMgrRef.current.setCharacterSpec(id, spec);
              const updatedAcc = accountMgrRef.current.getCurrentAccount();
              if (updatedAcc) {
                setAccount({ ...updatedAcc });
                const updatedChar = updatedAcc.characters.find(c => c.id === id);
                if (updatedChar) {
                  reloadCustomSlotLayout(updatedChar.id, updatedChar.lastSpec, updatedChar.classId);
                  setupRaidUnits(updatedChar);
                  // 立刻刷新服务器 session，避免进房仍用旧专精
                  netClient.refreshAuthProfile({
                    playerId: updatedChar.id,
                    playerName: updatedChar.name,
                    classId: updatedChar.classId,
                    spec: updatedChar.lastSpec,
                    role: getRoleBySpec(updatedChar.classId, updatedChar.lastSpec),
                  });
                }
              }
            }}
            onSaveKeybinding={(id, spec, slotIdx, key) => {
              accountMgrRef.current.saveSpecKeybinding(id, spec, slotIdx, key);
              setAccount({ ...accountMgrRef.current.getCurrentAccount()! });
            }}
            onViewCertificate={(cert) => setViewingCert(cert)}
            onOpenLeaderboard={() => setIsLeaderboardOpen(true)}
            onStartAdventure={() => {
              if (currentChar) {
                setupRaidUnits(currentChar, dungeonTier, dungeonDifficulty, customDifficulty);
              }
              setLobbySubView('ROOM_LIST');
            }}
            onAuth={async (user, password, mode) => {
              try {
                const mgr = accountMgrRef.current;
                const result = await mgr.authWithServer(
                  user,
                  password,
                  mode,
                  resolveGameApiBaseUrl()
                );
                if (result.ok === false) {
                  return { success: false, error: result.error };
                }
                setAccount({ ...result.account });
                const nextChar = mgr.getCurrentCharacter();
                setSelectedCharId(nextChar?.id || null);
                // Always open WS after server auth. Same character reconnect replaces that socket only.
                if (nextChar) {
                  netClient.connect({
                    username: result.account.username,
                    playerId: nextChar.id,
                    playerName: nextChar.name,
                    classId: nextChar.classId,
                    spec: nextChar.lastSpec,
                    role: getRoleBySpec(nextChar.classId, nextChar.lastSpec),
                  });
                } else {
                  netClient.connect({
                    username: result.account.username,
                    playerId: `acc_session_${result.account.id}`,
                    playerName: result.account.username,
                    classId: 'MAGE',
                    spec: 'FIRE',
                    role: 'DPS',
                  });
                }
                return { success: true };
              } catch (err: any) {
                return {
                  success: false,
                  error: err?.message || '登录过程出错，请重试',
                };
              }
            }}
            onLogout={() => {
              accountMgrRef.current.logout();
              netClient.disconnect();
              setAccount(null);
              setSelectedCharId(null);
              setNetConnected(false);
              setActiveRoomId(null);
              setLobbySubView('AUTH_CHAR');
            }}
            onDeleteAccount={async (password) => {
              try {
                const mgr = accountMgrRef.current;
                const result = await mgr.deleteAccountOnServer(password, resolveGameApiBaseUrl());
                if (result.ok === false) return { success: false, error: result.error };
                netClient.disconnect();
                setAccount(null);
                setSelectedCharId(null);
                setNetConnected(false);
                setActiveRoomId(null);
                setLobbySubView('AUTH_CHAR');
                return { success: true };
              } catch (err: any) {
                return { success: false, error: err?.message || '删除账号失败' };
              }
            }}
            slots={getPlayerSlots(selectedCharId, currentChar?.lastSpec)}
            onSwapSlots={(src, dest, targetCharId, targetSpecId) =>
              handleSwapSlots(src, dest, targetCharId || selectedCharId, targetSpecId || currentChar?.lastSpec)
            }
            onAssignSlot={(slotIdx, spellId, targetCharId, targetSpecId) =>
              handleAssignSlot(slotIdx, spellId, targetCharId || selectedCharId, targetSpecId || currentChar?.lastSpec)
            }
            onClearSlot={(slotIdx, targetCharId, targetSpecId) =>
              handleClearSlot(slotIdx, targetCharId || selectedCharId, targetSpecId || currentChar?.lastSpec)
            }
            onSaveUiLayout={(charId, patch) => {
              accountMgrRef.current.saveCharacterUiLayout(charId, patch);
              const updatedAcc = accountMgrRef.current.getCurrentAccount();
              if (updatedAcc) setAccount({ ...updatedAcc });
            }}
          />
            )}
          />
        ) : runPhase === 'SUMMARY' ? (
          <SummaryPage
            dungeonName={
              dungeonTier === '20man'
                ? `巨龙之魂（${dungeonDifficulty === 'HEROIC' ? '英雄模式' : dungeonDifficulty === 'CUSTOM' ? '自定义模式' : '普通模式'} 20人）`
                : `影牙城堡（${dungeonDifficulty === 'HEROIC' ? '英雄模式' : dungeonDifficulty === 'CUSTOM' ? '自定义模式' : '普通模式'}）`
            }
            totalDurationSec={totalDurationSec}
            encounters={rsmRef.current?.encounterReports || []}
            characterName={currentChar ? currentChar.name : '勇士'}
            characterClass={currentChar ? currentChar.classId : 'DK'}
            characterSpec={currentChar ? currentChar.lastSpec : 'BLOOD'}
            onExportJson={handleExportJson}
            onClaimCertificate={handleClaimCertificate}
            onReturnToLobby={handleReturnToLobby}
            isCertificateClaimed={isCertClaimed}
            isCleared={rsmRef.current ? rsmRef.current.checkIsCleared() : false}
          />
        ) : (
          <CombatHudScreen
            friendlyUnits={friendlyUnits}
            bossUnit={bossUnit}
            enemyUnits={engineRef.current.enemyUnits}
            bossTargetId={bossTargetId}
            groundEffects={groundEffects}
            floatingTexts={floatingTexts}
            runPhase={runPhase}
            isApproaching={isApproaching}
            screenShake={screenShake}
            selectedTargetId={selectedTargetId}
            focusTargetId={focusTargetId}
            dungeonTier={dungeonTier}
            dungeonId={rsmRef.current?.dungeon?.id}
            targetBossName={targetBossName}
            currentBossIndex={rsmRef.current?.currentBossIndex || 0}
            travelRemainingMs={travelRemainingMs}
            totalTravelMs={rsmRef.current?.totalTravelMs || (dungeonTier === '20man' ? 14000 : 7000)}
            isCorpseRunning={isCorpseRunning}
            corpseRunTimerMs={corpseRunTimerMs}
            revivingUnitId={revivingUnitId}
            reviveProgress={reviveProgress}
            autoApproachTarget={autoApproachTarget}
            groundTargetState={groundTargetState}
            playerCast={playerCast}
            companionCasts={companionCasts}
            bossCasting={
              isNetworkGuestRef.current
                ? guestBossCasting
                : bossAiRef.current?.currentCasting
                ? {
                    spellName: bossAiRef.current.currentCasting.skill.name,
                    spellId: bossAiRef.current.currentCasting.skill.id,
                    description: bossAiRef.current.currentCasting.skill.description,
                    school: bossAiRef.current.currentCasting.skill.school,
                    elapsedMs: bossAiRef.current.currentCasting.elapsedMs,
                    castTimeMs: bossAiRef.current.currentCasting.skill.castTimeMs || 1,
                    interruptible: !!bossAiRef.current.currentCasting.skill.interruptible,
                  }
                : null
            }
            syncRemotePositions={
              !!(netClient.connected && (isNetworkHostRef.current || isNetworkGuestRef.current))
            }
            isNetworkGuest={!!isNetworkGuestRef.current}
            onNetworkMoveReport={handleNetworkMovePosition}
            deadUnits={deadUnits}
            totalDurationSec={totalDurationSec}
            playerGcdRemainingMs={playerGcdRemainingMs}
            playerGcdTotalMs={playerGcdTotalMs}
            outOfRangeSpells={outOfRangeSpells}
            insufficientResourceSpells={insufficientResourceSpells}
            spellResourceErrors={spellResourceErrors}
            incomingHeals={incomingHeals}
            incomingCasts={incomingCasts}
            savedRaidMarks={savedRaidMarks}
            skipTravelVote={skipTravelVote}
            mySkipVote={mySkipVote}
            currentChar={currentChar}
            account={account}
            playerSlots={getPlayerSlots()}
            onSelectUnit={(id) => setSelectedTargetId(id)}
            onHoverUnit={setHoveredTargetId}
            onSetFocus={(id) => setFocusTargetId(id)}
            onClearTarget={() => setSelectedTargetId(null)}
            onClearFocus={() => setFocusTargetId(null)}
            raidSquads={raidSquads}
            selectedSquadIndex={selectedSquadIndex}
            onSelectSquad={setSelectedSquadIndex}
            onPlayerMove={handlePlayerMove}
            onCancelCast={handleCancelPlayerCast}
            onApproachComplete={() => setIsApproaching(false)}
            onFastForwardTravel={handleSkipTravelRequest}
            onApproachTargetReached={() => {
              if (autoApproachTarget) {
                const pending = autoApproachTarget.pendingSlotIdx;
                setAutoApproachTarget(null);
                handleCastSlot(pending);
              }
            }}
            onConfirmGroundTarget={handleConfirmGroundTarget}
            onCancelGroundTarget={() => setGroundTargetState(null)}
            onPlayerRevive={() => {
              if (deadUnits.length > 0) {
                const revSlot = getPlayerSlots().find(s => s.spellId === 'revive' || s.spellId === 'ancestral_spirit');
                if (revSlot) handleCastSlot(revSlot.slotIdx);
              }
            }}
            onSkipTravelVote={handleSkipTravelVote}
            onDispelUnit={handleDispelUnit}
            onSetRaidMark={handleSetRaidMark}
            onCastSlot={handleCastSlot}
            onSwapSlots={handleSwapSlots}
            onAssignSlot={handleAssignSlot}
            onClearSlot={handleClearSlot}
            onSaveUiLayout={(patch) => {
              if (currentChar) {
                accountMgrRef.current.saveCharacterUiLayout(currentChar.id, patch);
                const updatedAcc = accountMgrRef.current.getCurrentAccount();
                if (updatedAcc) setAccount({ ...updatedAcc });
              }
            }}
            onAccountRefresh={() => {
              const updatedAcc = accountMgrRef.current.getCurrentAccount();
              if (updatedAcc) setAccount({ ...updatedAcc });
            }}
            isPlayerHealer={
              currentChar?.lastSpec === 'RESTORATION' ||
              getPlayerSlots().some(s => s.spellId === 'revive' || s.spellId === 'ancestral_spirit')
            }
          />
        )}
      </main>

      {/* Wipe Vote Modal */}
      <WipeVoteModal
        isOpen={runPhase === 'WIPE_VOTE'}
        timerMs={
          wipeNetworkVote
            ? Math.max(0, wipeNetworkVote.timeoutMs - (Date.now() - wipeNetworkVote.startedAtMs))
            : wipeVoteTimerMs
        }
        bossName={targetBossName}
        wipeReport={rsmRef.current?.latestWipeReport}
        onVote={handleWipeVote}
        networkVote={wipeNetworkVote}
        myVote={myWipeVote}
      />

      {/* Clear Certificate Inspection Modal */}
      <ClearCertificateModal
        certificate={viewingCert}
        onClose={() => setViewingCert(null)}
      />

      {/* World Leaderboards Modal */}
      <LeaderboardModal
        isOpen={isLeaderboardOpen}
        onClose={() => setIsLeaderboardOpen(false)}
        entries={leaderboardMgrRef.current.getLeaderboard('FAST_KILL')}
      />

      {/* Header: delete account confirm */}
      {showHeaderDeleteConfirm && account && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-[#1a1218] border border-red-600/50 rounded-2xl p-5 max-w-sm w-full space-y-3 shadow-2xl">
            <h3 className="text-base font-extrabold text-red-300">删除账号</h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              将从<strong className="text-amber-300">服务器永久删除</strong>账号「{account.username}」及全部角色、键位与通关记录，且不可恢复。
            </p>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">输入密码确认</label>
              <input
                type="password"
                value={headerDeletePassword}
                onChange={(e) => {
                  setHeaderDeletePassword(e.target.value);
                  if (headerDeleteError) setHeaderDeleteError(null);
                }}
                className="w-full bg-[#10101e] border border-red-900/50 rounded p-2 text-sm text-white focus:border-red-400 outline-none"
                placeholder="账号密码"
                disabled={headerDeleteBusy}
              />
              {headerDeleteError && (
                <p className="mt-1.5 text-xs text-red-400 font-semibold">{headerDeleteError}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={headerDeleteBusy}
                onClick={() => setShowHeaderDeleteConfirm(false)}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800"
              >
                取消
              </button>
              <button
                type="button"
                disabled={headerDeleteBusy || !headerDeletePassword}
                onClick={async () => {
                  setHeaderDeleteBusy(true);
                  setHeaderDeleteError(null);
                  try {
                    const result = await accountMgrRef.current.deleteAccountOnServer(
                      headerDeletePassword,
                      resolveGameApiBaseUrl()
                    );
                    if (result.ok === false) {
                      setHeaderDeleteError(result.error);
                      return;
                    }
                    netClient.disconnect();
                    setAccount(null);
                    setSelectedCharId(null);
                    setNetConnected(false);
                    setActiveRoomId(null);
                    setLobbySubView('AUTH_CHAR');
                    setRunPhase('LOBBY');
                    setShowHeaderDeleteConfirm(false);
                  } catch (err: any) {
                    setHeaderDeleteError(err?.message || '删除账号失败');
                  } finally {
                    setHeaderDeleteBusy(false);
                  }
                }}
                className="px-3 py-1.5 text-xs rounded-lg bg-red-700 hover:bg-red-600 text-white font-bold disabled:opacity-50"
              >
                {headerDeleteBusy ? '删除中…' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Skill Book & Keybinding Center Modal */}
      {isSkillBookOpen && currentChar && (
        <SkillBookModal
          isOpen={isSkillBookOpen}
          onClose={() => setIsSkillBookOpen(false)}
          classId={currentChar.classId}
          specId={currentChar.lastSpec}
          keybindings={currentChar.specKeybindings?.[currentChar.lastSpec] || {}}
          slots={getPlayerSlots()}
          onSaveKeybinding={(slotIndex, key) => {
            accountMgrRef.current.saveSpecKeybinding(currentChar.id, currentChar.lastSpec, slotIndex, key);
            setAccount({ ...accountMgrRef.current.getCurrentAccount()! });
          }}
          onChangeSpec={(spec) => {
            accountMgrRef.current.setCharacterSpec(currentChar.id, spec);
            const updatedAcc = accountMgrRef.current.getCurrentAccount();
            if (updatedAcc) {
              setAccount({ ...updatedAcc });
              const updatedChar = updatedAcc.characters.find(c => c.id === currentChar.id);
              if (updatedChar) {
                setCustomSlotLayout(loadSpecCustomSlots(updatedChar.id, updatedChar.lastSpec, updatedChar.classId));
                netClient.refreshAuthProfile({
                  playerId: updatedChar.id,
                  playerName: updatedChar.name,
                  classId: updatedChar.classId,
                  spec: updatedChar.lastSpec,
                  role: getRoleBySpec(updatedChar.classId, updatedChar.lastSpec),
                });
              }
            }
          }}
          onAssignSlot={handleAssignSlot}
          onSwapSlots={handleSwapSlots}
          onClearSlot={handleClearSlot}
        />
      )}

      {/* Live Combat Waiting Queue Spectator Overlay */}
      {waitingQueueRoomId && currentChar && (
        <WaitingQueueOverlay
          roomName={roomManager.getRoom(waitingQueueRoomId)?.name || '副本挑战队伍'}
          dungeonName={
            DUNGEON_ROLE_QUOTAS[roomManager.getRoom(waitingQueueRoomId)?.dungeonId || 'shadowfang_keep']?.dungeonName || '影牙城堡'
          }
          role={getRoleBySpec(currentChar.classId, currentChar.lastSpec)}
          queuePosition={
            roomManager.getWaitingQueueStatus(waitingQueueRoomId, currentChar.id).queuePosition || 1
          }
          totalWaiting={
            roomManager.getWaitingQueueStatus(waitingQueueRoomId, currentChar.id).totalWaiting || 1
          }
          bossName={roomManager.getRoom(waitingQueueRoomId)?.inCombatBossName || '当前首领'}
          bossHpPct={roomManager.getWaitingQueueStatus(waitingQueueRoomId, currentChar.id).bossHpPct ?? 100}
          onExitQueue={() => {
            roomManager.leaveWaitingQueue(waitingQueueRoomId, currentChar.id);
            setWaitingQueueRoomId(null);
            setRoomsTick(t => t + 1);
          }}
        />
      )}
    </div>
  );
}

export default App;