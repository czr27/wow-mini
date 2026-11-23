import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  CombatEngine,
  RunStateMachine,
  RunPhase,
  AccountManager,
  LeaderboardManager,
  ReportManager,
  SHADOWFANG_KEEP_CONFIG,
  DRAGON_SOUL_CONFIG,
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
import {
  buildCastFromTimeline,
  cooldownRemainingFromTimelines,
  gcdRemainingFromTimelines,
} from './net/netTimeline.js';
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
import {
  SPELL_MANA_COSTS,
  SPELL_ENERGY_COSTS,
  SPELL_RAGE_COSTS,
  SPELL_RUNIC_COSTS,
} from './combat/spellCosts.js';
import { syncUnitResources } from './combat/unitResources.js';
import { setupRaidUnits as setupRaidUnitsCore } from './combat/setupRaidUnits.js';
import {
  applySharedCooldown,
  computePlayerGcdMs,
  resolvePlayerCast as resolvePlayerCastCore,
  handlePlayerCastSlot,
} from './hooks/usePlayerCastActions.js';
import { type AiActiveCast } from './combat/aiCombatExecutor.js';
import { confirmGroundTarget } from './combat/confirmGroundTarget.js';
import { dispelUnit } from './combat/dispelUnit.js';
import {
  getPredictedHealAmount as getPredictedHealAmountCore,
  isAiCdReady as isAiCdReadyCore,
  markAiCdUsed as markAiCdUsedCore,
  inferAiSpecForUnit,
  getOrCreateUnitAIPersonality,
  notifyOom as notifyOomCore,
} from './combat/aiUnitHelpers.js';
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
  const [isCertClaimed, setIsCertClaimed] = useState(false);

  // Combat runtime state
  const [runPhase, setRunPhase] = useState<'LOBBY' | 'TRAVEL_RECOVERY' | 'BOSS_COMBAT' | 'WIPE_VOTE' | 'SUMMARY'>('LOBBY');
  const [isApproaching, setIsApproaching] = useState(false);
  const [friendlyUnits, setFriendlyUnits] = useState<Unit[]>([]);
  const [bossUnit, setBossUnit] = useState<Unit | undefined>(undefined);
  const [bossTargetId, setBossTargetId] = useState<string | null>(null);
  const [groundEffects, setGroundEffects] = useState<GroundEffect[]>([]);
  const [floatingTexts, setFloatingTexts] = useState<FloatingCombatText[]>([]);
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
  const [companionCasts, setCompanionCasts] = useState<Record<string, { spellName: string; progress: number }>>({});
  const [revivingUnitId, setRevivingUnitId] = useState<string | null>(null);
  const [reviveProgress, setReviveProgress] = useState(0);
  const [isCorpseRunning, setIsCorpseRunning] = useState(false);
  const [corpseRunTimerMs, setCorpseRunTimerMs] = useState(0);
  const [groundTargetState, setGroundTargetState] = useState<GroundTargetState | null>(null);
  const [customSlotLayout, setCustomSlotLayout] = useState<ActionSlot[] | null>(null);
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
  const [dungeonDifficulty, setDungeonDifficulty] = useState<DungeonDifficulty>(() => {
    const initChar = accountMgrRef.current.getCurrentCharacter();
    if (initChar?.lastDungeonDifficulty) return initChar.lastDungeonDifficulty;
    try {
      const saved = localStorage.getItem('cata_dungeon_difficulty');
      if (saved === 'NORMAL' || saved === 'HEROIC' || saved === 'CUSTOM') {
        return saved;
      }
    } catch {}
    return 'HEROIC';
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
  const isShiftPressedRef = useRef(false);
  const [autoApproachTarget, setAutoApproachTarget] = useState<{ targetX: number; targetY: number; desiredDist: number; pendingSlotIdx: number } | null>(null);
  const prevRunPhaseRef = useRef<RunPhase>('LOBBY');

  // Global Shift key tracking for Focus targeting
  useEffect(() => {
    // 启动时尝试拉取服务器端最新账号数据，实现跨端/联机即时加载
    accountMgrRef.current.loadFromServer().then((success) => {
      if (success) {
        const curAcc = accountMgrRef.current.getCurrentAccount();
        setAccount(curAcc ? { ...curAcc } : null);
        const curChar = accountMgrRef.current.getCurrentCharacter();
        if (curChar) setSelectedCharId(curChar.id);
      }
    });

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
    setWaitingQueueRoomId,
    setDungeonTier,
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
  });

  // ── [Game Load] 游戏加载时，技能/Buff 图标优先从 \ART\resources\ 寻找 ──
  const [, setArtIconRevision] = useState(0);
  useEffect(() => {
    initArtResourceIcons();
    const unsubscribe = subscribeToIconChanges(() => {
      setArtIconRevision((prev) => prev + 1);
    });
    if (typeof import.meta !== 'undefined' && (import.meta as any).hot) {
      (import.meta as any).hot.on('art-resources-changed', () => {
        initArtResourceIcons();
      });
    }
    return () => unsubscribe();
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
      const diff = currentChar.lastDungeonDifficulty || 'HEROIC';
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
      playerCastRef.current = null;
      setPlayerCast(null);
      pendingCastSlotRef.current = null;
      engineRef.current.effectsManager?.addFloatingText({
        targetId: 'p1_player',
        text: '移动打断施法',
        category: 'STATUS',
        isCrit: false,
      });
      clearPlayerIncomingCast();
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
      const spellId = playerCastRef.current.spellId;
      playerCastRef.current = null;
      setPlayerCast(null);
      if (currentChar) {
        engineRef.current.interruptCast(currentChar.id);
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
      player?.stats?.haste ?? LEVEL_80_MAX_HASTE
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

  // Helper to persist custom slots to both memory state, localStorage and AccountManager
  const persistCustomSlots = (newSlots: ActionSlot[], targetCharId?: string, targetSpecId?: string) => {
    const cid = targetCharId || currentChar?.id;
    const sid = targetSpecId || currentChar?.lastSpec;
    if (cid === currentChar?.id && sid === currentChar?.lastSpec) {
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
    const baseSlots = (isCurrentActive && customSlotLayout)
      || loadSpecCustomSlots(char.id, spec, char.classId)
      || getDefaultActionSlots(char.classId, spec);
    return baseSlots.map(s => {
      const defaultCd = DEFAULT_SPELL_COOLDOWNS[s.spellId] || 0;
      const totalCdMs = (s.totalCdMs && s.totalCdMs > 0) ? s.totalCdMs : defaultCd;
      let cdRemainingMs = isCurrentActive ? (playerCooldowns[s.spellId]?.cdRemainingMs || 0) : 0;
      // Guest: prefer host timeline CD for the active character
      if (isCurrentActive && isNetworkGuestRef.current && currentChar) {
        const fromNet = cooldownRemainingFromTimelines(
          guestCdTimelinesRef.current,
          currentChar.id,
          s.spellId
        );
        if (fromNet > 0) cdRemainingMs = fromNet;
      }
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

    // Ranged attack spells (range <= 360px)
    const rangedAttackSpells = [
      'fireball', 'living_bomb', 'pyroblast', 'combustion', 'counterspell',
      'death_and_decay', 'dark_command', 'howling_blast', 'starsurge', 'wrath',
      'starfire', 'moonfire', 'sunfire', 'lightning_bolt', 'lava_burst',
      'chain_lightning', 'flame_shock', 'earth_shock', 'frostbolt', 'ice_lance',
      'deep_freeze', 'frozen_orb', 'arcane_blast', 'arcane_missiles', 'arcane_barrage'
    ];
    for (const sp of rangedAttackSpells) {
      res[sp] = distToBoss > 360;
    }

    // Friendly targeted spells (range <= 360px)
    const healSpells = [
      'rejuvenation', 'lifebloom', 'swiftmend', 'wild_growth', 'regrowth', 'healing_touch',
      'rebirth', 'revive', 'riptide', 'healing_wave', 'chain_heal', 'ancestral_spirit', 'innervate',
      'nourish', 'healing_surge', 'greater_healing_wave', 'natures_cure', 'cleanse_spirit', 'remove_curse', 'remove_corruption'
    ];
    for (const sp of healSpells) {
      res[sp] = distToTarget > 360;
    }

    // Dynamic range check for ALL 10 Cataclysm classes' slotted spells
    for (const slot of getPlayerSlots()) {
      if (res[slot.spellId] !== undefined) continue;
      const norm = getSpellByAnyId(slot.spellId, player.classId);
      if (!norm) continue;
      if (norm.isDefensive || norm.isResourceRestore) {
        res[slot.spellId] = false;
      } else if (norm.isHeal || norm.isShield || norm.isDispel || norm.isResurrect) {
        res[slot.spellId] = distToTarget > 360;
      } else if (norm.school === 'PHYSICAL' && norm.classId !== 'HUNTER' && !norm.isTaunt) {
        res[slot.spellId] = distToBoss > 80;
      } else {
        res[slot.spellId] = distToBoss > 360;
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
      const hpCost = norm?.resourceKind === 'HOLY_POWER' ? norm.resourceCostAmount : 0;
      if (hpCost > 0 && player.classId === 'PALADIN' && curHolyPower < hpCost) {
        insufficient[spId] = true;
        errors[spId] = '神圣能量不足';
        continue;
      }
    }
    return { insufficientResourceSpells: insufficient, spellResourceErrors: errors };
  }, [friendlyUnits]);

  // Global Alt+1 ~ Alt+9 quick target switching (matching RaidFrames unit order)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key, 10) - 1;
        const rolePriority: Record<string, number> = { TANK: 0, HEALER: 1, DPS: 2 };
        const sorted = [...friendlyUnits].sort((a, b) => {
          const rA = rolePriority[a.role] ?? 99;
          const rB = rolePriority[b.role] ?? 99;
          return rA - rB;
        });
        if (sorted[idx]) {
          setSelectedTargetId(sorted[idx].id);
          e.preventDefault();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [friendlyUnits]);

  // Cast Player Spell (P6e: gates in combat/handlePlayerCastSlot)
  const handleCastSlot = (slotIdx: number) => {
    handlePlayerCastSlot(slotIdx, {
      getPlayerSlots,
      engine: engineRef.current,
      currentChar,
      isNetworkGuest: isNetworkGuestRef.current,
      netConnected: netClient.connected,
      activeRoomId: activeRoomIdRef.current,
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
    });
  };

  // Global Escape & Right-click listener to cancel ground targeting or active cast
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (groundTargetState) {
          setGroundTargetState(null);
        } else if (playerCastRef.current) {
          handleCancelPlayerCast();
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
  }, [groundTargetState]);

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
      rsm.encounterReports
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

  const handleReturnToLobby = () => {
    const rsm = rsmRef.current;
    const engine = engineRef.current;
    if (rsm) {
      rsm.phase = 'LOBBY';
    }
    if (engine) {
      engine.reset();
    }
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
      netClient.requestSkipTravel(activeRoomIdRef.current, currentChar.id);
      setMySkipVote('YES');
      return;
    }
    rsmRef.current?.fastForwardTravel();
    if (rsmRef.current) setRunPhase(rsmRef.current.phase);
  };

  const handleSkipTravelVote = (choice: 'YES' | 'NO') => {
    if (!activeRoomIdRef.current) return;
    setMySkipVote(choice);
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

    // 4. 副本状态机启动
    if (rsm) {
      rsm.dungeon = effectiveTier === '20man' ? DRAGON_SOUL_CONFIG : SHADOWFANG_KEEP_CONFIG;
      rsm.startRun();
      setRunPhase(rsm.phase);
      setIsCertClaimed(false);
      setFocusTargetId(null);
    }

    if (engine) {
      setFriendlyUnits([...engine.friendlyUnits]);
    }
  };
  startAdventureRef.current = handleStartAdventure;

  const handleExportCsv = () => {
    const rsm = rsmRef.current;
    if (!rsm) return;
    const csv = reportMgrRef.current.exportCsv({
      dungeonId: rsm.dungeon.id,
      dungeonName: rsm.dungeon.name,
      exportedAtIso: new Date().toISOString(),
      totalDurationSec: rsm.totalRunDurationSec,
      encounters: rsm.encounterReports,
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ShadowfangKeep_Report_${Date.now()}.csv`;
    link.click();
  };

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

  return (
    <div className="w-full h-screen max-h-screen bg-[#0c0c16] text-gray-100 flex flex-col font-sans select-none overflow-hidden">
      
      {/* Top Header Navigation Bar */}
      <header className="h-14 shrink-0 border-b border-[#252542] bg-[#121224]/90 px-6 flex items-center justify-between backdrop-blur z-40">
        <div className="flex items-center space-x-3">
          <span className="text-2xl">🐉</span>
          <div>
            <h1 className="font-extrabold text-amber-300 text-sm tracking-wide">
              Cata Raid Sim — 大地的裂变副本模拟器
            </h1>
            <span className="text-[10px] text-gray-400">
              当前首领流程：{dungeonTier === '20man' ? '巨龙之魂 (20人' : '影牙城堡 (5人'}
              {dungeonDifficulty === 'HEROIC' ? '英雄模式)' : dungeonDifficulty === 'CUSTOM' ? '自定义难度)' : '普通模式)'}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div
            className={`px-2 py-1 text-[10px] rounded border font-bold ${
              netConnected
                ? 'border-emerald-600/60 text-emerald-300 bg-emerald-950/40'
                : 'border-slate-600 text-slate-400 bg-slate-900/40'
            }`}
            title={netConnected ? '已连接联机服务器（房间/战斗同步）' : '未连接服务器，房间仅本机有效'}
          >
            {netConnected ? '联机中' : '单机'}
          </div>
          {currentChar && (
            <div
              onClick={() => {
                if (runPhase !== 'LOBBY') {
                  handleReturnToLobby();
                } else if (activeRoomId) {
                  handleLeaveActiveRoom();
                }
                setLobbySubView('AUTH_CHAR');
              }}
              className="bg-[#1b1b34] border border-[#3b3b5c] px-3 py-1 rounded-lg text-xs font-bold cursor-pointer hover:border-amber-400 transition flex items-center space-x-2"
              title="点击返回主页与角色切换"
            >
              <span className="text-gray-400">当前冒险者:</span>
              <span className="text-amber-300">{currentChar.name}</span>
              <span className="text-[10px] text-gray-400">({currentChar.lastSpec})</span>
            </div>
          )}

          <div
            className={`px-2 py-1 text-[10px] rounded border font-bold ${
              netConnected
                ? 'border-emerald-600/60 text-emerald-300 bg-emerald-950/40'
                : 'border-slate-600 text-slate-400 bg-slate-900/50'
            }`}
            title={netConnected ? '已连接联机服务器（房间与房主战斗同步）' : '未连接服务器，房间为本地模式'}
          >
            {netConnected ? '联机 · 在线' : '本地模式'}
          </div>

          {/* Locked Read-Only Badge during active combat/travel (R8) */}
          <button disabled={runPhase !== 'LOBBY' && runPhase !== 'SUMMARY'} className="hidden" aria-hidden="true" tabIndex={-1} />
          {runPhase !== 'LOBBY' && runPhase !== 'SUMMARY' && (
            <div
              className="px-3 py-1.5 text-xs rounded-lg font-bold shadow flex items-center space-x-1.5 border bg-black/60 border-amber-500/50 text-amber-200"
              title="副本进行中，模式与难度已锁定"
            >
              <span>🔒</span>
              <span>
                {dungeonTier === '20man' ? '巨龙之魂 (20人' : '影牙城堡 (5人'}
                {dungeonDifficulty === 'HEROIC' ? '英雄)' : dungeonDifficulty === 'CUSTOM' ? '自定义)' : '普通)'} · 战斗中已锁定
              </span>
            </div>
          )}

          <button
            onClick={() => {
              if (runPhase !== 'LOBBY') {
                handleReturnToLobby();
              } else if (activeRoomId) {
                handleLeaveActiveRoom();
              } else {
                roomManager.cleanupAiOnlyRooms();
                setLobbySubView('ROOM_LIST');
                setRoomsTick(t => t + 1);
              }
            }}
            className="px-3 py-1.5 text-xs bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg font-bold shadow flex items-center space-x-1"
            title="打开副本大厅房间列表"
          >
            <span>🏰</span>
            <span>副本大厅</span>
          </button>

          <button
            onClick={() => setIsLeaderboardOpen(true)}
            className="px-3 py-1.5 text-xs bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold shadow flex items-center space-x-1"
          >
            <span>🏆</span>
            <span>世界排行</span>
          </button>

          <button
            onClick={() => setIsSkillBookOpen(true)}
            className="px-3 py-1.5 text-xs bg-indigo-700 hover:bg-indigo-600 text-white rounded-lg font-bold shadow flex items-center space-x-1"
            title="查看全部技能、机制说明与自定义三栏动作条"
          >
            <span>📖</span>
            <span>技能书与快捷键</span>
          </button>

          {runPhase !== 'LOBBY' && (
            <button
              onClick={handleReturnToLobby}
              className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded-lg text-gray-300 border border-slate-500 font-bold"
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
            characters={account?.characters || []}
            selectedCharId={selectedCharId}
            onSelectCharacter={(id) => {
              setSelectedCharId(id);
              accountMgrRef.current.selectCharacter(id);
              const targetChar = account?.characters.find(c => c.id === id);
              if (targetChar) {
                const tier = targetChar.lastDungeonTier || '5man';
                const diff = targetChar.lastDungeonDifficulty || 'HEROIC';
                const customDiff = targetChar.lastCustomDifficulty || DEFAULT_CUSTOM_DIFFICULTY;
                setDungeonTier(tier);
                setDungeonDifficulty(diff);
                setCustomDifficulty(customDiff);
                setupRaidUnits(targetChar, tier, diff, customDiff);
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
              const diff = newChar.lastDungeonDifficulty || 'HEROIC';
              const customDiff = newChar.lastCustomDifficulty || DEFAULT_CUSTOM_DIFFICULTY;
              setDungeonTier(tier);
              setDungeonDifficulty(diff);
              setCustomDifficulty(customDiff);
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
                const diff = nextChar.lastDungeonDifficulty || 'HEROIC';
                const customDiff = nextChar.lastCustomDifficulty || DEFAULT_CUSTOM_DIFFICULTY;
                setDungeonTier(tier);
                setDungeonDifficulty(diff);
                setCustomDifficulty(customDiff);
                setupRaidUnits(nextChar, tier, diff, customDiff);
              }
            }}
            onChangeSpec={(id, spec) => {
              accountMgrRef.current.setCharacterSpec(id, spec);
              const updatedAcc = accountMgrRef.current.getCurrentAccount();
              if (updatedAcc) {
                setAccount({ ...updatedAcc });
                const updatedChar = updatedAcc.characters.find(c => c.id === id);
                if (updatedChar) {
                  setCustomSlotLayout(loadSpecCustomSlots(updatedChar.id, updatedChar.lastSpec, updatedChar.classId));
                  setupRaidUnits(updatedChar);
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
                // WS AUTH kicks any previous live session for this username
                // (skip when offline fallback — server not reachable)
                if (!result.offline) {
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
            onExportCsv={handleExportCsv}
            onExportJson={handleExportJson}
            onClaimCertificate={handleClaimCertificate}
            onOpenLeaderboard={() => setIsLeaderboardOpen(true)}
            onReturnToLobby={handleReturnToLobby}
            isCertificateClaimed={isCertClaimed}
            isCleared={rsmRef.current ? rsmRef.current.checkIsCleared() : false}
          />
        ) : (
          <CombatHudScreen
            friendlyUnits={friendlyUnits}
            bossUnit={bossUnit}
            bossTargetId={bossTargetId}
            groundEffects={groundEffects}
            floatingTexts={floatingTexts}
            runPhase={runPhase}
            isApproaching={isApproaching}
            screenShake={screenShake}
            selectedTargetId={selectedTargetId}
            focusTargetId={focusTargetId}
            dungeonTier={dungeonTier}
            targetBossName={targetBossName}
            currentBossIndex={rsmRef.current?.currentBossIndex || 0}
            travelRemainingMs={travelRemainingMs}
            totalTravelMs={rsmRef.current?.totalTravelMs || 12000}
            isCorpseRunning={isCorpseRunning}
            corpseRunTimerMs={corpseRunTimerMs}
            revivingUnitId={revivingUnitId}
            reviveProgress={reviveProgress}
            autoApproachTarget={autoApproachTarget}
            groundTargetState={groundTargetState}
            playerCast={playerCast}
            companionCasts={companionCasts}
            bossCasting={
              bossAiRef.current?.currentCasting
                ? {
                    spellName: bossAiRef.current.currentCasting.skill.name,
                    elapsedMs: bossAiRef.current.currentCasting.elapsedMs,
                    castTimeMs: bossAiRef.current.currentCasting.skill.castTimeMs || 1,
                    interruptible: !!bossAiRef.current.currentCasting.skill.interruptible,
                  }
                : null
            }
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