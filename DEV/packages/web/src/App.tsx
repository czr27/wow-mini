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
  findOptimalGroundAuraCentroid,
  evaluateTankThreatDecision,
  getUnitPersonality,
  createAIPersonality,
  computeSkillMetrics,
  scoreSkillCandidate,
  evaluateUniversalAIDecision,
  type UsableSkillCandidate,
  type UniversalAIDecisionResult,
  COMPUTED_SKILL_METRICS,
  type AIPersonality,
  type SkillMetrics,
  rollAiDamage,
  rollAiHeal,
  GroundTargetState,
  GROUND_TARGET_SPELL_DEFS,
  roomManager,
  type LobbyRoom,
  getRoleBySpec,
  DUNGEON_ROLE_QUOTAS,
  LEVEL_80_STATS,
  LEVEL_80_MAX_HASTE,
  createLevel80BaseStats,
  getHastedCastTimeMs,
  getEffectiveGcdMs,
  ALL_CLASSES_NORMALIZED,
  getSpellByAnyId,
  getSpellsForClassSpec,
  getSpellGcdCategory,
  getClassPrimaryResource,
  isMeleeClassSpec,
  buildUsableCandidatesForUnit,
  getUnitResourceAmount,
  classifySpellCastMode,
  getCastLifecyclePolicy,
  isChanneledSpell,
  type NormalizedSpell,
  type SpellResourceCostBundle,
} from '@cata-raid-sim/engine';
import {
  hasSufficientPlayerResources,
  deductPlayerResources,
  processPlayerChannelTick,
} from './hooks/usePlayerCastController.js';

import { RoomListView, RoomDetailView, WaitingQueueOverlay } from './components/room/index.js';
import { netClient } from './net/NetClient.js';
import { NetworkRoomFacade } from './net/NetworkRoomFacade.js';
import type { LobbyRoom as NetLobbyRoom, NetworkCombatSnapshot, PlayerInputPayload } from '@cata-raid-sim/engine';

import { AuthAndCharacterModal, CLASS_COLORS } from './components/AuthAndCharacterModal.js';
import { ClearCertificateModal } from './components/ClearCertificateModal.js';
import { LeaderboardModal } from './components/LeaderboardModal.js';
import { SkillBookModal } from './components/SkillBookModal.js';
import { RaidFrames, getPlayerDispelCapabilities, DEBUFF_REGISTRY, IncomingHealCast, CLASS_COLORS_CATA } from './components/RaidFrames.js';
import { PlayerUnitFrame } from './components/PlayerUnitFrame.js';
import { TargetUnitFrame } from './components/TargetUnitFrame.js';
import { FocusUnitFrame } from './components/FocusUnitFrame.js';
import { BossBar } from './components/BossBar.js';
import { ActionBar, ActionSlot, PlayerCastState, PlayerCastBar, isOffGcdSpell, OFF_GCD_SPELLS } from './components/ActionBar.js';
import { StatsPanel } from './components/StatsPanel.js';
import { WipeVoteModal } from './components/WipeVoteModal.js';
import { TravelRecovery } from './components/TravelRecovery.js';
import { SummaryPage } from './components/SummaryPage.js';
import { CombatCanvas } from './canvas/CombatCanvas.js';
import { getDefaultActionSlots, DEFAULT_SPELL_COOLDOWNS } from './assets/defaultActionSlots.js';
import { SPELL_TOOLTIPS, initArtResourceIcons, subscribeToIconChanges } from './assets/pixelIcons.js';

// Cataclysm 4.3 Mana Cost Matrix (balanced for 1.2x~2.0x total encounter mana coverage)
const SPELL_MANA_COSTS: Record<string, number> = {
  healing_wave: 1800,
  nourish: 1800,
  rejuvenation: 2400,
  lifebloom: 1400,
  wild_growth: 2600,
  chain_heal: 2200,
  healing_surge: 2400,
  regrowth: 5200,
  greater_healing_wave: 5600,
  healing_touch: 5400,
  swiftmend: 1600,
  rebirth: 6800,
  revive: 6800,
  healing_rain: 6500,
  tranquility: 6500,
  wrath: 1600,
  lightning_bolt: 1600,
  frostbolt: 1800,
  fireball: 2000,
  starsurge: 2400,
  lava_burst: 2600,
  pyroblast: 2800,
  starfire: 2800,
  chain_lightning: 3000,
  earth_shield: 1800,
  unleash_life: 1600,
  healing_tide: 1200,
  ascendance: 1000,
  ancestral_guidance: 0,
  thunderstorm: 0,
  moonfire: 2200,
  sunfire: 2200,
  flame_shock: 2200,
  earth_shock: 2400,
  arcane_blast: 2500,
  arcane_barrage: 2400,
  living_bomb: 2600,
  cleanse_spirit: 2200,
  natures_cure: 2200,
  remove_curse: 2200,
  remove_corruption: 2200,
};

// Cataclysm 4.3 Rogue Energy Cost Matrix
const SPELL_ENERGY_COSTS: Record<string, number> = {
  sinister_strike: 40,
  mutilate: 55,
  slice_and_dice: 25,
  eviscerate: 35,
  envenom: 35,
  rupture: 25,
  kick: 15,
  feint: 20,
};

// Cataclysm 4.3 Bear/Warrior Rage Cost Matrix
const SPELL_RAGE_COSTS: Record<string, number> = {
  mangle: 15,
  lacerate: 15,
  maul: 30,
};

