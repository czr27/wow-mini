import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
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
} from '@cata-raid-sim/engine';
import {
  BossAI,
  roomManager,
  LEVEL_80_MAX_HASTE,
} from '@cata-raid-sim/engine';
import type { PlayerCastState } from '../components/ActionBar.js';
import type { IncomingHealCast } from '../components/RaidFrames.js';
import { netClient } from '../net/NetClient.js';
import type { NetworkRoomFacade } from '../net/NetworkRoomFacade.js';
import {
  buildCastFromTimeline,
  cooldownRemainingFromTimelines,
  gcdRemainingFromTimelines,
} from '../net/netTimeline.js';
import {
  hasSufficientPlayerResources,
  deductPlayerResources,
  processPlayerChannelTick,
} from '../hooks/usePlayerCastController.js';
import { syncUnitResources } from './unitResources.js';
import { runFriendlyAiCombatTick, type AiActiveCast } from './aiCombatExecutor.js';

export type CombatTickMutableState = {
  tickCount: number;
  reviveTimerMs: number;
};

export type CombatTickCtx = {
  rsmRef: MutableRefObject<RunStateMachine | null>;
  engineRef: MutableRefObject<CombatEngine>;
  runPhase: string;
  isNetworkGuestRef: MutableRefObject<boolean>;
  currentChar: CharacterRecord | null | undefined;
  guestCastTimelinesRef: MutableRefObject<NetworkCastTimeline[]>;
  guestGcdTimelinesRef: MutableRefObject<NetworkGcdTimeline[]>;
  guestCdTimelinesRef: MutableRefObject<NetworkCooldownTimeline[]>;
  playerCastRef: MutableRefObject<PlayerCastState | null>;
  setPlayerCast: Dispatch<SetStateAction<PlayerCastState | null>>;
  setPlayerGcdRemainingMs: Dispatch<SetStateAction<number>>;
  setPlayerGcdTotalMs: Dispatch<SetStateAction<number>>;
  setPlayerCooldowns: Dispatch<SetStateAction<Record<string, { cdRemainingMs: number; totalCdMs: number }>>>;
  setCompanionCasts: Dispatch<SetStateAction<Record<string, { spellName: string; progress: number }>>>;
  wipeNetworkVote: NetworkVoteState | null;
  setWipeVoteTimerMs: Dispatch<SetStateAction<number>>;
  isNetworkHostRef: MutableRefObject<boolean>;
  pendingGuestInputsRef: MutableRefObject<PlayerInputPayload[]>;
  activeRoomIdRef: MutableRefObject<string | null>;
  lastWipePhaseBroadcastRef: MutableRefObject<string | null>;
  lastCombatBroadcastMsRef: MutableRefObject<number>;
  prevRunPhaseRef: MutableRefObject<string | null>;
  clearPlayerIncomingCast: () => void;
  approachedBossIdRef: MutableRefObject<string | null>;
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
  activeRoomId: string | null;
  waitingQueueRoomId: string | null;
  roomFacadeRef: MutableRefObject<NetworkRoomFacade>;
  setWaitingQueueRoomId: Dispatch<SetStateAction<string | null>>;
  setActiveRoomId: Dispatch<SetStateAction<string | null>>;
  focusTargetId: string | null;
  bossAiRef: MutableRefObject<BossAIType | null>;
  lastBossAttackTickRef: MutableRefObject<number>;
  isApproaching: boolean;
  castTargetIdRef: MutableRefObject<string | null>;
  pendingCastSlotRef: MutableRefObject<number | null>;
  handleCastSlot: (slotIdx: number) => void;
  resolvePlayerCast: (spellId: string, totalCdMs?: number) => boolean;
  triggerCooldown: (spellId: string, totalCdMs: number) => void;
  getPredictedHealAmount: (spellId: string, caster?: Unit) => number;
  lastPlayerMoveMsRef: MutableRefObject<number>;
  aiHealerCastsRef: MutableRefObject<Record<string, AiActiveCast>>;
  aiCooldownsRef: MutableRefObject<Record<string, number>>;
  getUnitAIPersonality: (u: Unit) => AIPersonality;
  inferAiSpecForUnit: (u: Unit) => string;
  isAiCdReady: (unitId: string, spellId: string, cdMs: number) => boolean;
  markAiCdUsed: (unitId: string, spellId: string) => void;
  notifyOom: (u: Unit, engine: CombatEngine) => void;
  lastPlayerAttackTickRef: MutableRefObject<number>;
  lastPetAttackTickRef: MutableRefObject<number>;
  setRunPhase: Dispatch<SetStateAction<any>>;
  setTravelRemainingMs: Dispatch<SetStateAction<number>>;
  setTotalDurationSec: Dispatch<SetStateAction<number>>;
  setTargetBossName: Dispatch<SetStateAction<string>>;
  setIsCorpseRunning: Dispatch<SetStateAction<boolean>>;
  setCorpseRunTimerMs: Dispatch<SetStateAction<number>>;
};

