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
} from '@cata-raid-sim/engine';

import { RoomListView, RoomDetailView, WaitingQueueOverlay } from './components/room/index.js';

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
  wild_growth: 4800,
  chain_heal: 4500,
  healing_surge: 5200,
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
    totalMs: number;
    elapsedMs: number;
  }>>({});

  const getPredictedHealAmount = (spellId: string, caster?: Unit): number => {
    const PREDICTIONS: Record<string, { base: number; coeff: number }> = {
      nourish: { base: 9500, coeff: 0.35 },
      regrowth: { base: 16000, coeff: 0.45 },
      healing_touch: { base: 34000, coeff: 1.1 },
      healing_wave: { base: 22000, coeff: 0.75 },
      healing_surge: { base: 16000, coeff: 0.55 },
      greater_healing_wave: { base: 32000, coeff: 1.1 },
    };
    const pred = PREDICTIONS[spellId];
    if (!pred) return 0;
    const sp = caster?.stats?.spellPower || 6000;
    return Math.round(pred.base + sp * pred.coeff);
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

  const canAiUseCd = (unitId: string, spellKey: string, cdMs: number): boolean => {
    const key = `${unitId}_${spellKey}`;
    const last = aiCooldownsRef.current[key] || 0;
    const now = Date.now();
    if (now - last >= cdMs) {
      aiCooldownsRef.current[key] = now;
      return true;
    }
    return false;
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
    if (unit.resources) {
      if (unit.maxMp && unit.maxMp > 0) {
        const mRes = unit.resources.find(r => r.kind === 'MANA');
        if (mRes) mRes.current = unit.mp ?? 0;
        else unit.resources.push({ kind: 'MANA', current: unit.mp ?? 0, max: unit.maxMp });
      }
      if (unit.classId === 'ROGUE') {
        const eRes = unit.resources.find(r => r.kind === 'ENERGY');
        if (eRes) eRes.current = unit.energy ?? 0;
        else unit.resources.push({ kind: 'ENERGY', current: unit.energy ?? 0, max: 100 });
      }
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
  const [playerGcdTotalMs, setPlayerGcdTotalMs] = useState(750);
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

  // Seed mock rooms if empty
  useEffect(() => {
    if (roomManager.listRooms().length === 0) {
      const r1 = roomManager.createRoom({
        name: '影牙城堡英雄速推刷装队',
        dungeonId: 'shadowfang_keep',
        difficulty: 'HEROIC',
        host: { id: 'host_mograine', name: '莫格莱尼', classId: 'DK', spec: 'BLOOD' },
      });
      roomManager.addAiMember(r1.id, 'HEALER');
      roomManager.addAiMember(r1.id, 'DPS');
      roomManager.addAiMember(r1.id, 'DPS');

      const r2 = roomManager.createRoom({
        name: '巨龙之魂英雄开荒团 [进行中]',
        dungeonId: 'dragon_soul',
        difficulty: 'HEROIC',
        host: { id: 'host_uther', name: '乌瑟尔', classId: 'DK', spec: 'BLOOD' },
      });
      roomManager.autoFillAi(r2.id);
      r2.status = 'IN_COMBAT';
      r2.inCombatBossName = '莫卓克';
      r2.inCombatBossHp = 48750000;
      r2.inCombatBossMaxHp = 75000000;
    }
  }, []);

  const handleCreateRoom = (name: string, dungeonId: string, difficulty: DungeonDifficulty) => {
    if (!currentChar) return;
    const room = roomManager.createRoom({
      name,
      dungeonId,
      difficulty,
      host: {
        id: currentChar.id,
        name: currentChar.name,
        classId: currentChar.classId,
        spec: currentChar.lastSpec,
      },
    });
    setActiveRoomId(room.id);
    setLobbySubView('ROOM_DETAIL');
    setRoomsTick(t => t + 1);
  };

  const handleJoinRoom = (roomId: string) => {
    if (!currentChar) return;
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    let member = room.members.find(m => m.id === currentChar.id);
    if (!member) {
      const pRole = getRoleBySpec(currentChar.classId, currentChar.lastSpec);
      let targetSlot = room.slots.find(s => !s.occupied && s.role === pRole);
      if (!targetSlot) targetSlot = room.slots.find(s => !s.occupied);
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
    setActiveRoomId(room.id);
    setLobbySubView('ROOM_DETAIL');
    setRoomsTick(t => t + 1);
  };

  const handleJoinWaitingQueue = (roomId: string) => {
    if (!currentChar) return;
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
    const rooms = roomManager.listRooms();
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
    handleCreateRoom(`${currentChar.name}的速推队`, 'shadowfang_keep', 'HEROIC');
  };

  const handleStartGameFromRoom = () => {
    if (!activeRoomId || !currentChar) return;
    const room = roomManager.getRoom(activeRoomId);
    if (!room) return;
    const validation = roomManager.validateStartGame(activeRoomId);
    if (!validation.canStart) {
      alert(`无法开始游戏: ${validation.reasons.join('；')}`);
      return;
    }
    roomManager.startGame(activeRoomId, currentChar.id);

    const tier = room.dungeonId === 'dragon_soul' ? '20man' : '5man';
    setDungeonTier(tier);
    setDungeonDifficulty(room.difficulty);

    setupRaidUnits(currentChar, tier, room.difficulty, customDifficulty, room);
    handleStartAdventure();
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
      } else if (u.classId === 'ROGUE') {
        u.resources.push({ kind: 'ENERGY', current: u.energy ?? 100, max: 100 });
      } else if (u.classId === 'DK') {
        u.resources.push({ kind: 'RUNIC_POWER', current: 0, max: 100 });
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
        const apJitter = isPlayer ? 0 : ((nameSeed % 11) - 5) * 80;
        const spJitter = isPlayer ? 0 : (((nameSeed >> 2) % 11) - 5) * 80;
        const critJitter = isPlayer ? 0 : (((nameSeed >> 4) % 7) - 3) * 0.01;
        const hasteJitter = isPlayer ? 0 : (((nameSeed >> 1) % 5) - 2) * 0.01;

        party.push({
          id: isPlayer ? 'p1_player' : member.id,
          name: assignedName,
          classId: assignedClass,
          role: assignedRole,
          isPlayer,
          isAlive: true,
          alive: true,
          hp: isTankMember ? 145000 : 105000,
          maxHp: isTankMember ? 145000 : 105000,
          mp: isHealerMember || assignedClass === 'MAGE' || assignedClass === 'SHAMAN' || (assignedClass === 'DRUID' && assignedRole === 'DPS') ? 95000 : 0,
          maxMp: isHealerMember || assignedClass === 'MAGE' || assignedClass === 'SHAMAN' || (assignedClass === 'DRUID' && assignedRole === 'DPS') ? 95000 : 0,
          energy: assignedClass === 'ROGUE' ? 100 : 0,
          absorb: 0,
          resources: [],
          buffs: [],
          threatTable: [],
          position: {
            x: isTankMember ? 440 : (isHealerMember ? 140 : 220),
            y: 160 + (idx % 5) * 20,
          },
          stats: {
            attackPower: 8000 + apJitter,
            spellPower: 8000 + spJitter,
            critChance: 0.25 + critJitter,
            haste: 0.15 + hasteJitter,
            armor: isTankMember ? 24000 : 12000,
            spellResist: 0,
            block: isTankMember ? 0.15 : 0,
            parry: isTankMember ? 0.12 : 0,
            dodge: isTankMember ? 0.10 : (assignedClass === 'ROGUE' ? 0.08 : 0.05),
            mastery: 0.18,
            versatility: 0.05,
            speed: 1,
          },
        });
      });

      party.forEach(u => engine.addUnit(finalizeUnit(u)));
      setFriendlyUnits([...engine.friendlyUnits]);
      return;
    }

    const pClass = char ? char.classId : 'DK';
    const pRole: 'TANK' | 'HEALER' | 'DPS' =
      char?.lastSpec === 'RESTORATION'
        ? 'HEALER'
        : char?.lastSpec === 'BLOOD' || char?.lastSpec === 'GUARDIAN'
        ? 'TANK'
        : 'DPS';

    // ── 20-Man Heroic Raid Composition (4 Squads: 2T · 4H · 14DPS) ───────────
    if (tier === '20man') {
      const party: Unit[] = [];
      const roster: Array<{
        name: string;
        classId: ClassId;
        role: 'TANK' | 'HEALER' | 'DPS';
        posX: number;
        posY: number;
      }> = [
        // Squad 1 (Main Tank & Core Melee - Inside 60% Central Combat Rectangle)
        { name: '莫格莱尼', classId: 'DK', role: 'TANK', posX: 440, posY: 165 },
        { name: '乌瑟尔', classId: 'DK', role: 'TANK', posX: 440, posY: 195 },
        { name: '瓦莉拉', classId: 'ROGUE', role: 'DPS', posX: 465, posY: 150 },
        { name: '瓦里安', classId: 'DK', role: 'DPS', posX: 475, posY: 210 },
        { name: '玛法里奥', classId: 'DRUID', role: 'HEALER', posX: 190, posY: 150 },

        // Squad 2 (Melee & Off-Healer)
        { name: '萨萨里安', classId: 'DK', role: 'DPS', posX: 460, posY: 130 },
        { name: '萨鲁法尔', classId: 'DK', role: 'DPS', posX: 460, posY: 230 },
        { name: '肖尔', classId: 'ROGUE', role: 'DPS', posX: 450, posY: 180 },
        { name: '萨尔', classId: 'SHAMAN', role: 'DPS', posX: 230, posY: 130 },
        { name: '先知努波顿', classId: 'SHAMAN', role: 'HEALER', posX: 190, posY: 220 },

        // Squad 3 (Casters & Raid Healer)
        { name: '吉安娜', classId: 'MAGE', role: 'DPS', posX: 240, posY: 160 },
        { name: '卡德加', classId: 'MAGE', role: 'DPS', posX: 250, posY: 200 },
        { name: '古尔丹之影', classId: 'MAGE', role: 'DPS', posX: 260, posY: 140 },
        { name: '威尔弗雷德', classId: 'MAGE', role: 'DPS', posX: 270, posY: 230 },
        { name: '安度因', classId: 'DRUID', role: 'HEALER', posX: 180, posY: 180 },

        // Squad 4 (Ranged Marksmen & Support)
        { name: '希尔瓦娜斯', classId: 'ROGUE', role: 'DPS', posX: 280, posY: 120 },
        { name: '雷克萨', classId: 'SHAMAN', role: 'DPS', posX: 290, posY: 240 },
        { name: '本尼迪塔斯', classId: 'MAGE', role: 'DPS', posX: 300, posY: 180 },
        { name: '库尔提拉', classId: 'DK', role: 'DPS', posX: 430, posY: 200 },
        { name: '莉亚德琳', classId: 'SHAMAN', role: 'HEALER', posX: 200, posY: 250 },
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
        const isHealerMember = assignedRole === 'HEALER';

        // Add subtle individual stat variation per AI member (gear / talent flavor)
        const nameSeed = assignedName.split('').reduce((acc, c) => acc + c.charCodeAt(0), idx * 37);
        const apJitter = isPlayer ? 0 : ((nameSeed % 11) - 5) * 80; // ±400 AP
        const spJitter = isPlayer ? 0 : (((nameSeed >> 2) % 11) - 5) * 80; // ±400 SP
        const critJitter = isPlayer ? 0 : (((nameSeed >> 4) % 7) - 3) * 0.01; // ±0.03 Crit
        const hasteJitter = isPlayer ? 0 : (((nameSeed >> 1) % 5) - 2) * 0.01; // ±0.02 Haste

        party.push({
          id: isPlayer ? 'p1_player' : `ai_raid_${idx + 1}`,
          name: assignedName,
          classId: assignedClass,
          role: assignedRole,
          isPlayer,
          isAlive: true,
          alive: true,
          hp: isTankMember ? 145000 : 105000,
          maxHp: isTankMember ? 145000 : 105000,
          mp: isHealerMember || assignedClass === 'MAGE' || assignedClass === 'SHAMAN' || (assignedClass === 'DRUID' && assignedRole === 'DPS') ? 95000 : 0,
          maxMp: isHealerMember || assignedClass === 'MAGE' || assignedClass === 'SHAMAN' || (assignedClass === 'DRUID' && assignedRole === 'DPS') ? 95000 : 0,
          energy: assignedClass === 'ROGUE' ? 100 : 0,
          absorb: 0,
          resources: [],
          buffs: [],
          threatTable: [],
          position: { x: member.posX, y: member.posY },
          stats: {
            attackPower: Math.round((isTankMember ? 8000 : 8500) + apJitter),
            spellPower: Math.round((isHealerMember ? 9000 : 8500) + spJitter),
            critChance: Math.round((0.25 + critJitter) * 100) / 100,
            haste: Math.round((0.16 + hasteJitter) * 100) / 100,
            armor: isTankMember ? 24000 : 12000,
            spellResist: 0,
            block: isTankMember ? 0.16 : 0,
            parry: isTankMember ? 0.14 : 0,
            dodge: isTankMember ? 0.12 : 0,
            mastery: 0.18,
            versatility: 0.05,
            speed: 1,
          },
        });
      });

      if (pClass === 'DK' || pClass === 'MAGE') {
        party.push({
          id: 'player_pet',
          name: pClass === 'DK' ? '食尸鬼' : '水元素',
          classId: 'NPC',
          role: 'DPS',
          isPlayer: false,
          isPet: true,
          ownerId: 'p1_player',
          isAlive: true,
          alive: true,
          hp: 45000,
          maxHp: 45000,
          absorb: 0,
          resources: [],
          buffs: [],
          threatTable: [],
          position: { x: 220, y: 160 },
          stats: {
            attackPower: 5000,
            spellPower: 5000,
            critChance: 0.2,
            haste: 0.1,
            armor: 10000,
            spellResist: 0,
            block: 0,
            parry: 0,
            dodge: 0.05,
            mastery: 0.1,
            versatility: 0.05,
            speed: 1,
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

    // ── 5-man heroic squad (Default) ──────────────────────────────────
    const party: Unit[] = [
      {
        id: 'p1_player',
        name: char ? char.name : '勇士',
        classId: pClass,
        role: pRole,
        isPlayer: true,
        isAlive: true,
        alive: true,
        hp: pRole === 'TANK' ? 145000 : 105000,
        maxHp: pRole === 'TANK' ? 145000 : 105000,
        mp: pRole === 'HEALER' || pClass === 'MAGE' || pClass === 'SHAMAN' ? 95000 : 0,
        maxMp: pRole === 'HEALER' || pClass === 'MAGE' || pClass === 'SHAMAN' ? 95000 : 0,
        energy: pClass === 'ROGUE' ? 100 : 0,
        absorb: 0,
        resources: [],
        buffs: [],
        threatTable: [],
        position: { x: pRole === 'TANK' ? 440 : 220, y: 180 },
        stats: {
          attackPower: 8000,
          spellPower: 8000,
          critChance: 0.25,
          haste: 0.15,
          armor: pRole === 'TANK' ? 24000 : 12000,
          spellResist: 0,
          block: 0.15,
          parry: 0.12,
          dodge: 0.10,
          mastery: 0.18,
          versatility: 0.05,
          speed: 1,
        },
      },
    ];

    // Determine the 4 AI members with 100% class differentiation (DK, DRUID, SHAMAN, MAGE, ROGUE)
    let aiTank: { name: string; classId: ClassId } | null = null;
    let aiHealer: { name: string; classId: ClassId } | null = null;
    let aiDpsList: Array<{ name: string; classId: ClassId }> = [];

    if (pRole === 'TANK') {
      if (pClass === 'DK') {
        aiHealer = { name: '玛法里奥', classId: 'DRUID' };
        aiDpsList = [
          { name: '吉安娜', classId: 'MAGE' },
          { name: '瓦莉拉', classId: 'ROGUE' },
          { name: '萨尔', classId: 'SHAMAN' },
        ];
      } else {
        // Player is Druid Bear Tank
        aiHealer = { name: '先知努波顿', classId: 'SHAMAN' };
        aiDpsList = [
          { name: '萨萨里安', classId: 'DK' },
          { name: '吉安娜', classId: 'MAGE' },
          { name: '瓦莉拉', classId: 'ROGUE' },
        ];
      }
    } else if (pRole === 'HEALER') {
      aiTank = { name: '莫格莱尼', classId: 'DK' };
      if (pClass === 'DRUID') {
        aiDpsList = [
          { name: '吉安娜', classId: 'MAGE' },
          { name: '瓦莉拉', classId: 'ROGUE' },
          { name: '萨尔', classId: 'SHAMAN' },
        ];
      } else {
        // Player is Shaman Healer
        aiDpsList = [
          { name: '哈缪尔·符文图腾', classId: 'DRUID' },
          { name: '吉安娜', classId: 'MAGE' },
          { name: '瓦莉拉', classId: 'ROGUE' },
        ];
      }
    } else {
      // Player is DPS
      if (pClass === 'DK') {
        aiTank = { name: '布罗尔·熊皮', classId: 'DRUID' };
        aiHealer = { name: '先知努波顿', classId: 'SHAMAN' };
        aiDpsList = [
          { name: '吉安娜', classId: 'MAGE' },
          { name: '瓦莉拉', classId: 'ROGUE' },
        ];
      } else if (pClass === 'DRUID') {
        aiTank = { name: '莫格莱尼', classId: 'DK' };
        aiHealer = { name: '先知努波顿', classId: 'SHAMAN' };
        aiDpsList = [
          { name: '吉安娜', classId: 'MAGE' },
          { name: '瓦莉拉', classId: 'ROGUE' },
        ];
      } else if (pClass === 'MAGE') {
        aiTank = { name: '莫格莱尼', classId: 'DK' };
        aiHealer = { name: '玛法里奥', classId: 'DRUID' };
        aiDpsList = [
          { name: '瓦莉拉', classId: 'ROGUE' },
          { name: '萨尔', classId: 'SHAMAN' },
        ];
      } else if (pClass === 'ROGUE') {
        aiTank = { name: '莫格莱尼', classId: 'DK' };
        aiHealer = { name: '玛法里奥', classId: 'DRUID' };
        aiDpsList = [
          { name: '吉安娜', classId: 'MAGE' },
          { name: '萨尔', classId: 'SHAMAN' },
        ];
      } else {
        // Player is Shaman DPS
        aiTank = { name: '莫格莱尼', classId: 'DK' };
        aiHealer = { name: '玛法里奥', classId: 'DRUID' };
        aiDpsList = [
          { name: '吉安娜', classId: 'MAGE' },
          { name: '瓦莉拉', classId: 'ROGUE' },
        ];
      }
    }

    if (aiTank) {
      party.push({
        id: 'ai_tank',
        name: aiTank.name,
        classId: aiTank.classId,
        role: 'TANK',
        isPlayer: false,
        isAlive: true,
        alive: true,
        hp: 145000,
        maxHp: 145000,
        absorb: 0,
        resources: [],
        buffs: [],
        threatTable: [],
        position: { x: 440, y: 180 },
        stats: { attackPower: 7000, spellPower: 0, critChance: 0.15, haste: 0.1, armor: 24000, spellResist: 0, block: 0.18, parry: 0.14, dodge: 0.12, mastery: 0.2, versatility: 0.05, speed: 1 },
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
        hp: 105000,
        maxHp: 105000,
        mp: 110000,
        maxMp: 110000,
        absorb: 0,
        resources: [],
        buffs: [],
        threatTable: [],
        position: { x: 200, y: 200 },
        stats: { attackPower: 0, spellPower: 9000, critChance: 0.22, haste: 0.2, armor: 12000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0.15, versatility: 0.05, speed: 1 },
      });
    }

    aiDpsList.forEach((dps, idx) => {
      const nameSeed = dps.name.split('').reduce((acc, c) => acc + c.charCodeAt(0), idx * 41);
      const apJitter = ((nameSeed % 9) - 4) * 90;
      const spJitter = (((nameSeed >> 2) % 9) - 4) * 90;
      const critJitter = (((nameSeed >> 4) % 7) - 3) * 0.01;
      const hasteJitter = (((nameSeed >> 1) % 5) - 2) * 0.01;

      party.push({
        id: `ai_dps_${idx + 1}`,
        name: dps.name,
        classId: dps.classId,
        role: 'DPS',
        isPlayer: false,
        isAlive: true,
        alive: true,
        hp: 105000,
        maxHp: 105000,
        mp: dps.classId === 'MAGE' || dps.classId === 'SHAMAN' || dps.classId === 'DRUID' ? 90000 : 0,
        maxMp: dps.classId === 'MAGE' || dps.classId === 'SHAMAN' || dps.classId === 'DRUID' ? 90000 : 0,
        energy: dps.classId === 'ROGUE' ? 100 : 0,
        absorb: 0,
        resources: [],
        buffs: [],
        threatTable: [],
        position: { x: 230 + idx * 30, y: 140 + idx * 30 },
        stats: {
          attackPower: Math.round(8500 + apJitter),
          spellPower: Math.round(8500 + spJitter),
          critChance: Math.round((0.28 + critJitter) * 100) / 100,
          haste: Math.round((0.16 + hasteJitter) * 100) / 100,
          armor: 14000,
          spellResist: 0,
          block: 0,
          parry: 0,
          dodge: 0,
          mastery: 0.16,
          versatility: 0.05,
          speed: 1,
        },
      });
    });

    if (pClass === 'DK' || pClass === 'MAGE') {
      party.push({
        id: 'player_pet',
        name: pClass === 'DK' ? '食尸鬼' : '水元素',
        classId: 'NPC',
        role: 'DPS',
        isPlayer: false,
        isPet: true,
        ownerId: 'p1_player',
        isAlive: true,
        alive: true,
        hp: 45000,
        maxHp: 45000,
        absorb: 0,
        resources: [],
        buffs: [],
        threatTable: [],
        position: { x: (pRole === 'TANK' ? 440 : 180) - 20, y: 180 },
        stats: {
          attackPower: 5000,
          spellPower: 5000,
          critChance: 0.2,
          haste: 0.1,
          armor: 10000,
          spellResist: 0,
          block: 0,
          parry: 0,
          dodge: 0.05,
          mastery: 0.1,
          versatility: 0.05,
          speed: 1,
        },
      });
    }

    for (const u of party) {
      finalizeUnit(u);
      engine.addUnit(u);
    }
    setFriendlyUnits(party);
  };

  const handleSelectDungeonTier = (tier: '5man' | '20man') => {
    setDungeonTier(tier);
    try {
      localStorage.setItem('cata_dungeon_tier', tier);
    } catch {}
    if (currentChar) {
      accountMgrRef.current.saveDungeonPreferences(currentChar.id, tier, dungeonDifficulty, customDifficulty);
      setAccount({ ...accountMgrRef.current.getCurrentAccount()! });
      if (runPhase === 'LOBBY') {
        setupRaidUnits(currentChar, tier, dungeonDifficulty, customDifficulty);
      }
    }
  };

  const handleSelectDungeonDifficulty = (diff: DungeonDifficulty) => {
    setDungeonDifficulty(diff);
    try {
      localStorage.setItem('cata_dungeon_difficulty', diff);
    } catch {}
    if (currentChar) {
      accountMgrRef.current.saveDungeonPreferences(currentChar.id, dungeonTier, diff, customDifficulty);
      setAccount({ ...accountMgrRef.current.getCurrentAccount()! });
      if (runPhase === 'LOBBY') {
        setupRaidUnits(currentChar, dungeonTier, diff, customDifficulty);
      }
    }
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

      const deltaMs = 50;
      tickCount++;
      rsm.tick(deltaMs);
      engine.tick(deltaMs);

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

        // If channeling (e.g. 宁静 Tranquility, 奥术飞弹 Arcane Missiles), tick periodic effect
        if (prev.isChannel) {
          if (prev.spellId === 'tranquility') {
            if (Math.floor(newElapsed / 2000) > Math.floor(prev.elapsedMs / 2000)) {
              if (player && (player.isAlive || player.alive)) {
                for (const u of engine.friendlyUnits) {
                  if (u.alive && u.isAlive) {
                    engine.healUnit(player, u, 12000, Math.random() < 0.25, '宁静');
                  }
                }
              }
            }
          } else if (prev.spellId === 'arcane_missiles') {
            if (Math.floor(newElapsed / 500) > Math.floor(prev.elapsedMs / 500)) {
              const boss = engine.bossUnit;
              if (boss && (boss.isAlive || boss.alive) && boss.hp > 0) {
                engine.dealDamage(player, boss, 5500, 'ARCANE', Math.random() < 0.3, '奥术飞弹');
                engine.threatManager.addThreat(boss.id, player.id, 5500);
              }
            }
          }
          if (progress >= 1) {
            // 引导成功结束，此时才触发引导技能的冷却（如宁静 180s）
            if (prev.totalCdMs && prev.totalCdMs > 0) {
              triggerCooldown(prev.spellId, prev.totalCdMs);
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
        }

        // Standard read-bar cast completes
        if (progress >= 1) {
          // 只有读条完成且成功出手时，才触发该技能可能存在的冷却！
          const castSuccess = resolvePlayerCast(prev.spellId, prev.totalCdMs);
          if (castSuccess && prev.totalCdMs && prev.totalCdMs > 0) {
            triggerCooldown(prev.spellId, prev.totalCdMs);
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
        // ── Spirit Combat Mana & Energy Regen (Tuned for 1.2x~2.0x Encounter Budget) ──
        const is20ManRaid = engine.friendlyUnits.length > 5;
        for (const u of engine.friendlyUnits) {
          if (u.alive || u.isAlive) {
            if (u.maxMp && u.maxMp > 0) {
              const hasInnervate = u.buffs?.some(b => b.spellId === 'innervate');
              const hasManaTide = u.buffs?.some(b => b.spellId === 'mana_tide');
              const baseRegenRate = is20ManRaid ? 0.0065 : 0.0070; // 0.70%/s in 5-man, 0.65%/s in 20-man
              let regenPctPerSec = baseRegenRate;
              if (hasInnervate) regenPctPerSec += 0.05; // +5%/sec during Innervate
              if (hasManaTide) regenPctPerSec += 0.03; // +3%/sec during Mana Tide
              const regenAmt = (u.maxMp * regenPctPerSec * deltaMs) / 1000;
              u.mp = Math.min(u.maxMp, (u.mp ?? 0) + regenAmt);
              syncUnitResources(u);
            } else if (u.classId === 'ROGUE') {
              const hasAdrenaline = u.buffs?.some(b => b.spellId === 'adrenaline_rush');
              const haste = u.stats?.haste || 0;
              const baseRate = 10 * (1 + haste); // 10 energy/s base + haste
              const regenRate = hasAdrenaline ? baseRate * 2 : baseRate;
              const regenAmt = (regenRate * deltaMs) / 1000;
              u.energy = Math.min(100, (u.energy ?? 100) + regenAmt);
              syncUnitResources(u);
            }
          }
        }

        const boss = engine.bossUnit;
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

          for (const u of engine.friendlyUnits) {
            if ((!u.isAlive && !u.alive) || u.isPlayer) continue;

            const { tickOffset, individualMod, critMod } = getUnitPersonality(u);
            const aiPersonality = getUnitAIPersonality(u);

            if (u.role === 'TANK') {
              // ── 坦克仇恨顺位与健康线决策 ──
              // 排名靠后的坦克只有在自己血量健康，排名靠前坦克血量都不健康时主动拉仇恨，此时其他坦克要暂停拉仇恨直到自己过健康线
              const allTanks = engine.friendlyUnits.filter(t => t.role === 'TANK' && (t.isAlive ?? t.alive));
              const threatDecision = evaluateTankThreatDecision(
                u,
                allTanks,
                targetId,
                targetId === u.id
              );

              // ── Tank Rotation (DK or Bear Druid) ──
              if ((tickCount + tickOffset) % 20 === 0) {
                const isCrit = Math.random() < ((u.stats.critChance || 0.18) + critMod);
                if (u.classId === 'DK') {
                  // Death Strike: tuned for authentic Cata sustain (5,500 heal + 3,500 absorb shield) + Heart Strike
                  const dmg = rollAiDamage(u, 5800, 'PHYSICAL', isCrit);
                  const healAmt = Math.round((5500 + (Math.random() * 2 - 1) * 450) * individualMod);
                  const absorbAmt = Math.round((3500 + (Math.random() * 2 - 1) * 300) * individualMod);
                  engine.dealDamage(u, boss, dmg, 'PHYSICAL', isCrit, '灵界打击');
                  engine.healUnit(u, u, healAmt, false, '灵界打击');
                  u.absorb = Math.min(u.maxHp * 0.4, (u.absorb || 0) + absorbAmt);
                  // Ensure Bone Shield is maintained
                  if (!u.buffs.some(b => b.spellId === 'bone_shield')) {
                    engine.applyBuff(u, {
                      id: `bone_shield_ai_${Date.now()}_${u.id}`,
                      spellId: 'bone_shield',
                      name: '白骨之盾',
                      kind: 'BUFF',
                      tags: ['SHIELD'],
                      sourceUnitId: u.id,
                      targetUnitId: u.id,
                      stacks: 6,
                      maxStacks: 6,
                      durationMs: 300000,
                      remainingMs: 300000,
                      school: 'SHADOW',
                    });
                  }
                } else {
                  // Druid Bear Tank: Mangle + Lacerate bleed
                  const dmg = rollAiDamage(u, 6200, 'PHYSICAL', isCrit);
                  engine.dealDamage(u, boss, dmg, 'PHYSICAL', isCrit, '裂伤');
                  engine.applyBuff(boss, {
                    id: `lacerate_${u.id}`,
                    spellId: 'lacerate',
                    name: '割伤 (流血)',
                    kind: 'DEBUFF',
                    tags: ['DOT'],
                    sourceUnitId: u.id,
                    targetUnitId: boss.id,
                    stacks: 3,
                    maxStacks: 3,
                    durationMs: 15000,
                    remainingMs: 15000,
                    school: 'PHYSICAL',
                    tickIntervalMs: 3000,
                    tickValue: Math.round((2400 + (Math.random() * 2 - 1) * 200) * individualMod),
                  });
                }
                // Extra high threat modifier only when NOT pausing threat
                if (!threatDecision.pauseThreat) {
                  engine.threatManager.addThreat(boss.id, u.id, 18000);
                } else {
                  engine.threatManager.addThreat(boss.id, u.id, 1000);
                }
              }

              // Active taunt: only when threatDecision allows shouldTaunt
              if (threatDecision.shouldTaunt && (tickCount + tickOffset) % 12 === 0) {
                engine.threatManager.applyTaunt(boss.id, u.id);
                engine.effectsManager?.addFloatingText({
                  targetId: boss.id,
                  text: `${u.name} 嘲讽接怪！`,
                  category: 'CRIT',
                  isCrit: true,
                });
              }
            } else if (u.role === 'HEALER') {
              // ── Healer Rotation with Live Cast State Machine (Druid or Shaman) ──
              // 1. Check CC, stun, silence or movement (interruption check)
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

              // 2. Check and advance active ongoing read-bar cast
              let activeAiCast = aiHealerCastsRef.current[u.id];
              if (activeAiCast) {
                const targetUnit = engine.friendlyUnits.find(a => a.id === activeAiCast.targetId);
                if (!targetUnit || (!targetUnit.alive && !targetUnit.isAlive) || targetUnit.hp <= 0) {
                  // Target died mid-cast! Cast interrupted immediately
                  delete aiHealerCastsRef.current[u.id];
                  activeAiCast = undefined as any;
                }
              }

              if (activeAiCast) {
                activeAiCast.elapsedMs += deltaMs;
                const progress = Math.min(1, activeAiCast.elapsedMs / activeAiCast.totalMs);
                if (progress >= 1) {
                  // Cast successfully completed!
                  delete aiHealerCastsRef.current[u.id];
                  const targetUnit = engine.friendlyUnits.find(a => a.id === activeAiCast.targetId);
                  if (targetUnit && (targetUnit.alive || targetUnit.isAlive) && targetUnit.hp > 0) {
                    if ((u.mp ?? 0) >= activeAiCast.manaCost) {
                      u.mp = Math.max(0, (u.mp ?? 0) - activeAiCast.manaCost);
                      syncUnitResources(u);
                      const isCrit = Math.random() < ((u.stats.critChance || 0.22) + critMod);
                      const healAmt = rollAiHeal(u, activeAiCast.baseAmt, isCrit);
                      engine.healUnit(u, targetUnit, healAmt, isCrit, activeAiCast.spellName);
                      if (u.classId === 'DRUID' && ['nourish', 'healing_touch', 'regrowth'].includes(activeAiCast.spellId)) {
                        engine.refreshLifebloom(targetUnit, u.id);
                      }
                      if (activeAiCast.spellId === 'chain_heal') {
                        // 治疗链多目标智能弹跳：优先弹向生命值百分比最低的其余受伤队友，每跳衰减30%
                        let jumpAmt = healAmt * 0.70;
                        const hitTargets = new Set([targetUnit.id]);
                        for (let j = 0; j < 3; j++) {
                          const nextTarget = engine.friendlyUnits
                            .filter(a => (a.alive || a.isAlive) && a.hp > 0 && !hitTargets.has(a.id) && a.hp < a.maxHp)
                            .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];
                          if (!nextTarget) break;
                          hitTargets.add(nextTarget.id);
                          const bounceCrit = Math.random() < ((u.stats.critChance || 0.22) + critMod);
                          const actualBounceAmt = Math.round(jumpAmt * (bounceCrit ? 2.0 : 1.0));
                          engine.healUnit(u, nextTarget, actualBounceAmt, bounceCrit, `治疗链(第${j + 2}跳)`);
                          jumpAmt *= 0.70;
                        }
                      }
                    }
                  }
                } else {
                  // Ongoing cast: broadcast incoming heal to target unit frame
                  currentCasts[u.id] = { spellName: activeAiCast.spellName, progress };
                  addIncomingCast(activeAiCast.targetId, {
                    casterId: u.id,
                    casterName: u.name,
                    spellName: activeAiCast.spellName,
                    amount: activeAiCast.amount,
                    progress,
                    classId: u.classId,
                  });
                }
              } else {
                // 3. Not casting: evaluate instant utilities / HoTs / AOE / Emergency / Sustained casts via Universal AI Decision Engine
                const lowestAlly = [...engine.friendlyUnits]
                  .filter(a => (a.alive || a.isAlive) && a.hp > 0)
                  .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];
                const tankUnit = engine.friendlyUnits.find(a => a.role === 'TANK' && (a.alive || a.isAlive));

                // 3.1 法力急救图腾/大招 (Innervate / Mana Tide)
                const mpRatio = (u.mp ?? 0) / (u.maxMp || 100000);
                if (mpRatio < aiPersonality.resourceHealthyThreshold) {
                  if (u.classId === 'DRUID' && canAiUseCd(u.id, 'innervate', 180000)) {
                    engine.applyBuff(u, {
                      id: `innervate_${u.id}`,
                      spellId: 'innervate',
                      name: '激活 (+回蓝)',
                      kind: 'BUFF',
                      tags: ['STAT'],
                      sourceUnitId: u.id,
                      targetUnitId: u.id,
                      stacks: 1,
                      maxStacks: 1,
                      durationMs: 10000,
                      remainingMs: 10000,
                      school: 'NATURE',
                    });
                    engine.effectsManager?.addFloatingText({
                      targetId: u.id,
                      text: `${u.name} 激活！快速恢复法力值！`,
                      category: 'HEAL',
                      isCrit: true,
                    });
                  } else if (u.classId === 'SHAMAN' && canAiUseCd(u.id, 'mana_tide', 180000)) {
                    for (const ally of engine.friendlyUnits) {
                      if (ally.alive || ally.isAlive) {
                        engine.applyBuff(ally, {
                          id: `mana_tide_${ally.id}`,
                          spellId: 'mana_tide',
                          name: '法力之潮 (+3%/s回蓝)',
                          kind: 'BUFF',
                          tags: ['STAT'],
                          sourceUnitId: u.id,
                          targetUnitId: ally.id,
                          stacks: 1,
                          maxStacks: 1,
                          durationMs: 12000,
                          remainingMs: 12000,
                          school: 'NATURE',
                        });
                      }
                    }
                    engine.effectsManager?.addFloatingText({
                      targetId: u.id,
                      text: `${u.name} 插下法力之潮图腾！全团加速回蓝！`,
                      category: 'HEAL',
                      isCrit: true,
                    });
                  }
                }

                // 3.2 战复 (Druid Rebirth)
                const deadAlly = engine.friendlyUnits.find(a => (!a.alive || !a.isAlive) || a.hp <= 0);
                const uAny = u as any;
                if (deadAlly && u.classId === 'DRUID' && (!uAny.lastRebirthTick || (tickCount - uAny.lastRebirthTick) > 12000)) {
                  if ((u.mp ?? 0) >= 6800) {
                    u.mp = Math.max(0, (u.mp ?? 0) - 6800);
                    uAny.lastRebirthTick = tickCount;
                    engine.resurrectUnit(deadAlly.id, 0.6, 0.6);
                    engine.effectsManager?.addFloatingText({
                      targetId: deadAlly.id,
                      text: `⚡ ${u.name} 施放【复生】战复了 ${deadAlly.name}！`,
                      category: 'HEAL',
                      isCrit: true,
                    });
                  }
                }

                // 3.3 组装该治疗角色当前可用的技能池 (Usable Skills Catalog)
                const usableCandidates: UsableSkillCandidate[] = [];

                if (u.classId === 'DRUID') {
                  // 群体治疗 (AOE)
                  usableCandidates.push({
                    spellId: 'wild_growth',
                    spellName: '野性成长',
                    metrics: COMPUTED_SKILL_METRICS['druid_wild_growth'],
                    baseAmt: 16800,
                    castMs: 0,
                    cost: SPELL_MANA_COSTS['wild_growth'] || 4800,
                    resourceType: 'MANA',
                    isAOE: true,
                    maxTargets: 5,
                    isOnCooldown: !canAiUseCd(u.id, 'wild_growth', 8000),
                  });
                  const hasHotTarget = lowestAlly && lowestAlly.buffs.some(b => b.spellId === 'rejuvenation' || b.spellId === 'regrowth');
                  usableCandidates.push({
                    spellId: 'swiftmend',
                    spellName: '迅捷治愈',
                    metrics: COMPUTED_SKILL_METRICS['druid_swiftmend'],
                    baseAmt: 28000,
                    castMs: 0,
                    cost: SPELL_MANA_COSTS['swiftmend'] || 1600,
                    resourceType: 'MANA',
                    isAOE: true,
                    maxTargets: 5,
                    isOnCooldown: !canAiUseCd(u.id, 'swiftmend', 15000) || !hasHotTarget,
                  });
                  usableCandidates.push({
                    spellId: 'tranquility',
                    spellName: '宁静',
                    metrics: COMPUTED_SKILL_METRICS['druid_tranquility'],
                    baseAmt: 48000,
                    castMs: 8000,
                    cost: SPELL_MANA_COSTS['tranquility'] || 6800,
                    resourceType: 'MANA',
                    isAOE: true,
                    maxTargets: 10,
                    isOnCooldown: !canAiUseCd(u.id, 'tranquility', 180000),
                  });
                  // 单体救急/高吞吐
                  usableCandidates.push({
                    spellId: 'regrowth',
                    spellName: '愈合',
                    metrics: COMPUTED_SKILL_METRICS['druid_regrowth'],
                    baseAmt: 14000,
                    castMs: 1500,
                    cost: SPELL_MANA_COSTS['regrowth'] || 3900,
                    resourceType: 'MANA',
                    isAOE: false,
                    isOnCooldown: false,
                  });
                  usableCandidates.push({
                    spellId: 'healing_touch',
                    spellName: '治疗之触',
                    metrics: COMPUTED_SKILL_METRICS['druid_healing_touch'],
                    baseAmt: 25000,
                    castMs: 2500,
                    cost: SPELL_MANA_COSTS['healing_touch'] || 3400,
                    resourceType: 'MANA',
                    isAOE: false,
                    isOnCooldown: false,
                  });
                  // 单体高效/填充
                  usableCandidates.push({
                    spellId: 'nourish',
                    spellName: '滋养',
                    metrics: COMPUTED_SKILL_METRICS['druid_nourish'],
                    baseAmt: 9500,
                    castMs: 2500,
                    cost: SPELL_MANA_COSTS['nourish'] || 1100,
                    resourceType: 'MANA',
                    isAOE: false,
                    isOnCooldown: false,
                  });
                } else if (u.classId === 'SHAMAN') {
                  // 群体治疗 (AOE)：治疗链、大雨
                  usableCandidates.push({
                    spellId: 'chain_heal',
                    spellName: '治疗链',
                    metrics: COMPUTED_SKILL_METRICS['shaman_chain_heal'],
                    baseAmt: 28000,
                    castMs: 2500,
                    cost: SPELL_MANA_COSTS['chain_heal'] || 3400,
                    resourceType: 'MANA',
                    isAOE: true,
                    maxTargets: 4,
                    isOnCooldown: false,
                  });
                  usableCandidates.push({
                    spellId: 'healing_rain',
                    spellName: '治疗之雨',
                    metrics: COMPUTED_SKILL_METRICS['shaman_healing_rain'],
                    baseAmt: 32000,
                    castMs: 0,
                    cost: SPELL_MANA_COSTS['healing_rain'] || 6500,
                    resourceType: 'MANA',
                    isAOE: true,
                    maxTargets: 6,
                    isOnCooldown: !canAiUseCd(u.id, 'healing_rain', 10000),
                  });
                  // 单体救急/高吞吐：治疗之涌、强效治疗波
                  usableCandidates.push({
                    spellId: 'healing_surge',
                    spellName: '治疗之涌',
                    metrics: COMPUTED_SKILL_METRICS['shaman_healing_surge'],
                    baseAmt: 16000,
                    castMs: 1500,
                    cost: SPELL_MANA_COSTS['healing_surge'] || 3800,
                    resourceType: 'MANA',
                    isAOE: false,
                    isOnCooldown: false,
                  });
                  usableCandidates.push({
                    spellId: 'greater_healing_wave',
                    spellName: '强效治疗波',
                    metrics: COMPUTED_SKILL_METRICS['shaman_greater_healing_wave'],
                    baseAmt: 32000,
                    castMs: 2500,
                    cost: SPELL_MANA_COSTS['greater_healing_wave'] || 4200,
                    resourceType: 'MANA',
                    isAOE: false,
                    isOnCooldown: false,
                  });
                  // 单体高效/填充：治疗波
                  usableCandidates.push({
                    spellId: 'healing_wave',
                    spellName: '治疗波',
                    metrics: COMPUTED_SKILL_METRICS['shaman_healing_wave'],
                    baseAmt: 9500,
                    castMs: 2500,
                    cost: SPELL_MANA_COSTS['healing_wave'] || 1800,
                    resourceType: 'MANA',
                    isAOE: false,
                    isOnCooldown: false,
                  });
                }

                // 3.4 基础 HoT 维护检查 (平稳期优先补 HoT)
                if (u.classId === 'DRUID') {
                  // 回春术
                  if ((tickCount + tickOffset) % 60 === 0 && lowestAlly && lowestAlly.hp < lowestAlly.maxHp * 0.90 && !lowestAlly.buffs.some(b => b.spellId === 'rejuvenation')) {
                    const cost = SPELL_MANA_COSTS['rejuvenation'] || 2400;
                    if ((u.mp ?? 0) >= cost) {
                      u.mp = Math.max(0, (u.mp ?? 0) - cost);
                      syncUnitResources(u);
                      engine.applyBuff(lowestAlly, {
                        id: `rejuv_ai_${Date.now()}_${lowestAlly.id}_${u.id}`,
                        spellId: 'rejuvenation',
                        name: '回春术 (HoT)',
                        kind: 'BUFF',
                        tags: ['HOT'],
                        sourceUnitId: u.id,
                        targetUnitId: lowestAlly.id,
                        stacks: 1,
                        maxStacks: 1,
                        durationMs: 12000,
                        remainingMs: 12000,
                        school: 'NATURE',
                        tickIntervalMs: 3000,
                        tickValue: Math.round((4500 + (Math.random() * 2 - 1) * 350) * individualMod),
                      });
                    }
                  }
                  // 生命绽放
                  if ((tickCount + tickOffset) % 80 === 0 && tankUnit) {
                    const cost = SPELL_MANA_COSTS['lifebloom'] || 1400;
                    if ((u.mp ?? 0) >= cost) {
                      u.mp = Math.max(0, (u.mp ?? 0) - cost);
                      syncUnitResources(u);
                      const existingLb = tankUnit.buffs.find(b => b.spellId === 'lifebloom' && b.sourceUnitId === u.id);
                      const stacks = existingLb ? Math.min(3, existingLb.stacks + 1) : 1;
                      engine.applyBuff(tankUnit, {
                        id: `lb_ai_${Date.now()}_${u.id}`,
                        spellId: 'lifebloom',
                        name: `生命绽放 (${stacks}层)`,
                        kind: 'BUFF',
                        tags: ['HOT'],
                        sourceUnitId: u.id,
                        targetUnitId: tankUnit.id,
                        stacks,
                        maxStacks: 3,
                        durationMs: 15000,
                        remainingMs: 15000,
                        school: 'NATURE',
                        tickIntervalMs: 2000,
                        tickValue: Math.round((2400 + (Math.random() * 2 - 1) * 200) * individualMod),
                      });
                    }
                  }
                } else if (u.classId === 'SHAMAN') {
                  // 激流 HoT
                  if ((tickCount + tickOffset) % 60 === 0 && lowestAlly && lowestAlly.hp < lowestAlly.maxHp * 0.90 && !lowestAlly.buffs.some(b => b.spellId === 'riptide')) {
                    const cost = SPELL_MANA_COSTS['riptide'] || 2200;
                    if ((u.mp ?? 0) >= cost) {
                      u.mp = Math.max(0, (u.mp ?? 0) - cost);
                      syncUnitResources(u);
                      engine.applyBuff(lowestAlly, {
                        id: `rip_ai_${Date.now()}_${lowestAlly.id}_${u.id}`,
                        spellId: 'riptide',
                        name: '激流 (HoT)',
                        kind: 'BUFF',
                        tags: ['HOT'],
                        sourceUnitId: u.id,
                        targetUnitId: lowestAlly.id,
                        stacks: 1,
                        maxStacks: 1,
                        durationMs: 15000,
                        remainingMs: 15000,
                        school: 'NATURE',
                        tickIntervalMs: 3000,
                        tickValue: Math.round((2500 + (Math.random() * 2 - 1) * 200) * individualMod),
                      });
                    }
                  }
                }

                // 3.5 通用决策引擎打分裁决 (优先 AOE -> 救急高吞吐量 -> 常规性价比/输出)
                const decision = evaluateUniversalAIDecision({
                  caster: u,
                  personality: aiPersonality,
                  allies: engine.friendlyUnits,
                  enemies: engine.bossUnit ? [engine.bossUnit] : [],
                  usableSkills: usableCandidates,
                  tickCount,
                });

                if (decision.chosenCandidate) {
                  const chosen = decision.chosenCandidate;
                  const targetUnit = decision.targetUnit || lowestAlly;

                  // 瞬发技能立即施放结算
                  if (chosen.castMs === 0) {
                    if ((u.mp ?? 0) >= chosen.cost) {
                      u.mp = Math.max(0, (u.mp ?? 0) - chosen.cost);
                      syncUnitResources(u);

                      if (chosen.spellId === 'healing_rain') {
                        const rainPos = findOptimalGroundAuraCentroid(u, engine.friendlyUnits, 55, 360);
                        engine.effectsManager?.addGroundEffect({
                          id: `hrain_ai_${Date.now()}_${u.id}`,
                          kind: 'HEAL_ZONE',
                          spellId: 'healing_rain',
                          ownerId: u.id,
                          x: rainPos.x,
                          y: rainPos.y,
                          radius: 55,
                          colorHex: '#4169E1',
                          remainingMs: 10000,
                          tickIntervalMs: 1000,
                          tickElapsedMs: 0,
                          tickValue: Math.round((3200 + (Math.random() * 2 - 1) * 250) * individualMod),
                        });
                      } else if (chosen.spellId === 'wild_growth') {
                        const maxTargets = 5;
                        const cX = targetUnit.position?.x ?? 200;
                        const cY = targetUnit.position?.y ?? 200;
                        const wgTargets = engine.friendlyUnits
                          .filter(a => (a.alive || a.isAlive) && a.hp > 0)
                          .map(a => ({ unit: a, dist: Math.hypot((a.position?.x ?? cX) - cX, (a.position?.y ?? cY) - cY), hpRatio: a.hp / a.maxHp }))
                          .filter(c => c.dist <= 270)
                          .sort((a, b) => a.hpRatio - b.hpRatio)
                          .slice(0, maxTargets);

                        for (const t of wgTargets) {
                          engine.applyBuff(t.unit, {
                            id: `wg_ai_${Date.now()}_${t.unit.id}`,
                            spellId: 'wild_growth',
                            name: '野性成长',
                            kind: 'BUFF',
                            tags: ['HOT'],
                            sourceUnitId: u.id,
                            targetUnitId: t.unit.id,
                            stacks: 1,
                            maxStacks: 1,
                            durationMs: 7000,
                            remainingMs: 7000,
                            school: 'NATURE',
                            tickIntervalMs: 1000,
                            tickValue: Math.round((2400 + (Math.random() * 2 - 1) * 200) * individualMod),
                          });
                        }
                      } else if (chosen.spellId === 'swiftmend') {
                        const hotIdx = targetUnit.buffs.findIndex(b => b.spellId === 'rejuvenation' || b.spellId === 'regrowth');
                        if (hotIdx !== -1) {
                          const consumed = targetUnit.buffs.splice(hotIdx, 1)[0];
                          const swiftAmt = rollAiHeal(u, 28000, true);
                          engine.healUnit(u, targetUnit, swiftAmt, true, `迅捷治愈(消耗${consumed.name.split(' ')[0]})`);
                          const efflorPos = findOptimalGroundAuraCentroid(u, engine.friendlyUnits, 50, 360);
                          engine.effectsManager?.addGroundEffect({
                            id: `efflor_ai_${Date.now()}_${u.id}`,
                            kind: 'HEAL_ZONE',
                            spellId: 'swiftmend',
                            ownerId: u.id,
                            x: efflorPos.x,
                            y: efflorPos.y,
                            radius: 50,
                            colorHex: '#6FCF97',
                            remainingMs: 7000,
                            tickIntervalMs: 1000,
                            tickElapsedMs: 0,
                            tickValue: Math.round((3800 + (Math.random() * 2 - 1) * 300) * individualMod),
                          });
                        }
                      }
                    }
                  } else {
                    // 读条技能：启动读条并展示预治疗
                    const preHealVal = Math.round(chosen.baseAmt * individualMod);
                    aiHealerCastsRef.current[u.id] = {
                      targetId: targetUnit.id,
                      spellId: chosen.spellId,
                      spellName: chosen.spellName,
                      amount: preHealVal,
                      baseAmt: chosen.baseAmt,
                      manaCost: chosen.cost,
                      totalMs: chosen.castMs,
                      elapsedMs: 0,
                    };
                    currentCasts[u.id] = { spellName: chosen.spellName, progress: 0 };
                    addIncomingCast(targetUnit.id, {
                      casterId: u.id,
                      casterName: u.name,
                      spellName: chosen.spellName,
                      amount: preHealVal,
                      progress: 0,
                      classId: u.classId,
                    });
                  }
                } else if ((tickCount + tickOffset) % 60 === 0 && (u.mp ?? 0) < 1500) {
                  notifyOom(u, engine);
                }
              }
            } else if (u.classId === 'MAGE') {
              // ── Fire Mage Rotation ──
              // Evocation when low mana (< individual threshold)
              const mageMpRatio = (u.mp ?? 0) / (u.maxMp || 90000);
              const isLowManaMage = mageMpRatio < aiPersonality.resourceHealthyThreshold;
              if (isLowManaMage && canAiUseCd(u.id, 'evocation', 120000)) {
                u.mp = Math.min(u.maxMp || 90000, (u.mp ?? 0) + Math.round((u.maxMp || 90000) * 0.45));
                syncUnitResources(u);
                engine.effectsManager?.addFloatingText({
                  targetId: u.id,
                  text: `${u.name} 唤醒！法力值恢复+45%！`,
                  category: 'HEAL',
                  isCrit: true,
                });
              }

              const fbCost = SPELL_MANA_COSTS['fireball'] || 2000;
              if ((u.mp ?? 0) >= fbCost) {
                const castProgress = (((tickCount + tickOffset) * 50) % 2200) / 2200;
                currentCasts[u.id] = { spellName: '火球术', progress: castProgress };
              } else if ((tickCount + tickOffset) % 60 === 0) {
                notifyOom(u, engine);
              }

              // Keep Living Bomb on boss (cost 2600 mana)
              if ((tickCount + tickOffset) % 80 === 0 && !boss.buffs.some(b => b.spellId === 'living_bomb' && b.sourceUnitId === u.id)) {
                const lbCost = SPELL_MANA_COSTS['living_bomb'] || 2600;
                if ((u.mp ?? 0) >= lbCost) {
                  u.mp = Math.max(0, (u.mp ?? 0) - lbCost);
                  syncUnitResources(u);
                  engine.applyBuff(boss, {
                    id: `lb_ai_${Date.now()}_${u.id}`,
                    spellId: 'living_bomb',
                    name: '活动炸弹',
                    kind: 'DEBUFF',
                    tags: ['DOT'],
                    sourceUnitId: u.id,
                    targetUnitId: boss.id,
                    stacks: 1,
                    maxStacks: 1,
                    durationMs: 12000,
                    remainingMs: 12000,
                    school: 'FIRE',
                    tickIntervalMs: 3000,
                    tickValue: Math.round((3500 + (Math.random() * 2 - 1) * 300) * individualMod),
                  });
                }
              }

              if ((tickCount + tickOffset) % 44 === 0) {
                const isPyro = Math.random() < 0.35;
                if (isPyro) {
                  // Instant Pyroblast proc! Free mana, infinite DPM
                  const isCrit = Math.random() < ((u.stats.critChance || 0.25) + critMod + 0.2);
                  const dmg = rollAiDamage(u, 18500, 'FIRE', isCrit);
                  engine.dealDamage(u, boss, dmg, 'FIRE', isCrit, '炎爆术');
                  engine.threatManager.addThreat(boss.id, u.id, dmg);
                } else if ((u.mp ?? 0) >= fbCost) {
                  u.mp = Math.max(0, (u.mp ?? 0) - fbCost);
                  syncUnitResources(u);
                  const isCrit = Math.random() < ((u.stats.critChance || 0.25) + critMod);
                  const dmg = rollAiDamage(u, 11000, 'FIRE', isCrit);
                  engine.dealDamage(u, boss, dmg, 'FIRE', isCrit, '火球术');
                }
              }

              // Counterspell boss interruptible cast (对暂缓处决预留3秒治疗回血窗口)
              const mageCasting = bossAiRef.current?.currentCasting;
              const shouldMageKick = mageCasting?.skill.interruptible && (
                mageCasting.skill.id !== 'stay_of_execution' || mageCasting.elapsedMs >= 3000
              );
              if (shouldMageKick && (tickCount + tickOffset) % 20 === 0) {
                const success = bossAiRef.current!.interruptCurrentCast();
                if (success) {
                  if (u.combatStats) u.combatStats.interruptCount++;
                  engine.effectsManager?.addFloatingText({
                    targetId: boss.id,
                    text: `${u.name} 法术反制打断！`,
                    category: 'INTERRUPT',
                    isCrit: true,
                  });
                }
              }
            } else if (u.classId === 'ROGUE') {
              // ── Rogue Rotation & Energy Rules ──
              // Adrenaline Rush when low energy (< individual reserve line)
              const curEnergy = u.energy ?? 100;
              const isLowEnergy = curEnergy < aiPersonality.energyReserveThreshold;
              if (isLowEnergy && canAiUseCd(u.id, 'adrenaline_rush', 180000)) {
                engine.applyBuff(u, {
                  id: `ar_ai_${Date.now()}_${u.id}`,
                  spellId: 'adrenaline_rush',
                  name: '冲动 (能量回复+100%)',
                  kind: 'BUFF',
                  tags: ['STAT'],
                  sourceUnitId: u.id,
                  targetUnitId: u.id,
                  stacks: 1,
                  maxStacks: 1,
                  durationMs: 15000,
                  remainingMs: 15000,
                  school: 'PHYSICAL',
                });
                engine.effectsManager?.addFloatingText({
                  targetId: u.id,
                  text: `${u.name} 冲动！能量恢复加速！`,
                  category: 'HEAL',
                  isCrit: true,
                });
              }

              // Maintain Slice and Dice (+40% attack speed, cost 25 energy)
              if (!u.buffs.some(b => b.spellId === 'slice_and_dice' && b.sourceUnitId === u.id)) {
                const sndCost = SPELL_ENERGY_COSTS['slice_and_dice'] || 25;
                if ((u.energy ?? 100) >= sndCost) {
                  u.energy = Math.max(0, (u.energy ?? 100) - sndCost);
                  syncUnitResources(u);
                  engine.applyBuff(u, {
                    id: `snd_ai_${Date.now()}_${u.id}`,
                    spellId: 'slice_and_dice',
                    name: '切割 (+40%攻速)',
                    kind: 'BUFF',
                    tags: ['STAT'],
                    sourceUnitId: u.id,
                    targetUnitId: u.id,
                    stacks: 1,
                    maxStacks: 1,
                    durationMs: 24000,
                    remainingMs: 24000,
                    school: 'PHYSICAL',
                  });
                }
              }

              if ((tickCount + tickOffset) % 18 === 0) {
                const isFinisher = (tickCount + tickOffset) % 72 === 0;
                if (isFinisher) {
                  // Finisher: balance between Eviscerate burst and Rupture DoT efficiency based on AI personality
                  const hasRupture = boss.buffs.some(b => b.spellId === 'rupture' && b.sourceUnitId === u.id);
                  const preferEfficiency = aiPersonality.throughputVsEfficiencyBias < 0.45;
                  if (!hasRupture && preferEfficiency) {
                    const rupCost = SPELL_ENERGY_COSTS['rupture'] || 25;
                    if ((u.energy ?? 100) >= rupCost) {
                      u.energy = Math.max(0, (u.energy ?? 100) - rupCost);
                      syncUnitResources(u);
                      engine.applyBuff(boss, {
                        id: `rup_ai_${Date.now()}_${u.id}`,
                        spellId: 'rupture',
                        name: '割裂 (DoT)',
                        kind: 'DEBUFF',
                        tags: ['DOT'],
                        sourceUnitId: u.id,
                        targetUnitId: boss.id,
                        stacks: 1,
                        maxStacks: 1,
                        durationMs: 16000,
                        remainingMs: 16000,
                        school: 'PHYSICAL',
                        tickIntervalMs: 2000,
                        tickValue: Math.round((2200 + (Math.random() * 2 - 1) * 200) * individualMod),
                      });
                    }
                  } else {
                    const evisCost = SPELL_ENERGY_COSTS['eviscerate'] || 35;
                    if ((u.energy ?? 100) >= evisCost) {
                      u.energy = Math.max(0, (u.energy ?? 100) - evisCost);
                      syncUnitResources(u);
                      const isCrit = Math.random() < ((u.stats.critChance || 0.28) + critMod + 0.15);
                      const dmg = rollAiDamage(u, 19500, 'PHYSICAL', isCrit);
                      engine.dealDamage(u, boss, dmg, 'PHYSICAL', isCrit, '刺骨');
                      engine.threatManager.addThreat(boss.id, u.id, dmg);
                    }
                  }
                } else {
                  const ssCost = SPELL_ENERGY_COSTS['sinister_strike'] || 40;
                  if ((u.energy ?? 100) >= ssCost) {
                    u.energy = Math.max(0, (u.energy ?? 100) - ssCost);
                    syncUnitResources(u);
                    const isCrit = Math.random() < ((u.stats.critChance || 0.28) + critMod);
                    const dmg = rollAiDamage(u, 5500, 'PHYSICAL', isCrit);
                    engine.dealDamage(u, boss, dmg, 'PHYSICAL', isCrit, '影袭');
                  }
                }
              }

              // Kick interrupt (costs 15 energy)
              const rogueCasting = bossAiRef.current?.currentCasting;
              const shouldRogueKick = rogueCasting?.skill.interruptible && (
                rogueCasting.skill.id !== 'stay_of_execution' || rogueCasting.elapsedMs >= 3000
              );
              if (shouldRogueKick && (tickCount + tickOffset) % 20 === 0) {
                const kickCost = SPELL_ENERGY_COSTS['kick'] || 15;
                if ((u.energy ?? 100) >= kickCost) {
                  const success = bossAiRef.current!.interruptCurrentCast();
                  if (success) {
                    u.energy = Math.max(0, (u.energy ?? 100) - kickCost);
                    syncUnitResources(u);
                    if (u.combatStats) u.combatStats.interruptCount++;
                    engine.effectsManager?.addFloatingText({
                      targetId: boss.id,
                      text: `${u.name} 脚踢打断！(-15能量)`,
                      category: 'INTERRUPT',
                      isCrit: true,
                    });
                  }
                }
              }
            } else if (u.classId === 'SHAMAN') {
              // ── Elemental Shaman DPS ──
              const lbCost = SPELL_MANA_COSTS['lightning_bolt'] || 1600;
              if ((u.mp ?? 0) >= lbCost) {
                const castProgress = (((tickCount + tickOffset) * 50) % 2000) / 2000;
                currentCasts[u.id] = { spellName: '闪电箭', progress: castProgress };
              } else if ((tickCount + tickOffset) % 60 === 0) {
                notifyOom(u, engine);
              }

              // Flame Shock DoT on boss (cost 2200 mana)
              if ((tickCount + tickOffset) % 80 === 0 && !boss.buffs.some(b => b.spellId === 'flame_shock' && b.sourceUnitId === u.id)) {
                const fsCost = SPELL_MANA_COSTS['flame_shock'] || 2200;
                if ((u.mp ?? 0) >= fsCost) {
                  u.mp = Math.max(0, (u.mp ?? 0) - fsCost);
                  syncUnitResources(u);
                  engine.applyBuff(boss, {
                    id: `fs_ai_${Date.now()}_${u.id}`,
                    spellId: 'flame_shock',
                    name: '烈焰震击 (DoT)',
                    kind: 'DEBUFF',
                    tags: ['DOT'],
                    sourceUnitId: u.id,
                    targetUnitId: boss.id,
                    stacks: 1,
                    maxStacks: 1,
                    durationMs: 18000,
                    remainingMs: 18000,
                    school: 'FIRE',
                    tickIntervalMs: 3000,
                    tickValue: Math.round((2800 + (Math.random() * 2 - 1) * 220) * individualMod),
                  });
                }
              }

              if ((tickCount + tickOffset) % 36 === 0) {
                const isLava = (tickCount + tickOffset) % 72 === 0;
                if (isLava) {
                  const lavaCost = SPELL_MANA_COSTS['lava_burst'] || 2600;
                  if ((u.mp ?? 0) >= lavaCost) {
                    u.mp = Math.max(0, (u.mp ?? 0) - lavaCost);
                    syncUnitResources(u);
                    const dmg = rollAiDamage(u, 16000, 'FIRE', true);
                    engine.dealDamage(u, boss, dmg, 'FIRE', true, '熔岩爆裂');
                  } else if ((u.mp ?? 0) >= lbCost) {
                    u.mp = Math.max(0, (u.mp ?? 0) - lbCost);
                    syncUnitResources(u);
                    const isCrit = Math.random() < ((u.stats.critChance || 0.25) + critMod);
                    const dmg = rollAiDamage(u, 9000, 'NATURE', isCrit);
                    engine.dealDamage(u, boss, dmg, 'NATURE', isCrit, '闪电箭');
                  }
                } else if ((u.mp ?? 0) >= lbCost) {
                  u.mp = Math.max(0, (u.mp ?? 0) - lbCost);
                  syncUnitResources(u);
                  const isCrit = Math.random() < ((u.stats.critChance || 0.25) + critMod);
                  const dmg = rollAiDamage(u, 9000, 'NATURE', isCrit);
                  engine.dealDamage(u, boss, dmg, 'NATURE', isCrit, '闪电箭');
                }
              }

              // Wind Shear interrupt (对暂缓处决预留3秒治疗回血窗口)
              const shamanCasting = bossAiRef.current?.currentCasting;
              const shouldShamanKick = shamanCasting?.skill.interruptible && (
                shamanCasting.skill.id !== 'stay_of_execution' || shamanCasting.elapsedMs >= 3000
              );
              if (shouldShamanKick && (tickCount + tickOffset) % 20 === 0) {
                const success = bossAiRef.current!.interruptCurrentCast();
                if (success) {
                  if (u.combatStats) u.combatStats.interruptCount++;
                  engine.effectsManager?.addFloatingText({
                    targetId: boss.id,
                    text: `${u.name} 风剪打断！`,
                    category: 'INTERRUPT',
                    isCrit: true,
                  });
                }
              }
            } else {
              // Other DPS (Druid Balance / DK Frost)
              if ((tickCount + tickOffset) % 24 === 0) {
                if (u.classId === 'DRUID') {
                  const isStarfire = (tickCount + tickOffset) % 48 === 0;
                  const spellName = isStarfire ? '星火术' : '愤怒';
                  const school = isStarfire ? 'ARCANE' : 'NATURE';
                  const baseDmg = isStarfire ? 12000 : 8500;
                  const cost = isStarfire ? (SPELL_MANA_COSTS['starfire'] || 2800) : (SPELL_MANA_COSTS['wrath'] || 1600);
                  if ((u.mp ?? 0) >= cost) {
                    u.mp = Math.max(0, (u.mp ?? 0) - cost);
                    syncUnitResources(u);
                    const isCrit = Math.random() < ((u.stats.critChance || 0.25) + critMod);
                    const dmg = rollAiDamage(u, baseDmg, school, isCrit);
                    engine.dealDamage(u, boss, dmg, school, isCrit, spellName);
                  } else if ((tickCount + tickOffset) % 60 === 0) {
                    notifyOom(u, engine);
                  }
                } else if (u.classId === 'DK') {
                  const isObliterate = (tickCount + tickOffset) % 48 === 0;
                  const spellName = isObliterate ? '湮灭' : '冰霜打击';
                  const school = isObliterate ? 'PHYSICAL' : 'FROST';
                  const baseDmg = isObliterate ? 12500 : 8800;
                  const isCrit = Math.random() < ((u.stats.critChance || 0.25) + critMod);
                  const dmg = rollAiDamage(u, baseDmg, school, isCrit);
                  engine.dealDamage(u, boss, dmg, school, isCrit, spellName);
                } else {
                  const isCrit = Math.random() < ((u.stats.critChance || 0.25) + critMod);
                  const dmg = rollAiDamage(u, 9000, 'PHYSICAL', isCrit);
                  engine.dealDamage(u, boss, dmg, 'PHYSICAL', isCrit, '技能攻击');
                }
              }
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

    const isRevive = spellId === 'revive' || spellId === 'ancestral_spirit' || spellId === 'rebirth';
    const isHarmful = [
      'fireball', 'pyroblast', 'frostbolt', 'arcane_blast', 'wrath',
      'starfire', 'starsurge', 'lightning_bolt', 'lava_burst', 'chain_lightning'
    ].includes(spellId);

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
        engine.dealDamage(player, boss, 14000, 'NATURE', isCrit, '闪电箭');
        engine.threatManager.addThreat(boss.id, player.id, 14000);
      }
    } else if (spellId === 'lava_burst') {
      if (boss && boss.alive) {
        setScreenShake(true);
        setTimeout(() => setScreenShake(false), 120);
        engine.dealDamage(player, boss, 26000, 'FIRE', true, '熔岩爆裂'); // Guaranteed critical hit
        engine.threatManager.addThreat(boss.id, player.id, 26000);
      }
    } else if (spellId === 'chain_lightning') {
      if (boss && boss.alive) {
        const isCrit = Math.random() < 0.25;
        engine.dealDamage(player, boss, 16500, 'NATURE', isCrit, '闪电链');
        engine.threatManager.addThreat(boss.id, player.id, 16500);
      }
    } else if (spellId === 'healing_wave') {
      const target = (castTargetIdRef.current ? engine.friendlyUnits.find(u => u.id === castTargetIdRef.current) : null)
        || (selectedTargetId ? engine.friendlyUnits.find(u => u.id === selectedTargetId) : null)
        || player;
      engine.healUnit(player, target, 22000, Math.random() < 0.3, '治疗波');
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
      engine.healUnit(player, target, 16000, Math.random() < 0.3, '治疗之涌');
    } else if (spellId === 'greater_healing_wave') {
      const target = (castTargetIdRef.current ? engine.friendlyUnits.find(u => u.id === castTargetIdRef.current) : null)
        || (selectedTargetId ? engine.friendlyUnits.find(u => u.id === selectedTargetId) : null)
        || player;
      engine.healUnit(player, target, 32000, Math.random() < 0.35, '强效治疗波');
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
    } else if (spellId === 'revive' || spellId === 'ancestral_spirit') {
      const deadTarget = engine.friendlyUnits.find(u => (!u.isAlive && !u.alive) || u.hp <= 0);
      if (deadTarget) {
        engine.resurrectUnit(deadTarget.id, 0.4, 0.4);
        engine.healUnit(player, deadTarget, 30000, false, spellId === 'revive' ? '起死回生' : '先祖之魂');
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

  // Trigger Global Cooldown (GCD) for on-GCD spells: 0.75s (750ms)
  const triggerGcd = (spellId?: string) => {
    if (spellId && isOffGcdSpell(spellId)) return;
    const engine = engineRef.current;
    const player = engine.friendlyUnits.find(u => u.isPlayer);
    const gcdMs = 750;
    setPlayerGcdRemainingMs(gcdMs);
    setPlayerGcdTotalMs(gcdMs);
    if (player) {
      engine.cooldownManager?.startGcd?.(player.id, gcdMs);
    }
  };

  // Dispel unit debuffs (Cataclysm dispel matrix)
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

    return res;
  }, [friendlyUnits, bossUnit, selectedTargetId]);

  // Compute resource insufficiency (Mana / Energy / Rage / Runic Power)
  const { insufficientResourceSpells, spellResourceErrors } = useMemo(() => {
    const engine = engineRef.current;
    const player = engine.friendlyUnits.find(u => u.isPlayer);
    const insufficient: Record<string, boolean> = {};
    const errors: Record<string, string> = {};
    if (!player) return { insufficientResourceSpells: insufficient, spellResourceErrors: errors };

    const curMp = player.mp ?? player.resources?.find(r => r.kind === 'MANA')?.current ?? 0;
    const curEnergy = player.energy ?? player.resources?.find(r => r.kind === 'ENERGY')?.current ?? 100;
    const curRage = player.rage ?? 0;
    const curRunic = player.runicPower ?? player.energy ?? 0;

    const slots = getPlayerSlots();
    for (const slot of slots) {
      const spId = slot.spellId;
      const manaCost = SPELL_MANA_COSTS[spId] || 0;
      if (manaCost > 0 && player.maxMp && player.maxMp > 0 && curMp < manaCost) {
        insufficient[spId] = true;
        errors[spId] = '法力值不足';
        continue;
      }
      const energyCost = SPELL_ENERGY_COSTS[spId] || 0;
      if (energyCost > 0 && (player.classId === 'ROGUE' || player.energy !== undefined) && curEnergy < energyCost) {
        insufficient[spId] = true;
        errors[spId] = '能量不足';
        continue;
      }
      const rageCost = SPELL_RAGE_COSTS[spId] || 0;
      if (rageCost > 0 && curRage < rageCost) {
        insufficient[spId] = true;
        errors[spId] = '怒气不足';
        continue;
      }
      const runicCost = SPELL_RUNIC_COSTS[spId] || 0;
      if (runicCost > 0 && player.classId === 'DK' && curRunic < runicCost) {
        insufficient[spId] = true;
        errors[spId] = '符能不足';
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
    const player = engine.friendlyUnits.find(u => u.isPlayer);
    const boss = engine.bossUnit;

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

    // ── Check Mana Cost ──────────────────────────────────────────────
    const manaCost = SPELL_MANA_COSTS[slot.spellId] || 0;
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
    const energyCost = SPELL_ENERGY_COSTS[slot.spellId] || 0;
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
    const rageCost = SPELL_RAGE_COSTS[slot.spellId] || 0;
    if (rageCost > 0) {
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

    // ── Check Runic Cost for DK ──────────────────────────────────────
    const runicCost = SPELL_RUNIC_COSTS[slot.spellId] || 0;
    if (runicCost > 0 && player.classId === 'DK') {
      const curRunic = player.runicPower ?? player.energy ?? 0;
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

    // ── Guard Against Casting while Moving ────────────────────────────
    const isMoving = Date.now() - lastPlayerMoveMsRef.current < 250;
    const isCastOrChannel = [
      'fireball', 'pyroblast', 'frostbolt', 'arcane_blast', 'arcane_missiles',
      'wrath', 'starfire', 'starsurge', 'lightning_bolt', 'lava_burst',
      'chain_lightning', 'healing_wave', 'healing_surge', 'greater_healing_wave',
      'nourish', 'regrowth', 'healing_touch', 'tranquility', 'rebirth', 'revive', 'ancestral_spirit'
    ].includes(slot.spellId);

    const hasNaturesSwiftness = player.buffs.some(b => b.spellId === 'natures_swiftness');
    const isNatureInstantable = ['healing_touch', 'rebirth', 'regrowth', 'nourish', 'wrath', 'revive'].includes(slot.spellId);
    const isInstantViaNs = hasNaturesSwiftness && isNatureInstantable;

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
    const isFriendlySpell = [
      'rejuvenation', 'lifebloom', 'regrowth', 'healing_touch', 'nourish', 'swiftmend',
      'wild_growth', 'tranquility', 'rebirth', 'revive', 'natures_cure', 'riptide',
      'healing_wave', 'healing_surge', 'greater_healing_wave', 'chain_heal',
      'healing_rain', 'spirit_link', 'cleanse_spirit', 'ancestral_spirit',
      'innervate', 'remove_curse', 'remove_corruption', 'bone_shield',
      'vampiric_blood', 'pillar_of_frost', 'horn_of_winter', 'slice_and_dice',
      'adrenaline_rush', 'feint', 'bloodlust', 'time_warp', 'arcane_power',
      'arcane_brilliance', 'mark_of_the_wild', 'natures_swiftness'
    ].includes(slot.spellId);

    let effectiveTarget: Unit = player;

    if (isFriendlySpell) {
      if (slot.spellId === 'revive' || slot.spellId === 'ancestral_spirit' || slot.spellId === 'rebirth') {
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
        // 必须按选中目标施法：若选中的是友方则对选中的友方施法；若选中目标不匹配(选中的是敌方/首领/空)则向自己放(自我施法回退)
        // 鼠标悬停在团队框架上绝不劫持施法目标，严格按当前选中目标施法
        const hoveredFriendly = null;
        const selectedFriendly = selectedTargetId ? engine.friendlyUnits.find(u => u.id === selectedTargetId) : null;
        effectiveTarget = hoveredFriendly || selectedFriendly || player;
      }
    } else {
      // 敌对攻击技能：若当前选中的是敌方目标，对该敌方施法；若选中目标敌友不匹配(选中了友方队友或无目标)，向最近的敌人施法
      const selectedEnemy = selectedTargetId
        ? engine.enemyUnits.find(u => u.id === selectedTargetId && (u.isAlive ?? u.alive) && u.hp > 0)
        : null;

      if (selectedEnemy) {
        effectiveTarget = selectedEnemy;
      } else {
        // 选中友方或无目标：自动寻找距离玩家最近的存活敌人
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
    if (slot.spellId === 'revive' || slot.spellId === 'ancestral_spirit') {
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
    const isSelfOrPartyWide = [
      'bone_shield', 'vampiric_blood', 'pillar_of_frost', 'horn_of_winter',
      'slice_and_dice', 'adrenaline_rush', 'feint', 'bloodlust', 'time_warp',
      'arcane_power', 'tranquility', 'natures_swiftness'
    ].includes(slot.spellId);

    const isMelee = [
      'death_strike', 'heart_strike', 'rune_strike', 'mind_freeze', 'sinister_strike',
      'eviscerate', 'kick', 'obliterate', 'frost_strike', 'mutilate', 'envenom'
    ].includes(slot.spellId);
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
    const isRevive = slot.spellId === 'revive' || slot.spellId === 'ancestral_spirit' || slot.spellId === 'rebirth';
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

    // ── Deduct Resource & Trigger Global Cooldown (GCD) ──
    if (manaCost > 0 && player.maxMp && player.maxMp > 0) {
      player.mp = Math.max(0, (player.mp ?? 0) - manaCost);
      const mRes = player.resources?.find(r => r.kind === 'MANA');
      if (mRes) mRes.current = player.mp;
    }
    if (energyCost > 0 && player.classId === 'ROGUE') {
      player.energy = Math.max(0, (player.energy ?? 100) - energyCost);
      const eRes = player.resources?.find(r => r.kind === 'ENERGY');
      if (eRes) eRes.current = player.energy;
    }
    if (!isOffGcd) {
      const gcdMs = 750;
      setPlayerGcdRemainingMs(gcdMs);
      setPlayerGcdTotalMs(gcdMs);
      engine.cooldownManager?.startGcd?.(player.id, gcdMs);
    }

    const triggerSlotCooldown = (explicitCdMs?: number) => {
      const defaultCd = DEFAULT_SPELL_COOLDOWNS[slot.spellId] || 0;
      const cd = explicitCdMs ?? ((slot.totalCdMs && slot.totalCdMs > 0) ? slot.totalCdMs : defaultCd);
      if (cd > 0) {
        triggerCooldown(slot.spellId, cd);
      }
    };

    const startPlayerCast = (newCast: PlayerCastState) => {
      playerCastRef.current = newCast;
      setPlayerCast(newCast);
      if (!newCast.isHarmful && !newCast.isChannel && newCast.targetId) {
        const pAmt = getPredictedHealAmount(newCast.spellId, player);
        if (pAmt > 0) {
          const castObj: IncomingHealCast = {
            casterId: player.id || 'p1_player',
            casterName: player.name || '勇士',
            spellName: newCast.spellName,
            amount: pAmt,
            progress: 0,
            classId: player.classId || 'DRUID',
          };
          setIncomingCasts((prev) => {
            const existing = prev[newCast.targetId!]?.filter(c => c.casterId !== (player.id || 'p1_player')) || [];
            return {
              ...prev,
              [newCast.targetId!]: [...existing, castObj],
            };
          });
          setIncomingHeals((prev) => ({
            ...prev,
            [newCast.targetId!]: (prev[newCast.targetId!] || 0) + pAmt,
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
      const target = selectedTargetId
        ? engine.friendlyUnits.find(u => u.id === selectedTargetId) || player
        : player;
      let healVal = 18000;
      engine.healUnit(player, target, healVal, false, '治疗链');
      const otherAllies = engine.friendlyUnits.filter(u => u.id !== target.id && u.alive && u.isAlive);
      for (let i = 0; i < Math.min(3, otherAllies.length); i++) {
        healVal = Math.round(healVal * 0.7);
        engine.healUnit(player, otherAllies[i], healVal, false, '治疗链');
      }
      triggerSlotCooldown();
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

    // Default Fallback
    if (boss && boss.alive) {
      const isCrit = Math.random() < 0.35;
      if (isCrit) {
        setScreenShake(true);
        setTimeout(() => setScreenShake(false), 120);
      }
      engine.dealDamage(player, boss, 11500, 'PHYSICAL', isCrit, '影袭');
      engine.threatManager.addThreat(boss.id, player.id, 11500);
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

    if (choice === 'RETRY') {
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

  const handleStartAdventure = () => {
    if (!currentChar) return;
    const engine = engineRef.current;
    const rsm = rsmRef.current;

    // 1. 重置技能 CD 与读条施法状态，固化加载当前专精自定义动作条布局
    setCustomSlotLayout(loadSpecCustomSlots(currentChar.id, currentChar.lastSpec, currentChar.classId));
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

    // 2. 重新初始化队伍为 100% 满状态存活
    setupRaidUnits(currentChar, dungeonTier, dungeonDifficulty, customDifficulty);

    // 3. 引擎系统重置 (CD、仇恨、地面法阵、DK符文)
    if (engine) {
      engine.difficulty = dungeonDifficulty;
      engine.customDifficulty = customDifficulty;
      engine.resetCooldowns();
      engine.threatManager.resetAll();
      engine.effectsManager.clearAll();
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
    }

    // 4. 副本状态机启动
    if (rsm) {
      rsm.dungeon = dungeonTier === '20man' ? DRAGON_SOUL_CONFIG : SHADOWFANG_KEEP_CONFIG;
      rsm.startRun();
      setRunPhase(rsm.phase);
      setIsCertClaimed(false);
      setFocusTargetId(null);
    }

    if (engine) {
      setFriendlyUnits([...engine.friendlyUnits]);
    }
  };

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
          {currentChar && (
            <div
              onClick={() => {
                setLobbySubView('AUTH_CHAR');
                if (runPhase !== 'LOBBY') {
                  handleReturnToLobby();
                }
              }}
              className="bg-[#1b1b34] border border-[#3b3b5c] px-3 py-1 rounded-lg text-xs font-bold cursor-pointer hover:border-amber-400 transition flex items-center space-x-2"
              title="点击返回主页与角色切换"
            >
              <span className="text-gray-400">当前冒险者:</span>
              <span className="text-amber-300">{currentChar.name}</span>
              <span className="text-[10px] text-gray-400">({currentChar.lastSpec})</span>
            </div>
          )}

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
              setLobbySubView('ROOM_LIST');
              if (runPhase !== 'LOBBY') {
                handleReturnToLobby();
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
              rooms={roomManager.listRooms()}
              player={{
                id: currentChar.id,
                name: currentChar.name,
                classId: currentChar.classId,
                spec: currentChar.lastSpec,
              }}
              onCreateRoom={handleCreateRoom}
              onJoinRoom={handleJoinRoom}
              onJoinWaitingQueue={handleJoinWaitingQueue}
              onQuickJoin={handleQuickJoin}
              onBackToCharacterSelect={() => setLobbySubView('AUTH_CHAR')}
            />
          ) : lobbySubView === 'ROOM_DETAIL' && activeRoomId && roomManager.getRoom(activeRoomId) && currentChar ? (
            <RoomDetailView
              room={roomManager.getRoom(activeRoomId)!}
              currentPlayerId={currentChar.id}
              roomManager={roomManager}
              onLeaveRoom={() => {
                setActiveRoomId(null);
                setLobbySubView('ROOM_LIST');
                setRoomsTick(t => t + 1);
              }}
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
            dungeonTier={dungeonTier}
            onSelectDungeonTier={handleSelectDungeonTier}
            dungeonDifficulty={dungeonDifficulty}
            onSelectDungeonDifficulty={handleSelectDungeonDifficulty}
            customDifficulty={customDifficulty}
            onChangeCustomDifficulty={handleCustomDifficultyChange}
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
                  isPlayerDead={(() => {
                    const p = friendlyUnits.find(u => u.isPlayer);
                    return !p || (!p.isAlive && !p.alive) || (p.hp !== undefined && p.hp <= 0);
                  })()}
                  initialPos={currentChar?.uiLayout?.actionBar}
                  onSavePos={(pos) => {
                    if (currentChar) {
                      accountMgrRef.current.saveCharacterUiLayout(currentChar.id, { actionBar: pos });
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