// Cataclysm 4.3 DK Runic Power Cost Matrix
const SPELL_RUNIC_COSTS: Record<string, number> = {
  frost_strike: 32,
  rune_strike: 30,
  death_coil: 40,
};

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
  const aiHealerCastsRef = useRef<Record<string, {
    targetId: string;
    spellId: string;
    spellName: string;
    amount: number;
    baseAmt: number;
    manaCost: number;
    resourceKind?: string;
    totalMs: number;
    elapsedMs: number;
    isHarmful?: boolean;
    isAOE?: boolean;
    maxTargets?: number;
    school?: string;
    normalizedSpell?: NormalizedSpell;
  }>>({});

  const getPredictedHealAmount = (spellId: string, caster?: Unit): number => {
    const PREDICTIONS: Record<string, { base: number; coeff: number }> = {
      nourish: { base: 4200, coeff: 0.35 },
      regrowth: { base: 6500, coeff: 0.45 },
      healing_touch: { base: 11500, coeff: 0.85 },
      healing_wave: { base: 4200, coeff: 0.35 },
      healing_surge: { base: 8200, coeff: 0.55 },
      greater_healing_wave: { base: 12000, coeff: 0.85 },
      chain_heal: { base: 6200, coeff: 0.5 },
      holy_light: { base: 5200, coeff: 0.4 },
      flash_of_light: { base: 8200, coeff: 0.55 },
      divine_light: { base: 12500, coeff: 0.85 },
      heal: { base: 4600, coeff: 0.35 },
      flash_heal: { base: 8500, coeff: 0.55 },
      greater_heal: { base: 12500, coeff: 0.85 },
      prayer_of_healing: { base: 5800, coeff: 0.45 },
    };
    const pred = PREDICTIONS[spellId];
    const sp = caster?.stats?.spellPower || 3200;
    if (pred) return Math.round(pred.base + sp * pred.coeff);
    const norm = getSpellByAnyId(spellId, caster?.classId);
    if (norm && norm.isHeal && norm.directHeal > 0) {
      return Math.round(norm.directHeal + sp * 0.4);
    }
    return 0;
  };

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

  // Pure read-only cooldown check for AI candidate evaluation (NEVER mutates CD state!)
  const isAiCdReady = (unitId: string, spellKey: string, cdMs: number): boolean => {
    if (cdMs <= 0) return true;
    const key = `${unitId}_${spellKey}`;
    const last = aiCooldownsRef.current[key] || 0;
    return Date.now() - last >= cdMs;
  };

  // Commit cooldown ONLY when AI actually casts/executes the spell
  const markAiCdUsed = (unitId: string, spellKey: string): void => {
    aiCooldownsRef.current[`${unitId}_${spellKey}`] = Date.now();
  };

  const inferAiSpecForUnit = (u: Unit): string => {
    const cls = ALL_CLASSES_NORMALIZED[u.classId];
    if (!cls) return u.spec || 'BLOOD';
    if (u.spec) {
      const exact = cls.specs.find(s => s.id.toUpperCase() === u.spec!.toUpperCase());
      if (exact) return exact.id;
    }
    const matching = cls.specs.find(s => s.role === u.role);
    return matching?.id || cls.specs[0]?.id || 'BLOOD';
  };

  const aiPersonalitiesRef = useRef<Map<string, AIPersonality>>(new Map());
  const getUnitAIPersonality = (u: Unit): AIPersonality => {
    let p = aiPersonalitiesRef.current.get(u.id);
    if (!p) {
      p = createAIPersonality(u.name || 'AI', u.id || 'unit');
      aiPersonalitiesRef.current.set(u.id, p);
    }
    return p;
  };

  const notifyOom = (unit: Unit, engine: CombatEngine) => {
    const now = Date.now();
    if (!lastOomWarningMsRef.current[unit.id] || now - lastOomWarningMsRef.current[unit.id] > 4000) {
      lastOomWarningMsRef.current[unit.id] = now;
      engine.effectsManager?.addFloatingText({
        targetId: unit.id,
        text: `⚠️ ${unit.name} 法力耗尽 (OOM)!`,
        category: 'STATUS',
        isCrit: false,
      });
    }
  };

  const syncUnitResources = (unit: Unit) => {
    if (!unit.resources) unit.resources = [];
    if (unit.maxMp && unit.maxMp > 0) {
      const mRes = unit.resources.find(r => r.kind === 'MANA');
      if (mRes) mRes.current = unit.mp ?? 0;
      else unit.resources.push({ kind: 'MANA', current: unit.mp ?? 0, max: unit.maxMp });
    }
    if (unit.classId === 'ROGUE') {
      const eRes = unit.resources.find(r => r.kind === 'ENERGY');
      if (eRes) eRes.current = unit.energy ?? 0;
      else unit.resources.push({ kind: 'ENERGY', current: unit.energy ?? 100, max: 100 });
    }
    if (unit.classId === 'WARRIOR' || (unit.classId === 'DRUID' && unit.role === 'TANK')) {
      const rRes = unit.resources.find(r => r.kind === 'RAGE');
      if (rRes) rRes.current = unit.rage ?? 0;
      else unit.resources.push({ kind: 'RAGE', current: unit.rage ?? 25, max: 100 });
    }
    if (unit.classId === 'HUNTER') {
      const fRes = unit.resources.find(r => r.kind === 'FOCUS');
      if (fRes) fRes.current = unit.focus ?? 100;
      else unit.resources.push({ kind: 'FOCUS', current: unit.focus ?? 100, max: 100 });
    }
    if (unit.classId === 'DK') {
      const rpRes = unit.resources.find(r => r.kind === 'RUNIC_POWER');
      if (rpRes) rpRes.current = unit.runicPower ?? 0;
      else unit.resources.push({ kind: 'RUNIC_POWER', current: unit.runicPower ?? 0, max: 100 });
    }
    if (unit.classId === 'PALADIN') {
      const hpRes = unit.resources.find(r => r.kind === 'HOLY_POWER');
      if (hpRes) hpRes.current = unit.holyPower ?? 0;
      else unit.resources.push({ kind: 'HOLY_POWER', current: unit.holyPower ?? 0, max: 3 });
    }
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
  const roomFacadeRef = useRef(new NetworkRoomFacade(roomManager));
  const isNetworkGuestRef = useRef(false);
  const isNetworkHostRef = useRef(false);
  const activeRoomIdRef = useRef<string | null>(null);
  const pendingGuestInputsRef = useRef<PlayerInputPayload[]>([]);
  const lastCombatBroadcastMsRef = useRef(0);
  const startAdventureRef = useRef<(overrides?: {
    tier?: '5man' | '20man';
    difficulty?: DungeonDifficulty;
    customDiff?: CustomDifficultySettings;
    activeRoom?: LobbyRoom;
  }) => void>(() => {});
  const customDifficultyRef = useRef(customDifficulty);
  customDifficultyRef.current = customDifficulty;

  useEffect(() => {
    activeRoomIdRef.current = activeRoomId;
  }, [activeRoomId]);

  // Ensure any AI-only rooms are always cleaned up on mount
  useEffect(() => {
    roomManager.cleanupAiOnlyRooms();
  }, []);

  // WebSocket: auth + room/combat sync subscription
  useEffect(() => {
    if (!currentChar || !account) return;

    netClient.connect({
      username: account.username,
      playerId: currentChar.id,
      playerName: currentChar.name,
      classId: currentChar.classId,
      spec: currentChar.lastSpec,
      role: getRoleBySpec(currentChar.classId, currentChar.lastSpec),
    });

    const unsub = netClient.subscribe((msg) => {
      if (msg.type === 'AUTH_OK' || msg.type === 'CONNECTED') {
        setNetConnected(true);
        setRoomsTick((t) => t + 1);
      }
      if (msg.type === 'ROOM_LIST_SYNC' && Array.isArray(msg.payload)) {
        for (const room of msg.payload as NetLobbyRoom[]) {
          roomFacadeRef.current.upsertRoom(room);
        }
        setRoomsTick((t) => t + 1);
      }
      if (msg.type === 'ROOM_UPDATE' && msg.payload) {
        const room = msg.payload as NetLobbyRoom;
        roomFacadeRef.current.upsertRoom(room);
        if (currentChar && room.members.some((m) => m.id === currentChar.id)) {
          setActiveRoomId(room.id);
          setLobbySubView('ROOM_DETAIL');
          isNetworkHostRef.current = room.hostId === currentChar.id;
          isNetworkGuestRef.current = room.hostId !== currentChar.id && room.members.some((m) => m.id === currentChar.id && !m.isAi);
        }
        setRoomsTick((t) => t + 1);
      }
      if (msg.type === 'ROOM_START' && msg.payload) {
        const room = msg.payload as NetLobbyRoom;
        roomFacadeRef.current.upsertRoom(room);
        setActiveRoomId(room.id);
        isNetworkHostRef.current = !!(currentChar && room.hostId === currentChar.id);
        isNetworkGuestRef.current = !!(currentChar && room.hostId !== currentChar.id);
        const tier: '5man' | '20man' = room.dungeonId === 'dragon_soul' ? '20man' : '5man';
        const effectiveCustom = room.customDifficulty || customDifficultyRef.current;
        setDungeonTier(tier);
        setDungeonDifficulty(room.difficulty);
        if (room.difficulty === 'CUSTOM') setCustomDifficulty(effectiveCustom);
        startAdventureRef.current({
          tier,
          difficulty: room.difficulty,
          customDiff: effectiveCustom,
          activeRoom: room,
        });
      }
      if (msg.type === 'COMBAT_STATE' && msg.payload && isNetworkGuestRef.current) {
        const snap = msg.payload as NetworkCombatSnapshot;
        const engine = engineRef.current;
        engine.applyNetworkUnitSnapshots(snap.units);
        setFriendlyUnits([...engine.friendlyUnits]);
        setBossUnit(engine.bossUnit ? { ...engine.bossUnit } : undefined);
        if (snap.bossTargetId !== undefined) setBossTargetId(snap.bossTargetId ?? null);
        if (snap.runPhase && snap.runPhase !== runPhase) {
          setRunPhase(snap.runPhase as RunPhase);
        }
      }
      if (msg.type === 'PLAYER_INPUT' && msg.payload && isNetworkHostRef.current) {
        pendingGuestInputsRef.current.push(msg.payload as PlayerInputPayload);
      }
      if (msg.type === 'MEMBER_REPLACE_AI' && msg.payload) {
        const body = msg.payload as { room: NetLobbyRoom; playerId: string; aiMemberId: string };
        roomFacadeRef.current.upsertRoom(body.room);
        if (isNetworkHostRef.current) {
          const engine = engineRef.current;
          const unit = engine.getUnit(body.playerId);
          if (unit) {
            // Keep unit id stable for combat; mark as AI-controlled
            unit.isPlayer = false;
          }
        }
        if (currentChar && body.playerId === currentChar.id) {
          isNetworkGuestRef.current = false;
          isNetworkHostRef.current = body.room.hostId === currentChar.id;
        }
        setRoomsTick((t) => t + 1);
      }
      if (msg.type === 'HOST_TRANSFER' && msg.payload) {
        const body = msg.payload as { newHostId: string; room: NetLobbyRoom };
        roomFacadeRef.current.upsertRoom(body.room);
        if (currentChar) {
          isNetworkHostRef.current = body.newHostId === currentChar.id;
          isNetworkGuestRef.current = body.newHostId !== currentChar.id && body.room.members.some((m) => m.id === currentChar.id && !m.isAi);
        }
        setRoomsTick((t) => t + 1);
      }
    });

    return () => {
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChar?.id, account?.username]);

  const handleLeaveActiveRoom = () => {
    if (activeRoomId && currentChar) {
      roomFacadeRef.current.leaveRoom(activeRoomId, currentChar.id);
    } else if (activeRoomId) {
      roomManager.deleteRoom(activeRoomId);
    }
    roomManager.cleanupAiOnlyRooms();
    isNetworkGuestRef.current = false;
    isNetworkHostRef.current = false;
    setActiveRoomId(null);
    setLobbySubView('ROOM_LIST');
    setRoomsTick(t => t + 1);
  };

  const handleCreateRoom = (
    name: string,
    dungeonId: string,
    difficulty: DungeonDifficulty,
    customDiff?: CustomDifficultySettings
  ) => {
    if (!currentChar) return;
    if (customDiff) {
      handleCustomDifficultyChange(customDiff);
    }
    const host = {
      id: currentChar.id,
      name: currentChar.name,
      classId: currentChar.classId,
      spec: currentChar.lastSpec,
      role: getRoleBySpec(currentChar.classId, currentChar.lastSpec),
    };
    if (netClient.connected) {
      netClient.createRoom({
        name,
        dungeonId,
        difficulty,
        customDifficulty: difficulty === 'CUSTOM' ? (customDiff || customDifficulty) : undefined,
        host,
      });
      setLobbySubView('ROOM_DETAIL');
      setRoomsTick(t => t + 1);
      return;
    }
    const room = roomManager.createRoom({
      name,
      dungeonId,
      difficulty,
      customDifficulty: difficulty === 'CUSTOM' ? (customDiff || customDifficulty) : undefined,
      host,
    });
    isNetworkHostRef.current = true;
    isNetworkGuestRef.current = false;
    setActiveRoomId(room.id);
    setLobbySubView('ROOM_DETAIL');
    setRoomsTick(t => t + 1);
  };

  const handleJoinRoom = (roomId: string) => {
    if (!currentChar) return;
    if (netClient.connected) {
      netClient.joinRoom(roomId);
      setActiveRoomId(roomId);
      setLobbySubView('ROOM_DETAIL');
      setRoomsTick(t => t + 1);
      return;
    }
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    let member = room.members.find(m => m.id === currentChar.id);
    if (!member) {
      const pRole = getRoleBySpec(currentChar.classId, currentChar.lastSpec);
      const targetSlot = room.slots.find(s => !s.occupied);
      if (targetSlot) {
        member = {
          id: currentChar.id,
          name: currentChar.name,
          classId: currentChar.classId,
          spec: currentChar.lastSpec,
          role: pRole,
          isPlayer: true,
          isAi: false,
          isHost: false,
          isReady: true,
          slotIndex: targetSlot.index,
        };
        targetSlot.occupied = true;
        targetSlot.role = pRole;
        targetSlot.member = member;
        room.members.push(member);
      }
    }
    isNetworkGuestRef.current = room.hostId !== currentChar.id;
    isNetworkHostRef.current = room.hostId === currentChar.id;
    setActiveRoomId(room.id);
    setLobbySubView('ROOM_DETAIL');
    setRoomsTick(t => t + 1);
  };

  const handleJoinWaitingQueue = (roomId: string) => {
    if (!currentChar) return;
    if (netClient.connected) {
      netClient.joinRoom(roomId);
      setWaitingQueueRoomId(roomId);
      setRoomsTick(t => t + 1);
      return;
    }
    roomManager.joinWaitingQueue(roomId, {
      id: currentChar.id,
      name: currentChar.name,
      classId: currentChar.classId,
      spec: currentChar.lastSpec,
    });
    setWaitingQueueRoomId(roomId);
    setRoomsTick(t => t + 1);
  };

  const handleQuickJoin = () => {
    if (!currentChar) return;
    const pRole = getRoleBySpec(currentChar.classId, currentChar.lastSpec);
    const rooms = roomFacadeRef.current.listRooms();
    for (const r of rooms) {
      if (r.status === 'LOBBY') {
        const quota = DUNGEON_ROLE_QUOTAS[r.dungeonId];
        const roleCount = r.members.filter(m => m.role === pRole).length;
        if (roleCount < (quota?.roles[pRole]?.max ?? 5) && r.members.length < (quota?.capacity ?? 5)) {
          handleJoinRoom(r.id);
          return;
        }
      }
    }
    handleCreateRoom(`${currentChar.name}的速推队`, 'shadowfang_keep', dungeonDifficulty, dungeonDifficulty === 'CUSTOM' ? customDifficulty : undefined);
  };

  const handleStartGameFromRoom = () => {
    if (!activeRoomId || !currentChar) return;
    const room = roomFacadeRef.current.getRoom(activeRoomId) || roomManager.getRoom(activeRoomId);
    if (!room) return;
    const validation = roomFacadeRef.current.validateStartGame(activeRoomId);
    if (!validation.canStart) {
      return;
    }

    if (netClient.connected) {
      isNetworkHostRef.current = true;
      isNetworkGuestRef.current = false;
      // Server broadcasts ROOM_START to host + guests; adventure starts in the WS handler
      netClient.startRoom(activeRoomId);
      return;
    }

    roomManager.startGame(activeRoomId, currentChar.id);

    const tier: '5man' | '20man' = room.dungeonId === 'dragon_soul' ? '20man' : '5man';
    const effectiveCustom = room.customDifficulty || customDifficulty;
    setDungeonTier(tier);
    setDungeonDifficulty(room.difficulty);
    if (room.difficulty === 'CUSTOM') {
      setCustomDifficulty(effectiveCustom);
    }

    // Pass room, tier, difficulty, and custom settings directly so FIRST entry uses exact room roster & config
    handleStartAdventure({
      tier,
      difficulty: room.difficulty,
      customDiff: effectiveCustom,
      activeRoom: room,
    });
  };

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
    const engine = engineRef.current;
    engine.reset();
    engine.difficulty = diff;
    engine.customDifficulty = customDiff;
    setPlayerCooldowns({});
    playerCastRef.current = null;
    clearPlayerIncomingCast();
    setPlayerCast(null);

    const isCustom = diff === 'CUSTOM';
    const playerHpMult = isCustom ? Math.max(0.1, customDiff.playerHpCoeff ?? 1.0) : 1.0;
    const playerMpMult = isCustom ? Math.max(0.1, customDiff.playerMpCoeff ?? 1.0) : 1.0;
    const aiHpMult = isCustom ? Math.max(0.1, customDiff.aiHpCoeff ?? 1.0) : 1.0;
    const aiMpMult = isCustom ? Math.max(0.1, customDiff.aiMpCoeff ?? 1.0) : 1.0;

    const hasManaForClassRole = (cls: ClassId, role: 'TANK' | 'HEALER' | 'DPS'): boolean => {
      if (role === 'HEALER') return true;
      return (
        cls === 'MAGE' ||
        cls === 'SHAMAN' ||
        cls === 'PRIEST' ||
        cls === 'WARLOCK' ||
        cls === 'PALADIN' ||
        (cls === 'DRUID' && role === 'DPS')
      );
    };

    const getLv80MaxMp = (cls: ClassId, role: 'TANK' | 'HEALER' | 'DPS'): number => {
      if (!hasManaForClassRole(cls, role)) return 0;
      return role === 'HEALER' ? LEVEL_80_STATS.healerBaseMp : LEVEL_80_STATS.casterBaseMp;
    };

    const finalizeUnit = (u: Unit): Unit => {
      if (u.isPlayer) {
        u.maxHp = Math.round(u.maxHp * playerHpMult);
        u.hp = u.maxHp;
        if (u.maxMp && u.maxMp > 0) {
          u.maxMp = Math.round(u.maxMp * playerMpMult);
          u.mp = u.maxMp;
        }
      } else {
        u.maxHp = Math.round(u.maxHp * aiHpMult);
        u.hp = u.maxHp;
        if (u.maxMp && u.maxMp > 0) {
          u.maxMp = Math.round(u.maxMp * aiMpMult);
          u.mp = u.maxMp;
        }
      }
      u.resources = [];
      if (u.maxMp && u.maxMp > 0) {
        u.resources.push({ kind: 'MANA', current: u.mp ?? u.maxMp, max: u.maxMp });
      }
      if (u.classId === 'ROGUE') {
        u.energy = u.energy ?? 100;
        u.resources.push({ kind: 'ENERGY', current: u.energy, max: 100 });
      } else if (u.classId === 'WARRIOR' || (u.classId === 'DRUID' && u.role === 'TANK')) {
        u.rage = u.rage ?? 40;
        u.resources.push({ kind: 'RAGE', current: u.rage, max: 100 });
      } else if (u.classId === 'HUNTER') {
        u.focus = u.focus ?? 100;
        u.resources.push({ kind: 'FOCUS', current: u.focus, max: 100 });
      } else if (u.classId === 'DK') {
        u.runicPower = u.runicPower ?? 20;
        u.resources.push({ kind: 'RUNIC_POWER', current: u.runicPower, max: 100 });
      } else if (u.classId === 'PALADIN') {
        u.holyPower = u.holyPower ?? 1;
        u.resources.push({ kind: 'HOLY_POWER', current: u.holyPower, max: 3 });
      }
      return u;
    };

    if (activeRoom && activeRoom.members.length > 0) {
      const party: Unit[] = [];
      activeRoom.members.forEach((member, idx) => {
        const isPlayer = member.id === char?.id || member.isPlayer;
        const assignedClass = member.classId;
        const assignedRole = member.role;
        const assignedName = member.name;
        const isTankMember = assignedRole === 'TANK';
        const isHealerMember = assignedRole === 'HEALER';

        const nameSeed = assignedName.split('').reduce((acc, c) => acc + c.charCodeAt(0), idx * 37);
        const apJitter = isPlayer ? 0 : ((nameSeed % 11) - 5) * 40;
        const spJitter = isPlayer ? 0 : (((nameSeed >> 2) % 11) - 5) * 40;
        const critJitter = isPlayer ? 0 : (((nameSeed >> 4) % 7) - 3) * 0.01;
        const baseStats = createLevel80BaseStats(assignedRole);
        const maxHp = isTankMember ? LEVEL_80_STATS.tankBaseHp : LEVEL_80_STATS.dpsHealerBaseHp;
        const maxMp = getLv80MaxMp(assignedClass, assignedRole);

        party.push({
          id: isPlayer ? 'p1_player' : member.id,
          name: assignedName,
          classId: assignedClass,
          spec: member.spec,
          role: assignedRole,
          isPlayer,
          isAlive: true,
          alive: true,
          hp: maxHp,
          maxHp,
          mp: maxMp,
          maxMp,
          energy: assignedClass === 'ROGUE' ? 100 : 0,
          rage: assignedClass === 'WARRIOR' || (assignedClass === 'DRUID' && isTankMember) ? 40 : 0,
          focus: assignedClass === 'HUNTER' ? 100 : 0,
          runicPower: assignedClass === 'DK' ? 20 : 0,
          holyPower: assignedClass === 'PALADIN' ? 1 : 0,
          absorb: 0,
          resources: [],
          buffs: [],
          threatTable: [],
          position: {
            x: isTankMember ? 440 : (isHealerMember ? 140 : 220),
            y: 160 + (idx % 5) * 20,
          },
          stats: {
            ...baseStats,
            attackPower: Math.round(baseStats.attackPower + apJitter),
            spellPower: Math.round(baseStats.spellPower + spJitter),
            critChance: Math.round((baseStats.critChance + critJitter) * 100) / 100,
            haste: LEVEL_80_MAX_HASTE,
            dodge: isTankMember ? 0.12 : (assignedClass === 'ROGUE' ? 0.08 : 0.05),
          },
        });
      });

      party.forEach(u => engine.addUnit(finalizeUnit(u)));
      setFriendlyUnits([...engine.friendlyUnits]);
      return;
    }

    const pClass: ClassId = char ? char.classId : 'DK';
    const pRole: 'TANK' | 'HEALER' | 'DPS' = char?.lastSpec ? getRoleBySpec(pClass, char.lastSpec) : 'TANK';

    // ── 20-Man Heroic Raid Composition (All 10 Cataclysm Classes · 2T · 4H · 14DPS · Lv.80 Max Haste) ──
    if (tier === '20man') {
      const party: Unit[] = [];
      const roster: Array<{
        name: string;
        classId: ClassId;
        role: 'TANK' | 'HEALER' | 'DPS';
        posX: number;
        posY: number;
      }> = [
        // Squad 1 (Main Tank & Core Melee)
        { name: '莫格莱尼', classId: 'DK', role: 'TANK', posX: 440, posY: 165 },
        { name: '乌瑟尔', classId: 'PALADIN', role: 'TANK', posX: 440, posY: 195 },
        { name: '瓦莉拉', classId: 'ROGUE', role: 'DPS', posX: 465, posY: 150 },
        { name: '瓦里安', classId: 'WARRIOR', role: 'DPS', posX: 475, posY: 210 },
        { name: '玛法里奥', classId: 'DRUID', role: 'HEALER', posX: 190, posY: 150 },

        // Squad 2 (Melee & Shaman Support)
        { name: '萨萨里安', classId: 'DK', role: 'DPS', posX: 460, posY: 130 },
        { name: '萨鲁法尔', classId: 'WARRIOR', role: 'DPS', posX: 460, posY: 230 },
        { name: '肖尔', classId: 'ROGUE', role: 'DPS', posX: 450, posY: 180 },
        { name: '萨尔', classId: 'SHAMAN', role: 'DPS', posX: 230, posY: 130 },
        { name: '先知努波顿', classId: 'SHAMAN', role: 'HEALER', posX: 190, posY: 220 },

        // Squad 3 (Casters & Priest Healer)
        { name: '吉安娜', classId: 'MAGE', role: 'DPS', posX: 240, posY: 160 },
        { name: '卡德加', classId: 'MAGE', role: 'DPS', posX: 250, posY: 200 },
        { name: '古尔丹之影', classId: 'WARLOCK', role: 'DPS', posX: 260, posY: 140 },
        { name: '威尔弗雷德', classId: 'WARLOCK', role: 'DPS', posX: 270, posY: 230 },
        { name: '安度因', classId: 'PRIEST', role: 'HEALER', posX: 180, posY: 180 },

        // Squad 4 (Hunters, Shadow Priest & Holy Paladin)
        { name: '希尔瓦娜斯', classId: 'HUNTER', role: 'DPS', posX: 280, posY: 120 },
        { name: '雷克萨', classId: 'HUNTER', role: 'DPS', posX: 290, posY: 240 },
        { name: '本尼迪塔斯', classId: 'PRIEST', role: 'DPS', posX: 300, posY: 180 },
        { name: '库尔提拉', classId: 'PALADIN', role: 'DPS', posX: 430, posY: 200 },
        { name: '莉亚德琳', classId: 'PALADIN', role: 'HEALER', posX: 200, posY: 250 },
      ];

      // Assign player to the matching role slot in Squad 1
      let playerSlotIdx = 0;
      if (pRole === 'TANK') {
        playerSlotIdx = 0;
      } else if (pRole === 'HEALER') {
        playerSlotIdx = 4;
      } else {
        playerSlotIdx = 2;
      }

      roster.forEach((member, idx) => {
        const isPlayer = idx === playerSlotIdx;
        const assignedClass = isPlayer ? pClass : member.classId;
        const assignedRole = isPlayer ? pRole : member.role;
        const assignedName = isPlayer ? (char ? char.name : '勇士') : member.name;
        const isTankMember = assignedRole === 'TANK';

        const nameSeed = assignedName.split('').reduce((acc, c) => acc + c.charCodeAt(0), idx * 37);
        const apJitter = isPlayer ? 0 : ((nameSeed % 11) - 5) * 40;
        const spJitter = isPlayer ? 0 : (((nameSeed >> 2) % 11) - 5) * 40;
        const critJitter = isPlayer ? 0 : (((nameSeed >> 4) % 7) - 3) * 0.01;
        const baseStats = createLevel80BaseStats(assignedRole);
        const maxHp = isTankMember ? LEVEL_80_STATS.tankBaseHp : LEVEL_80_STATS.dpsHealerBaseHp;
        const maxMp = getLv80MaxMp(assignedClass, assignedRole);

        party.push({
          id: isPlayer ? 'p1_player' : `ai_raid_${idx + 1}`,
          name: assignedName,
          classId: assignedClass,
          role: assignedRole,
          isPlayer,
          isAlive: true,
          alive: true,
          hp: maxHp,
          maxHp,
          mp: maxMp,
          maxMp,
          energy: assignedClass === 'ROGUE' ? 100 : 0,
          rage: assignedClass === 'WARRIOR' || (assignedClass === 'DRUID' && isTankMember) ? 40 : 0,
          focus: assignedClass === 'HUNTER' ? 100 : 0,
          runicPower: assignedClass === 'DK' ? 20 : 0,
          holyPower: assignedClass === 'PALADIN' ? 1 : 0,
          absorb: 0,
          resources: [],
          buffs: [],
          threatTable: [],
          position: { x: member.posX, y: member.posY },
          stats: {
            ...baseStats,
            attackPower: Math.round(baseStats.attackPower + apJitter),
            spellPower: Math.round(baseStats.spellPower + spJitter),
            critChance: Math.round((baseStats.critChance + critJitter) * 100) / 100,
            haste: LEVEL_80_MAX_HASTE,
          },
        });
      });

      if (pClass === 'DK' || pClass === 'MAGE' || pClass === 'HUNTER' || pClass === 'WARLOCK') {
        const petName =
          pClass === 'DK' ? '食尸鬼' :
          pClass === 'MAGE' ? '水元素' :
          pClass === 'HUNTER' ? '幽灵狼' : '恶魔卫士';
        party.push({
          id: 'player_pet',
          name: petName,
          classId: 'NPC',
          role: 'DPS',
          isPlayer: false,
          isPet: true,
          ownerId: 'p1_player',
          isAlive: true,
          alive: true,
          hp: LEVEL_80_STATS.petBaseHp,
          maxHp: LEVEL_80_STATS.petBaseHp,
          absorb: 0,
          resources: [],
          buffs: [],
          threatTable: [],
          position: { x: 220, y: 160 },
          stats: {
            ...createLevel80BaseStats('DPS'),
            attackPower: 2600,
            spellPower: 2400,
            haste: LEVEL_80_MAX_HASTE,
          },
        });
      }

      for (const u of party) {
        finalizeUnit(u);
        engine.addUnit(u);
      }
      setFriendlyUnits(party);
      return;
    }

    // ── 5-man heroic squad (Lv.80 Max-Level Max-Haste, supports ALL 10 Cataclysm classes) ──
    const playerBaseStats = createLevel80BaseStats(pRole);
    const playerMaxHp = pRole === 'TANK' ? LEVEL_80_STATS.tankBaseHp : LEVEL_80_STATS.dpsHealerBaseHp;
    const playerMaxMp = getLv80MaxMp(pClass, pRole);

    const party: Unit[] = [
      {
        id: 'p1_player',
        name: char ? char.name : '勇士',
        classId: pClass,
        role: pRole,
        isPlayer: true,
        isAlive: true,
        alive: true,
        hp: playerMaxHp,
        maxHp: playerMaxHp,
        mp: playerMaxMp,
        maxMp: playerMaxMp,
        energy: pClass === 'ROGUE' ? 100 : 0,
        rage: pClass === 'WARRIOR' || (pClass === 'DRUID' && pRole === 'TANK') ? 40 : 0,
        focus: pClass === 'HUNTER' ? 100 : 0,
        runicPower: pClass === 'DK' ? 20 : 0,
        holyPower: pClass === 'PALADIN' ? 1 : 0,
        absorb: 0,
        resources: [],
        buffs: [],
        threatTable: [],
        position: { x: pRole === 'TANK' ? 440 : 220, y: 180 },
        stats: {
          ...playerBaseStats,
          haste: LEVEL_80_MAX_HASTE,
        },
      },
    ];

    // Pick balanced, class-diverse AI party from all 10 classes (always featuring Resto Shaman when player is not Shaman/Healer)
    const TANK_POOL: Array<{ name: string; classId: ClassId }> = [
      { name: '瓦里安', classId: 'WARRIOR' },
      { name: '乌瑟尔', classId: 'PALADIN' },
      { name: '莫格莱尼', classId: 'DK' },
      { name: '布罗尔·熊皮', classId: 'DRUID' },
    ];
    const HEALER_POOL: Array<{ name: string; classId: ClassId }> = [
      { name: '先知努波顿', classId: 'SHAMAN' },
      { name: '安度因', classId: 'PRIEST' },
      { name: '玛法里奥', classId: 'DRUID' },
      { name: '莉亚德琳', classId: 'PALADIN' },
    ];
    const DPS_POOL: Array<{ name: string; classId: ClassId }> = [
      { name: '吉安娜', classId: 'MAGE' },
      { name: '希尔瓦娜斯', classId: 'HUNTER' },
      { name: '古尔丹之影', classId: 'WARLOCK' },
      { name: '瓦莉拉', classId: 'ROGUE' },
      { name: '萨尔', classId: 'SHAMAN' },
      { name: '萨鲁法尔', classId: 'WARRIOR' },
      { name: '本尼迪塔斯', classId: 'PRIEST' },
    ];

    const usedClasses = new Set<ClassId>([pClass]);
    const pickDistinct = (pool: Array<{ name: string; classId: ClassId }>) => {
      const found = pool.find(m => !usedClasses.has(m.classId)) || pool[0];
      usedClasses.add(found.classId);
      return found;
    };

    const aiTank = pRole === 'TANK' ? null : pickDistinct(TANK_POOL);
    const aiHealer = pRole === 'HEALER' ? null : pickDistinct(HEALER_POOL);
    const neededDps = pRole === 'DPS' ? 2 : 3;
    const aiDpsList: Array<{ name: string; classId: ClassId }> = [];
    for (let i = 0; i < neededDps; i++) {
      aiDpsList.push(pickDistinct(DPS_POOL));
    }

    if (aiTank) {
      const tMaxMp = getLv80MaxMp(aiTank.classId, 'TANK');
      party.push({
        id: 'ai_tank',
        name: aiTank.name,
        classId: aiTank.classId,
        role: 'TANK',
        isPlayer: false,
        isAlive: true,
        alive: true,
        hp: LEVEL_80_STATS.tankBaseHp,
        maxHp: LEVEL_80_STATS.tankBaseHp,
        mp: tMaxMp,
        maxMp: tMaxMp,
        rage: aiTank.classId === 'WARRIOR' || aiTank.classId === 'DRUID' ? 40 : 0,
        runicPower: aiTank.classId === 'DK' ? 20 : 0,
        holyPower: aiTank.classId === 'PALADIN' ? 1 : 0,
        absorb: 0,
        resources: [],
        buffs: [],
        threatTable: [],
        position: { x: 440, y: 180 },
        stats: {
          ...createLevel80BaseStats('TANK'),
          haste: LEVEL_80_MAX_HASTE,
        },
      });
    }

    if (aiHealer) {
      party.push({
        id: 'ai_healer',
        name: aiHealer.name,
        classId: aiHealer.classId,
        role: 'HEALER',
        isPlayer: false,
        isAlive: true,
        alive: true,
        hp: LEVEL_80_STATS.dpsHealerBaseHp,
        maxHp: LEVEL_80_STATS.dpsHealerBaseHp,
        mp: LEVEL_80_STATS.healerBaseMp,
        maxMp: LEVEL_80_STATS.healerBaseMp,
        holyPower: aiHealer.classId === 'PALADIN' ? 1 : 0,
        absorb: 0,
        resources: [],
        buffs: [],
        threatTable: [],
        position: { x: 200, y: 200 },
        stats: {
          ...createLevel80BaseStats('HEALER'),
          haste: LEVEL_80_MAX_HASTE,
        },
      });
    }

    aiDpsList.forEach((dps, idx) => {
      const nameSeed = dps.name.split('').reduce((acc, c) => acc + c.charCodeAt(0), idx * 41);
      const apJitter = ((nameSeed % 9) - 4) * 45;
      const spJitter = (((nameSeed >> 2) % 9) - 4) * 45;
      const critJitter = (((nameSeed >> 4) % 7) - 3) * 0.01;
      const baseStats = createLevel80BaseStats('DPS');
      const dMaxMp = getLv80MaxMp(dps.classId, 'DPS');

      party.push({
        id: `ai_dps_${idx + 1}`,
        name: dps.name,
        classId: dps.classId,
        role: 'DPS',
        isPlayer: false,
        isAlive: true,
        alive: true,
        hp: LEVEL_80_STATS.dpsHealerBaseHp,
        maxHp: LEVEL_80_STATS.dpsHealerBaseHp,
        mp: dMaxMp,
        maxMp: dMaxMp,
        energy: dps.classId === 'ROGUE' ? 100 : 0,
        rage: dps.classId === 'WARRIOR' ? 40 : 0,
        focus: dps.classId === 'HUNTER' ? 100 : 0,
        runicPower: dps.classId === 'DK' ? 20 : 0,
        holyPower: dps.classId === 'PALADIN' ? 1 : 0,
        absorb: 0,
        resources: [],
        buffs: [],
        threatTable: [],
        position: { x: 230 + idx * 30, y: 140 + idx * 30 },
        stats: {
          ...baseStats,
          attackPower: Math.round(baseStats.attackPower + apJitter),
          spellPower: Math.round(baseStats.spellPower + spJitter),
          critChance: Math.round((baseStats.critChance + critJitter) * 100) / 100,
          haste: LEVEL_80_MAX_HASTE,
        },
      });
    });

    if (pClass === 'DK' || pClass === 'MAGE' || pClass === 'HUNTER' || pClass === 'WARLOCK') {
      const petName =
        pClass === 'DK' ? '食尸鬼' :
        pClass === 'MAGE' ? '水元素' :
        pClass === 'HUNTER' ? '幽灵狼' : '恶魔卫士';
      party.push({
        id: 'player_pet',
        name: petName,
        classId: 'NPC',
        role: 'DPS',
        isPlayer: false,
        isPet: true,
        ownerId: 'p1_player',
        isAlive: true,
        alive: true,
        hp: LEVEL_80_STATS.petBaseHp,
        maxHp: LEVEL_80_STATS.petBaseHp,
        absorb: 0,
        resources: [],
        buffs: [],
        threatTable: [],
        position: { x: (pRole === 'TANK' ? 440 : 180) - 20, y: 180 },
        stats: {
          ...createLevel80BaseStats('DPS'),
          attackPower: 2600,
          spellPower: 2400,
          haste: LEVEL_80_MAX_HASTE,
        },
      });
    }

    for (const u of party) {
      finalizeUnit(u);
      engine.addUnit(u);
    }
    setFriendlyUnits(party);
  };

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
  useEffect(() => {
    let tickCount = 0;
    let reviveTimerMs = 0;

    const timer = setInterval(() => {
      const rsm = rsmRef.current;
      const engine = engineRef.current;
      if (!rsm || runPhase === 'LOBBY' || runPhase === 'SUMMARY') return;

      // Network guests: host computes combat; local tick only keeps HUD clocks if needed
      if (isNetworkGuestRef.current) {
        return;
      }

      const deltaMs = 50;
      tickCount++;

      // Apply remote player inputs on host before simulating
      if (isNetworkHostRef.current && pendingGuestInputsRef.current.length > 0) {
        const inputs = pendingGuestInputsRef.current.splice(0, pendingGuestInputsRef.current.length);
        for (const input of inputs) {
          if (input.kind === 'TARGET' && input.targetId) {
            // Guests' focus/target is host-side only for now; ignore visual target
            continue;
          }
          if (input.kind === 'CAST' && input.spellId && input.playerId) {
            const spell = engine.getSpell(input.spellId);
            const caster = engine.getUnit(input.playerId);
            if (spell && caster && caster.isAlive) {
              const targetId = input.targetId || engine.bossUnit?.id || caster.id;
              try {
                engine.castSpell(caster.id, spell.id, targetId);
              } catch {}
            }
          }
        }
      }

      rsm.tick(deltaMs);
      engine.tick(deltaMs);

      // Host broadcasts compact combat state to room guests (~10Hz)
      if (isNetworkHostRef.current && activeRoomIdRef.current && netClient.connected) {
        const now = Date.now();
        if (now - lastCombatBroadcastMsRef.current >= 100) {
          lastCombatBroadcastMsRef.current = now;
          netClient.sendCombatState({
            roomId: activeRoomIdRef.current,
            timeMs: now,
            runPhase: rsm.phase,
            bossTargetId: engine.bossUnit
              ? engine.threatManager.getCurrentTarget?.(engine.bossUnit.id) ?? null
              : null,
            units: engine.buildNetworkUnitSnapshots(),
          });
        }
      }

      // Detect wipe vote retry transition (manual vote or auto-timeout after 15s)
      if (prevRunPhaseRef.current === 'WIPE_VOTE' && rsm.phase === 'TRAVEL_RECOVERY') {
        engine.resetCooldowns();
        engine.threatManager.resetAll();
        engine.effectsManager.clearAll();
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
        approachedBossIdRef.current = null;
        setIsApproaching(false);
        setGroundEffects([]);
        setFloatingTexts([]);
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
            for (const r of u.runes) r.cooldownMs = 0;
          }
        }
        const bossConfig = rsm.getCurrentBoss();
        if (bossConfig) {
          engine.spawnBoss(bossConfig.id, bossConfig.name, bossConfig.hp);
          setBossUnit(engine.bossUnit ? { ...engine.bossUnit } : undefined);
        }
        setFriendlyUnits([...engine.friendlyUnits]);
      }

      // Boss health synchronization for room spectators
      if (activeRoomId && engine.bossUnit && rsm.phase === 'BOSS_COMBAT') {
        roomManager.updateCombatBossState(
          activeRoomId,
          engine.bossUnit.name,
          engine.bossUnit.hp,
          engine.bossUnit.maxHp,
          engine.bossUnit.id
        );
      }

      // Out-of-combat substitution check (boss killed or wipe vote retry -> TRAVEL_RECOVERY)
      if (
        (prevRunPhaseRef.current === 'BOSS_COMBAT' || prevRunPhaseRef.current === 'WIPE_VOTE') &&
        rsm.phase === 'TRAVEL_RECOVERY'
      ) {
        const targetRoomId = activeRoomId || waitingQueueRoomId;
        if (targetRoomId) {
          const subResult = roomManager.substituteOutOfCombat(targetRoomId, engine, rsm);
          if (subResult.substituted.length > 0) {
            setFriendlyUnits([...engine.friendlyUnits]);
            if (waitingQueueRoomId && currentChar && subResult.substituted.some(s => s.player.id === currentChar.id)) {
              setWaitingQueueRoomId(null);
              setActiveRoomId(targetRoomId);
              setRunPhase('TRAVEL_RECOVERY');
            }
          }
        }
      }

      prevRunPhaseRef.current = rsm.phase;

      // Check boss encounter transition for Staged Pull Approach
      if (rsm.phase === 'BOSS_COMBAT') {
        const currentBossConfig = rsm.getCurrentBoss();
        const expectedBossId = currentBossConfig?.id || 'ashbury';
        if (approachedBossIdRef.current !== expectedBossId) {
          approachedBossIdRef.current = expectedBossId;
          setIsApproaching(true);
          bossAiRef.current = new BossAI(expectedBossId, rsm.dungeon.id);
          lastBossAttackTickRef.current = 0;
          if (engine.bossUnit) {
            setFocusTargetId(engine.bossUnit.id);
          }
        }
        if (!focusTargetId && engine.bossUnit) {
          setFocusTargetId(engine.bossUnit.id);
        }
      } else {
        approachedBossIdRef.current = null;
      }

      // 1. Advance Player Cast Bar if casting or channeling
      setPlayerCast((prev) => {
        if (!prev) {
          playerCastRef.current = null;
          return null;
        }

        const player = engine.friendlyUnits.find(u => u.isPlayer);
        if (!player || (!player.isAlive && !player.alive)) {
          playerCastRef.current = null;
          clearPlayerIncomingCast();
          return null;
        }

        // 运行时目标存活与射程校验：若中途目标死亡或超出范围，施法立即中断，绝对不进CD！
        const targetId = prev.targetId || castTargetIdRef.current;
        const target = targetId
          ? (engine.bossUnit?.id === targetId ? engine.bossUnit : engine.friendlyUnits.find(u => u.id === targetId))
          : (prev.isHarmful ? engine.bossUnit : player);

        const isRevive = prev.spellId === 'revive' || prev.spellId === 'ancestral_spirit' || prev.spellId === 'rebirth';
        if (target) {
          const isTargetAlive = (target.isAlive ?? target.alive) && target.hp > 0;
          if (!isRevive && !isTargetAlive) {
            engine.effectsManager?.addFloatingText({
              targetId: player.id,
              text: '❌ 目标已死亡 (施法中断)',
              category: 'STATUS',
              isCrit: false,
            });
            playerCastRef.current = null;
            clearPlayerIncomingCast();
            return null;
          }
          if (isRevive && isTargetAlive) {
            engine.effectsManager?.addFloatingText({
              targetId: player.id,
              text: '❌ 目标不需要复活 (施法中断)',
              category: 'STATUS',
              isCrit: false,
            });
            playerCastRef.current = null;
            clearPlayerIncomingCast();
            return null;
          }

          const maxRange = prev.maxAllowedRange || 360;
          if (player.position && target.position) {
            const dist = Math.hypot(player.position.x - target.position.x, player.position.y - target.position.y);
            if (dist > maxRange) {
              engine.effectsManager?.addFloatingText({
                targetId: player.id,
                text: '❌ 目标超出范围 (施法中断)',
                category: 'STATUS',
                isCrit: false,
              });
              playerCastRef.current = null;
              clearPlayerIncomingCast();
              return null;
            }
          }
        }

        const newElapsed = prev.elapsedMs + deltaMs;
        const progress = Math.min(1, newElapsed / prev.totalMs);

        // If channeling (e.g. 宁静, 奥术飞弹, 神圣赞美诗, 苦修, 精神鞭笞, 吸取灵魂, 唤醒等), tick periodic effect
        // 注意：引导技能的资源与冷却均在起手瞬间已触发，中断后依然保持冷却；自然结束绝不重复触发冷却。
        if (prev.isChannel) {
          if (player) {
            processPlayerChannelTick(prev, newElapsed, engine, player, syncUnitResources);
          }
          if (progress >= 1) {
            const pending = pendingCastSlotRef.current;
            pendingCastSlotRef.current = null;
            if (pending !== null) {
              setTimeout(() => handleCastSlot(pending), 10);
            }
            playerCastRef.current = null;
            clearPlayerIncomingCast();
            return null;
          }
          const next = { ...prev, elapsedMs: newElapsed, progress };
          playerCastRef.current = next;
          return next;
        }

        // Standard read-bar cast completes (读条技能完成时才校验/扣除资源并进入冷却)
        if (progress >= 1) {
          let castSuccess = false;
          if (player) {
            const resCheck = prev.deferredCosts
              ? hasSufficientPlayerResources(player, prev.deferredCosts)
              : { ok: true };
            if (resCheck.ok) {
              castSuccess = resolvePlayerCast(prev.spellId, prev.totalCdMs);
              if (castSuccess) {
                if (prev.deferredCosts) {
                  deductPlayerResources(player, prev.deferredCosts, syncUnitResources);
                }
                if (prev.totalCdMs && prev.totalCdMs > 0) {
                  triggerCooldown(prev.spellId, prev.totalCdMs);
                }
              }
            } else if (resCheck.errorText) {
              window.dispatchEvent(new CustomEvent('cata_ui_error', { detail: { text: resCheck.errorText } }));
            }
          }
          const pending = pendingCastSlotRef.current;
          pendingCastSlotRef.current = null;
          if (pending !== null) {
            setTimeout(() => handleCastSlot(pending), 10);
          }
          playerCastRef.current = null;
          clearPlayerIncomingCast();
          return null;
        }
        const next = { ...prev, elapsedMs: newElapsed, progress };
        playerCastRef.current = next;
        return next;
      });

      // Decrement active player cooldowns
      setPlayerCooldowns((prev) => {
        let hasActive = false;
        const next: Record<string, { cdRemainingMs: number; totalCdMs: number }> = {};
        for (const [id, cd] of Object.entries(prev)) {
          const rem = Math.max(0, cd.cdRemainingMs - deltaMs);
          if (rem > 0) {
            next[id] = { ...cd, cdRemainingMs: rem };
            hasActive = true;
          }
        }
        if (!hasActive && Object.keys(prev).length === 0) return prev;
        return next;
      });

      // Decrement active player Global Cooldown (GCD)
      setPlayerGcdRemainingMs((prev) => Math.max(0, prev - deltaMs));

      // Advance & compute incoming heal predictions across all frames (Player & AI Teammates)
      const currentCasts: Record<string, { spellName: string; progress: number }> = {};
      const currentHeals: Record<string, number> = {};
      const currentIncomingCasts: Record<string, IncomingHealCast[]> = {};

      const addIncomingCast = (targetId: string, cast: IncomingHealCast) => {
        if (!currentIncomingCasts[targetId]) currentIncomingCasts[targetId] = [];
        currentIncomingCasts[targetId].push(cast);
        currentHeals[targetId] = (currentHeals[targetId] || 0) + cast.amount;
      };

      // 1. Add player's active healing cast (works in ALL encounter & lobby phases!)
      const activePlayerCast = playerCastRef.current;
      if (activePlayerCast && !activePlayerCast.isHarmful && !activePlayerCast.isChannel) {
        const pTargetId = activePlayerCast.targetId || castTargetIdRef.current;
        if (pTargetId) {
          const pTarget = engine.friendlyUnits.find(u => u.id === pTargetId);
          if (pTarget && (pTarget.alive || pTarget.isAlive) && pTarget.hp > 0) {
            const pUnit = engine.friendlyUnits.find(u => u.isPlayer);
            const pAmt = getPredictedHealAmount(activePlayerCast.spellId, pUnit);
            if (pAmt > 0) {
              addIncomingCast(pTargetId, {
                casterId: pUnit?.id || 'p1_player',
                casterName: pUnit?.name || '勇士',
                spellName: activePlayerCast.spellName,
                amount: pAmt,
                progress: activePlayerCast.progress,
                classId: pUnit?.classId || 'DRUID',
              });
            }
          }
        }
      }

      // Lord Walden Green Potion Check: must keep moving, standing still > 1500ms deals poison
      if (rsm.phase === 'BOSS_COMBAT' && !isApproaching) {
        const player = engine.friendlyUnits.find(u => u.isPlayer);
        if (player && (player.isAlive || player.alive) && player.buffs.some(b => b.spellId === 'toxic_catalyst')) {
          if (Date.now() - lastPlayerMoveMsRef.current > 1500 && tickCount % 20 === 0) {
            engine.dealDamage(engine.bossUnit || player, player, 4500, 'NATURE', false);
            engine.effectsManager?.addFloatingText({
              targetId: player.id,
              text: '绿色药剂毒素！请保持走动！-4,500',
              category: 'SPELL_NATURE',
              isCrit: false,
            });
          }
        }
      }

      // 2. Combat phase logic: Threat Table, BossAI, Mana Regen & AI Rotations
      if (rsm.phase === 'BOSS_COMBAT' && !isApproaching) {
        // ── Lv.80 Max-Haste In-Combat Resource Regen (All 10 Classes) ──
        const is20ManRaid = engine.friendlyUnits.length > 5;
        for (const u of engine.friendlyUnits) {
          if (u.alive || u.isAlive) {
            const haste = u.stats?.haste ?? LEVEL_80_MAX_HASTE;
            if (u.maxMp && u.maxMp > 0) {
              const hasInnervate = u.buffs?.some(b => b.spellId === 'innervate');
              const hasManaTide = u.buffs?.some(b => b.spellId === 'mana_tide' || b.spellId === 'mana_tide_totem');
              const hasDivinePlea = u.buffs?.some(b => b.spellId === 'divine_plea' || b.spellId === 'shadowfiend');
              const baseRegenRate = is20ManRaid ? 0.0085 : 0.0095;
              let regenPctPerSec = baseRegenRate;
              if (hasInnervate) regenPctPerSec += 0.05;
              if (hasManaTide) regenPctPerSec += 0.035;
              if (hasDivinePlea) regenPctPerSec += 0.035;
              const regenAmt = (u.maxMp * regenPctPerSec * deltaMs) / 1000;
              u.mp = Math.min(u.maxMp, (u.mp ?? 0) + regenAmt);
            }
            if (u.classId === 'ROGUE') {
              const hasAdrenaline = u.buffs?.some(b => b.spellId === 'adrenaline_rush');
              const baseRate = 10 * (1 + haste);
              const regenRate = hasAdrenaline ? baseRate * 2 : baseRate;
              u.energy = Math.min(100, (u.energy ?? 100) + (regenRate * deltaMs) / 1000);
            } else if (u.classId === 'WARRIOR' || (u.classId === 'DRUID' && u.role === 'TANK')) {
              u.rage = Math.min(100, (u.rage ?? 30) + (7 * deltaMs) / 1000);
            } else if (u.classId === 'HUNTER') {
              const focusRate = 6.5 * (1 + haste);
              u.focus = Math.min(100, (u.focus ?? 100) + (focusRate * deltaMs) / 1000);
            } else if (u.classId === 'DK') {
              u.runicPower = Math.min(100, (u.runicPower ?? 20) + (5.5 * deltaMs) / 1000);
            }
            syncUnitResources(u);
          }
        }

        const boss = engine.bossUnit;
        const livingEnemies = engine.enemyUnits.filter(e => (e.isAlive ?? e.alive) && e.hp > 0);
        if (boss && (boss.isAlive || boss.alive) && boss.hp > 0) {
          // Sync stationary-casting info to boss unit so CombatCanvas can freeze movement during casts
          (boss as any).isCasting = Boolean(
            bossAiRef.current?.currentCasting && bossAiRef.current.currentCasting.skill.castTimeMs > 0
          );
          (boss as any).castingSpellName = bossAiRef.current?.currentCasting?.skill.name;
          (boss as any).castProgress = bossAiRef.current?.currentCasting
            ? bossAiRef.current.currentCasting.elapsedMs / bossAiRef.current.currentCasting.skill.castTimeMs
            : 0;

          // Tick authentic Boss AI abilities
          if (bossAiRef.current) {
            bossAiRef.current.tick(deltaMs, boss, engine);
          }

          // Resolve authentic boss target (OT detection)
          const targetId = engine.getBossTargetId();
          setBossTargetId(targetId || null);

          // Shared helper: deduct resource from an AI unit based on resource kind
          const deductAiResource = (unit: Unit, kind: string | undefined, amount: number): boolean => {
            if (!amount || amount <= 0 || !kind || kind === 'NONE' || kind === 'RUNE' || kind === 'COMBO_POINTS') {
              return true;
            }
            if (kind === 'MANA') {
              if ((unit.mp ?? 0) < amount) return false;
              unit.mp = Math.max(0, (unit.mp ?? 0) - amount);
            } else if (kind === 'ENERGY') {
              if ((unit.energy ?? 100) < amount) return false;
              unit.energy = Math.max(0, (unit.energy ?? 100) - amount);
            } else if (kind === 'RAGE') {
              if ((unit.rage ?? 0) < amount) return false;
              unit.rage = Math.max(0, (unit.rage ?? 0) - amount);
            } else if (kind === 'FOCUS') {
              if ((unit.focus ?? 100) < amount) return false;
              unit.focus = Math.max(0, (unit.focus ?? 100) - amount);
            } else if (kind === 'RUNIC_POWER') {
              if ((unit.runicPower ?? 0) < amount) return false;
              unit.runicPower = Math.max(0, (unit.runicPower ?? 0) - amount);
            } else if (kind === 'HOLY_POWER') {
              if ((unit.holyPower ?? 0) < amount) return false;
              unit.holyPower = Math.max(0, (unit.holyPower ?? 0) - amount);
            }
            syncUnitResources(unit);
            return true;
          };

          // Shared helper: execute any NormalizedSpell generically for an AI unit (ZERO per-class branching!)
          const executeAiNormalizedSpell = (
            u: Unit,
            sp: NormalizedSpell,
            targetUnit: Unit | null,
            individualMod: number,
            critMod: number,
            pauseThreat: boolean = false
          ) => {
            const isCrit = Math.random() < ((u.stats.critChance || 0.25) + critMod);
            const livingAllies = engine.friendlyUnits.filter(a => (a.alive || a.isAlive) && a.hp > 0);
            const activeEnemies = livingEnemies.length > 0 ? livingEnemies : [boss];

            // Resource builders (Paladin Holy Power / Warrior Rage / DK Runic Power)
            if (u.classId === 'PALADIN' && sp.resourceKind !== 'HOLY_POWER' && !sp.isDefensive && !sp.isTaunt && !sp.isInterrupt) {
              u.holyPower = Math.min(3, (u.holyPower ?? 0) + 1);
            } else if (u.classId === 'WARRIOR' && sp.resourceCostAmount === 0) {
              u.rage = Math.min(100, (u.rage ?? 0) + 15);
            } else if (u.classId === 'DK' && sp.resourceKind !== 'RUNIC_POWER') {
              u.runicPower = Math.min(100, (u.runicPower ?? 0) + 15);
            }
            syncUnitResources(u);

            // 通用 Buff / Buff+Heal（数据驱动：大地之盾、生命释放、升腾、先祖指引、圣光道标等）
            // 新技能只要在 ClassRegistry 标 isBuff/targetType/maxStacks/directHeal，即可自动执行，无需再写 spellId 分支
            if (sp.isBuff && !sp.isDamage) {
              const isSelfBuff = sp.targetType === 'SELF';
              const isEnemyBuff = sp.targetType === 'SINGLE_ENEMY' || sp.targetType === 'AOE_ENEMY';
              const allyTarget = targetUnit && (targetUnit.alive || targetUnit.isAlive) && targetUnit.hp > 0
                ? targetUnit
                : livingAllies.sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0] || u;
              const enemyTarget = targetUnit && engine.enemyUnits.some(e => e.id === targetUnit.id)
                ? targetUnit
                : activeEnemies[0] || boss;
              const buffTarget = isSelfBuff ? u : isEnemyBuff ? enemyTarget : allyTarget;
              const auraSpellId = sp.auraId || sp.shortId;
              const stacks = Math.max(1, sp.maxStacks || 1);
              const isStackedShield = stacks > 1 && (sp.targetType === 'SINGLE_ALLY' || sp.targetType === 'SMART_ALLY');

              // Buff+直疗（如生命释放）：先结算治疗
              if (sp.isHeal && sp.directHeal > 0 && !isSelfBuff && !isEnemyBuff) {
                const healAmt = rollAiHeal(u, sp.directHeal, isCrit);
                engine.healUnit(u, allyTarget, healAmt, isCrit, sp.name);
              }

              // 「友方直疗 + 自身下一口增效」类 Buff 挂在施法者；叠层护盾/道标挂在友方；自身大招挂自己
              const nextHealAmpOnCaster =
                sp.isHeal &&
                sp.directHeal > 0 &&
                !isSelfBuff &&
                !isEnemyBuff &&
                stacks === 1 &&
                Boolean(sp.auraId);
              const finalAuraTarget = nextHealAmpOnCaster ? u : buffTarget;

              engine.applyBuff(finalAuraTarget, {
                id: `${auraSpellId}_ai_${Date.now()}_${finalAuraTarget.id}`,
                spellId: auraSpellId,
                name: isStackedShield ? `${sp.name} (${stacks}层)` : sp.name,
                kind: isEnemyBuff ? 'DEBUFF' : 'BUFF',
                tags: isStackedShield ? ['SHIELD'] : ['STAT'],
                sourceUnitId: u.id,
                targetUnitId: finalAuraTarget.id,
                stacks,
                maxStacks: stacks,
                durationMs: Math.max(8000, sp.durationMs || 15000),
                remainingMs: Math.max(8000, sp.durationMs || 15000),
                school: sp.school,
              });
              return;
            }

            if (sp.isHeal || sp.isShield) {
              const primaryTarget = targetUnit && (targetUnit.alive || targetUnit.isAlive) && targetUnit.hp > 0
                ? targetUnit
                : livingAllies.sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0] || u;

              // Ground heal zone (Healing Rain / Healing Tide / Mana Tide / Spirit Link / PW:Barrier)
              if (
                sp.shortId === 'healing_rain' ||
                sp.shortId === 'spirit_link_totem' ||
                sp.shortId === 'spirit_link' ||
                sp.shortId === 'healing_tide' ||
                sp.shortId === 'healing_tide_totem' ||
                sp.shortId === 'mana_tide' ||
                sp.shortId === 'mana_tide_totem' ||
                sp.shortId === 'power_word_barrier'
              ) {
                const centroid = findOptimalGroundAuraCentroid(u, livingAllies, 55, 360);
                const isHealingTide = sp.shortId.includes('healing_tide');
                const isManaTide = sp.shortId.includes('mana_tide');
                const isSpiritLink = sp.shortId.includes('spirit_link') || sp.shortId === 'power_word_barrier';
                const isTotem = isHealingTide || isManaTide || isSpiritLink;
                engine.effectsManager?.addGroundEffect({
                  id: `${sp.shortId}_ai_${Date.now()}_${u.id}`,
                  kind: isHealingTide ? 'TOTEM' : isTotem ? 'TOTEM' : 'HEAL_ZONE',
                  spellId: sp.shortId === 'spirit_link_totem' ? 'spirit_link' : (isHealingTide ? 'healing_tide' : sp.shortId),
                  ownerId: u.id,
                  x: centroid.x,
                  y: centroid.y,
                  radius: isTotem ? 70 : 58,
                  colorHex: sp.shortId === 'power_word_barrier'
                    ? '#FACC15'
                    : isHealingTide
                    ? '#0EA5E9'
                    : isManaTide
                    ? '#56CCF2'
                    : isTotem
                    ? '#00CED1'
                    : '#4169E1',
                  remainingMs: isHealingTide ? 10000 : isManaTide ? 12000 : isSpiritLink ? 6000 : 10000,
                  tickIntervalMs: isHealingTide ? 2000 : isManaTide ? 5000 : 1000,
                  tickElapsedMs: 0,
                  tickValue: Math.round(
                    (isHealingTide
                      ? Math.max(5200, (sp.hotTotalHeal || 26000) / 5)
                      : Math.max(1600, (sp.directHeal || sp.hotTotalHeal * 0.25) * 0.4)) * individualMod
                  ),
                });
                if (isManaTide) {
                  for (const a of livingAllies) {
                    engine.applyBuff(a, {
                      id: `mana_tide_ai_${Date.now()}_${a.id}`,
                      spellId: 'mana_tide',
                      name: '法力之潮',
                      kind: 'BUFF',
                      tags: ['STAT'],
                      sourceUnitId: u.id,
                      targetUnitId: a.id,
                      stacks: 1,
                      maxStacks: 1,
                      durationMs: 12000,
                      remainingMs: 12000,
                      school: 'NATURE',
                    });
                  }
                }
                if (isSpiritLink && livingAllies.length > 1) {
                  // Spirit Link / Barrier immediately stabilizes raid HP toward average + small heal
                  const avgPct = livingAllies.reduce((sum, a) => sum + a.hp / a.maxHp, 0) / livingAllies.length;
                  for (const a of livingAllies) {
                    const desiredHp = Math.round(a.maxHp * Math.min(1, avgPct + 0.08));
                    if (desiredHp > a.hp) {
                      engine.healUnit(u, a, desiredHp - a.hp, false, sp.name);
                    }
                  }
                }
                return;
              }

              // AoE Heals (Chain Heal smart bounce, Wild Growth HoT, Circle/Prayer of Healing, Light of Dawn, Tranquility, Divine Hymn)
              if (sp.isAOE) {
                const maxTargets = Math.max(3, sp.maxAoeTargets || 4);
                const woundedAllies = [...livingAllies]
                  .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))
                  .slice(0, maxTargets);

                if (sp.shortId === 'chain_heal') {
                  let jumpAmt = rollAiHeal(u, Math.max(4800, sp.directHeal), isCrit);
                  woundedAllies.forEach((ally, idx) => {
                    const bCrit = idx === 0 ? isCrit : Math.random() < ((u.stats.critChance || 0.22) + critMod);
                    const amt = Math.round(jumpAmt * (idx === 0 ? 1 : (bCrit ? 1.5 : 1)));
                    engine.healUnit(u, ally, amt, bCrit, idx === 0 ? sp.name : `${sp.name}(第${idx + 1}跳)`);
                    jumpAmt *= 0.85;
                  });
                  return;
                }

                for (const ally of woundedAllies) {
                  const allyCrit = Math.random() < ((u.stats.critChance || 0.22) + critMod);
                  const perTargetBase = Math.max(2400, sp.directHeal || sp.hotTotalHeal * 0.45);
                  const healAmt = rollAiHeal(u, perTargetBase, allyCrit);
                  engine.healUnit(u, ally, healAmt, allyCrit, sp.name);
                  if (sp.isHot && sp.hotTotalHeal > 0) {
                    engine.applyBuff(ally, {
                      id: `${sp.shortId}_ai_${Date.now()}_${ally.id}_${u.id}`,
                      spellId: sp.shortId,
                      name: `${sp.name} (HoT)`,
                      kind: 'BUFF',
                      tags: ['HOT'],
                      sourceUnitId: u.id,
                      targetUnitId: ally.id,
                      stacks: 1,
                      maxStacks: 1,
                      durationMs: 8000,
                      remainingMs: 8000,
                      school: sp.school,
                      tickIntervalMs: 2000,
                      tickValue: Math.round((sp.hotTotalHeal / 4) * individualMod),
                    });
                  }
                }
                return;
              }

              // Shield spells (Power Word: Shield)
              if (sp.isShield) {
                const shieldAmt = Math.round(Math.max(6500, sp.shieldValue || sp.directHeal) * individualMod);
                primaryTarget.absorb = Math.min(primaryTarget.maxHp * 0.5, (primaryTarget.absorb || 0) + shieldAmt);
                engine.applyBuff(primaryTarget, {
                  id: `${sp.shortId}_ai_${Date.now()}_${primaryTarget.id}`,
                  spellId: sp.shortId,
                  name: sp.name,
                  kind: 'BUFF',
                  tags: ['SHIELD'],
                  sourceUnitId: u.id,
                  targetUnitId: primaryTarget.id,
                  stacks: 1,
                  maxStacks: 1,
                  durationMs: 15000,
                  remainingMs: 15000,
                  school: sp.school,
                });
                engine.effectsManager?.addFloatingText({
                  targetId: primaryTarget.id,
                  text: `🛡️ ${sp.name} (+${shieldAmt})`,
                  category: 'HEAL',
                  isCrit: false,
                });
                return;
              }

              // Single-target direct heal and/or HoT
              if (sp.directHeal > 0) {
                const healAmt = rollAiHeal(u, sp.directHeal, isCrit);
                engine.healUnit(u, primaryTarget, healAmt, isCrit, sp.name);
                if (u.classId === 'DRUID' && ['nourish', 'healing_touch', 'regrowth'].includes(sp.shortId)) {
                  engine.refreshLifebloom(primaryTarget, u.id);
                }
              }
              if (sp.isHot && sp.hotTotalHeal > 0) {
                const existingLb = sp.shortId === 'lifebloom'
                  ? primaryTarget.buffs.find(b => b.spellId === 'lifebloom' && b.sourceUnitId === u.id)
                  : undefined;
                const stacks = sp.shortId === 'lifebloom' ? Math.min(3, (existingLb?.stacks || 0) + 1) : 1;
                engine.applyBuff(primaryTarget, {
                  id: `${sp.shortId}_ai_${Date.now()}_${primaryTarget.id}_${u.id}`,
                  spellId: sp.shortId,
                  name: stacks > 1 ? `${sp.name} (${stacks}层)` : `${sp.name} (HoT)`,
                  kind: 'BUFF',
                  tags: ['HOT'],
                  sourceUnitId: u.id,
                  targetUnitId: primaryTarget.id,
                  stacks,
                  maxStacks: sp.shortId === 'lifebloom' ? 3 : 1,
                  durationMs: 12000,
                  remainingMs: 12000,
                  school: sp.school,
                  tickIntervalMs: 3000,
                  tickValue: Math.round((sp.hotTotalHeal / 4) * individualMod),
                });
              }
              return;
            }

            // Damage / Tank attack spells (AoE or ST)
            if (sp.isAOE) {
              const targets = activeEnemies.slice(0, Math.max(3, sp.maxAoeTargets || 5));
              for (const enemy of targets) {
                const tCrit = Math.random() < ((u.stats.critChance || 0.25) + critMod);
                const baseD = Math.max(2600, sp.directDamage || sp.dotTotalDamage * 0.5);
                const dmg = rollAiDamage(u, baseD, sp.school, tCrit);
                engine.dealDamage(u, enemy, dmg, sp.school, tCrit, sp.name);
                if (u.role === 'TANK') {
                  engine.threatManager.addThreat(enemy.id, u.id, pauseThreat ? 500 : Math.round(dmg * 3.5));
                }
              }
              return;
            }

            const enemyTarget = targetUnit && (targetUnit.alive || targetUnit.isAlive) && targetUnit.hp > 0 && engine.enemyUnits.some(e => e.id === targetUnit.id)
              ? targetUnit
              : boss;

            const baseD = Math.max(2800, sp.directDamage || sp.dotTotalDamage * 0.35);
            const dmg = rollAiDamage(u, baseD, sp.school, isCrit);
            engine.dealDamage(u, enemyTarget, dmg, sp.school, isCrit, sp.name);

            if (u.role === 'TANK') {
              engine.threatManager.addThreat(enemyTarget.id, u.id, pauseThreat ? 500 : Math.round(dmg * 3.8));
              // Self-sustain tank skills (e.g., Death Strike / Victory Rush / Word of Glory)
              if (sp.shortId === 'death_strike') {
                const selfHeal = Math.round(4200 * individualMod);
                engine.healUnit(u, u, selfHeal, false, sp.name);
                u.absorb = Math.min(u.maxHp * 0.35, (u.absorb || 0) + Math.round(selfHeal * 0.6));
              }
            }

            if (sp.isDot && sp.dotTotalDamage > 0) {
              engine.applyBuff(enemyTarget, {
                id: `${sp.shortId}_ai_${Date.now()}_${u.id}`,
                spellId: sp.shortId,
                name: `${sp.name} (DoT)`,
                kind: 'DEBUFF',
                tags: ['DOT'],
                sourceUnitId: u.id,
                targetUnitId: enemyTarget.id,
                stacks: 1,
                maxStacks: 1,
                durationMs: 15000,
                remainingMs: 15000,
                school: sp.school,
                tickIntervalMs: 3000,
                tickValue: Math.round((sp.dotTotalDamage / 5) * individualMod),
              });
            }
          };

          // ── Universal AI Loop across ALL Friendly AI Units (All 10 Classes & 30 Specs) ──
          const nowMs = Date.now();
          for (const u of engine.friendlyUnits) {
            if ((!u.isAlive && !u.alive) || u.isPlayer || u.isPet) continue;

            const { tickOffset, individualMod, critMod } = getUnitPersonality(u);
            const aiPersonality = getUnitAIPersonality(u);
            const specId = inferAiSpecForUnit(u);
            const ownedSpells = getSpellsForClassSpec(u.classId, specId);

            // 1. CC / Stun / Movement cast-interruption check
            const isCcOrInterrupted = u.buffs?.some(b =>
              b.tags?.includes('CC') || (b.tags as any)?.includes('STUN') || (b.tags as any)?.includes('SILENCE')
            );
            if (isCcOrInterrupted || (u as any).isMoving) {
              if (aiHealerCastsRef.current[u.id]) {
                delete aiHealerCastsRef.current[u.id];
                engine.effectsManager?.addFloatingText({
                  targetId: u.id,
                  text: (u as any).isMoving ? `${u.name} 移动打断施法` : `${u.name} 施法被中断`,
                  category: 'STATUS',
                  isCrit: false,
                });
              }
              continue;
            }

            // 2. Universal Interrupt Check (any AI owning an off-CD interrupt stops Boss interruptible casts)
            const bossCasting = bossAiRef.current?.currentCasting;
            const shouldInterruptBoss = bossCasting?.skill.interruptible && (
              bossCasting.skill.id !== 'stay_of_execution' || bossCasting.elapsedMs >= 3000
            );
            if (shouldInterruptBoss && (tickCount + tickOffset) % 16 === 0) {
              const interruptSp = ownedSpells.find(
                sp => sp.isInterrupt && isAiCdReady(u.id, sp.shortId, sp.cooldownMs || 10000)
              );
              if (interruptSp && deductAiResource(u, interruptSp.resourceKind, interruptSp.resourceCostAmount)) {
                const success = bossAiRef.current!.interruptCurrentCast();
                if (success) {
                  markAiCdUsed(u.id, interruptSp.shortId);
                  if (u.combatStats) u.combatStats.interruptCount++;
                  engine.effectsManager?.addFloatingText({
                    targetId: boss.id,
                    text: `${u.name} ${interruptSp.name}打断！`,
                    category: 'INTERRUPT',
                    isCrit: true,
                  });
                }
              }
            }

            // 3. Universal Resource Restore CD Check (Innervate, Mana Tide, Divine Plea, Shadowfiend, Evocation, Life Tap, Adrenaline Rush)
            if ((tickCount + tickOffset) % 20 === 0) {
              const primaryRes = getClassPrimaryResource(u.classId, specId);
              const curRes = getUnitResourceAmount(u, primaryRes);
              const maxRes = primaryRes === 'MANA' ? (u.maxMp || LEVEL_80_STATS.casterBaseMp) : 100;
              const resRatio = maxRes > 0 ? curRes / maxRes : 1;
              const threshold = primaryRes === 'ENERGY' ? (aiPersonality.energyReserveThreshold / 100) : aiPersonality.resourceHealthyThreshold;
              if (resRatio < threshold) {
                const restoreSp = ownedSpells.find(
                  sp => sp.isResourceRestore && isAiCdReady(u.id, sp.shortId, sp.cooldownMs || 60000)
                );
                if (restoreSp) {
                  markAiCdUsed(u.id, restoreSp.shortId);
                  if (primaryRes === 'MANA' && u.maxMp) {
                    const instantRestore = Math.round(u.maxMp * 0.25);
                    u.mp = Math.min(u.maxMp, (u.mp ?? 0) + instantRestore);
                    syncUnitResources(u);
                    const buffTargets = restoreSp.isAOE ? engine.friendlyUnits.filter(a => a.alive || a.isAlive) : [u];
                    for (const bt of buffTargets) {
                      engine.applyBuff(bt, {
                        id: `${restoreSp.shortId}_ai_${Date.now()}_${bt.id}`,
                        spellId: restoreSp.shortId,
                        name: `${restoreSp.name} (+回蓝)`,
                        kind: 'BUFF',
                        tags: ['STAT'],
                        sourceUnitId: u.id,
                        targetUnitId: bt.id,
                        stacks: 1,
                        maxStacks: 1,
                        durationMs: 10000,
                        remainingMs: 10000,
                        school: restoreSp.school,
                      });
                    }
                  } else if (primaryRes === 'ENERGY') {
                    engine.applyBuff(u, {
                      id: `${restoreSp.shortId}_ai_${Date.now()}_${u.id}`,
                      spellId: restoreSp.shortId,
                      name: `${restoreSp.name} (回能+100%)`,
                      kind: 'BUFF',
                      tags: ['STAT'],
                      sourceUnitId: u.id,
                      targetUnitId: u.id,
                      stacks: 1,
                      maxStacks: 1,
                      durationMs: 15000,
                      remainingMs: 15000,
                      school: restoreSp.school,
                    });
                  }
                  engine.effectsManager?.addFloatingText({
                    targetId: u.id,
                    text: `${u.name} 施放【${restoreSp.name}】恢复资源！`,
                    category: 'HEAL',
                    isCrit: true,
                  });
                }
              }
            }

            // 4. Universal Battle-Rez Check (any AI owning an off-CD combat rez revives fallen allies)
            const deadAlly = engine.friendlyUnits.find(a => (!a.alive || !a.isAlive) || a.hp <= 0);
            if (deadAlly && (tickCount + tickOffset) % 30 === 0) {
              const bRezSp = ownedSpells.find(
                sp => sp.isResurrect && !sp.isOutOfCombatOnly && isAiCdReady(u.id, sp.shortId, sp.cooldownMs || 600000)
              );
              if (bRezSp && deductAiResource(u, bRezSp.resourceKind, bRezSp.resourceCostAmount)) {
                markAiCdUsed(u.id, bRezSp.shortId);
                engine.resurrectUnit(deadAlly.id, 0.6, 0.6);
                engine.effectsManager?.addFloatingText({
                  targetId: deadAlly.id,
                  text: `⚡ ${u.name} 施放【${bRezSp.name}】战复了 ${deadAlly.name}！`,
                  category: 'HEAL',
                  isCrit: true,
                });
              }
            }

            // 5. Tank Threat, Taunt & Defensive Cooldown Checks (Universal across Warrior/Paladin/DK/Druid Tanks)
            let tankPauseThreat = false;
            if (u.role === 'TANK') {
              const allTanks = engine.friendlyUnits.filter(t => t.role === 'TANK' && (t.isAlive ?? t.alive));
              const threatDecision = evaluateTankThreatDecision(u, allTanks, targetId, targetId === u.id);
              tankPauseThreat = threatDecision.pauseThreat;

              if (threatDecision.shouldTaunt && (tickCount + tickOffset) % 12 === 0) {
                const tauntSp = ownedSpells.find(sp => sp.isTaunt && isAiCdReady(u.id, sp.shortId, sp.cooldownMs || 8000));
                if (tauntSp) {
                  markAiCdUsed(u.id, tauntSp.shortId);
                  engine.threatManager.applyTaunt(boss.id, u.id);
                  engine.effectsManager?.addFloatingText({
                    targetId: boss.id,
                    text: `${u.name} ${tauntSp.name}嘲讽接怪！`,
                    category: 'CRIT',
                    isCrit: true,
                  });
                }
              }

              if (u.hp / u.maxHp < 0.52 && (tickCount + tickOffset) % 15 === 0) {
                const defSp = ownedSpells.find(
                  sp => sp.isDefensive && isAiCdReady(u.id, sp.shortId, sp.cooldownMs || 60000)
                );
                if (defSp) {
                  markAiCdUsed(u.id, defSp.shortId);
                  u.absorb = Math.min(u.maxHp * 0.4, (u.absorb || 0) + Math.round(u.maxHp * 0.14));
                  engine.applyBuff(u, {
                    id: `${defSp.shortId}_ai_${Date.now()}_${u.id}`,
                    spellId: defSp.shortId,
                    name: `${defSp.name} (减伤)`,
                    kind: 'BUFF',
                    tags: ['SHIELD'],
                    sourceUnitId: u.id,
                    targetUnitId: u.id,
                    stacks: 1,
                    maxStacks: 1,
                    durationMs: 10000,
                    remainingMs: 10000,
                    school: defSp.school,
                  });
                  engine.effectsManager?.addFloatingText({
                    targetId: u.id,
                    text: `🛡️ ${u.name} 开启【${defSp.name}】！`,
                    category: 'HEAL',
                    isCrit: true,
                  });
                }
              }
            }

            // 6. Advance Ongoing Read-Bar Cast (for BOTH Healer AND Caster DPS)
            let activeAiCast = aiHealerCastsRef.current[u.id];
            if (activeAiCast) {
              const targetUnit = activeAiCast.isHarmful
                ? engine.enemyUnits.find(e => e.id === activeAiCast.targetId) || boss
                : engine.friendlyUnits.find(a => a.id === activeAiCast.targetId);
              if (!targetUnit || (!targetUnit.alive && !targetUnit.isAlive) || targetUnit.hp <= 0) {
                delete aiHealerCastsRef.current[u.id];
                activeAiCast = undefined as any;
              }
            }

            if (activeAiCast) {
              activeAiCast.elapsedMs += deltaMs;
              const progress = Math.min(1, activeAiCast.elapsedMs / Math.max(100, activeAiCast.totalMs));
              if (progress >= 1) {
                delete aiHealerCastsRef.current[u.id];
                const sp = activeAiCast.normalizedSpell || getSpellByAnyId(activeAiCast.spellId, u.classId);
                const targetUnit = activeAiCast.isHarmful
                  ? engine.enemyUnits.find(e => e.id === activeAiCast.targetId) || boss
                  : engine.friendlyUnits.find(a => a.id === activeAiCast.targetId);
                if (sp && targetUnit && (targetUnit.alive || targetUnit.isAlive) && targetUnit.hp > 0) {
                  if (deductAiResource(u, activeAiCast.resourceKind || sp.resourceKind, activeAiCast.manaCost)) {
                    if (sp.cooldownMs > 0) markAiCdUsed(u.id, sp.shortId);
                    executeAiNormalizedSpell(u, sp, targetUnit, individualMod, critMod, tankPauseThreat);
                  }
                }
              } else {
                currentCasts[u.id] = { spellName: activeAiCast.spellName, progress };
                if (!activeAiCast.isHarmful) {
                  addIncomingCast(activeAiCast.targetId, {
                    casterId: u.id,
                    casterName: u.name,
                    spellName: activeAiCast.spellName,
                    amount: activeAiCast.amount,
                    progress,
                    classId: u.classId,
                  });
                }
              }
              continue;
            }

            // 7. Per-Unit Effective GCD Check (Lv.80 max haste: >= 1000ms NORMAL / 1000ms ROGUE)
            const unitGcdMs = getEffectiveGcdMs(u.classId === 'ROGUE' || u.classId === 'HUNTER' ? 'ROGUE' : 'NORMAL', u.stats.haste ?? LEVEL_80_MAX_HASTE);
            const lastGcdTime = aiCooldownsRef.current[`${u.id}_gcd`] || 0;
            if (nowMs - lastGcdTime < unitGcdMs) continue;

            // 8. Build Usable Candidates Dynamically from Unit's Owned Available Skills & Evaluate Universal Rules
            const roleFilter: 'HEAL' | 'DAMAGE' = u.role === 'HEALER' ? 'HEAL' : 'DAMAGE';
            const usableCandidates = buildUsableCandidatesForUnit(
              u,
              specId,
              (sp) => isAiCdReady(u.id, sp.shortId, sp.cooldownMs),
              { roleFilter, useShortId: true }
            );

            const decision = evaluateUniversalAIDecision({
              caster: u,
              personality: aiPersonality,
              allies: engine.friendlyUnits,
              enemies: livingEnemies.length > 0 ? livingEnemies : [boss],
              usableSkills: usableCandidates,
              tickCount,
            });

            if (decision.chosenCandidate) {
              const chosen = decision.chosenCandidate;
              const normSp = getSpellByAnyId(chosen.spellId, u.classId);
              if (!normSp) continue;

              const targetUnit = decision.targetUnit || (roleFilter === 'HEAL'
                ? [...engine.friendlyUnits].filter(a => (a.alive || a.isAlive) && a.hp > 0).sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0] || u
                : boss);

              const hastedCastMs = chosen.castMs > 0 ? chosen.castMs : 0;

              // Commit AI GCD start timestamp
              aiCooldownsRef.current[`${u.id}_gcd`] = nowMs;

              if (hastedCastMs <= 0) {
                if (deductAiResource(u, normSp.resourceKind, chosen.cost)) {
                  if (normSp.cooldownMs > 0) markAiCdUsed(u.id, normSp.shortId);
                  executeAiNormalizedSpell(u, normSp, targetUnit, individualMod, critMod, tankPauseThreat);
                }
              } else {
                const preVal = Math.round(chosen.baseAmt * individualMod);
                const isHarmful = !normSp.isHeal && !normSp.isShield;
                aiHealerCastsRef.current[u.id] = {
                  targetId: targetUnit.id,
                  spellId: chosen.spellId,
                  spellName: chosen.spellName,
                  amount: preVal,
                  baseAmt: chosen.baseAmt,
                  manaCost: chosen.cost,
                  resourceKind: normSp.resourceKind,
                  totalMs: hastedCastMs,
                  elapsedMs: 0,
                  isHarmful,
                  isAOE: chosen.isAOE,
                  maxTargets: chosen.maxTargets,
                  school: normSp.school,
                  normalizedSpell: normSp,
                };
                currentCasts[u.id] = { spellName: chosen.spellName, progress: 0 };
                if (!isHarmful) {
                  addIncomingCast(targetUnit.id, {
                    casterId: u.id,
                    casterName: u.name,
                    spellName: chosen.spellName,
                    amount: preVal,
                    progress: 0,
                    classId: u.classId,
                  });
                }
              }
            } else if ((tickCount + tickOffset) % 60 === 0 && u.maxMp && u.maxMp > 0 && (u.mp ?? 0) < 1200) {
              notifyOom(u, engine);
            }
          }

          const is20Man = engine.friendlyUnits.length > 5;

          // 判定首领当前是否处于窒息术后安全治疗窗口或行动锁定状态
          const isBossDamageLocked = Boolean(
            bossAiRef.current?.isActionLocked() || engine.isBossHealingGraceActive()
          );

          if (isBossDamageLocked) {
            // 在3秒安全治疗窗口期间，首领严禁造成任何普攻与伤害，并重置普攻挥击计时器
            // 确保窗口结束后坦克仍拥有完整的1.2秒（24 ticks）挥击前摇缓冲，给予治疗充足的加血时间
            lastBossAttackTickRef.current = tickCount;
          } else {
            // Boss auto attacks its top threat target (resolved from ThreatManager, constrained by melee range <= 80px)
            const targetUnit = engine.friendlyUnits.find(u => u.id === targetId && (u.isAlive || u.alive));
            if (targetUnit && (tickCount - lastBossAttackTickRef.current) >= 24) {
              lastBossAttackTickRef.current = tickCount;
              const bX = boss.position?.x ?? 540;
              const bY = boss.position?.y ?? 190;
              const tX = targetUnit.position?.x ?? 180;
              const tY = targetUnit.position?.y ?? 190;
              const distToTarget = Math.hypot(bX - tX, bY - tY);
              const MELEE_RANGE = 80;

              if (distToTarget <= MELEE_RANGE) {
                let bossHitDmg: number;
                if (is20Man) {
                  bossHitDmg = targetUnit.role === 'TANK' ? 32000 : 65000;
                } else {
                  bossHitDmg = targetUnit.role === 'TANK' ? 18000 : 32000;
                }
                const isBossCrit = Math.random() < 0.1;
                engine.resolveAttackHit(boss, targetUnit, bossHitDmg, 'PHYSICAL', isBossCrit, '首领普通攻击');
              }
            }
          }

          // ── Player & Pet Auto-Attacks (白字普攻、黄字技能、暴击放大) ──
          const playerUnit = engine.friendlyUnits.find(u => u.isPlayer && (u.isAlive ?? u.alive));
          if (playerUnit && boss && (boss.isAlive || boss.alive) && boss.hp > 0 && !isBossDamageLocked) {
            // Player auto attacks every 2.0s (40 ticks)
            if (tickCount - lastPlayerAttackTickRef.current >= 40) {
              lastPlayerAttackTickRef.current = tickCount;
              const pX = playerUnit.position?.x ?? 180;
              const pY = playerUnit.position?.y ?? 190;
              const bX = boss.position?.x ?? 540;
              const bY = boss.position?.y ?? 190;
              const distToBoss = Math.hypot(bX - pX, bY - pY);

              const isMeleeClass = ['DK', 'ROGUE'].includes(playerUnit.classId);
              const maxRange = isMeleeClass ? 85 : 360;

              if (distToBoss <= maxRange) {
                const isCrit = Math.random() < (playerUnit.stats?.critChance || 0.2);
                const baseAuto = isMeleeClass ? (isCrit ? 9000 : 4500) : (isCrit ? 4000 : 2000);
                // 白字普攻 (White damage numbers on enemy head)
                engine.resolveAttackHit(playerUnit, boss, baseAuto, 'PHYSICAL', isCrit, '普通攻击');
              }
            }

            // Player Pet (e.g. Frost Mage Water Elemental or DK Ghoul)
            const playerPet = engine.friendlyUnits.find(u => u.isPet && u.ownerId === playerUnit.id && (u.isAlive ?? u.alive));
            if (playerPet) {
              if (tickCount - lastPetAttackTickRef.current >= 48) {
                lastPetAttackTickRef.current = tickCount;
                const petCrit = Math.random() < 0.25;
                const isPetSkill = (tickCount % 96 === 0);
                const petDmg = isPetSkill ? (petCrit ? 6000 : 3000) : (petCrit ? 3600 : 1800);
                const petSpell = isPetSkill ? (playerUnit.classId === 'MAGE' ? '水箭' : '爪击') : '普通攻击';
                const school = playerUnit.classId === 'MAGE' && isPetSkill ? 'FROST' : 'PHYSICAL';
                engine.resolveAttackHit(playerPet, boss, petDmg, school as any, petCrit, petSpell);
              }
            }
          }

          // Continuous ambient dungeon combat pressure (every 3.0s = 60 ticks)
          // 在首领治疗窗口期内严格禁止造成环境暗影瘴气伤害
          if (!isBossDamageLocked && tickCount % 60 === 0) {
            const ambientDmg = is20Man ? 6000 : 4000;
            const livingNonTanks = engine.friendlyUnits.filter(u => u.role !== 'TANK' && (u.isAlive || u.alive));
            if (livingNonTanks.length > 0) {
              const randomVictim = livingNonTanks[Math.floor(Math.random() * livingNonTanks.length)];
              engine.dealDamage(boss, randomVictim, ambientDmg, 'SHADOW', false, '地牢暗影瘴气');
            }
          }
        } else {
          // Boss is dead! Stop all casting immediately
          setBossTargetId(null);
          aiHealerCastsRef.current = {};
        }
      }

      // 3. Recovery Phase: Surviving Healer Resurrects Dead Teammates (3.0s cast)
      if (rsm.phase === 'TRAVEL_RECOVERY') {
        const deadAlly = engine.friendlyUnits.find(u => (!u.isAlive && !u.alive) || u.hp <= 0);
        const healer = engine.friendlyUnits.find(
          u => (u.isAlive ?? u.alive) && u.hp > 0 && (u.role === 'HEALER' || u.classId === 'SHAMAN' || u.classId === 'DRUID')
        );

        if (deadAlly && healer && !rsm.isCorpseRunning) {
          setRevivingUnitId(deadAlly.id);
          reviveTimerMs += deltaMs;
          const progress = Math.min(1, reviveTimerMs / 3000);
          setReviveProgress(progress);

          if (progress >= 1) {
            // Revive completed!
            engine.resurrectUnit(deadAlly.id, 0.5, 0.5);
            engine.healUnit(healer, deadAlly, Math.round(deadAlly.maxHp * 0.5), false);
            engine.effectsManager?.addFloatingText({
              targetId: deadAlly.id,
              text: '起死回生！',
              category: 'HEAL',
              isCrit: true,
            });
            reviveTimerMs = 0;
            setRevivingUnitId(null);
            setReviveProgress(0);
          }
        } else {
          setRevivingUnitId(null);
          setReviveProgress(0);
          reviveTimerMs = 0;
        }
      }

      // Sync active casts & incoming heal prediction bars across frames
      setCompanionCasts(currentCasts);
      setIncomingHeals(currentHeals);
      setIncomingCasts(currentIncomingCasts);

      // Sync React state
      setRunPhase(rsm.phase);
      setFriendlyUnits([...engine.friendlyUnits]);
      setBossUnit(engine.bossUnit ? { ...engine.bossUnit } : undefined);
      setGroundEffects([...(engine.effectsManager?.groundEffects || [])]);
      setFloatingTexts([...(engine.effectsManager?.floatingTexts || [])]);
      setTravelRemainingMs(rsm.travelRemainingMs);
      setWipeVoteTimerMs(rsm.wipeVoteTimerMs);
      setTotalDurationSec(Math.round(rsm.totalRunDurationSec));
      setTargetBossName(rsm.getCurrentBoss()?.name || '首领');
      setIsCorpseRunning(rsm.isCorpseRunning);
      setCorpseRunTimerMs(rsm.corpseRunTimerMs);
    }, 50);

    return () => clearInterval(timer);
  }, [runPhase, isApproaching]);

  // Handle WASD movement callback (cancels casts and checks red potion penalty)
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
      playerCastRef.current = null;
      setPlayerCast(null);
      engineRef.current.effectsManager?.addFloatingText({
        targetId: 'p1_player',
        text: '施法已取消',
        category: 'STATUS',
        isCrit: false,
      });
      clearPlayerIncomingCast();
    }
  };

  // Resolve completed cast from player - returns boolean indicating whether the cast actually succeeded
  const resolvePlayerCast = (spellId: string, totalCdMs?: number): boolean => {
    const engine = engineRef.current;
    const player = engine.friendlyUnits.find(u => u.isPlayer);
    const boss = engine.bossUnit;
    if (!player || (!player.isAlive && !player.alive)) return false;

    const normSpell = getSpellByAnyId(spellId, player.classId);
    const isRevive =
      spellId === 'revive' ||
      spellId === 'ancestral_spirit' ||
      spellId === 'rebirth' ||
      spellId === 'redemption' ||
      spellId === 'resurrection' ||
      Boolean(normSpell?.isResurrect);
    const isHarmful =
      [
        'fireball', 'pyroblast', 'frostbolt', 'arcane_blast', 'wrath',
        'starfire', 'starsurge', 'lightning_bolt', 'lava_burst', 'chain_lightning',
      ].includes(spellId) ||
      Boolean(normSpell && !normSpell.isHeal && !normSpell.isShield && !normSpell.isResurrect && !normSpell.isDispel && !normSpell.isDefensive && !normSpell.isResourceRestore);

    // ── 目标存活与射程校验：若目标已死亡或超出范围，施法失败且绝对不进CD！──
    if (isHarmful) {
      if (!boss || (!boss.isAlive && !boss.alive) || boss.hp <= 0) {
        engine.effectsManager?.addFloatingText({
          targetId: player.id,
          text: '❌ 目标已死亡',
          category: 'STATUS',
          isCrit: false,
        });
        return false;
      }
      if (player.position && boss.position) {
        const dist = Math.hypot(player.position.x - boss.position.x, player.position.y - boss.position.y);
        if (dist > 360) {
          engine.effectsManager?.addFloatingText({
            targetId: player.id,
            text: '❌ 距离不足 (超出范围)',
            category: 'STATUS',
            isCrit: false,
          });
          return false;
        }
      }
    } else if (!isRevive) {
      const target = (castTargetIdRef.current ? engine.friendlyUnits.find(u => u.id === castTargetIdRef.current) : null)
        || (selectedTargetId ? engine.friendlyUnits.find(u => u.id === selectedTargetId) : null)
        || player;
      if (!target || (!target.isAlive && !target.alive) || target.hp <= 0) {
        engine.effectsManager?.addFloatingText({
          targetId: player.id,
          text: '❌ 目标已死亡',
          category: 'STATUS',
          isCrit: false,
        });
        return false;
      }
      if (player.position && target.position) {
        const dist = Math.hypot(player.position.x - target.position.x, player.position.y - target.position.y);
        if (dist > 360) {
          engine.effectsManager?.addFloatingText({
            targetId: player.id,
            text: '❌ 距离不足 (超出范围)',
            category: 'STATUS',
            isCrit: false,
          });
          return false;
        }
      }
    } else {
      // 复活类技能：必须有已阵亡的目标
      const deadTarget = engine.friendlyUnits.find(u => (!u.isAlive && !u.alive) || u.hp <= 0);
      if (!deadTarget) {
        engine.effectsManager?.addFloatingText({
          targetId: player.id,
          text: '❌ 没有需要复活的目标',
          category: 'STATUS',
          isCrit: false,
        });
        return false;
      }
    }

    // ── 目标合法且在射程内，执行法术效果 ──
    if (spellId === 'fireball') {
      if (boss && boss.alive) {
        const isCrit = Math.random() < 0.35;
        if (isCrit) {
          setScreenShake(true);
          setTimeout(() => setScreenShake(false), 120);
        }
        engine.dealDamage(player, boss, 14500, 'FIRE', isCrit, '火球术');
        engine.threatManager.addThreat(boss.id, player.id, 14500);
      }
    } else if (spellId === 'pyroblast') {
      if (boss && boss.alive) {
        setScreenShake(true);
        setTimeout(() => setScreenShake(false), 150);
        engine.dealDamage(player, boss, 21000, 'FIRE', true, '炎爆术');
        engine.threatManager.addThreat(boss.id, player.id, 21000);
      }
    } else if (spellId === 'frostbolt') {
      if (boss && boss.alive) {
        const isCrit = Math.random() < 0.3;
        engine.dealDamage(player, boss, 13800, 'FROST', isCrit, '寒冰箭');
        engine.threatManager.addThreat(boss.id, player.id, 13800);
      }
    } else if (spellId === 'arcane_blast') {
      if (boss && boss.alive) {
        const isCrit = Math.random() < 0.32;
        engine.dealDamage(player, boss, 18500, 'ARCANE', isCrit, '奥术冲击');
        engine.threatManager.addThreat(boss.id, player.id, 18500);
      }
    } else if (spellId === 'wrath') {
      if (boss && boss.alive) {
        const isCrit = Math.random() < 0.3;
        engine.dealDamage(player, boss, 13500, 'NATURE', isCrit, '愤怒');
        engine.threatManager.addThreat(boss.id, player.id, 13500);
      }
    } else if (spellId === 'starfire') {
      if (boss && boss.alive) {
        const isCrit = Math.random() < 0.35;
        if (isCrit) {
          setScreenShake(true);
          setTimeout(() => setScreenShake(false), 120);
        }
        engine.dealDamage(player, boss, 21500, 'ARCANE', isCrit, '星火术');
        engine.threatManager.addThreat(boss.id, player.id, 21500);
      }
    } else if (spellId === 'starsurge') {
      if (boss && boss.alive) {
        setScreenShake(true);
        setTimeout(() => setScreenShake(false), 150);
        engine.dealDamage(player, boss, 28000, 'ARCANE', true, '星涌术');
        engine.threatManager.addThreat(boss.id, player.id, 28000);
      }
    } else if (spellId === 'lightning_bolt') {
      if (boss && boss.alive) {
        const isCrit = Math.random() < 0.28;
        const sp = getSpellByAnyId('lightning_bolt', 'SHAMAN');
        const base = sp?.directDamage || 8500;
        const dmg = Math.round(base + (player.stats.spellPower || 3800) * 0.86);
        engine.dealDamage(player, boss, dmg, 'NATURE', isCrit, '闪电箭');
        engine.threatManager.addThreat(boss.id, player.id, dmg);
        // 大地之流回蓝后同步资源条
        syncUnitResources(player);
      }
    } else if (spellId === 'lava_burst') {
      if (boss && boss.alive) {
        setScreenShake(true);
        setTimeout(() => setScreenShake(false), 120);
        const sp = getSpellByAnyId('lava_burst', 'SHAMAN');
        const base = sp?.directDamage || 14000;
        // 熔岩爆裂：有烈焰震击时必然暴击；这里按技能描述保底暴击
        const dmg = Math.round((base + (player.stats.spellPower || 3800) * 0.86) * 2.0);
        engine.dealDamage(player, boss, dmg, 'FIRE', true, '熔岩爆裂');
        engine.threatManager.addThreat(boss.id, player.id, dmg);
      }
    } else if (spellId === 'chain_lightning') {
      const enemies = engine.enemyUnits.filter(e => (e.isAlive ?? e.alive) && e.hp > 0).slice(0, 4);
      const targets = enemies.length > 0 ? enemies : (boss && (boss.isAlive ?? boss.alive) && boss.hp > 0 ? [boss] : []);
      const sp = getSpellByAnyId('chain_lightning', 'SHAMAN');
      const base = sp?.directDamage || 8600;
      // 80 级满级标定：基础值 + 法强系数，弹跳衰减 30%
      let jumpAmt = Math.round(base + (player.stats.spellPower || 3800) * 0.86);
      targets.forEach((enemy, idx) => {
        const isCrit = Math.random() < 0.25;
        const hit = Math.round(jumpAmt * (isCrit ? 1.5 : 1));
        engine.dealDamage(player, enemy, hit, 'NATURE', isCrit, '闪电链');
        engine.threatManager.addThreat(enemy.id, player.id, hit);
        jumpAmt *= 0.7;
      });
      syncUnitResources(player);
    } else if (spellId === 'healing_wave') {
      const target = (castTargetIdRef.current ? engine.friendlyUnits.find(u => u.id === castTargetIdRef.current) : null)
        || (selectedTargetId ? engine.friendlyUnits.find(u => u.id === selectedTargetId) : null)
        || player;
      const sp = getSpellByAnyId('healing_wave', 'SHAMAN');
      const base = sp?.directHeal || 8800;
      const heal = Math.round(base + (player.stats.spellPower || 4000) * 0.8);
      engine.healUnit(player, target, heal, Math.random() < 0.3, '治疗波');
    } else if (spellId === 'nourish') {
      const target = (castTargetIdRef.current ? engine.friendlyUnits.find(u => u.id === castTargetIdRef.current) : null)
        || (selectedTargetId ? engine.friendlyUnits.find(u => u.id === selectedTargetId) : null)
        || player;
      const hasHot = target.buffs.some(b => ['rejuvenation', 'regrowth', 'lifebloom', 'wild_growth'].includes(b.spellId));
      const val = hasHot ? Math.round(9500 * 1.2) : 9500;
      engine.healUnit(player, target, val, Math.random() < 0.25, '滋养');
      const refreshed = engine.refreshLifebloom(target, player.id);
      if (refreshed) {
        setFriendlyUnits([...engine.friendlyUnits]);
        engine.effectsManager?.addFloatingText({
          targetId: target.id,
          text: '✨ 生命绽放已刷新',
          category: 'HEAL',
          isCrit: false,
        });
      }
    } else if (spellId === 'healing_surge') {
      const target = (castTargetIdRef.current ? engine.friendlyUnits.find(u => u.id === castTargetIdRef.current) : null)
        || (selectedTargetId ? engine.friendlyUnits.find(u => u.id === selectedTargetId) : null)
        || player;
      const sp = getSpellByAnyId('healing_surge', 'SHAMAN');
      const heal = Math.round((sp?.directHeal || 12400) + (player.stats.spellPower || 4000) * 0.8);
      engine.healUnit(player, target, heal, Math.random() < 0.3, '治疗之涌');
    } else if (spellId === 'greater_healing_wave') {
      const target = (castTargetIdRef.current ? engine.friendlyUnits.find(u => u.id === castTargetIdRef.current) : null)
        || (selectedTargetId ? engine.friendlyUnits.find(u => u.id === selectedTargetId) : null)
        || player;
      const sp = getSpellByAnyId('greater_healing_wave', 'SHAMAN');
      const heal = Math.round((sp?.directHeal || 20500) + (player.stats.spellPower || 4000) * 0.8);
      engine.healUnit(player, target, heal, Math.random() < 0.35, '强效治疗波');
    } else if (spellId === 'healing_touch') {
      const target = (castTargetIdRef.current ? engine.friendlyUnits.find(u => u.id === castTargetIdRef.current) : null)
        || (selectedTargetId ? engine.friendlyUnits.find(u => u.id === selectedTargetId) : null)
        || player;
      const isCrit = Math.random() < 0.35;
      engine.healUnit(player, target, 34000, isCrit, '治疗之触');
      const refreshed = engine.refreshLifebloom(target, player.id);
      if (refreshed) {
        setFriendlyUnits([...engine.friendlyUnits]);
        engine.effectsManager?.addFloatingText({
          targetId: target.id,
          text: '✨ 生命绽放已刷新',
          category: 'HEAL',
          isCrit: false,
        });
      }
    } else if (spellId === 'regrowth') {
      const target = (castTargetIdRef.current ? engine.friendlyUnits.find(u => u.id === castTargetIdRef.current) : null)
        || (selectedTargetId ? engine.friendlyUnits.find(u => u.id === selectedTargetId) : null)
        || player;
      // Direct heal + 6s HoT
      engine.healUnit(player, target, 16000, Math.random() < 0.3, '愈合');
      engine.applyBuff(target, {
        id: `regrowth_${Date.now()}`,
        spellId: 'regrowth',
        name: '愈合 (HoT)',
        kind: 'BUFF',
        tags: ['HOT'],
        sourceUnitId: player.id,
        targetUnitId: target.id,
        stacks: 1,
        maxStacks: 1,
        durationMs: 6000,
        remainingMs: 6000,
        school: 'NATURE',
        tickIntervalMs: 2000,
        tickValue: 1800,
      });
      const refreshed = engine.refreshLifebloom(target, player.id);
      if (refreshed) {
        setFriendlyUnits([...engine.friendlyUnits]);
        engine.effectsManager?.addFloatingText({
          targetId: target.id,
          text: '✨ 生命绽放已刷新',
          category: 'HEAL',
          isCrit: false,
        });
      }
    } else if (spellId === 'rebirth') {
      const targetId = castTargetIdRef.current || selectedTargetId;
      const deadTarget = targetId
        ? engine.friendlyUnits.find(u => u.id === targetId && ((!u.isAlive && !u.alive) || u.hp <= 0))
        : engine.friendlyUnits.find(u => (!u.isAlive && !u.alive) || u.hp <= 0);
      if (deadTarget) {
        engine.resurrectUnit(deadTarget.id, 0.6, 0.6);
        engine.effectsManager?.addFloatingText({
          targetId: deadTarget.id,
          text: '⚡ 复生！(战斗复活)',
          category: 'HEAL',
          isCrit: true,
        });
        setFriendlyUnits([...engine.friendlyUnits]);
      } else {
        return false;
      }
    } else if (spellId === 'chain_heal') {
      const target = (castTargetIdRef.current ? engine.friendlyUnits.find(u => u.id === castTargetIdRef.current) : null)
        || (selectedTargetId ? engine.friendlyUnits.find(u => u.id === selectedTargetId) : null)
        || player;
      const isCrit = Math.random() < (player.stats.critChance || 0.25);
      const sp = getSpellByAnyId('chain_heal', 'SHAMAN');
      // 80 级满级：主目标按 ClassRegistry 直疗 + 法强系数，后续弹跳衰减 30%
      let healVal = Math.round((sp?.directHeal || 23500) + (player.stats.spellPower || 4000) * 0.55);
      engine.healUnit(player, target, healVal, isCrit, '治疗链');
      const otherAllies = engine.friendlyUnits
        .filter(u => u.id !== target.id && (u.alive || u.isAlive) && u.hp > 0 && u.hp < u.maxHp)
        .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
      for (let i = 0; i < Math.min(3, otherAllies.length); i++) {
        healVal = Math.round(healVal * 0.7);
        engine.healUnit(player, otherAllies[i], healVal, Math.random() < (player.stats.critChance || 0.25), `治疗链(第${i + 2}跳)`);
      }
    } else if (spellId === 'revive' || spellId === 'ancestral_spirit' || spellId === 'redemption' || spellId === 'resurrection') {
      const deadTarget = engine.friendlyUnits.find(u => (!u.isAlive && !u.alive) || u.hp <= 0);
      if (deadTarget) {
        engine.resurrectUnit(deadTarget.id, 0.4, 0.4);
        const rezName = normSpell?.name || (spellId === 'revive' ? '起死回生' : '先祖之魂');
        engine.healUnit(player, deadTarget, Math.round(deadTarget.maxHp * 0.4), false, rezName);
      }
    } else if (normSpell) {
      // Data-driven resolution for ALL 10 Cataclysm classes' cast-time spells
      const spPower = player.stats.spellPower || 3200;
      const apPower = player.stats.attackPower || 3200;
      const isCrit = Math.random() < (player.stats.critChance || 0.28);
      if (normSpell.isHeal || normSpell.isShield) {
        const target = (castTargetIdRef.current ? engine.friendlyUnits.find(u => u.id === castTargetIdRef.current) : null)
          || (selectedTargetId ? engine.friendlyUnits.find(u => u.id === selectedTargetId) : null)
          || player;
        if (normSpell.isAOE) {
          const maxT = Math.max(3, normSpell.maxAoeTargets || 5);
          const wounded = engine.friendlyUnits
            .filter(u => (u.alive || u.isAlive) && u.hp > 0)
            .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))
            .slice(0, maxT);
          const perHeal = Math.round(Math.max(3800, normSpell.directHeal || normSpell.hotTotalHeal * 0.45) + spPower * 0.4);
          for (const ally of wounded) {
            engine.healUnit(player, ally, perHeal, Math.random() < (player.stats.critChance || 0.25), normSpell.name);
          }
        } else {
          const healVal = Math.round(Math.max(4500, normSpell.directHeal) + spPower * 0.55);
          engine.healUnit(player, target, healVal, isCrit, normSpell.name);
        }
      } else if (normSpell.isAOE) {
        const livingEnemies = engine.enemyUnits.filter(e => (e.isAlive ?? e.alive) && e.hp > 0);
        const targets = livingEnemies.slice(0, Math.max(3, normSpell.maxAoeTargets || 6));
        const power = normSpell.school === 'PHYSICAL' ? apPower : spPower;
        const perDmg = Math.round(Math.max(3600, normSpell.directDamage || normSpell.dotTotalDamage * 0.5) + power * 0.45);
        for (const enemy of targets) {
          engine.dealDamage(player, enemy, perDmg, normSpell.school, Math.random() < (player.stats.critChance || 0.28), normSpell.name);
          engine.threatManager.addThreat(enemy.id, player.id, perDmg);
        }
      } else if (boss && boss.alive) {
        const power = normSpell.school === 'PHYSICAL' ? apPower : spPower;
        const dmgVal = Math.round(Math.max(5200, normSpell.directDamage || normSpell.dotTotalDamage * 0.35) + power * 0.65);
        if (isCrit) {
          setScreenShake(true);
          setTimeout(() => setScreenShake(false), 110);
        }
        engine.dealDamage(player, boss, dmgVal, normSpell.school, isCrit, normSpell.name);
        engine.threatManager.addThreat(boss.id, player.id, dmgVal);
        if (normSpell.isDot && normSpell.dotTotalDamage > 0) {
          engine.applyBuff(boss, {
            id: `${normSpell.shortId}_${Date.now()}`,
            spellId: normSpell.shortId,
            name: `${normSpell.name} (DoT)`,
            kind: 'DEBUFF',
            tags: ['DOT'],
            sourceUnitId: player.id,
            targetUnitId: boss.id,
            stacks: 1,
            maxStacks: 1,
            durationMs: 15000,
            remainingMs: 15000,
            school: normSpell.school,
            tickIntervalMs: 3000,
            tickValue: Math.round(normSpell.dotTotalDamage / 5),
          });
        }
      }
    }

    if (totalCdMs && totalCdMs > 0) {
      triggerCooldown(spellId, totalCdMs);
    }

    return true;
  };

  // Shared cooldown matrix (Cataclysm 4.3 authentic shared CD categories)
  const SHARED_COOLDOWN_GROUPS: Record<string, string[]> = {
    flame_shock: ['flame_shock', 'earth_shock'],
    earth_shock: ['flame_shock', 'earth_shock'],
    healthstone: ['healthstone', 'healing_potion', 'mana_potion'],
    healing_potion: ['healthstone', 'healing_potion', 'mana_potion'],
    mana_potion: ['healthstone', 'healing_potion', 'mana_potion'],
  };

  // Trigger spell cooldown (with shared cooldown group propagation)
  const triggerCooldown = (spellId: string, totalCdMs: number) => {
    const sharedGroup = SHARED_COOLDOWN_GROUPS[spellId] || [spellId];
    setPlayerCooldowns((prev) => {
      const next = { ...prev };
      for (const sid of sharedGroup) {
        next[sid] = { cdRemainingMs: totalCdMs, totalCdMs };
      }
      return next;
    });
  };

  // Trigger Global Cooldown (GCD) using authentic Lv.80 Cataclysm GCD grouping:
  // NORMAL = max(1000ms, round(1500 / (1 + haste))), ROGUE = fixed 1000ms, OFF_GCD = 0ms
  const triggerGcd = (spellId?: string) => {
    if (spellId && isOffGcdSpell(spellId)) return;
    const engine = engineRef.current;
    const player = engine.friendlyUnits.find(u => u.isPlayer);
    const gcdCat = getSpellGcdCategory(spellId || '', player?.classId);
    const gcdMs = getEffectiveGcdMs(gcdCat, player?.stats?.haste ?? LEVEL_80_MAX_HASTE);
    if (gcdMs <= 0) return;
    setPlayerGcdRemainingMs(gcdMs);
    setPlayerGcdTotalMs(gcdMs);
    if (player) {
      engine.cooldownManager?.startGcd?.(player.id, gcdMs);
    }
  };

  // Dispel unit debuffs (Cataclysm dispel matrix for all 10 classes)
  const handleDispelUnit = (targetUnitId?: string | null) => {
    const engine = engineRef.current;
    const player = engine.friendlyUnits.find(u => u.isPlayer);
    if (!player || (!player.isAlive && !player.alive)) return;

    if (playerGcdRemainingMs > 0) {
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '公共冷却中！',
        category: 'STATUS',
        isCrit: false,
      });
      return;
    }

    const allowedDispels = getPlayerDispelCapabilities(currentChar?.classId, currentChar?.lastSpec);
    if (allowedDispels.length === 0) {
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '❌ 当前职业/专精无驱散技能',
        category: 'STATUS',
        isCrit: false,
      });
      return;
    }

    const dispelSpellId = currentChar?.classId === 'DRUID'
      ? (currentChar?.lastSpec === 'RESTORATION' ? 'natures_cure' : 'remove_corruption')
      : currentChar?.classId === 'SHAMAN'
      ? 'cleanse_spirit'
      : currentChar?.classId === 'PALADIN'
      ? 'cleanse'
      : currentChar?.classId === 'PRIEST'
      ? 'dispel_magic'
      : currentChar?.classId === 'WARLOCK'
      ? 'devour_magic'
      : 'remove_curse';

    if ((playerCooldowns[dispelSpellId]?.cdRemainingMs || 0) > 0) {
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '驱散法术还在冷却中！',
        category: 'STATUS',
        isCrit: false,
      });
      return;
    }

    const target = (targetUnitId ? engine.friendlyUnits.find(u => u.id === targetUnitId) : null)
      || (selectedTargetId ? engine.friendlyUnits.find(u => u.id === selectedTargetId) : null)
      || player;

    if (!target) return;

    // Distance check: > 340px
    if (player.position && target.position) {
      const dx = player.position.x - target.position.x;
      const dy = player.position.y - target.position.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 340) {
        engine.effectsManager?.addFloatingText({
          targetId: player.id,
          text: '距离过远，无法驱散！',
          category: 'STATUS',
          isCrit: false,
        });
        return;
      }
    }

    // Find first debuff matching player's dispel capability
    const debuffIdx = target.buffs.findIndex(b => {
      if (b.kind !== 'DEBUFF') return false;
      const meta = DEBUFF_REGISTRY[b.spellId];
      return meta?.dispelType && allowedDispels.includes(meta.dispelType);
    });

    if (debuffIdx === -1) {
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '目标身上无可驱散的负面状态',
        category: 'STATUS',
        isCrit: false,
      });
      return;
    }

    const removed = target.buffs[debuffIdx];
    target.buffs.splice(debuffIdx, 1);

    // Enter 8s cooldown and trigger GCD
    triggerCooldown(dispelSpellId, 8000);
    triggerGcd();

    engine.effectsManager?.addFloatingText({
      targetId: target.id,
      text: `✨ 驱散成功: ${removed.name}`,
      category: 'HEAL',
      isCrit: true,
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
      return {
        ...s,
        totalCdMs,
        cdRemainingMs: isCurrentActive ? (playerCooldowns[s.spellId]?.cdRemainingMs || 0) : 0,
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

  // Cast Player Spell
  const handleCastSlot = (slotIdx: number) => {
    const slots = getPlayerSlots();
    const slot = slots.find(s => s.slotIdx === slotIdx);
    if (!slot) return;

    const engine = engineRef.current;
    const player = engine.friendlyUnits.find(u => u.isPlayer) || (currentChar ? engine.getUnit(currentChar.id) : undefined);
    const boss = engine.bossUnit;

    // Network guest: forward cast intent to host; do not simulate locally
    if (isNetworkGuestRef.current && netClient.connected && activeRoomIdRef.current && currentChar) {
      netClient.sendPlayerInput(activeRoomIdRef.current, {
        kind: 'CAST',
        playerId: currentChar.id,
        spellId: slot.spellId,
        slotIndex: slotIdx,
        targetId: bossTargetId || boss?.id || player?.id || null,
      });
      return;
    }

    if (!player || (!player.isAlive && !player.alive)) return;

    // ── Re-cast Guard: Ignore redundant keypresses while casting read-bar spell ──
    if (playerCast && !playerCast.isChannel) {
      return;
    }

    // ── Check GCD (Off-GCD spells ignore GCD and do not trigger GCD) ──
    const isOffGcd = isOffGcdSpell(slot.spellId);
    if (!isOffGcd && playerGcdRemainingMs > 0) {
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '公共冷却中！',
        category: 'STATUS',
        isCrit: false,
      });
      return;
    }

    // ── Check Cooldown ───────────────────────────────────────────────
    if ((playerCooldowns[slot.spellId]?.cdRemainingMs || 0) > 0) {
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '法术还在冷却中！',
        category: 'STATUS',
        isCrit: false,
      });
      return;
    }

    const normSlotSpell = getSpellByAnyId(slot.spellId, player.classId);

    // ── Check Mana Cost ──────────────────────────────────────────────
    const manaCost = SPELL_MANA_COSTS[slot.spellId] ?? (normSlotSpell?.resourceKind === 'MANA' ? normSlotSpell.resourceCostAmount : 0);
    if (manaCost > 0 && player.maxMp && player.maxMp > 0) {
      if ((player.mp ?? 0) < manaCost) {
        window.dispatchEvent(new CustomEvent('cata_ui_error', { detail: { text: '法力值不足' } }));
        engine.effectsManager?.addFloatingText({
          targetId: player.id,
          text: '⚠️ 法力值不足！',
          category: 'STATUS',
          isCrit: false,
        });
        return;
      }
    }

    // ── Check Energy Cost for Rogue ──────────────────────────────────
    const energyCost = SPELL_ENERGY_COSTS[slot.spellId] ?? (normSlotSpell?.resourceKind === 'ENERGY' ? normSlotSpell.resourceCostAmount : 0);
    if (energyCost > 0 && player.classId === 'ROGUE') {
      if ((player.energy ?? 100) < energyCost) {
        window.dispatchEvent(new CustomEvent('cata_ui_error', { detail: { text: '能量不足' } }));
        engine.effectsManager?.addFloatingText({
          targetId: player.id,
          text: '⚠️ 能量值不足！',
          category: 'STATUS',
          isCrit: false,
        });
        return;
      }
    }

    // ── Check Rage Cost ──────────────────────────────────────────────
    const rageCost = SPELL_RAGE_COSTS[slot.spellId] ?? (normSlotSpell?.resourceKind === 'RAGE' ? normSlotSpell.resourceCostAmount : 0);
    if (rageCost > 0 && (player.classId === 'WARRIOR' || (player.classId === 'DRUID' && player.role === 'TANK'))) {
      const curRage = player.rage ?? 0;
      if (curRage < rageCost) {
        window.dispatchEvent(new CustomEvent('cata_ui_error', { detail: { text: '怒气不足' } }));
        engine.effectsManager?.addFloatingText({
          targetId: player.id,
          text: '⚠️ 怒气不足！',
          category: 'STATUS',
          isCrit: false,
        });
        return;
      }
    }

    // ── Check Focus Cost for Hunter ──────────────────────────────────
    const focusCost = normSlotSpell?.resourceKind === 'FOCUS' ? normSlotSpell.resourceCostAmount : 0;
    if (focusCost > 0 && player.classId === 'HUNTER') {
      const curFocus = player.focus ?? 100;
      if (curFocus < focusCost) {
        window.dispatchEvent(new CustomEvent('cata_ui_error', { detail: { text: '集中值不足' } }));
        engine.effectsManager?.addFloatingText({
          targetId: player.id,
          text: '⚠️ 集中值不足！',
          category: 'STATUS',
          isCrit: false,
        });
        return;
      }
    }

    // ── Check Runic Cost for DK ──────────────────────────────────────
    const runicCost = SPELL_RUNIC_COSTS[slot.spellId] ?? (normSlotSpell?.resourceKind === 'RUNIC_POWER' ? normSlotSpell.resourceCostAmount : 0);
    if (runicCost > 0 && player.classId === 'DK') {
      const curRunic = player.runicPower ?? 0;
      if (curRunic < runicCost) {
        window.dispatchEvent(new CustomEvent('cata_ui_error', { detail: { text: '符能不足' } }));
        engine.effectsManager?.addFloatingText({
          targetId: player.id,
          text: '⚠️ 符能不足！',
          category: 'STATUS',
          isCrit: false,
        });
        return;
      }
    }

    // ── Check Holy Power Cost for Paladin ────────────────────────────
    const holyPowerCost = normSlotSpell?.resourceKind === 'HOLY_POWER' ? normSlotSpell.resourceCostAmount : 0;
    if (holyPowerCost > 0 && player.classId === 'PALADIN') {
      const curHpPower = player.holyPower ?? 0;
      if (curHpPower < holyPowerCost) {
        window.dispatchEvent(new CustomEvent('cata_ui_error', { detail: { text: '神圣能量不足' } }));
        engine.effectsManager?.addFloatingText({
          targetId: player.id,
          text: '⚠️ 神圣能量不足！',
          category: 'STATUS',
          isCrit: false,
        });
        return;
      }
    }

    // ── Ground-Targeted Spells (Reticle follows mouse, click ground to cast, right-click/ESC to cancel) ──
    const groundDef = GROUND_TARGET_SPELL_DEFS[slot.spellId];
    if (groundDef) {
      if (groundTargetState && groundTargetState.spellId === slot.spellId) {
        setGroundTargetState(null);
        return;
      }
      setGroundTargetState({
        slotIdx,
        spellId: slot.spellId,
        name: slot.name,
        radius: groundDef.radius,
        color: groundDef.color,
        maxRange: groundDef.maxRange,
      });
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: `🎯 鼠标指定位置释放【${slot.name}】(右键或ESC取消)`,
        category: 'STATUS',
        isCrit: false,
      });
      return;
    }

    // ── Guard Against Casting while Moving & Classify Spell Lifecycle ──
    const isMoving = Date.now() - lastPlayerMoveMsRef.current < 250;
    const isHardcodedCastOrChannel = [
      'fireball', 'pyroblast', 'frostbolt', 'arcane_blast', 'arcane_missiles',
      'wrath', 'starfire', 'starsurge', 'lightning_bolt', 'lava_burst',
      'chain_lightning', 'healing_wave', 'healing_surge', 'greater_healing_wave',
      'chain_heal', 'nourish', 'regrowth', 'healing_touch', 'tranquility',
      'rebirth', 'revive', 'ancestral_spirit', 'redemption', 'resurrection',
    ].includes(slot.spellId);

    const hasNaturesSwiftness = player.buffs.some(b => b.spellId === 'natures_swiftness');
    const isNatureInstantable = ['healing_touch', 'rebirth', 'regrowth', 'nourish', 'wrath', 'revive'].includes(slot.spellId);
    const isInstantViaNs = hasNaturesSwiftness && isNatureInstantable;

    const isSlotChanneled = isChanneledSpell({
      spellId: slot.spellId,
      castTimeMs: normSlotSpell?.castTimeMs,
      channelDurationMs: normSlotSpell?.channelDurationMs,
      isInstantOverride: isInstantViaNs,
    });

    const castMode = classifySpellCastMode({
      spellId: slot.spellId,
      castTimeMs: isHardcodedCastOrChannel && !isSlotChanneled
        ? Math.max(1500, normSlotSpell?.castTimeMs || 1500)
        : normSlotSpell?.castTimeMs,
      channelDurationMs: normSlotSpell?.channelDurationMs,
      isChannel: isSlotChanneled,
      isInstantOverride: isInstantViaNs,
    });
    const castLifecycle = getCastLifecyclePolicy(castMode);
    const isCastOrChannel = castMode !== 'INSTANT';

    if (isMoving && isCastOrChannel && !isInstantViaNs) {
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '⚠️ 移动中无法施法！',
        category: 'STATUS',
        isCrit: false,
      });
      return;
    }

    // ── Smart Target Redirection (Friendly -> Self fallback, Hostile -> Nearest Enemy fallback) ──
    const isFriendlySpell =
      [
        'rejuvenation', 'lifebloom', 'regrowth', 'healing_touch', 'nourish', 'swiftmend',
        'wild_growth', 'tranquility', 'rebirth', 'revive', 'natures_cure', 'riptide',
        'healing_wave', 'healing_surge', 'greater_healing_wave', 'chain_heal',
        'healing_rain', 'spirit_link', 'cleanse_spirit', 'ancestral_spirit',
        'innervate', 'remove_curse', 'remove_corruption', 'bone_shield',
        'vampiric_blood', 'pillar_of_frost', 'horn_of_winter', 'slice_and_dice',
        'adrenaline_rush', 'feint', 'bloodlust', 'time_warp', 'arcane_power',
        'arcane_brilliance', 'mark_of_the_wild', 'natures_swiftness',
      ].includes(slot.spellId) ||
      Boolean(
        normSlotSpell &&
          (normSlotSpell.isHeal ||
            normSlotSpell.isShield ||
            normSlotSpell.isResurrect ||
            normSlotSpell.isDispel ||
            normSlotSpell.isDefensive ||
            normSlotSpell.isResourceRestore)
      );

    let effectiveTarget: Unit = player;

    if (isFriendlySpell) {
      if (
        slot.spellId === 'revive' ||
        slot.spellId === 'ancestral_spirit' ||
        slot.spellId === 'rebirth' ||
        slot.spellId === 'redemption' ||
        slot.spellId === 'resurrection' ||
        normSlotSpell?.isResurrect
      ) {
        const deadAlly = selectedTargetId
          ? engine.friendlyUnits.find(u => u.id === selectedTargetId && ((!u.isAlive && !u.alive) || u.hp <= 0))
          : engine.friendlyUnits.find(u => (!u.isAlive && !u.alive) || u.hp <= 0);
        if (!deadAlly) {
          engine.effectsManager?.addFloatingText({
            targetId: player.id,
            text: '❌ 没有需要复活的阵亡目标',
            category: 'STATUS',
            isCrit: false,
          });
          return;
        }
        effectiveTarget = deadAlly;
      } else {
        const hoveredFriendly = null;
        const selectedFriendly = selectedTargetId ? engine.friendlyUnits.find(u => u.id === selectedTargetId) : null;
        effectiveTarget = hoveredFriendly || selectedFriendly || player;
      }
    } else {
      const selectedEnemy = selectedTargetId
        ? engine.enemyUnits.find(u => u.id === selectedTargetId && (u.isAlive ?? u.alive) && u.hp > 0)
        : null;

      if (selectedEnemy) {
        effectiveTarget = selectedEnemy;
      } else {
        const livingEnemies = engine.enemyUnits.filter(u => (u.isAlive ?? u.alive) && u.hp > 0);
        if (livingEnemies.length === 0) {
          engine.effectsManager?.addFloatingText({
            targetId: player.id,
            text: '❌ 没有可攻击的目标 (敌方首领已阵亡)',
            category: 'STATUS',
            isCrit: false,
          });
          return;
        }

        let nearestEnemy = livingEnemies[0];
        let minDist = Infinity;
        const pX = player.position?.x ?? 180;
        const pY = player.position?.y ?? 190;
        for (const enemy of livingEnemies) {
          const eX = enemy.position?.x ?? 520;
          const eY = enemy.position?.y ?? 190;
          const dist = Math.hypot(eX - pX, eY - pY);
          if (dist < minDist) {
            minDist = dist;
            nearestEnemy = enemy;
          }
        }

        effectiveTarget = nearestEnemy;
        if (boss && nearestEnemy.id === boss.id) {
          effectiveTarget = boss;
        }
        if (selectedTargetId !== effectiveTarget.id) {
          setSelectedTargetId(effectiveTarget.id);
        }
      }
    }
    castTargetIdRef.current = effectiveTarget.id;
    const effectiveFriendly = effectiveTarget;

    // ── Check Out-of-Combat-Only Spell Restriction ────────────────────
    if (
      slot.spellId === 'revive' ||
      slot.spellId === 'ancestral_spirit' ||
      slot.spellId === 'redemption' ||
      slot.spellId === 'resurrection' ||
      normSlotSpell?.isOutOfCombatOnly
    ) {
      if (runPhase === 'BOSS_COMBAT') {
        engine.effectsManager?.addFloatingText({
          targetId: player.id,
          text: '❌ 无法在战斗中使用！(仅非战斗状态可用)',
          category: 'STATUS',
          isCrit: false,
        });
        return;
      }
    }

    // ── Distance Check & Auto-approach Target ─────────────────────────
    const isSelfOrPartyWide =
      [
        'bone_shield', 'vampiric_blood', 'pillar_of_frost', 'horn_of_winter',
        'slice_and_dice', 'adrenaline_rush', 'feint', 'bloodlust', 'time_warp',
        'arcane_power', 'tranquility', 'natures_swiftness',
      ].includes(slot.spellId) ||
      Boolean(normSlotSpell && (normSlotSpell.isDefensive || normSlotSpell.isResourceRestore));

    const isMelee =
      [
        'death_strike', 'heart_strike', 'rune_strike', 'mind_freeze', 'sinister_strike',
        'eviscerate', 'kick', 'obliterate', 'frost_strike', 'mutilate', 'envenom',
      ].includes(slot.spellId) ||
      Boolean(normSlotSpell && normSlotSpell.school === 'PHYSICAL' && normSlotSpell.classId !== 'HUNTER' && !normSlotSpell.isTaunt && !normSlotSpell.isDefensive && !normSlotSpell.isHeal);
    const maxAllowedRange = isMelee ? 80 : 360;

    if (!isSelfOrPartyWide) {
      const tX = effectiveTarget.position?.x ?? 520;
      const tY = effectiveTarget.position?.y ?? 190;
      const pX = player.position?.x ?? 180;
      const pY = player.position?.y ?? 190;
      const distToTarget = Math.hypot(tX - pX, tY - pY);

      if (distToTarget > maxAllowedRange) {
        window.dispatchEvent(new CustomEvent('cata_ui_error', { detail: { text: '目标太远了' } }));
        setAutoApproachTarget({
          targetX: tX,
          targetY: tY,
          desiredDist: maxAllowedRange - 20,
          pendingSlotIdx: slotIdx,
        });
        engine.effectsManager?.addFloatingText({
          targetId: player.id,
          text: '🏃 距离不足，正在自动靠近目标...',
          category: 'STATUS',
          isCrit: false,
        });
        return;
      } else {
        setAutoApproachTarget(null);
      }
    }

    // If player casts an ability while in staging approach, trigger combat pull
    if (isApproaching) {
      setIsApproaching(false);
    }

    // ── Target Liveness Check ─────────────────────────────────────────
    const isRevive =
      slot.spellId === 'revive' ||
      slot.spellId === 'ancestral_spirit' ||
      slot.spellId === 'rebirth' ||
      slot.spellId === 'redemption' ||
      slot.spellId === 'resurrection' ||
      Boolean(normSlotSpell?.isResurrect);
    const isTargetAlive = (effectiveTarget.isAlive ?? effectiveTarget.alive) && effectiveTarget.hp > 0;
    if (!isRevive && !isTargetAlive) {
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '❌ 目标已死亡',
        category: 'STATUS',
        isCrit: false,
      });
      return;
    }
    if (isRevive && isTargetAlive) {
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '❌ 目标不需要复活',
        category: 'STATUS',
        isCrit: false,
      });
      return;
    }

    // ── Swiftmend Prerequisite Check (目标身上必须有回春术或愈合，否则无法施放且不扣蓝不进CD) ──
    if (slot.spellId === 'swiftmend') {
      const hasRejuvOrRegrowth = effectiveFriendly.buffs.some(b => b.spellId === 'rejuvenation' || b.spellId === 'regrowth');
      if (!hasRejuvOrRegrowth) {
        engine.effectsManager?.addFloatingText({
          targetId: player.id,
          text: '❌ 目标身上没有回春术或愈合！无法施放迅捷治愈',
          category: 'STATUS',
          isCrit: false,
        });
        return;
      }
    }

    // ── Deduct Resource (INSTANT & CHANNELED immediately; CASTED defers until cast completion) ──
    const spellCostBundle: SpellResourceCostBundle = {
      mana: manaCost,
      energy: energyCost,
      rage: rageCost,
      focus: focusCost,
      runicPower: runicCost,
      holyPower: holyPowerCost,
    };

    if (castLifecycle.deductResourceOnStart) {
      deductPlayerResources(player, spellCostBundle, syncUnitResources);
    }

    if (!isOffGcd && castLifecycle.triggerGcdOnStart) {
      const gcdCat = getSpellGcdCategory(slot.spellId, player.classId);
      const gcdMs = getEffectiveGcdMs(gcdCat, player.stats?.haste ?? LEVEL_80_MAX_HASTE);
      if (gcdMs > 0) {
        setPlayerGcdRemainingMs(gcdMs);
        setPlayerGcdTotalMs(gcdMs);
        engine.cooldownManager?.startGcd?.(player.id, gcdMs);
      }
    }

    const triggerSlotCooldown = (explicitCdMs?: number) => {
      const defaultCd = DEFAULT_SPELL_COOLDOWNS[slot.spellId] || normSlotSpell?.cooldownMs || 0;
      const cd = explicitCdMs ?? ((slot.totalCdMs && slot.totalCdMs > 0) ? slot.totalCdMs : defaultCd);
      if (cd > 0) {
        triggerCooldown(slot.spellId, cd);
      }
    };

    const startPlayerCast = (newCast: PlayerCastState) => {
      const effectiveIsChannel = Boolean(newCast.isChannel || isSlotChanneled);
      const castStateWithLifecycle: PlayerCastState = {
        ...newCast,
        isChannel: effectiveIsChannel,
        deferredCosts: effectiveIsChannel ? undefined : spellCostBundle,
      };
      // 引导技能起手立即触发冷却（读条技能不进CD，直到读完结算成功才进CD）
      if (effectiveIsChannel) {
        triggerSlotCooldown(newCast.totalCdMs && newCast.totalCdMs > 0 ? newCast.totalCdMs : undefined);
      }
      playerCastRef.current = castStateWithLifecycle;
      setPlayerCast(castStateWithLifecycle);
      if (!castStateWithLifecycle.isHarmful && !castStateWithLifecycle.isChannel && castStateWithLifecycle.targetId) {
        const pAmt = getPredictedHealAmount(castStateWithLifecycle.spellId, player);
        if (pAmt > 0) {
          const castObj: IncomingHealCast = {
            casterId: player.id || 'p1_player',
            casterName: player.name || '勇士',
            spellName: castStateWithLifecycle.spellName,
            amount: pAmt,
            progress: 0,
            classId: player.classId || 'DRUID',
          };
          setIncomingCasts((prev) => {
            const existing = prev[castStateWithLifecycle.targetId!]?.filter(c => c.casterId !== (player.id || 'p1_player')) || [];
            return {
              ...prev,
              [castStateWithLifecycle.targetId!]: [...existing, castObj],
            };
          });
          setIncomingHeals((prev) => ({
            ...prev,
            [castStateWithLifecycle.targetId!]: (prev[castStateWithLifecycle.targetId!] || 0) + pAmt,
          }));
        }
      }
    };

    // ── Druid: Nature's Swiftness (自然迅捷) ──
    if (slot.spellId === 'natures_swiftness') {
      engine.applyBuff(player, {
        id: `ns_${Date.now()}`,
        spellId: 'natures_swiftness',
        name: '自然迅捷',
        kind: 'BUFF',
        tags: ['STAT'],
        sourceUnitId: player.id,
        targetUnitId: player.id,
        stacks: 1,
        maxStacks: 1,
        durationMs: 60000,
        remainingMs: 60000,
        school: 'NATURE',
      });
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '⚡ 自然迅捷已激活！(下一自然法术瞬发+50%治疗)',
        category: 'STATUS',
        isCrit: false,
      });
      triggerSlotCooldown();
      return;
    }

    // ── Nature's Swiftness Instant Cast Consumption ──
    if (isInstantViaNs) {
      // 消耗自然迅捷 buff
      player.buffs = player.buffs.filter(b => b.spellId !== 'natures_swiftness');

      if (slot.spellId === 'healing_touch') {
        const target = effectiveFriendly;
        const isCrit = Math.random() < 0.35;
        const healVal = Math.round(34000 * 1.5);
        engine.healUnit(player, target, healVal, isCrit, '治疗之触 (自然迅捷)');
        engine.effectsManager?.addFloatingText({
          targetId: target.id,
          text: '⚡ 自然迅捷·治疗之触！',
          category: 'HEAL',
          isCrit: true,
        });
        triggerSlotCooldown();
        return;
      } else if (slot.spellId === 'regrowth') {
        const target = effectiveFriendly;
        const isCrit = Math.random() < 0.3;
        const healVal = Math.round(16000 * 1.5);
        engine.healUnit(player, target, healVal, isCrit, '愈合 (自然迅捷)');
        engine.applyBuff(target, {
          id: `regrowth_${Date.now()}`,
          spellId: 'regrowth',
          name: '愈合 (HoT)',
          kind: 'BUFF',
          tags: ['HOT'],
          sourceUnitId: player.id,
          targetUnitId: target.id,
          stacks: 1,
          maxStacks: 1,
          durationMs: 6000,
          remainingMs: 6000,
          school: 'NATURE',
          tickIntervalMs: 2000,
          tickValue: 3200,
        });
        engine.effectsManager?.addFloatingText({
          targetId: target.id,
          text: '⚡ 自然迅捷·愈合！',
          category: 'HEAL',
          isCrit: true,
        });
        triggerSlotCooldown();
        return;
      } else if (slot.spellId === 'nourish') {
        const target = effectiveFriendly;
        const isCrit = Math.random() < 0.25;
        const hasHot = target.buffs.some(b => ['rejuvenation', 'regrowth', 'lifebloom', 'wild_growth'].includes(b.spellId));
        const baseVal = hasHot ? Math.round(9500 * 1.2) : 9500;
        const healVal = Math.round(baseVal * 1.5);
        engine.healUnit(player, target, healVal, isCrit, '滋养 (自然迅捷)');
        engine.effectsManager?.addFloatingText({
          targetId: target.id,
          text: '⚡ 自然迅捷·滋养！',
          category: 'HEAL',
          isCrit: true,
        });
        triggerSlotCooldown();
        return;
      } else if (slot.spellId === 'wrath') {
        if (effectiveTarget && (effectiveTarget.isAlive ?? effectiveTarget.alive) && effectiveTarget.hp > 0) {
          const isCrit = Math.random() < 0.3;
          engine.dealDamage(player, effectiveTarget, 13500, 'NATURE', isCrit, '愤怒 (自然迅捷)');
          engine.threatManager.addThreat(effectiveTarget.id, player.id, 13500);
          engine.effectsManager?.addFloatingText({
            targetId: effectiveTarget.id,
            text: '⚡ 自然迅捷·愤怒！',
            category: 'SPELL_NATURE',
            isCrit: true,
          });
        }
        triggerSlotCooldown();
        return;
      } else if (slot.spellId === 'rebirth') {
        const deadTarget = effectiveFriendly;
        if (deadTarget && ((!deadTarget.isAlive && !deadTarget.alive) || deadTarget.hp <= 0)) {
          engine.resurrectUnit(deadTarget.id, 0.6, 0.6);
          engine.effectsManager?.addFloatingText({
            targetId: deadTarget.id,
            text: '⚡ 自然迅捷·复生！(瞬发战复)',
            category: 'HEAL',
            isCrit: true,
          });
          setFriendlyUnits([...engine.friendlyUnits]);
        }
        triggerSlotCooldown(600000);
        return;
      } else if (slot.spellId === 'revive') {
        const deadTarget = effectiveFriendly;
        deadTarget.alive = true;
        deadTarget.isAlive = true;
        deadTarget.hp = Math.round(deadTarget.maxHp * 0.35);
        engine.effectsManager?.addFloatingText({
          targetId: deadTarget.id,
          text: '⚡ 自然迅捷·起死回生！',
          category: 'STATUS',
          isCrit: true,
        });
        triggerSlotCooldown();
        return;
      }
    }

    // ── Spells with Cast Bars or Channels ──────────────────────────────
    if (slot.spellId === 'fireball') {
      startPlayerCast({
        spellName: '火球术',
        spellId: 'fireball',
        progress: 0,
        elapsedMs: 0,
        totalMs: 2250,
        targetId: effectiveTarget.id,
        isHarmful: true,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return;
    } else if (slot.spellId === 'pyroblast') {
      startPlayerCast({
        spellName: '炎爆术',
        spellId: 'pyroblast',
        progress: 0,
        elapsedMs: 0,
        totalMs: 3500,
        targetId: effectiveTarget.id,
        isHarmful: true,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return;
    } else if (slot.spellId === 'frostbolt') {
      startPlayerCast({
        spellName: '寒冰箭',
        spellId: 'frostbolt',
        progress: 0,
        elapsedMs: 0,
        totalMs: 2000,
        targetId: effectiveTarget.id,
        isHarmful: true,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return;
    } else if (slot.spellId === 'arcane_blast') {
      startPlayerCast({
        spellName: '奥术冲击',
        spellId: 'arcane_blast',
        progress: 0,
        elapsedMs: 0,
        totalMs: 2000,
        targetId: effectiveTarget.id,
        isHarmful: true,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return;
    } else if (slot.spellId === 'arcane_missiles') {
      startPlayerCast({
        spellName: '奥术飞弹 (引导施法中...)',
        spellId: 'arcane_missiles',
        progress: 0,
        elapsedMs: 0,
        totalMs: 2500,
        isChannel: true,
        targetId: effectiveTarget.id,
        isHarmful: true,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return;
    } else if (slot.spellId === 'wrath') {
      startPlayerCast({
        spellName: '愤怒',
        spellId: 'wrath',
        progress: 0,
        elapsedMs: 0,
        totalMs: 1500,
        targetId: effectiveTarget.id,
        isHarmful: true,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return;
    } else if (slot.spellId === 'starfire') {
      startPlayerCast({
        spellName: '星火术',
        spellId: 'starfire',
        progress: 0,
        elapsedMs: 0,
        totalMs: 2700,
        targetId: effectiveTarget.id,
        isHarmful: true,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return;
    } else if (slot.spellId === 'starsurge') {
      startPlayerCast({
        spellName: '星涌术',
        spellId: 'starsurge',
        progress: 0,
        elapsedMs: 0,
        totalMs: 2000,
        targetId: effectiveTarget.id,
        isHarmful: true,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 15000,
      });
      return;
    } else if (slot.spellId === 'lightning_bolt') {
      startPlayerCast({
        spellName: '闪电箭',
        spellId: 'lightning_bolt',
        progress: 0,
        elapsedMs: 0,
        totalMs: 2000,
        targetId: effectiveTarget.id,
        isHarmful: true,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return;
    } else if (slot.spellId === 'lava_burst') {
      startPlayerCast({
        spellName: '熔岩爆裂',
        spellId: 'lava_burst',
        progress: 0,
        elapsedMs: 0,
        totalMs: 1500,
        targetId: effectiveTarget.id,
        isHarmful: true,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 8000,
      });
      return;
    } else if (slot.spellId === 'chain_lightning') {
      startPlayerCast({
        spellName: '闪电链',
        spellId: 'chain_lightning',
        progress: 0,
        elapsedMs: 0,
        totalMs: 2000,
        targetId: effectiveTarget.id,
        isHarmful: true,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 3000,
      });
      return;
    } else if (slot.spellId === 'healing_wave') {
      startPlayerCast({
        spellName: '治疗波',
        spellId: 'healing_wave',
        progress: 0,
        elapsedMs: 0,
        totalMs: 2500,
        targetId: effectiveTarget.id,
        isHarmful: false,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return;
    } else if (slot.spellId === 'healing_surge') {
      startPlayerCast({
        spellName: '治疗之涌',
        spellId: 'healing_surge',
        progress: 0,
        elapsedMs: 0,
        totalMs: 1500,
        targetId: effectiveTarget.id,
        isHarmful: false,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return;
    } else if (slot.spellId === 'greater_healing_wave') {
      startPlayerCast({
        spellName: '强效治疗波',
        spellId: 'greater_healing_wave',
        progress: 0,
        elapsedMs: 0,
        totalMs: 2500,
        targetId: effectiveTarget.id,
        isHarmful: false,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return;
    } else if (slot.spellId === 'nourish') {
      startPlayerCast({
        spellName: '滋养',
        spellId: 'nourish',
        progress: 0,
        elapsedMs: 0,
        totalMs: 2500,
        targetId: effectiveTarget.id,
        isHarmful: false,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return;
    } else if (slot.spellId === 'regrowth') {
      startPlayerCast({
        spellName: '愈合',
        spellId: 'regrowth',
        progress: 0,
        elapsedMs: 0,
        totalMs: 1500,
        targetId: effectiveTarget.id,
        isHarmful: false,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return;
    } else if (slot.spellId === 'healing_touch') {
      startPlayerCast({
        spellName: '治疗之触',
        spellId: 'healing_touch',
        progress: 0,
        elapsedMs: 0,
        totalMs: 2500,
        targetId: effectiveTarget.id,
        isHarmful: false,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return;
    } else if (slot.spellId === 'tranquility') {
      startPlayerCast({
        spellName: '宁静 (引导施法中...)',
        spellId: 'tranquility',
        progress: 0,
        elapsedMs: 0,
        totalMs: 8000,
        isChannel: true,
        targetId: player.id,
        isHarmful: false,
        maxAllowedRange: 360,
        totalCdMs: slot.totalCdMs || 180000,
      });
      return;
    } else if (slot.spellId === 'rebirth') {
      startPlayerCast({
        spellName: '复生 (战斗复活)',
        spellId: 'rebirth',
        progress: 0,
        elapsedMs: 0,
        totalMs: 2000,
        targetId: effectiveTarget.id,
        isHarmful: false,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 600000,
      });
      return;
    } else if (slot.spellId === 'revive' || slot.spellId === 'ancestral_spirit') {
      startPlayerCast({
        spellName: slot.name,
        spellId: slot.spellId,
        progress: 0,
        elapsedMs: 0,
        totalMs: 3000,
        targetId: effectiveTarget.id,
        isHarmful: false,
        maxAllowedRange,
        totalCdMs: slot.totalCdMs || 0,
      });
      return;
    }

    // ── Dispel Spells ─────────────────────────────────────────────────
    if (
      slot.spellId === 'natures_cure' ||
      slot.spellId === 'cleanse_spirit' ||
      slot.spellId === 'remove_curse' ||
      slot.spellId === 'remove_corruption'
    ) {
      handleDispelUnit(effectiveFriendly.id);
      return;
    }

    // ── Instant Spells & HoTs/DoTs ─────────────────────────────────────
    // Druid HoTs
    if (slot.spellId === 'rejuvenation') {
      const target = effectiveFriendly;
      engine.applyBuff(target, {
        id: `rejuv_${Date.now()}`,
        spellId: 'rejuvenation',
        name: '回春术 (HoT)',
        kind: 'BUFF',
        tags: ['HOT'],
        sourceUnitId: player.id,
        targetUnitId: target.id,
        stacks: 1,
        maxStacks: 1,
        durationMs: 12000,
        remainingMs: 12000,
        school: 'NATURE',
        tickIntervalMs: 3000,
        tickValue: 4500,
      });
      engine.effectsManager?.addFloatingText({
        targetId: target.id,
        text: '回春术',
        category: 'HEAL',
        isCrit: false,
      });
      triggerSlotCooldown();
      return;
    } else if (slot.spellId === 'lifebloom') {
      const target = effectiveFriendly;
      // 生命绽放唯一目标限制：同一释放者同时只能给一个人维持生命绽放；若给其他人施放，立即没收该释放者给其他人施加的生命绽放buff（包括所有层数）
      for (const u of engine.getAllUnits()) {
        if (u.id !== target.id) {
          while (engine.auraManager.removeBuff(u, 'lifebloom', player.id)) {}
        }
      }
      const existing = target.buffs.find(b => b.spellId === 'lifebloom' && b.sourceUnitId === player.id);
      if (existing) {
        // 多层生命绽放共用同一个倒计时条，不是每层独立计时；层数只加每跳治疗量，不单独有各自的时间
        // 基础持续 15 秒，每 2 秒一跳 HOT，最多叠 3 层；每次叠加或刷新时倒计时重置为 15 秒
        if (existing.stacks < 3) {
          existing.stacks += 1;
        }
        existing.remainingMs = 15000;
        existing.durationMs = 15000;
        delete existing.stackRemainingMs;
        existing.name = `生命绽放 (${existing.stacks}层)`;
      } else {
        engine.applyBuff(target, {
          id: `lb_${Date.now()}`,
          spellId: 'lifebloom',
          name: '生命绽放 (1层)',
          kind: 'BUFF',
          tags: ['HOT'],
          sourceUnitId: player.id,
          targetUnitId: target.id,
          stacks: 1,
          maxStacks: 3,
          durationMs: 15000,
          remainingMs: 15000,
          school: 'NATURE',
          tickIntervalMs: 2000,
          tickValue: 2400,
        });
      }
      setFriendlyUnits([...engine.friendlyUnits]);
      engine.effectsManager?.addFloatingText({
        targetId: target.id,
        text: `生命绽放 (${existing ? existing.stacks : 1}层)`,
        category: 'HEAL',
        isCrit: false,
      });
      triggerSlotCooldown();
      return;
    } else if (slot.spellId === 'swiftmend') {
      const target = effectiveFriendly;
      const hotIdx = target.buffs.findIndex(b => b.spellId === 'rejuvenation' || b.spellId === 'regrowth');
      if (hotIdx === -1) {
        engine.effectsManager?.addFloatingText({
          targetId: player.id,
          text: '❌ 目标身上没有回春术或愈合！无法施放迅捷治愈',
          category: 'STATUS',
          isCrit: false,
        });
        return;
      }
      const consumedBuff = target.buffs.splice(hotIdx, 1)[0];
      setFriendlyUnits([...engine.friendlyUnits]);
      engine.effectsManager?.addFloatingText({
        targetId: target.id,
        text: `迅捷治愈 (消耗${consumedBuff.name.split(' ')[0]})`,
        category: 'HEAL',
        isCrit: true,
      });
      engine.healUnit(player, target, 28000, Math.random() < 0.3, '迅捷治愈');
      // Summons Efflorescence (百花齐放) healing circle zone on ground
      engine.effectsManager?.addGroundEffect({
        id: `efflor_${Date.now()}`,
        kind: 'HEAL_ZONE',
        spellId: 'swiftmend',
        ownerId: player.id,
        x: target.position.x || 160,
        y: target.position.y || 220,
        radius: 50,
        colorHex: '#6FCF97',
        remainingMs: 7000,
        tickIntervalMs: 1000,
        tickElapsedMs: 0,
        tickValue: 3800,
      });
      triggerSlotCooldown();
      return;
    } else if (slot.spellId === 'wild_growth') {
      const centerTarget = effectiveFriendly || player;
      const tX = centerTarget.position?.x ?? 180;
      const tY = centerTarget.position?.y ?? 190;
      const radius = 270; // 30码范围 (40码=360px -> 30码=270px)
      const maxTargets = 5; // 严格最多 5 个友方（包含自己作为候选目标之一）

      // 筛选目标身边30码范围内的存活友方单位（包含玩家自己，作为可选目标之一）
      const inRangeAllies = engine.friendlyUnits.filter(u => {
        const isAlive = (u.isAlive ?? u.alive) && u.hp > 0;
        if (!isAlive) return false;
        const uX = u.position?.x ?? tX;
        const uY = u.position?.y ?? tY;
        return Math.hypot(uX - tX, uY - tY) <= radius;
      });

      // 优先选择血量百分比最低的受伤队友（若百分比相同则缺血数值更多者优先；机制是在范围内挑选血量最低的友方，不保证必加到自己）
      inRangeAllies.sort((a, b) => {
        const pctA = a.hp / Math.max(1, a.maxHp);
        const pctB = b.hp / Math.max(1, b.maxHp);
        if (Math.abs(pctA - pctB) > 0.0001) {
          return pctA - pctB;
        }
        return (a.hp - a.maxHp) - (b.hp - b.maxHp);
      });

      // 最多对 5 个目标施加野性成长 HoT（无其他队友时至少作用于主目标）
      const chosen = inRangeAllies.slice(0, maxTargets);
      if (chosen.length === 0) {
        chosen.push(centerTarget);
      }

      for (const u of chosen) {
        engine.applyBuff(u, {
          id: `wg_${Date.now()}_${u.id}`,
          spellId: 'wild_growth',
          name: '野性成长',
          kind: 'BUFF',
          tags: ['HOT'],
          sourceUnitId: player.id,
          targetUnitId: u.id,
          stacks: 1,
          maxStacks: 1,
          durationMs: 7000,
          remainingMs: 7000,
          school: 'NATURE',
          tickIntervalMs: 1000,
          tickValue: 2400,
        });
        engine.effectsManager?.addFloatingText({
          targetId: u.id,
          text: '野性成长',
          category: 'HEAL',
          isCrit: false,
        });
      }
      triggerSlotCooldown();
      return;
    } else if (slot.spellId === 'moonfire') {
      if (boss && boss.alive) {
        engine.dealDamage(player, boss, 4800, 'ARCANE', false, '月火术');
        engine.applyBuff(boss, {
          id: `mf_${Date.now()}`,
          spellId: 'moonfire',
          name: '月火术 (DoT)',
          kind: 'DEBUFF',
          tags: ['DOT'],
          sourceUnitId: player.id,
          targetUnitId: boss.id,
          stacks: 1,
          maxStacks: 1,
          durationMs: 14000,
          remainingMs: 14000,
          school: 'ARCANE',
          tickIntervalMs: 2000,
          tickValue: 2800,
        });
        triggerSlotCooldown();
      }
      return;
    } else if (slot.spellId === 'sunfire') {
      if (boss && boss.alive) {
        engine.dealDamage(player, boss, 4800, 'NATURE', false, '日火术');
        engine.applyBuff(boss, {
          id: `sf_${Date.now()}`,
          spellId: 'sunfire',
          name: '日火术 (DoT)',
          kind: 'DEBUFF',
          tags: ['DOT'],
          sourceUnitId: player.id,
          targetUnitId: boss.id,
          stacks: 1,
          maxStacks: 1,
          durationMs: 14000,
          remainingMs: 14000,
          school: 'NATURE',
          tickIntervalMs: 2000,
          tickValue: 2800,
        });
        triggerSlotCooldown();
      }
      return;
    } else if (slot.spellId === 'innervate') {
      const target = effectiveFriendly;
      engine.applyBuff(target, {
        id: `inn_${Date.now()}`,
        spellId: 'innervate',
        name: '激活 (法力回复)',
        kind: 'BUFF',
        tags: ['STAT'],
        sourceUnitId: player.id,
        targetUnitId: target.id,
        stacks: 1,
        maxStacks: 1,
        durationMs: 10000,
        remainingMs: 10000,
        school: 'NATURE',
      });
      engine.effectsManager?.addFloatingText({
        targetId: target.id,
        text: '激活 (每秒回复5%法力)',
        category: 'HEAL',
        isCrit: false,
      });
      triggerSlotCooldown(180000);
      return;
    }

    // Death Knight Abilities
    if (slot.spellId === 'death_strike') {
      if (boss && boss.alive) {
        engine.dealDamage(player, boss, 9800, 'PHYSICAL', Math.random() < 0.3, '灵界打击');
        engine.healUnit(player, player, 12000, false, '灵界打击');
        engine.threatManager.addThreat(boss.id, player.id, 25000);
        triggerSlotCooldown();
      }
      return;
    } else if (slot.spellId === 'heart_strike' || slot.spellId === 'rune_strike') {
      if (boss && boss.alive) {
        const sName = slot.spellId === 'rune_strike' ? '符文打击' : '心脏打击';
        engine.dealDamage(player, boss, 7500, 'PHYSICAL', Math.random() < 0.25, sName);
        engine.threatManager.addThreat(boss.id, player.id, 18000);
        triggerSlotCooldown();
      }
      return;
    } else if (slot.spellId === 'dark_command') {
      if (boss && boss.alive) {
        engine.threatManager.applyTaunt(boss.id, player.id);
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
          text: '黑暗命令 (嘲讽！)',
          category: 'CRIT',
          isCrit: true,
        });
        triggerSlotCooldown();
      }
      return;
    } else if (slot.spellId === 'bone_shield') {
      engine.applyBuff(player, {
        id: `bone_shield_${Date.now()}`,
        spellId: 'bone_shield',
        name: '白骨之盾 (6层)',
        kind: 'BUFF',
        tags: ['SHIELD'],
        sourceUnitId: player.id,
        targetUnitId: player.id,
        stacks: 6,
        maxStacks: 6,
        durationMs: 300000,
        remainingMs: 300000,
        school: 'SHADOW',
      });
      player.absorb = (player.absorb || 0) + 18000;
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '白骨之盾 +18,000吸收盾',
        category: 'HEAL',
        isCrit: true,
      });
      triggerSlotCooldown();
      return;
    } else if (slot.spellId === 'vampiric_blood') {
      engine.applyBuff(player, {
        id: `vb_${Date.now()}`,
        spellId: 'vampiric_blood',
        name: '吸血鬼之血',
        kind: 'BUFF',
        tags: ['STAT'],
        sourceUnitId: player.id,
        targetUnitId: player.id,
        stacks: 1,
        maxStacks: 1,
        durationMs: 10000,
        remainingMs: 10000,
        school: 'PHYSICAL',
      });
      player.hp = Math.min(player.maxHp + 25000, player.hp + 25000);
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '吸血鬼之血 +25,000临时生命',
        category: 'HEAL',
        isCrit: true,
      });
      triggerSlotCooldown();
      return;
    } else if (slot.spellId === 'death_and_decay') {
      const bossPos = engine.bossUnit?.position || { x: 520, y: 200 };
      engine.effectsManager?.addGroundEffect({
        id: `dnd_${Date.now()}`,
        kind: 'DAMAGE_ZONE',
        spellId: 'death_and_decay',
        ownerId: player.id,
        x: bossPos.x,
        y: bossPos.y,
        radius: 60,
        colorHex: '#8B0000',
        remainingMs: 10000,
        tickIntervalMs: 1000,
        tickElapsedMs: 0,
        tickValue: 3200,
      });
      if (boss && boss.alive) engine.threatManager.addThreat(boss.id, player.id, 15000);
      triggerSlotCooldown();
      return;
    } else if (slot.spellId === 'howling_blast') {
      if (boss && boss.alive) {
        engine.dealDamage(player, boss, 14200, 'FROST', Math.random() < 0.3, '凛风冲击');
        engine.threatManager.addThreat(boss.id, player.id, 14200);
        triggerSlotCooldown();
      }
      return;
    } else if (slot.spellId === 'frost_strike') {
      if (boss && boss.alive) {
        engine.dealDamage(player, boss, 18500, 'FROST', Math.random() < 0.4, '冰霜打击');
        engine.threatManager.addThreat(boss.id, player.id, 18500);
        triggerSlotCooldown();
      }
      return;
    } else if (slot.spellId === 'obliterate') {
      if (boss && boss.alive) {
        setScreenShake(true);
        setTimeout(() => setScreenShake(false), 120);
        engine.dealDamage(player, boss, 27500, 'PHYSICAL', Math.random() < 0.35, '湮灭');
        engine.threatManager.addThreat(boss.id, player.id, 27500);
        triggerSlotCooldown();
      }
      return;
    } else if (slot.spellId === 'pillar_of_frost') {
      engine.applyBuff(player, {
        id: `pof_${Date.now()}`,
        spellId: 'pillar_of_frost',
        name: '冰霜之柱 (+20%力量)',
        kind: 'BUFF',
        tags: ['STAT'],
        sourceUnitId: player.id,
        targetUnitId: player.id,
        stacks: 1,
        maxStacks: 1,
        durationMs: 20000,
        remainingMs: 20000,
        school: 'FROST',
      });
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '冰霜之柱 +20%力量',
        category: 'HEAL',
        isCrit: true,
      });
      triggerSlotCooldown();
      return;
    } else if (slot.spellId === 'horn_of_winter') {
      for (const u of engine.friendlyUnits) {
        if (u.alive) {
          engine.applyBuff(u, {
            id: `how_${u.id}`,
            spellId: 'horn_of_winter',
            name: '寒冬号角 (+属性)',
            kind: 'BUFF',
            tags: ['STAT'],
            sourceUnitId: player.id,
            targetUnitId: u.id,
            stacks: 1,
            maxStacks: 1,
            durationMs: 120000,
            remainingMs: 120000,
            school: 'PHYSICAL',
          });
        }
      }
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '寒冬号角 (全团力量/敏捷提高)',
        category: 'HEAL',
        isCrit: false,
      });
      triggerSlotCooldown();
      return;
    }

    // Interrupts (Mind Freeze, Wind Shear, Counterspell, Kick)
    if (slot.spellId === 'mind_freeze' || slot.spellId === 'wind_shear' || slot.spellId === 'counterspell' || slot.spellId === 'kick') {
      if (boss && (boss.alive || boss.isAlive) && boss.hp > 0 && bossAiRef.current) {
        const success = bossAiRef.current.interruptCurrentCast();
        if (success) {
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '打断成功！',
            category: 'INTERRUPT',
            isCrit: true,
          });
          if (player.combatStats) player.combatStats.interruptCount++;
        } else {
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '未在施法 / 无法打断',
            category: 'STATUS',
            isCrit: false,
          });
        }
        triggerSlotCooldown();
      }
      return;
    }

    // Shaman Abilities
    if (slot.spellId === 'riptide') {
      const target = effectiveFriendly;
      engine.healUnit(player, target, 12000, Math.random() < 0.25, '激流');
      engine.applyBuff(target, {
        id: `rip_${Date.now()}`,
        spellId: 'riptide',
        name: '激流 (HoT)',
        kind: 'BUFF',
        tags: ['HOT'],
        sourceUnitId: player.id,
        targetUnitId: target.id,
        stacks: 1,
        maxStacks: 1,
        durationMs: 15000,
        remainingMs: 15000,
        school: 'NATURE',
        tickIntervalMs: 3000,
        tickValue: 2500,
      });
      triggerSlotCooldown();
      return;
    } else if (slot.spellId === 'chain_heal') {
      // Cataclysm Resto Shaman Chain Heal: 2.5s base cast (1.67s at Lv.80 max haste), 0s CD!
      const hastedMs = getHastedCastTimeMs(2500, player.stats?.haste ?? LEVEL_80_MAX_HASTE);
      startPlayerCast({
        spellId: 'chain_heal',
        spellName: '治疗链',
        elapsedMs: 0,
        totalMs: hastedMs,
        progress: 0,
        isChannel: false,
        isHarmful: false,
        targetId: effectiveFriendly.id,
        totalCdMs: 0,
      });
      return;
    } else if (slot.spellId === 'healing_rain') {
      const rainPos = findOptimalGroundAuraCentroid(player, engine.friendlyUnits, 60, 360);
      engine.effectsManager?.addGroundEffect({
        id: `hrain_${Date.now()}`,
        kind: 'HEAL_ZONE',
        spellId: 'healing_rain',
        ownerId: player.id,
        x: rainPos.x,
        y: rainPos.y,
        radius: 60,
        colorHex: '#4169E1',
        remainingMs: 10000,
        tickIntervalMs: 1000,
        tickElapsedMs: 0,
        tickValue: 3400,
      });
      triggerSlotCooldown();
      return;
    } else if (slot.spellId === 'spirit_link') {
      const target = selectedTargetId
        ? engine.friendlyUnits.find(u => u.id === selectedTargetId) || player
        : player;
      engine.effectsManager?.addGroundEffect({
        id: `slt_${Date.now()}`,
        kind: 'TOTEM',
        spellId: 'spirit_link',
        ownerId: player.id,
        x: target.position.x || 200,
        y: target.position.y || 200,
        radius: 55,
        colorHex: '#00CED1',
        remainingMs: 6000,
        tickIntervalMs: 1000,
        tickElapsedMs: 0,
        tickValue: 2000,
      });
      triggerSlotCooldown();
      return;
    } else if (slot.spellId === 'flame_shock') {
      if (boss && boss.alive) {
        engine.dealDamage(player, boss, 5200, 'FIRE', false, '烈焰震击');
        engine.applyBuff(boss, {
          id: `fs_${Date.now()}`,
          spellId: 'flame_shock',
          name: '烈焰震击 (DoT)',
          kind: 'DEBUFF',
          tags: ['DOT'],
          sourceUnitId: player.id,
          targetUnitId: boss.id,
          stacks: 1,
          maxStacks: 1,
          durationMs: 18000,
          remainingMs: 18000,
          school: 'FIRE',
          tickIntervalMs: 3000,
          tickValue: 3200,
        });
        triggerSlotCooldown();
      }
      return;
    } else if (slot.spellId === 'earth_shock') {
      if (boss && boss.alive) {
        engine.dealDamage(player, boss, 15500, 'NATURE', Math.random() < 0.3, '大地震击');
        engine.threatManager.addThreat(boss.id, player.id, 15500);
        triggerSlotCooldown();
      }
      return;
    } else if (slot.spellId === 'bloodlust') {
      for (const u of engine.friendlyUnits) {
        if (u.alive) {
          engine.applyBuff(u, {
            id: `bl_${u.id}`,
            spellId: 'bloodlust',
            name: '嗜血 (+30%急速)',
            kind: 'BUFF',
            tags: ['BLOODLUST'],
            sourceUnitId: player.id,
            targetUnitId: u.id,
            stacks: 1,
            maxStacks: 1,
            durationMs: 40000,
            remainingMs: 40000,
            school: 'PHYSICAL',
          });
        }
      }
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '嗜血！全团急速+30%',
        category: 'CRIT',
        isCrit: true,
      });
      triggerSlotCooldown();
      return;
    }

    // Mage Abilities
    if (slot.spellId === 'living_bomb') {
      if (boss && boss.alive) {
        engine.dealDamage(player, boss, 5000, 'FIRE', false, '活动炸弹');
        engine.applyBuff(boss, {
          id: `lb_${Date.now()}`,
          spellId: 'living_bomb',
          name: '活动炸弹',
          kind: 'DEBUFF',
          tags: ['DOT'],
          sourceUnitId: player.id,
          targetUnitId: boss.id,
          stacks: 1,
          maxStacks: 1,
          durationMs: 12000,
          remainingMs: 12000,
          school: 'FIRE',
          tickIntervalMs: 3000,
          tickValue: 3500,
        });
        triggerSlotCooldown();
      }
      return;
    } else if (slot.spellId === 'combustion') {
      if (boss && boss.alive) {
        const hasLb = boss.buffs.some(b => b.spellId === 'living_bomb');
        const dmg = hasLb ? 38000 : 16000;
        engine.dealDamage(player, boss, dmg, 'FIRE', true, '燃烧');
        engine.threatManager.addThreat(boss.id, player.id, dmg);
        triggerSlotCooldown();
      }
      return;
    } else if (slot.spellId === 'time_warp') {
      for (const u of engine.friendlyUnits) {
        if (u.alive) {
          engine.applyBuff(u, {
            id: `tw_${u.id}`,
            spellId: 'time_warp',
            name: '时间扭曲 (+30%急速)',
            kind: 'BUFF',
            tags: ['BLOODLUST'],
            sourceUnitId: player.id,
            targetUnitId: u.id,
            stacks: 1,
            maxStacks: 1,
            durationMs: 40000,
            remainingMs: 40000,
            school: 'ARCANE',
          });
        }
      }
      triggerSlotCooldown();
      return;
    } else if (slot.spellId === 'ice_lance') {
      if (boss && boss.alive) {
        engine.dealDamage(player, boss, 9200, 'FROST', Math.random() < 0.4, '冰枪术');
        engine.threatManager.addThreat(boss.id, player.id, 9200);
        triggerSlotCooldown();
      }
      return;
    } else if (slot.spellId === 'deep_freeze') {
      if (boss && boss.alive) {
        setScreenShake(true);
        setTimeout(() => setScreenShake(false), 120);
        engine.dealDamage(player, boss, 34000, 'FROST', true, '深度冻结');
        engine.threatManager.addThreat(boss.id, player.id, 34000);
        triggerSlotCooldown();
      }
      return;
    } else if (slot.spellId === 'frozen_orb') {
      const bossPos = engine.bossUnit?.position || { x: 520, y: 200 };
      engine.effectsManager?.addGroundEffect({
        id: `forb_${Date.now()}`,
        kind: 'DAMAGE_ZONE',
        spellId: 'frozen_orb',
        ownerId: player.id,
        x: bossPos.x,
        y: bossPos.y,
        radius: 65,
        colorHex: '#00BFFF',
        remainingMs: 10000,
        tickIntervalMs: 1000,
        tickElapsedMs: 0,
        tickValue: 4200,
      });
      triggerSlotCooldown();
      return;
    } else if (slot.spellId === 'arcane_barrage') {
      if (boss && boss.alive) {
        engine.dealDamage(player, boss, 19000, 'ARCANE', Math.random() < 0.35, '奥术弹幕');
        engine.threatManager.addThreat(boss.id, player.id, 19000);
        triggerSlotCooldown();
      }
      return;
    } else if (slot.spellId === 'arcane_power') {
      engine.applyBuff(player, {
        id: `ap_${Date.now()}`,
        spellId: 'arcane_power',
        name: '奥术强化 (+20%法伤)',
        kind: 'BUFF',
        tags: ['STAT'],
        sourceUnitId: player.id,
        targetUnitId: player.id,
        stacks: 1,
        maxStacks: 1,
        durationMs: 15000,
        remainingMs: 15000,
        school: 'ARCANE',
      });
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '奥术强化 +20%法伤',
        category: 'CRIT',
        isCrit: true,
      });
      triggerSlotCooldown();
      return;
    }

    // Rogue Abilities
    if (slot.spellId === 'slice_and_dice') {
      engine.applyBuff(player, {
        id: `snd_${Date.now()}`,
        spellId: 'slice_and_dice',
        name: '切割 (+40%攻速)',
        kind: 'BUFF',
        tags: ['STAT'],
        sourceUnitId: player.id,
        targetUnitId: player.id,
        stacks: 1,
        maxStacks: 1,
        durationMs: 24000,
        remainingMs: 24000,
        school: 'PHYSICAL',
      });
      triggerSlotCooldown();
      return;
    } else if (slot.spellId === 'feint') {
      engine.applyBuff(player, {
        id: `feint_${Date.now()}`,
        spellId: 'feint',
        name: '佯攻 (AOE减伤50%)',
        kind: 'BUFF',
        tags: ['STAT'],
        sourceUnitId: player.id,
        targetUnitId: player.id,
        stacks: 1,
        maxStacks: 1,
        durationMs: 5000,
        remainingMs: 5000,
        school: 'PHYSICAL',
      });
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '佯攻 (AOE减伤50%)',
        category: 'HEAL',
        isCrit: false,
      });
      triggerSlotCooldown();
      return;
    } else if (slot.spellId === 'eviscerate') {
      if (boss && boss.alive) {
        engine.dealDamage(player, boss, 22000, 'PHYSICAL', true, '剔骨');
        engine.threatManager.addThreat(boss.id, player.id, 22000);
        triggerSlotCooldown();
      }
      return;
    } else if (slot.spellId === 'adrenaline_rush') {
      engine.applyBuff(player, {
        id: `ar_${Date.now()}`,
        spellId: 'adrenaline_rush',
        name: '冲动 (能量回复+100%)',
        kind: 'BUFF',
        tags: ['STAT'],
        sourceUnitId: player.id,
        targetUnitId: player.id,
        stacks: 1,
        maxStacks: 1,
        durationMs: 15000,
        remainingMs: 15000,
        school: 'PHYSICAL',
      });
      triggerSlotCooldown();
      return;
    } else if (slot.spellId === 'mutilate') {
      if (boss && boss.alive) {
        engine.dealDamage(player, boss, 16800, 'PHYSICAL', Math.random() < 0.35, '毁伤');
        engine.threatManager.addThreat(boss.id, player.id, 16800);
        triggerSlotCooldown();
      }
      return;
    } else if (slot.spellId === 'envenom') {
      if (boss && boss.alive) {
        setScreenShake(true);
        setTimeout(() => setScreenShake(false), 100);
        engine.dealDamage(player, boss, 24500, 'NATURE', Math.random() < 0.4, '毒化');
        engine.threatManager.addThreat(boss.id, player.id, 24500);
        triggerSlotCooldown();
      }
      return;
    } else if (slot.spellId === 'rupture') {
      if (boss && boss.alive) {
        engine.applyBuff(boss, {
          id: `rup_${Date.now()}`,
          spellId: 'rupture',
          name: '割裂 (DoT)',
          kind: 'DEBUFF',
          tags: ['DOT'],
          sourceUnitId: player.id,
          targetUnitId: boss.id,
          stacks: 1,
          maxStacks: 1,
          durationMs: 16000,
          remainingMs: 16000,
          school: 'PHYSICAL',
          tickIntervalMs: 2000,
          tickValue: 3100,
        });
        triggerSlotCooldown();
      }
      return;
    } else if (slot.spellId === 'vendetta') {
      if (boss && boss.alive) {
        engine.applyBuff(boss, {
          id: `ven_${Date.now()}`,
          spellId: 'vendetta',
          name: '宿敌 (+20%易伤)',
          kind: 'DEBUFF',
          tags: ['DEBUFF'],
          sourceUnitId: player.id,
          targetUnitId: boss.id,
          stacks: 1,
          maxStacks: 1,
          durationMs: 20000,
          remainingMs: 20000,
          school: 'PHYSICAL',
        });
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
          text: '宿敌 (受伤害+20%)',
          category: 'CRIT',
          isCrit: true,
        });
        triggerSlotCooldown();
      }
      return;
    }

    // ── Data-Driven Universal Player Spell Executor (Warrior / Paladin / Hunter / Priest / Warlock & All New Spells) ──
    if (normSlotSpell) {
      // Cast-time & Channeled spells start hasted player cast/channel bar
      const normIsChannel = isChanneledSpell({
        spellId: slot.spellId,
        castTimeMs: normSlotSpell.castTimeMs,
        channelDurationMs: normSlotSpell.channelDurationMs,
      });
      if (normIsChannel || normSlotSpell.castTimeMs > 0) {
        const baseDurMs = normIsChannel
          ? (normSlotSpell.channelDurationMs > 0 ? normSlotSpell.channelDurationMs : Math.max(2000, normSlotSpell.castTimeMs))
          : normSlotSpell.castTimeMs;
        const hastedMs = getHastedCastTimeMs(baseDurMs, player.stats?.haste ?? LEVEL_80_MAX_HASTE);
        const defaultCd = DEFAULT_SPELL_COOLDOWNS[slot.spellId] ?? normSlotSpell.cooldownMs ?? 0;
        startPlayerCast({
          spellId: slot.spellId,
          spellName: normIsChannel ? `${normSlotSpell.name} (引导施法中...)` : normSlotSpell.name,
          elapsedMs: 0,
          totalMs: hastedMs,
          progress: 0,
          isChannel: normIsChannel,
          isHarmful: !isFriendlySpell,
          targetId: effectiveTarget.id,
          totalCdMs: defaultCd,
        });
        return;
      }

      // Resource generation for builders (Paladin Holy Power / Warrior Rage / DK Runic Power)
      if (player.classId === 'PALADIN' && normSlotSpell.resourceKind !== 'HOLY_POWER' && !normSlotSpell.isDefensive && !normSlotSpell.isTaunt && !normSlotSpell.isInterrupt) {
        player.holyPower = Math.min(3, (player.holyPower ?? 0) + 1);
      } else if (player.classId === 'WARRIOR' && normSlotSpell.resourceCostAmount === 0) {
        player.rage = Math.min(100, (player.rage ?? 0) + 15);
      }
      syncUnitResources(player);

      // Interrupt
      if (normSlotSpell.isInterrupt) {
        const success = bossAiRef.current?.interruptCurrentCast?.() ?? false;
        if (success) {
          if (player.combatStats) player.combatStats.interruptCount++;
          engine.effectsManager?.addFloatingText({
            targetId: boss?.id || player.id,
            text: `⚡ ${normSlotSpell.name} 打断成功！`,
            category: 'INTERRUPT',
            isCrit: true,
          });
        } else {
          engine.effectsManager?.addFloatingText({
            targetId: player.id,
            text: `${normSlotSpell.name} (目标未在读条)`,
            category: 'STATUS',
            isCrit: false,
          });
        }
        triggerSlotCooldown(normSlotSpell.cooldownMs);
        return;
      }

      // Taunt
      if (normSlotSpell.isTaunt && boss && boss.alive) {
        engine.threatManager.applyTaunt(boss.id, player.id);
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
          text: `🛡️ ${normSlotSpell.name} 嘲讽成功！`,
          category: 'CRIT',
          isCrit: true,
        });
        triggerSlotCooldown(normSlotSpell.cooldownMs);
        return;
      }

      // Dispel
      if (normSlotSpell.isDispel) {
        handleDispelUnit(effectiveFriendly.id);
        return;
      }

      // Buff-only / Buff+Heal skills (Earth Shield / Ascendance / Ancestral Guidance / Unleash Life)
      if (normSlotSpell.isBuff && !normSlotSpell.isDefensive && !normSlotSpell.isShield) {
        const shortId = normSlotSpell.shortId;
        const isUnleashLife = shortId === 'unleash_life';
        const isEarthShield = shortId === 'earth_shield';
        const isSelfBuff =
          normSlotSpell.targetType === 'SELF' ||
          shortId === 'ascendance' ||
          shortId === 'ancestral_guidance';
        const buffTarget = isSelfBuff ? player : effectiveFriendly;
        const auraSpellId = normSlotSpell.auraId || shortId;
        const stacks = isEarthShield ? 9 : 1;

        if (isUnleashLife || (normSlotSpell.isHeal && normSlotSpell.directHeal > 0 && !isSelfBuff)) {
          const healVal = Math.round((normSlotSpell.directHeal || 8500) + (player.stats.spellPower || 3200) * 0.35);
          engine.healUnit(player, effectiveFriendly, healVal, Math.random() < (player.stats.critChance || 0.25), normSlotSpell.name);
        }

        // Unleash Life next-heal buff resides on the caster
        const auraTarget = isUnleashLife ? player : buffTarget;
        engine.applyBuff(auraTarget, {
          id: `${auraSpellId}_${Date.now()}`,
          spellId: auraSpellId,
          name: isEarthShield ? `${normSlotSpell.name} (${stacks}层)` : normSlotSpell.name,
          kind: 'BUFF',
          tags: isEarthShield ? ['SHIELD'] : ['STAT'],
          sourceUnitId: player.id,
          targetUnitId: auraTarget.id,
          stacks,
          maxStacks: stacks,
          durationMs: Math.max(10000, normSlotSpell.durationMs || 15000),
          remainingMs: Math.max(10000, normSlotSpell.durationMs || 15000),
          school: normSlotSpell.school,
        });

        // Ascendance also enables resto heal-duplication via same buff id checked in CombatEngine
        if (shortId === 'ascendance' && (player.classId === 'SHAMAN')) {
          engine.effectsManager?.addFloatingText({
            targetId: player.id,
            text: '升腾！伤害+35% / 治疗复制',
            category: 'CRIT',
            isCrit: true,
          });
        } else {
          engine.effectsManager?.addFloatingText({
            targetId: auraTarget.id,
            text: `✨ ${normSlotSpell.name}`,
            category: 'HEAL',
            isCrit: false,
          });
        }

        triggerSlotCooldown(normSlotSpell.cooldownMs);
        return;
      }

      // Resource Restore
      if (normSlotSpell.isResourceRestore) {
        if (player.maxMp && player.maxMp > 0) {
          player.mp = Math.min(player.maxMp, (player.mp ?? 0) + Math.round(player.maxMp * 0.25));
          syncUnitResources(player);
        }
        engine.applyBuff(player, {
          id: `${normSlotSpell.shortId}_${Date.now()}`,
          spellId: normSlotSpell.shortId,
          name: `${normSlotSpell.name} (+回蓝)`,
          kind: 'BUFF',
          tags: ['STAT'],
          sourceUnitId: player.id,
          targetUnitId: player.id,
          stacks: 1,
          maxStacks: 1,
          durationMs: 10000,
          remainingMs: 10000,
          school: normSlotSpell.school,
        });
        engine.effectsManager?.addFloatingText({
          targetId: player.id,
          text: `✨ ${normSlotSpell.name} 资源恢复！`,
          category: 'HEAL',
          isCrit: true,
        });
        triggerSlotCooldown(normSlotSpell.cooldownMs);
        return;
      }

      // Defensive / Shield
      if (normSlotSpell.isDefensive || normSlotSpell.isShield) {
        const target = normSlotSpell.isShield ? effectiveFriendly : player;
        const shieldVal = Math.round(normSlotSpell.shieldValue || target.maxHp * 0.2);
        target.absorb = Math.min(target.maxHp * 0.5, (target.absorb || 0) + shieldVal);
        engine.applyBuff(target, {
          id: `${normSlotSpell.shortId}_${Date.now()}`,
          spellId: normSlotSpell.shortId,
          name: normSlotSpell.name,
          kind: 'BUFF',
          tags: ['SHIELD'],
          sourceUnitId: player.id,
          targetUnitId: target.id,
          stacks: 1,
          maxStacks: 1,
          durationMs: 12000,
          remainingMs: 12000,
          school: normSlotSpell.school,
        });
        engine.effectsManager?.addFloatingText({
          targetId: target.id,
          text: `🛡️ ${normSlotSpell.name} (+${shieldVal}吸收)`,
          category: 'HEAL',
          isCrit: true,
        });
        triggerSlotCooldown(normSlotSpell.cooldownMs);
        return;
      }

      // Instant Heals (AoE or ST or HoT)
      if (normSlotSpell.isHeal) {
        const spPower = player.stats.spellPower || 3200;
        const isCrit = Math.random() < (player.stats.critChance || 0.25);
        if (normSlotSpell.isAOE) {
          const maxT = Math.max(3, normSlotSpell.maxAoeTargets || 5);
          const wounded = engine.friendlyUnits
            .filter(u => (u.alive || u.isAlive) && u.hp > 0)
            .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))
            .slice(0, maxT);
          const perHeal = Math.round(Math.max(3800, normSlotSpell.directHeal || normSlotSpell.hotTotalHeal * 0.45) + spPower * 0.4);
          for (const ally of wounded) {
            engine.healUnit(player, ally, perHeal, Math.random() < (player.stats.critChance || 0.25), normSlotSpell.name);
          }
        } else {
          if (normSlotSpell.directHeal > 0) {
            const healVal = Math.round(normSlotSpell.directHeal + spPower * 0.5);
            engine.healUnit(player, effectiveFriendly, healVal, isCrit, normSlotSpell.name);
          }
          if (normSlotSpell.isHot && normSlotSpell.hotTotalHeal > 0) {
            engine.applyBuff(effectiveFriendly, {
              id: `${normSlotSpell.shortId}_${Date.now()}`,
              spellId: normSlotSpell.shortId,
              name: `${normSlotSpell.name} (HoT)`,
              kind: 'BUFF',
              tags: ['HOT'],
              sourceUnitId: player.id,
              targetUnitId: effectiveFriendly.id,
              stacks: 1,
              maxStacks: 1,
              durationMs: 12000,
              remainingMs: 12000,
              school: normSlotSpell.school,
              tickIntervalMs: 3000,
              tickValue: Math.round(normSlotSpell.hotTotalHeal / 4),
            });
          }
        }
        triggerSlotCooldown(normSlotSpell.cooldownMs);
        return;
      }

      // Instant Damage (AoE or ST / DoT)
      const power = normSlotSpell.school === 'PHYSICAL' ? (player.stats.attackPower || 3200) : (player.stats.spellPower || 3200);
      if (normSlotSpell.isAOE) {
        const livingEnemies = engine.enemyUnits.filter(e => (e.isAlive ?? e.alive) && e.hp > 0);
        const targets = livingEnemies.slice(0, Math.max(3, normSlotSpell.maxAoeTargets || 6));
        const perDmg = Math.round(Math.max(3200, normSlotSpell.directDamage || normSlotSpell.dotTotalDamage * 0.5) + power * 0.45);
        for (const enemy of targets) {
          engine.dealDamage(player, enemy, perDmg, normSlotSpell.school, Math.random() < (player.stats.critChance || 0.28), normSlotSpell.name);
          engine.threatManager.addThreat(enemy.id, player.id, player.role === 'TANK' ? perDmg * 3 : perDmg);
        }
        triggerSlotCooldown(normSlotSpell.cooldownMs);
        return;
      } else if (boss && boss.alive) {
        const isCrit = Math.random() < (player.stats.critChance || 0.3);
        const dmgVal = Math.round(Math.max(4200, normSlotSpell.directDamage || normSlotSpell.dotTotalDamage * 0.35) + power * 0.55);
        if (isCrit) {
          setScreenShake(true);
          setTimeout(() => setScreenShake(false), 110);
        }
        engine.dealDamage(player, boss, dmgVal, normSlotSpell.school, isCrit, normSlotSpell.name);
        engine.threatManager.addThreat(boss.id, player.id, player.role === 'TANK' ? dmgVal * 3.5 : dmgVal);
        if (normSlotSpell.isDot && normSlotSpell.dotTotalDamage > 0) {
          engine.applyBuff(boss, {
            id: `${normSlotSpell.shortId}_${Date.now()}`,
            spellId: normSlotSpell.shortId,
            name: `${normSlotSpell.name} (DoT)`,
            kind: 'DEBUFF',
            tags: ['DOT'],
            sourceUnitId: player.id,
            targetUnitId: boss.id,
            stacks: 1,
            maxStacks: 1,
            durationMs: 15000,
            remainingMs: 15000,
            school: normSlotSpell.school,
            tickIntervalMs: 3000,
            tickValue: Math.round(normSlotSpell.dotTotalDamage / 5),
          });
        }
        triggerSlotCooldown(normSlotSpell.cooldownMs);
        return;
      }
    }

    // Default Fallback
    if (boss && boss.alive) {
      const isCrit = Math.random() < 0.35;
      if (isCrit) {
        setScreenShake(true);
        setTimeout(() => setScreenShake(false), 120);
      }
      engine.dealDamage(player, boss, 6500, 'PHYSICAL', isCrit, slot.name || '攻击');
      engine.threatManager.addThreat(boss.id, player.id, 6500);
      triggerSlotCooldown();
    }
  };

  // Confirm Ground-Targeted Spell Placement (death_and_decay, healing_rain, spirit_link, etc.)
  const handleConfirmGroundTarget = (slotIdx: number, spellId: string, x: number, y: number) => {
    const engine = engineRef.current;
    const player = engine?.friendlyUnits.find(u => u.isPlayer);
    const boss = engine?.bossUnit;
    if (!engine || !player) return;

    const slots = getPlayerSlots(selectedCharId, currentChar?.lastSpec);
    const slot = slots.find(s => s.slotIdx === slotIdx) || slots[slotIdx];
    const totalCdMs = slot?.totalCdMs || 0;

    // Deduct mana if applicable
    const manaCost = SPELL_MANA_COSTS[spellId] || 0;
    if (manaCost > 0 && player.maxMp && player.maxMp > 0) {
      player.mp = Math.max(0, (player.mp ?? 0) - manaCost);
    }

    const triggerSlotCooldown = () => {
      if (totalCdMs > 0) {
        triggerCooldown(spellId, totalCdMs);
      }
      if (!isOffGcdSpell(spellId)) {
        triggerGcd(spellId);
      }
    };

    if (spellId === 'death_and_decay') {
      engine.effectsManager?.addGroundEffect({
        id: `dnd_${Date.now()}`,
        kind: 'DAMAGE_ZONE',
        spellId: 'death_and_decay',
        ownerId: player.id,
        x,
        y,
        radius: 60,
        colorHex: '#8B0000',
        remainingMs: 10000,
        tickIntervalMs: 1000,
        tickElapsedMs: 0,
        tickValue: 3200,
      });
      if (boss && (boss.alive ?? boss.isAlive)) {
        engine.threatManager.addThreat(boss.id, player.id, 15000);
      }
      triggerSlotCooldown();
      setGroundTargetState(null);
    } else if (spellId === 'healing_rain') {
      engine.effectsManager?.addGroundEffect({
        id: `hrain_${Date.now()}`,
        kind: 'HEAL_ZONE',
        spellId: 'healing_rain',
        ownerId: player.id,
        x,
        y,
        radius: 60,
        colorHex: '#4169E1',
        remainingMs: 10000,
        tickIntervalMs: 1000,
        tickElapsedMs: 0,
        tickValue: 3400,
      });
      triggerSlotCooldown();
      setGroundTargetState(null);
    } else if (spellId === 'spirit_link') {
      engine.effectsManager?.addGroundEffect({
        id: `slt_${Date.now()}`,
        kind: 'TOTEM',
        spellId: 'spirit_link',
        ownerId: player.id,
        x,
        y,
        radius: 55,
        colorHex: '#00CED1',
        remainingMs: 6000,
        tickIntervalMs: 1000,
        tickElapsedMs: 0,
        tickValue: 0,
      });
      triggerSlotCooldown();
      setGroundTargetState(null);
    } else if (spellId === 'healing_tide' || spellId === 'healing_tide_totem') {
      engine.effectsManager?.addGroundEffect({
        id: `htt_${Date.now()}`,
        kind: 'TOTEM',
        spellId: 'healing_tide',
        ownerId: player.id,
        x,
        y,
        radius: 70,
        colorHex: '#0EA5E9',
        remainingMs: 10000,
        tickIntervalMs: 2000,
        tickElapsedMs: 0,
        tickValue: 5200,
      });
      triggerSlotCooldown();
      setGroundTargetState(null);
    } else if (spellId === 'mana_tide' || spellId === 'mana_tide_totem') {
      engine.effectsManager?.addGroundEffect({
        id: `mtt_${Date.now()}`,
        kind: 'TOTEM',
        spellId: 'mana_tide',
        ownerId: player.id,
        x,
        y,
        radius: 70,
        colorHex: '#56CCF2',
        remainingMs: 12000,
        tickIntervalMs: 5000,
        tickElapsedMs: 0,
        tickValue: 0,
      });
      for (const u of engine.friendlyUnits) {
        if (u.alive || u.isAlive) {
          engine.applyBuff(u, {
            id: `mana_tide_${u.id}_${Date.now()}`,
            spellId: 'mana_tide',
            name: '法力之潮',
            kind: 'BUFF',
            tags: ['STAT'],
            sourceUnitId: player.id,
            targetUnitId: u.id,
            stacks: 1,
            maxStacks: 1,
            durationMs: 12000,
            remainingMs: 12000,
            school: 'NATURE',
          });
        }
      }
      triggerSlotCooldown();
      setGroundTargetState(null);
    }
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
    // Clean up active room on combat exit / failure return so no ghost room lingers
    if (activeRoomId && currentChar) {
      roomManager.leaveRoom(activeRoomId, currentChar.id);
    } else if (activeRoomId) {
      roomManager.deleteRoom(activeRoomId);
    }
    roomManager.cleanupAiOnlyRooms();
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

  const handleWipeVote = (choice: 'RETRY' | 'FINISH') => {
    const rsm = rsmRef.current;
    const engine = engineRef.current;
    if (!rsm || !engine) return;

    rsm.handleWipeVoteChoice(choice);

    if (choice === 'FINISH') {
      // Combat failed and ended: immediately clean up the room so it doesn't linger
      if (activeRoomId && currentChar) {
        roomManager.leaveRoom(activeRoomId, currentChar.id);
      } else if (activeRoomId) {
        roomManager.deleteRoom(activeRoomId);
      }
      roomManager.cleanupAiOnlyRooms();
      setActiveRoomId(null);
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
    <div className="w-full min-h-screen bg-[#0c0c16] text-gray-100 flex flex-col font-sans select-none overflow-x-hidden">
      
      {/* Top Header Navigation Bar */}
      <header className="h-14 border-b border-[#252542] bg-[#121224]/90 px-6 flex items-center justify-between backdrop-blur sticky top-0 z-40">
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
      <main className={`flex-1 flex flex-col relative w-full ${runPhase === 'LOBBY' || runPhase === 'SUMMARY' ? 'p-4 items-center justify-center' : 'p-0 overflow-hidden'}`}>
        {runPhase === 'LOBBY' ? (
          lobbySubView === 'ROOM_LIST' && currentChar ? (
            <RoomListView
              rooms={roomFacadeRef.current.listRooms()}
              player={{
                id: currentChar.id,
                name: currentChar.name,
                classId: currentChar.classId,
                spec: currentChar.lastSpec,
              }}
              customDifficulty={customDifficulty}
              onChangeCustomDifficulty={handleCustomDifficultyChange}
              onCreateRoom={handleCreateRoom}
              onJoinRoom={handleJoinRoom}
              onJoinWaitingQueue={handleJoinWaitingQueue}
              onQuickJoin={handleQuickJoin}
              onBackToCharacterSelect={() => setLobbySubView('AUTH_CHAR')}
            />
          ) : lobbySubView === 'ROOM_DETAIL' && activeRoomId && (roomFacadeRef.current.getRoom(activeRoomId) || roomManager.getRoom(activeRoomId)) && currentChar ? (
            <RoomDetailView
              room={(roomFacadeRef.current.getRoom(activeRoomId) || roomManager.getRoom(activeRoomId))!}
              currentPlayerId={currentChar.id}
              roomManager={roomFacadeRef.current}
              customDifficulty={customDifficulty}
              onChangeCustomDifficulty={handleCustomDifficultyChange}
              onLeaveRoom={handleLeaveActiveRoom}
              onStartGame={handleStartGameFromRoom}
              onRefreshRoom={() => setRoomsTick(t => t + 1)}
            />
          ) : (
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
            onCreateCharacter={(name, cls, spec) => {
              const newChar = accountMgrRef.current.createCharacter(name, cls, spec);
              const updatedAcc = accountMgrRef.current.getCurrentAccount();
              setAccount(updatedAcc ? { ...updatedAcc } : null);
              if (newChar) {
                setSelectedCharId(newChar.id);
                const tier = newChar.lastDungeonTier || '5man';
                const diff = newChar.lastDungeonDifficulty || 'HEROIC';
                const customDiff = newChar.lastCustomDifficulty || DEFAULT_CUSTOM_DIFFICULTY;
                setDungeonTier(tier);
                setDungeonDifficulty(diff);
                setCustomDifficulty(customDiff);
                setupRaidUnits(newChar, tier, diff, customDiff);
              }
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
            onLogin={(user) => {
              let acc = accountMgrRef.current.login(user, 'wow123');
              if (!acc) acc = accountMgrRef.current.register(user, 'wow123');
              setAccount({ ...accountMgrRef.current.getCurrentAccount()! });
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
          )
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
          /* Active Combat & Travel Viewport (Full-Viewport Interactive Background + Floating HUD) */
          <div className="w-full flex-1 relative min-h-[640px] h-[calc(100vh-3.5rem)] overflow-hidden select-none bg-[#0a0a14]">
            
            {/* ── Layer 0 (z-0): Interactive Combat Scene Background (无分框纯背景画布，可直接点击交互，层次低) ── */}
            <div className="absolute inset-0 z-0">
              <CombatCanvas
                units={friendlyUnits}
                bossUnit={bossUnit}
                bossTargetId={bossTargetId}
                groundEffects={groundEffects}
                floatingTexts={floatingTexts}
                runPhase={isApproaching ? 'PULL_APPROACH' : runPhase}
                screenShake={screenShake}
                selectedUnitId={selectedTargetId}
                dungeonTier={dungeonTier}
                targetBossName={targetBossName}
                currentBossIndex={rsmRef.current?.currentBossIndex || 0}
                travelRemainingMs={travelRemainingMs}
                totalTravelMs={rsmRef.current?.totalTravelMs || 12000}
                isCorpseRunning={isCorpseRunning}
                corpseRunRemainingMs={corpseRunTimerMs}
                onSelectUnit={(id) => setSelectedTargetId(id)}
                onSetFocus={(id) => setFocusTargetId(id)}
                onPlayerMove={handlePlayerMove}
                onCancelCast={handleCancelPlayerCast}
                onApproachComplete={() => setIsApproaching(false)}
                onFastForwardTravel={() => rsmRef.current?.fastForwardTravel()}
                revivingUnitId={revivingUnitId}
                reviveProgress={reviveProgress}
                autoApproachTarget={autoApproachTarget}
                onApproachTargetReached={() => {
                  if (autoApproachTarget) {
                    const pending = autoApproachTarget.pendingSlotIdx;
                    setAutoApproachTarget(null);
                    handleCastSlot(pending);
                  }
                }}
                groundTargetState={groundTargetState}
                onConfirmGroundTarget={handleConfirmGroundTarget}
                onCancelGroundTarget={() => setGroundTargetState(null)}
              />
            </div>

            {/* ── Layer 1 (z-10): Floating HUD Overlays (事件穿透到底层背景画布，UI 组件各自可点击交互) ── */}
            <div className="absolute inset-0 pointer-events-none z-10">
              
              {/* Top Left: Player Unit Frame & Target Unit Frame */}
              <div className="absolute top-3 left-4 flex flex-col space-y-2 pointer-events-auto">
                {(() => {
                  const playerUnit = friendlyUnits.find(u => u.isPlayer);
                  if (!playerUnit) return null;
                  return (
                    <PlayerUnitFrame
                      player={playerUnit}
                      allUnits={[...friendlyUnits, ...(bossUnit ? [bossUnit] : [])]}
                      isInCombat={runPhase === 'BOSS_COMBAT'}
                      dkRunes={
                        currentChar?.classId === 'DK'
                          ? [
                              { type: 'BLOOD', cdMs: 0 },
                              { type: 'BLOOD', cdMs: 0 },
                              { type: 'FROST', cdMs: 0 },
                              { type: 'FROST', cdMs: 0 },
                              { type: 'UNHOLY', cdMs: 0 },
                              { type: 'UNHOLY', cdMs: 0 },
                            ]
                          : undefined
                      }
                      onSelect={() => setSelectedTargetId(playerUnit.id)}
                      onSetFocus={() => setFocusTargetId(playerUnit.id)}
                    />
                  );
                })()}

                {/* Subordinate Target Unit Frame */}
                {(() => {
                  const targetUnit = (bossUnit && (selectedTargetId === bossUnit.id || selectedTargetId === 'boss'))
                    ? bossUnit
                    : friendlyUnits.find(u => u.id === selectedTargetId);
                  if (!targetUnit) return null;

                  let targetCastState = null;
                  if (targetUnit.id === bossUnit?.id && bossAiRef.current?.currentCasting) {
                    const c = bossAiRef.current.currentCasting;
                    targetCastState = {
                      spellName: c.skill.name,
                      progress: c.skill.castTimeMs > 0 ? Math.min(1, c.elapsedMs / c.skill.castTimeMs) : 1,
                      interruptible: c.skill.interruptible,
                    };
                  } else if (companionCasts[targetUnit.id]) {
                    targetCastState = {
                      spellName: companionCasts[targetUnit.id].spellName,
                      progress: companionCasts[targetUnit.id].progress,
                      interruptible: true,
                    };
                  }

                  return (
                    <TargetUnitFrame
                      unit={targetUnit}
                      allUnits={[...friendlyUnits, ...(bossUnit ? [bossUnit] : [])]}
                      castState={targetCastState}
                      onClearTarget={() => setSelectedTargetId(null)}
                      onSelectTarget={(id) => setSelectedTargetId(id)}
                      onSetFocus={(id) => setFocusTargetId(id)}
                    />
                  );
                })()}

                {/* Focus Target Unit Frame */}
                {(() => {
                  if (!focusTargetId) return null;
                  const focusUnit = (bossUnit && (focusTargetId === bossUnit.id || focusTargetId === 'boss'))
                    ? bossUnit
                    : friendlyUnits.find(u => u.id === focusTargetId);
                  if (!focusUnit) return null;

                  let focusCastState = null;
                  if (focusUnit.id === bossUnit?.id && bossAiRef.current?.currentCasting) {
                    const c = bossAiRef.current.currentCasting;
                    focusCastState = {
                      spellName: c.skill.name,
                      progress: c.skill.castTimeMs > 0 ? Math.min(1, c.elapsedMs / c.skill.castTimeMs) : 1,
                      interruptible: c.skill.interruptible,
                    };
                  } else if (companionCasts[focusUnit.id]) {
                    focusCastState = {
                      spellName: companionCasts[focusUnit.id].spellName,
                      progress: companionCasts[focusUnit.id].progress,
                      interruptible: true,
                    };
                  }

                  return (
                    <FocusUnitFrame
                      unit={focusUnit}
                      allUnits={[...friendlyUnits, ...(bossUnit ? [bossUnit] : [])]}
                      castState={focusCastState}
                      onClearFocus={() => setFocusTargetId(null)}
                      onSelectTarget={(id) => setSelectedTargetId(id)}
                      onSetFocus={(id) => setFocusTargetId(id)}
                    />
                  );
                })()}
              </div>

              {/* Top Center: Travel Recovery Status (during TRAVEL_RECOVERY) */}
              {runPhase === 'TRAVEL_RECOVERY' ? (
                <div className="absolute top-3 left-1/2 transform -translate-x-1/2 pointer-events-auto">
                  <TravelRecovery
                    targetBossName={targetBossName}
                    remainingMs={travelRemainingMs}
                    totalMs={rsmRef.current?.totalTravelMs || 12000}
                    deadUnits={deadUnits}
                    isReviving={!!revivingUnitId}
                    revivingTargetName={friendlyUnits.find(u => u.id === revivingUnitId)?.name || ''}
                    isPlayerHealer={currentChar?.lastSpec === 'RESTORATION' || getPlayerSlots().some(s => s.spellId === 'revive' || s.spellId === 'ancestral_spirit')}
                    onPlayerRevive={() => {
                      if (deadUnits.length > 0) {
                        const revSlot = getPlayerSlots().find(s => s.spellId === 'revive' || s.spellId === 'ancestral_spirit');
                        if (revSlot) handleCastSlot(revSlot.slotIdx);
                      }
                    }}
                    onFastForward={() => rsmRef.current?.fastForwardTravel()}
                    isCorpseRunning={isCorpseRunning}
                    corpseRunRemainingMs={corpseRunTimerMs}
                  />
                </div>
              ) : null}

              {/* Floating Draggable Player Cast Bar */}
              <div className="pointer-events-auto">
                <PlayerCastBar
                  playerCast={playerCast}
                  onCancelCast={handleCancelPlayerCast}
                />
              </div>

              {/* Floating Raid Frames (Draggable & Resizable, Position Persisted in CharacterRecord) */}
              <div className="pointer-events-auto">
                <RaidFrames
                  units={friendlyUnits}
                  selectedUnitId={selectedTargetId}
                  onSelectUnit={(id) => setSelectedTargetId(id)}
                  onHoverUnit={setHoveredTargetId}
                  onQuickDispel={handleDispelUnit}
                  onSetFocus={(id) => setFocusTargetId(id)}
                  bossTargetId={bossTargetId}
                  revivingUnitId={revivingUnitId}
                  reviveProgress={reviveProgress}
                  is20Man={friendlyUnits.length > 5}
                  unitCasts={companionCasts}
                  playerClassId={currentChar?.classId}
                  playerSpecId={currentChar?.lastSpec}
                  playerPos={friendlyUnits.find(u => u.isPlayer)?.position}
                  incomingHeals={incomingHeals}
                  incomingCasts={incomingCasts}
                  accountId={account?.id || account?.username || 'default'}
                  raidMarks={savedRaidMarks}
                  onSetRaidMark={handleSetRaidMark}
                  initialPos={currentChar?.uiLayout?.raidFrames}
                  onSavePos={(pos) => {
                    if (currentChar) {
                      accountMgrRef.current.saveCharacterUiLayout(currentChar.id, { raidFrames: pos });
                    }
                  }}
                />
              </div>

              {/* Right Side: Recount / Details Stats Panel (Floating HUD, Position Persisted in CharacterRecord) */}
              <div className="pointer-events-auto">
                <StatsPanel
                  units={friendlyUnits}
                  durationSec={totalDurationSec}
                  initialPos={currentChar?.uiLayout?.statsPanel}
                  onSavePos={(pos) => {
                    if (currentChar) {
                      accountMgrRef.current.saveCharacterUiLayout(currentChar.id, { statsPanel: pos });
                    }
                  }}
                />
              </div>

              {/* Draggable Action Bar (Position Persisted in CharacterRecord & Server Sync) */}
              <div className="pointer-events-auto flex justify-center w-full absolute bottom-4 left-0">
                <ActionBar
                  classId={currentChar ? currentChar.classId : 'DK'}
                  specId={currentChar ? currentChar.lastSpec : 'BLOOD'}
                  keybindings={currentChar?.specKeybindings?.[currentChar.lastSpec] || {}}
                  slots={getPlayerSlots()}
                  gcdRemainingMs={playerGcdRemainingMs}
                  gcdTotalMs={playerGcdTotalMs}
                  activeGroundSpellId={groundTargetState?.spellId}
                  onCastSlot={handleCastSlot}
                  onSwapSlots={handleSwapSlots}
                  onAssignSlot={handleAssignSlot}
                  onClearSlot={handleClearSlot}
                  playerCast={playerCast}
                  onCancelCast={handleCancelPlayerCast}
                  isInCombat={runPhase === 'BOSS_COMBAT'}
                  outOfRangeSpells={outOfRangeSpells}
                  insufficientResourceSpells={insufficientResourceSpells}
                  spellResourceErrors={spellResourceErrors}
                  dkRunes={
                    currentChar?.classId === 'DK'
                      ? [
                          { type: 'BLOOD', cdMs: 0 },
                          { type: 'BLOOD', cdMs: 2500 },
                          { type: 'FROST', cdMs: 0 },
                          { type: 'FROST', cdMs: 0 },
                          { type: 'UNHOLY', cdMs: 0 },
                          { type: 'UNHOLY', cdMs: 6000 },
                        ]
                      : undefined
                  }
                  comboPoints={currentChar?.classId === 'ROGUE' ? 4 : 0}
                  holyPower={
                    currentChar?.classId === 'PALADIN'
                      ? (friendlyUnits.find(u => u.isPlayer)?.holyPower ?? 0)
                      : undefined
                  }
                  isPlayerDead={(() => {
                    const p = friendlyUnits.find(u => u.isPlayer);
                    return !p || (!p.isAlive && !p.alive) || (p.hp !== undefined && p.hp <= 0);
                  })()}
                  initialPos={currentChar?.uiLayout?.actionBar ?? null}
                  onSavePos={(pos) => {
                    if (currentChar) {
                      accountMgrRef.current.saveCharacterUiLayout(currentChar.id, { actionBar: pos });
                      const updatedAcc = accountMgrRef.current.getCurrentAccount();
                      if (updatedAcc) {
                        setAccount({ ...updatedAcc });
                      }
                    }
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Wipe Vote Modal */}
      <WipeVoteModal
        isOpen={runPhase === 'WIPE_VOTE'}
        timerMs={wipeVoteTimerMs}
        bossName={targetBossName}
        wipeReport={rsmRef.current?.latestWipeReport}
        onVote={handleWipeVote}
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