/**
 * One 20Hz combat frame (host sim + guest HUD timelines + sync).
 * tickCount / reviveTimerMs live in mutable state so the owning interval can reset them.
 */
export function runCombatTickFrame(ctx: CombatTickCtx, state: CombatTickMutableState): void {
  const rsm = ctx.rsmRef.current;
  const engine = ctx.engineRef.current;
  if (!rsm || ctx.runPhase === 'LOBBY' || ctx.runPhase === 'SUMMARY') return;

  // Network guests: no combat sim — advance local HUD from host timelines
  if (ctx.isNetworkGuestRef.current) {
    const now = Date.now();
    const myId = ctx.currentChar?.id;
    if (myId) {
      const myCastTl = ctx.guestCastTimelinesRef.current.find((c) => c.unitId === myId && !c.interrupted);
      if (myCastTl) {
        const built = buildCastFromTimeline(myCastTl, now);
        if (built) {
          ctx.playerCastRef.current = built as any;
          ctx.setPlayerCast(built as any);
        } else {
          ctx.playerCastRef.current = null;
          ctx.setPlayerCast(null);
        }
      }
      const gcd = gcdRemainingFromTimelines(ctx.guestGcdTimelinesRef.current, myId, now);
      ctx.setPlayerGcdRemainingMs(gcd.remaining);
      ctx.setPlayerGcdTotalMs(gcd.total);
      ctx.setPlayerCooldowns((prev) => {
        const next = { ...prev };
        for (const slot of Object.keys(next)) {
          const rem = cooldownRemainingFromTimelines(ctx.guestCdTimelinesRef.current, myId, slot, now);
          if (rem > 0) {
            next[slot] = { ...(next[slot] || { totalCdMs: rem }), cdRemainingMs: rem, totalCdMs: next[slot]?.totalCdMs || rem };
          } else if (next[slot]) {
            next[slot] = { ...next[slot], cdRemainingMs: 0 };
          }
        }
        for (const cd of ctx.guestCdTimelinesRef.current) {
          if (cd.unitId !== myId) continue;
          const rem = cooldownRemainingFromTimelines(ctx.guestCdTimelinesRef.current, myId, cd.spellId, now);
          next[cd.spellId] = { cdRemainingMs: rem, totalCdMs: cd.totalMs };
        }
        return next;
      });
    }
    const companion: Record<string, { spellName: string; progress: number }> = {};
    for (const c of ctx.guestCastTimelinesRef.current) {
      if (c.interrupted || c.unitId === myId) continue;
      const built = buildCastFromTimeline(c, now);
      if (built) companion[c.unitId] = { spellName: built.spellName, progress: built.progress };
    }
    ctx.setCompanionCasts(companion);
    if (ctx.wipeNetworkVote && !ctx.wipeNetworkVote.resolved) {
      ctx.setWipeVoteTimerMs(Math.max(0, ctx.wipeNetworkVote.timeoutMs - (now - ctx.wipeNetworkVote.startedAtMs)));
    }
    return;
  }

  const deltaMs = 50;
  state.tickCount++;

  // Apply remote player inputs on host before simulating
  if (ctx.isNetworkHostRef.current && ctx.pendingGuestInputsRef.current.length > 0) {
    const inputs = ctx.pendingGuestInputsRef.current.splice(0, ctx.pendingGuestInputsRef.current.length);
    for (const input of inputs) {
      if (input.kind === 'TARGET' && input.targetId) {
        continue;
      }
      if (input.kind === 'INTERRUPT' && input.playerId) {
        engine.interruptCast(input.playerId);
        if (ctx.activeRoomIdRef.current) {
          netClient.sendCastInterrupt(ctx.activeRoomIdRef.current, input.playerId, input.spellId);
        }
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

  // Host: start wipe vote once when entering WIPE_VOTE
  if (
    ctx.isNetworkHostRef.current &&
    netClient.connected &&
    ctx.activeRoomIdRef.current &&
    rsm.phase === 'WIPE_VOTE' &&
    ctx.lastWipePhaseBroadcastRef.current !== 'WIPE_VOTE'
  ) {
    ctx.lastWipePhaseBroadcastRef.current = 'WIPE_VOTE';
    netClient.startVote(ctx.activeRoomIdRef.current, 'WIPE');
  }
  if (rsm.phase !== 'WIPE_VOTE') {
    ctx.lastWipePhaseBroadcastRef.current = rsm.phase;
  }

  // Host broadcasts compact combat state + cast/CD timelines (~10Hz)
  if (ctx.isNetworkHostRef.current && ctx.activeRoomIdRef.current && netClient.connected) {
    const now = Date.now();
    if (now - ctx.lastCombatBroadcastMsRef.current >= 100) {
      ctx.lastCombatBroadcastMsRef.current = now;
      const casts: NetworkCastTimeline[] = engine.getPendingCasts().map((c) => ({
        unitId: c.casterId,
        spellId: c.spellId,
        spellName: c.spellName,
        startedAtMs: now - (c.totalMs - c.remainingMs),
        totalMs: c.totalMs,
        isChannel: c.mode === 'CHANNELED',
        targetId: c.targetId,
      }));
      // Also include local player cast bar if driven outside engine pendingCasts
      if (ctx.playerCastRef.current && ctx.currentChar) {
        const pc = ctx.playerCastRef.current;
        if (!casts.some((c) => c.unitId === ctx.currentChar.id)) {
          casts.push({
            unitId: ctx.currentChar.id,
            spellId: pc.spellId,
            spellName: pc.spellName,
            startedAtMs: now - (pc.elapsedMs || 0),
            totalMs: pc.totalMs || 1500,
            isChannel: !!pc.isChannel,
            targetId: pc.targetId,
          });
        }
      }
      const cooldowns: NetworkCooldownTimeline[] = engine.cooldownManager.getAllActiveCooldowns().map((e) => ({
        unitId: e.unitId,
        spellId: e.spellId,
        startedAtMs: now - (e.totalMs - e.remainingMs),
        totalMs: e.totalMs,
      }));
      const gcds: NetworkGcdTimeline[] = [];
      for (const u of engine.getAllUnits()) {
        const rem = engine.cooldownManager.getGcdRemaining(u.id);
        if (rem > 0) {
          const total = 1000;
          gcds.push({
            unitId: u.id,
            startedAtMs: now - (total - rem),
            totalMs: total,
          });
        }
      }
      netClient.sendCombatState({
        roomId: ctx.activeRoomIdRef.current,
        timeMs: now,
        runPhase: rsm.phase,
        travelRemainingMs: rsm.travelRemainingMs,
        totalTravelMs: rsm.totalTravelMs,
        currentBossIndex: rsm.currentBossIndex,
        isCleared: rsm.isCleared,
        bossTargetId: engine.bossUnit
          ? engine.threatManager.getCurrentTarget?.(engine.bossUnit.id) ?? null
          : null,
        units: engine.buildNetworkUnitSnapshots(),
        casts,
        cooldowns,
        gcds,
      });
    }
  }

  // Detect wipe vote retry transition (manual vote or auto-timeout after 15s)
  if (ctx.prevRunPhaseRef.current === 'WIPE_VOTE' && rsm.phase === 'TRAVEL_RECOVERY') {
    engine.resetCooldowns();
    engine.threatManager.resetAll();
    engine.effectsManager.clearAll();
    ctx.setPlayerCooldowns({});
    ctx.playerCastRef.current = null;
    ctx.clearPlayerIncomingCast();
    ctx.setPlayerCast(null);
    ctx.setCompanionCasts({});
    ctx.setIncomingHeals({});
    ctx.setIncomingCasts({});
    ctx.setBossTargetId(null);
    ctx.setFocusTargetId(null);
    ctx.setRevivingUnitId(null);
    ctx.setReviveProgress(0);
    ctx.approachedBossIdRef.current = null;
    ctx.setIsApproaching(false);
    ctx.setGroundEffects([]);
    ctx.setFloatingTexts([]);
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
      ctx.setBossUnit(engine.bossUnit ? { ...engine.bossUnit } : undefined);
    }
    ctx.setFriendlyUnits([...engine.friendlyUnits]);
  }

  // Boss health synchronization for room spectators
  if (ctx.activeRoomId && engine.bossUnit && rsm.phase === 'BOSS_COMBAT') {
    roomManager.updateCombatBossState(
      ctx.activeRoomId,
      engine.bossUnit.name,
      engine.bossUnit.hp,
      engine.bossUnit.maxHp,
      engine.bossUnit.id
    );
  }

  // Hot-swap waiting players onto AI slots (inherit HP/Buff); also mid-combat
  {
    const targetRoomId = ctx.activeRoomId || ctx.waitingQueueRoomId;
    if (targetRoomId && (!ctx.isNetworkHostRef.current || ctx.isNetworkHostRef.current)) {
      const shouldTrySwap =
        !netClient.connected ||
        ctx.isNetworkHostRef.current ||
        (!netClient.connected && (rsm.phase === 'TRAVEL_RECOVERY' || rsm.phase === 'BOSS_COMBAT'));
      if (shouldTrySwap && (rsm.phase === 'TRAVEL_RECOVERY' || rsm.phase === 'BOSS_COMBAT')) {
        // Only host (or offline) mutates engine; networked guests receive MEMBER_HOT_SWAP
        if (!netClient.connected || ctx.isNetworkHostRef.current) {
          const subResult = roomManager.substituteOutOfCombat(targetRoomId, engine, rsm);
          if (subResult.substituted.length > 0) {
            ctx.setFriendlyUnits([...engine.friendlyUnits]);
            ctx.roomFacadeRef.current.upsertRoom(roomManager.getRoom(targetRoomId)!);
            if (netClient.connected && ctx.isNetworkHostRef.current && ctx.activeRoomIdRef.current) {
              for (const s of subResult.substituted) {
                const unitSnap = s.unit
                  ? engine.buildNetworkUnitSnapshots().find((u) => u.id === s.player.id)
                  : undefined;
                netClient.sendHotSwap(ctx.activeRoomIdRef.current, {
                  roomId: ctx.activeRoomIdRef.current,
                  room: roomManager.getRoom(targetRoomId),
                  playerId: s.player.id,
                  replacedAiId: s.replacedAi.id,
                  unitSnapshot: unitSnap,
                });
              }
            }
            if (ctx.waitingQueueRoomId && ctx.currentChar && subResult.substituted.some(s => s.player.id === ctx.currentChar.id)) {
              ctx.setWaitingQueueRoomId(null);
              ctx.setActiveRoomId(targetRoomId);
            }
          }
        }
      }
    }
  }

  ctx.prevRunPhaseRef.current = rsm.phase;

  // Check boss encounter transition for Staged Pull Approach
  if (rsm.phase === 'BOSS_COMBAT') {
    const currentBossConfig = rsm.getCurrentBoss();
    const expectedBossId = currentBossConfig?.id || 'ashbury';
    // Ensure boss unit always exists when entering the room (travel/skip can race)
    if (!engine.bossUnit && currentBossConfig) {
      engine.spawnBoss(currentBossConfig.id, currentBossConfig.name, currentBossConfig.hp);
    }
    if (ctx.approachedBossIdRef.current !== expectedBossId) {
      ctx.approachedBossIdRef.current = expectedBossId;
      ctx.setIsApproaching(true);
      ctx.bossAiRef.current = new BossAI(expectedBossId, rsm.dungeon.id);
      ctx.lastBossAttackTickRef.current = 0;
      if (engine.bossUnit) {
        ctx.setBossUnit({ ...engine.bossUnit });
        ctx.setFocusTargetId(engine.bossUnit.id);
        ctx.setSelectedTargetId(engine.bossUnit.id);
      }
    }
    if (!ctx.focusTargetId && engine.bossUnit) {
      ctx.setFocusTargetId(engine.bossUnit.id);
    }
  } else {
    ctx.approachedBossIdRef.current = null;
  }

  // 1. Advance Player Cast Bar if casting or channeling
  ctx.setPlayerCast((prev) => {
    if (!prev) {
      ctx.playerCastRef.current = null;
      return null;
    }

    const player = engine.friendlyUnits.find(u => u.isPlayer);
    if (!player || (!player.isAlive && !player.alive)) {
      ctx.playerCastRef.current = null;
      ctx.clearPlayerIncomingCast();
      return null;
    }

    // 运行时目标存活与射程校验：若中途目标死亡或超出范围，施法立即中断，绝对不进CD！
    const targetId = prev.targetId || ctx.castTargetIdRef.current;
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
        ctx.playerCastRef.current = null;
        ctx.clearPlayerIncomingCast();
        return null;
      }
      if (isRevive && isTargetAlive) {
        engine.effectsManager?.addFloatingText({
          targetId: player.id,
          text: '❌ 目标不需要复活 (施法中断)',
          category: 'STATUS',
          isCrit: false,
        });
        ctx.playerCastRef.current = null;
        ctx.clearPlayerIncomingCast();
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
          ctx.playerCastRef.current = null;
          ctx.clearPlayerIncomingCast();
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
        const pending = ctx.pendingCastSlotRef.current;
        ctx.pendingCastSlotRef.current = null;
        if (pending !== null) {
          setTimeout(() => ctx.handleCastSlot(pending), 10);
        }
        ctx.playerCastRef.current = null;
        ctx.clearPlayerIncomingCast();
        return null;
      }
      const next = { ...prev, elapsedMs: newElapsed, progress };
      ctx.playerCastRef.current = next;
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
          castSuccess = ctx.resolvePlayerCast(prev.spellId, prev.totalCdMs);
          if (castSuccess) {
            if (prev.deferredCosts) {
              deductPlayerResources(player, prev.deferredCosts, syncUnitResources);
            }
            if (prev.totalCdMs && prev.totalCdMs > 0) {
              ctx.triggerCooldown(prev.spellId, prev.totalCdMs);
            }
          }
        } else if (resCheck.errorText) {
          window.dispatchEvent(new CustomEvent('cata_ui_error', { detail: { text: resCheck.errorText } }));
        }
      }
      const pending = ctx.pendingCastSlotRef.current;
      ctx.pendingCastSlotRef.current = null;
      if (pending !== null) {
        setTimeout(() => ctx.handleCastSlot(pending), 10);
      }
      ctx.playerCastRef.current = null;
      ctx.clearPlayerIncomingCast();
      return null;
    }
    const next = { ...prev, elapsedMs: newElapsed, progress };
    ctx.playerCastRef.current = next;
    return next;
  });

  // Decrement active player cooldowns
  ctx.setPlayerCooldowns((prev) => {
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
  ctx.setPlayerGcdRemainingMs((prev) => Math.max(0, prev - deltaMs));

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
  const activePlayerCast = ctx.playerCastRef.current;
  if (activePlayerCast && !activePlayerCast.isHarmful && !activePlayerCast.isChannel) {
    const pTargetId = activePlayerCast.targetId || ctx.castTargetIdRef.current;
    if (pTargetId) {
      const pTarget = engine.friendlyUnits.find(u => u.id === pTargetId);
      if (pTarget && (pTarget.alive || pTarget.isAlive) && pTarget.hp > 0) {
        const pUnit = engine.friendlyUnits.find(u => u.isPlayer);
        const pAmt = ctx.getPredictedHealAmount(activePlayerCast.spellId, pUnit);
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
  if (rsm.phase === 'BOSS_COMBAT' && !ctx.isApproaching) {
    const player = engine.friendlyUnits.find(u => u.isPlayer);
    if (player && (player.isAlive || player.alive) && player.buffs.some(b => b.spellId === 'toxic_catalyst')) {
      if (Date.now() - ctx.lastPlayerMoveMsRef.current > 1500 && state.tickCount % 20 === 0) {
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
  if (rsm.phase === 'BOSS_COMBAT' && !ctx.isApproaching) {
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
        ctx.bossAiRef.current?.currentCasting && ctx.bossAiRef.current.currentCasting.skill.castTimeMs > 0
      );
      (boss as any).castingSpellName = ctx.bossAiRef.current?.currentCasting?.skill.name;
      (boss as any).castProgress = ctx.bossAiRef.current?.currentCasting
        ? ctx.bossAiRef.current.currentCasting.elapsedMs / ctx.bossAiRef.current.currentCasting.skill.castTimeMs
        : 0;

      // Tick authentic Boss AI abilities
      if (ctx.bossAiRef.current) {
        ctx.bossAiRef.current.tick(deltaMs, boss, engine);
      }

      // Resolve authentic boss target (OT detection)
      const targetId = engine.getBossTargetId();
      ctx.setBossTargetId(targetId || null);

      // P7: AI spell execute + decision loop → combat/aiCombatExecutor
      runFriendlyAiCombatTick({
        engine,
        boss,
        livingEnemies,
        bossThreatTargetId: targetId || null,
        tickCount: state.tickCount,
        deltaMs,
        bossAi: ctx.bossAiRef.current,
        aiCasts: ctx.aiHealerCastsRef.current,
        aiCooldowns: ctx.aiCooldownsRef.current,
        currentCasts,
        getUnitAIPersonality: ctx.getUnitAIPersonality,
        inferAiSpecForUnit: ctx.inferAiSpecForUnit,
        isAiCdReady: ctx.isAiCdReady,
        markAiCdUsed: ctx.markAiCdUsed,
        notifyOom: ctx.notifyOom,
        addIncomingCast,
      });

      const is20Man = engine.friendlyUnits.length > 5;

      // 判定首领当前是否处于窒息术后安全治疗窗口或行动锁定状态
      const isBossDamageLocked = Boolean(
        ctx.bossAiRef.current?.isActionLocked() || engine.isBossHealingGraceActive()
      );

      if (isBossDamageLocked) {
        // 在3秒安全治疗窗口期间，首领严禁造成任何普攻与伤害，并重置普攻挥击计时器
        // 确保窗口结束后坦克仍拥有完整的1.2秒（24 ticks）挥击前摇缓冲，给予治疗充足的加血时间
        ctx.lastBossAttackTickRef.current = state.tickCount;
      } else {
        // Boss auto attacks its top threat target (resolved from ThreatManager, constrained by melee range <= 80px)
        const targetUnit = engine.friendlyUnits.find(u => u.id === targetId && (u.isAlive || u.alive));
        if (targetUnit && (state.tickCount - ctx.lastBossAttackTickRef.current) >= 24) {
          ctx.lastBossAttackTickRef.current = state.tickCount;
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
        if (state.tickCount - ctx.lastPlayerAttackTickRef.current >= 40) {
          ctx.lastPlayerAttackTickRef.current = state.tickCount;
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
          if (state.tickCount - ctx.lastPetAttackTickRef.current >= 48) {
            ctx.lastPetAttackTickRef.current = state.tickCount;
            const petCrit = Math.random() < 0.25;
            const isPetSkill = (state.tickCount % 96 === 0);
            const petDmg = isPetSkill ? (petCrit ? 6000 : 3000) : (petCrit ? 3600 : 1800);
            const petSpell = isPetSkill ? (playerUnit.classId === 'MAGE' ? '水箭' : '爪击') : '普通攻击';
            const school = playerUnit.classId === 'MAGE' && isPetSkill ? 'FROST' : 'PHYSICAL';
            engine.resolveAttackHit(playerPet, boss, petDmg, school as any, petCrit, petSpell);
          }
        }
      }

      // Continuous ambient dungeon combat pressure (every 3.0s = 60 ticks)
      // 在首领治疗窗口期内严格禁止造成环境暗影瘴气伤害
      if (!isBossDamageLocked && state.tickCount % 60 === 0) {
        const ambientDmg = is20Man ? 6000 : 4000;
        const livingNonTanks = engine.friendlyUnits.filter(u => u.role !== 'TANK' && (u.isAlive || u.alive));
        if (livingNonTanks.length > 0) {
          const randomVictim = livingNonTanks[Math.floor(Math.random() * livingNonTanks.length)];
          engine.dealDamage(boss, randomVictim, ambientDmg, 'SHADOW', false, '地牢暗影瘴气');
        }
      }
    } else {
      // Boss is dead! Stop all casting immediately
      ctx.setBossTargetId(null);
      ctx.aiHealerCastsRef.current = {};
    }
  }

  // 3. Recovery Phase: Surviving Healer Resurrects Dead Teammates (3.0s cast)
  if (rsm.phase === 'TRAVEL_RECOVERY') {
    const deadAlly = engine.friendlyUnits.find(u => (!u.isAlive && !u.alive) || u.hp <= 0);
    const healer = engine.friendlyUnits.find(
      u => (u.isAlive ?? u.alive) && u.hp > 0 && (u.role === 'HEALER' || u.classId === 'SHAMAN' || u.classId === 'DRUID')
    );

    if (deadAlly && healer && !rsm.isCorpseRunning) {
      ctx.setRevivingUnitId(deadAlly.id);
      state.reviveTimerMs += deltaMs;
      const progress = Math.min(1, state.reviveTimerMs / 3000);
      ctx.setReviveProgress(progress);

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
        state.reviveTimerMs = 0;
        ctx.setRevivingUnitId(null);
        ctx.setReviveProgress(0);
      }
    } else {
      ctx.setRevivingUnitId(null);
      ctx.setReviveProgress(0);
      state.reviveTimerMs = 0;
    }
  }

  // Sync active casts & incoming heal prediction bars across frames
  ctx.setCompanionCasts(currentCasts);
  ctx.setIncomingHeals(currentHeals);
  ctx.setIncomingCasts(currentIncomingCasts);

  // Sync React state
  ctx.setRunPhase(rsm.phase);
  ctx.setFriendlyUnits([...engine.friendlyUnits]);
  ctx.setBossUnit(engine.bossUnit ? { ...engine.bossUnit } : undefined);
  ctx.setGroundEffects([...(engine.effectsManager?.groundEffects || [])]);
  ctx.setFloatingTexts([...(engine.effectsManager?.floatingTexts || [])]);
  ctx.setTravelRemainingMs(rsm.travelRemainingMs);
  ctx.setWipeVoteTimerMs(rsm.wipeVoteTimerMs);
  ctx.setTotalDurationSec(Math.round(rsm.totalRunDurationSec));
  ctx.setTargetBossName(rsm.getCurrentBoss()?.name || '首领');
  ctx.setIsCorpseRunning(rsm.isCorpseRunning);
  ctx.setCorpseRunTimerMs(rsm.corpseRunTimerMs);
}
