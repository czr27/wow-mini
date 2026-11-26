import { useEffect, useRef, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
import type {
  CharacterRecord,
  UserAccount,
  CombatEngine,
  RunStateMachine,
  RunPhase,
  Unit,
  DungeonDifficulty,
  CustomDifficultySettings,
  NetworkCastTimeline,
  NetworkCooldownTimeline,
  NetworkGcdTimeline,
  NetworkCombatSnapshot,
  TemporaryExtraAction,
  NetworkVoteState,
  PlayerInputPayload,
  VoteResultPayload,
  LobbyRoom as NetLobbyRoom,
  AccountManager,
  GroundEffect,
  FloatingCombatText,
  CombatEffect,
  CombatBatch,
  OwnerSnapshot,
  DbmAlert,
  GmCommandPayload,
} from '@cata-raid-sim/engine';
import {
  roomManager,
  getRoleBySpec,
  DUNGEON_ROLE_QUOTAS,
  getDungeonConfig,
} from '@cata-raid-sim/engine';
import type { PlayerCastState } from '../components/ActionBar.js';
import { netClient } from '../net/NetClient.js';
import type { NetworkRoomFacade } from '../net/NetworkRoomFacade.js';
import {
  pendingQuickPlayStartRef,
  type RoomLobbySubView,
  type StartAdventureOverrides,
} from './useRoomLobby.js';
import { applyGuestMazeSync } from '../combat/mazeSyncBridge.js';
import { dispatchCombatFxActions } from '../combat/dispatchCombatFx.js';
import { installSummonReporters } from '../combat/summonReport.js';
import {
  applyCombatBatch,
  beginCombatEffectEpoch,
  buildLocalOwnerSnapshot,
  configureCombatAuthority,
  hostReceiveCombatEffect,
  hostReceiveOwnerSnapshot,
  ingestCombatEffect,
  makeGuestAuthorityPredicate,
  makeHostAuthorityPredicate,
  mergeOwnerSnapshotUnits,
  publishOwnerSnapshot,
  setHostEffectHudHook,
} from '../combat/networkCombatAuthority.js';
import {
  beginAuthorityPresenceEpoch,
  clearAuthorityPresence,
  endAuthorityPresenceEpoch,
  isTrackedAuthority,
  noteAuthorityPacket,
  trackAuthoritySeat,
} from '../combat/authorityPresence.js';
import { serializeGroundEffectWire } from '../combat/summonReport.js';
import {
  applyRemoteCastEffect,
  companionCastsFromTimelines,
  syncBossCastHud,
  type CompanionCastHud,
} from '../combat/castLifecycleNet.js';
import {
  applyWorldSnapshotsPreservingAuthority,
  mergeGroundEffectsPreservingAuthority,
  syncPreservedIdentityFromSnapshot,
} from '../combat/applyWorldSnapshotPreserveAuth.js';
import {
  getLocalEncounterRecorder,
  mergeHostEncounterReports,
  noteGuestCombatSnapshot,
} from '../combat/localEncounterRecorder.js';
import { clearOwnerCombatSpawns } from '../combat/clearOwnerCombatSpawns.js';
import {
  applyPlayerLeaveAiTakeover,
  purgeStaleOwnerIfNotInRoom,
} from '../combat/playerLeaveAiTakeover.js';
import { ensureHotJoinedSeat } from '../combat/ensureHotJoinedSeat.js';
import {
  HOST_GONE_TIMEOUT_MS,
  isHostAliveSignal,
  shouldGuestLeaveOnHostSilence,
} from '../combat/hostLeaveWatch.js';

export type NetworkRoomSyncDeps = {
  currentChar: CharacterRecord | null;
  account: UserAccount | null;
  accountMgrRef: MutableRefObject<AccountManager>;
  roomFacadeRef: MutableRefObject<NetworkRoomFacade>;
  rsmRef: MutableRefObject<RunStateMachine | null>;
  engineRef: MutableRefObject<CombatEngine>;
  isNetworkHostRef: MutableRefObject<boolean>;
  isNetworkGuestRef: MutableRefObject<boolean>;
  activeRoomIdRef: MutableRefObject<string | null>;
  waitingQueueRoomIdRef: MutableRefObject<string | null>;
  setupRaidUnitsRef: MutableRefObject<(
    char: CharacterRecord,
    tier?: '5man' | '20man',
    difficulty?: DungeonDifficulty,
    customDiff?: CustomDifficultySettings,
    activeRoom?: NetLobbyRoom
  ) => void>;
  customDifficultyRef: MutableRefObject<CustomDifficultySettings>;
  startAdventureRef: MutableRefObject<(overrides?: StartAdventureOverrides) => void>;
  guestCastTimelinesRef: MutableRefObject<NetworkCastTimeline[]>;
  guestCdTimelinesRef: MutableRefObject<NetworkCooldownTimeline[]>;
  guestGcdTimelinesRef: MutableRefObject<NetworkGcdTimeline[]>;
  companionCastsRef?: MutableRefObject<Record<string, CompanionCastHud>>;
  guestBossOverheadSkillRef?: MutableRefObject<string | null>;
  setGuestExtraAction?: Dispatch<SetStateAction<TemporaryExtraAction | null>>;
  playerCastRef: MutableRefObject<PlayerCastState | null>;
  pendingGuestInputsRef: MutableRefObject<PlayerInputPayload[]>;
  applyWipeVoteResultRef: MutableRefObject<(choice: 'RETRY' | 'FINISH') => void>;
  setNetConnected: Dispatch<SetStateAction<boolean>>;
  setRoomsTick: Dispatch<SetStateAction<number>>;
  setAccount: Dispatch<SetStateAction<UserAccount | null>>;
  setSelectedCharId: Dispatch<SetStateAction<string | null>>;
  setActiveRoomId: Dispatch<SetStateAction<string | null>>;
  setLobbySubView: Dispatch<SetStateAction<RoomLobbySubView>>;
  setRunPhase: Dispatch<SetStateAction<any>>;
  setIsApproaching: Dispatch<SetStateAction<boolean>>;
  /** 立刻弹出「别处登录」提示（勿用 window.alert，会被浏览器延后到下次点击） */
  setSessionKickNotice: Dispatch<SetStateAction<string | null>>;
  setAuthOpenRequest: Dispatch<
    SetStateAction<{ mode: 'login' | 'register'; id: number } | null>
  >;
  setWaitingQueueRoomId: Dispatch<SetStateAction<string | null>>;
  setDungeonTier: Dispatch<SetStateAction<'5man' | '20man'>>;
  setSelectedDungeonId: Dispatch<SetStateAction<string>>;
  setDungeonDifficulty: Dispatch<SetStateAction<DungeonDifficulty>>;
  setCustomDifficulty: Dispatch<SetStateAction<CustomDifficultySettings>>;
  setFriendlyUnits: Dispatch<SetStateAction<Unit[]>>;
  setBossUnit: Dispatch<SetStateAction<Unit | undefined>>;
  setPlayerCast: Dispatch<SetStateAction<PlayerCastState | null>>;
  setCompanionCasts: Dispatch<SetStateAction<Record<string, { spellName: string; progress: number }>>>;
  setBossTargetId: Dispatch<SetStateAction<string | null>>;
  setPlayerGcdRemainingMs: Dispatch<SetStateAction<number>>;
  setPlayerGcdTotalMs: Dispatch<SetStateAction<number>>;
  setTravelRemainingMs: Dispatch<SetStateAction<number>>;
  setRevivingUnitId?: Dispatch<SetStateAction<string | null>>;
  setReviveProgress?: Dispatch<SetStateAction<number>>;
  setIsCorpseRunning?: Dispatch<SetStateAction<boolean>>;
  setCorpseRunTimerMs?: Dispatch<SetStateAction<number>>;
  setTotalDurationSec?: Dispatch<SetStateAction<number>>;
  setWipeNetworkVote: Dispatch<SetStateAction<NetworkVoteState | null>>;
  setSkipTravelVote: Dispatch<SetStateAction<NetworkVoteState | null>>;
  setMyWipeVote: Dispatch<SetStateAction<'RETRY' | 'FINISH' | null>>;
  setMySkipVote: Dispatch<SetStateAction<'YES' | 'NO' | null>>;
  setGroundEffects: Dispatch<SetStateAction<GroundEffect[]>>;
  setFloatingTexts: Dispatch<SetStateAction<FloatingCombatText[]>>;
  onDbmAlerts?: (alerts: DbmAlert[]) => void;
  onGmCommand?: (cmd: GmCommandPayload) => void;
  setGuestBossCasting: Dispatch<
    SetStateAction<{
      spellName: string;
      spellId?: string;
      description?: string;
      school?: string;
      elapsedMs: number;
      castTimeMs: number;
      interruptible: boolean;
    } | null>
  >;
};

/** WebSocket connect + room/combat sync subscription (from App). */
const RECENTLY_LEFT_ROOM_TTL_MS = 4000;
const recentlyLeftRooms = new Map<string, number>();

/** Guard against stale in-flight ROOM_UPDATE / ROOM_START / HOT_SWAP pulling a user back after leaving. */
export function markRoomRecentlyLeft(roomId: string | null | undefined, nowMs = Date.now()): void {
  if (!roomId) return;
  recentlyLeftRooms.set(roomId, nowMs + RECENTLY_LEFT_ROOM_TTL_MS);
}

export function clearRoomRecentlyLeft(roomId: string | null | undefined): void {
  if (!roomId) return;
  recentlyLeftRooms.delete(roomId);
}

export function isRoomRecentlyLeft(roomId: string | null | undefined, nowMs = Date.now()): boolean {
  if (!roomId) return false;
  const until = recentlyLeftRooms.get(roomId);
  if (until == null) return false;
  if (nowMs >= until) {
    recentlyLeftRooms.delete(roomId);
    return false;
  }
  return true;
}

export function useNetworkRoomSync(deps: NetworkRoomSyncDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  /** Guest: ignore stale/out-of-order COMBAT_STATE; newer full snapshots heal missed ones */
  const lastAppliedCombatSeqRef = useRef(0);
  /** Guest: full unit mirror only on first seed or seq-gap recovery — steady state is deltas */
  const guestUnitsSeededRef = useRef(false);
  const fallbackBossOverheadSkillRef = useRef<string | null>(null);
  const fallbackCompanionCastsRef = useRef<Record<string, CompanionCastHud>>({});

  const charId = deps.currentChar?.id;
  const charSpec = deps.currentChar?.lastSpec;
  const charClassId = deps.currentChar?.classId;
  const username = deps.account?.username;

  useEffect(() => {
    const account = depsRef.current.account;
    if (!account) return;

    const d = () => depsRef.current;
    const currentChar = d().currentChar;

    // Always attach to the game server (incl. localhost). Session id may be
    // a placeholder until the player has a character.
    // Re-run when lastSpec/class changes so join uses the latest role/spec.
    if (currentChar) {
      netClient.connect({
        username: account.username,
        playerId: currentChar.id,
        playerName: currentChar.name,
        classId: currentChar.classId,
        spec: currentChar.lastSpec,
        role: getRoleBySpec(currentChar.classId, currentChar.lastSpec),
      });
    } else {
      netClient.connect({
        username: account.username,
        playerId: `acc_session_${account.id || account.username}`,
        playerName: account.username,
        classId: 'MAGE',
        spec: 'FIRE',
        role: 'DPS',
      });
    }

    /** Host live EFFECT + guest COMBAT_BATCH — same cast HUD path */
    const applyCastHud = (e: import('@cata-raid-sim/engine').CombatEffect) => {
      const myId = d().currentChar?.id || null;
      if (e.kind !== 'CAST_START' && e.kind !== 'CAST_LAND' && e.kind !== 'INTERRUPT') return;
      const castsRef = d().companionCastsRef ?? fallbackCompanionCastsRef;
      const overheadRef = d().guestBossOverheadSkillRef ?? fallbackBossOverheadSkillRef;
      const applied = applyRemoteCastEffect({
        effect: e,
        timelines: d().guestCastTimelinesRef.current,
        companionCasts: castsRef.current,
        skipUnitId: myId,
      });
      d().guestCastTimelinesRef.current = applied.timelines;
      castsRef.current = applied.companionCasts;
      d().setCompanionCasts(applied.companionCasts);
      const boss = d().engineRef.current?.bossUnit;
      if (boss && e.sourceId === boss.id) {
        syncBossCastHud({
          boss,
          cast: applied.companionCasts[e.sourceId] || null,
          recentOverheadSkillName: overheadRef.current,
          setGuestBossCasting: d().setGuestBossCasting,
        });
        d().setBossUnit({ ...boss });
      }
    };
    setHostEffectHudHook(applyCastHud);

    /** Last host/room sim packet — guest leaves after HOST_GONE_TIMEOUT_MS silence. */
    let lastHostSignalMs = Date.now();

    const leaveActiveRoomAsGuest = (reason: string, forceSummaryHint?: boolean) => {
      const closedId = d().activeRoomIdRef.current || d().waitingQueueRoomIdRef.current;
      if (!closedId) return;
      const rsm = d().rsmRef.current;
      const wasInRun = !!rsm && rsm.phase !== 'LOBBY' && rsm.phase !== 'SUMMARY';
      const goSummary =
        !!(forceSummaryHint || reason === 'host_left' || reason === 'host_timeout') && wasInRun;

      // 超时兜底：房间可能仍在，主动 ROOM_LEAVE；房主广播关闭则服务端已销毁
      if (reason === 'host_timeout' && d().currentChar?.id) {
        try {
          d().roomFacadeRef.current.leaveRoom(closedId, d().currentChar.id);
        } catch {}
      }
      d().roomFacadeRef.current.deleteRoom(closedId);

      d().isNetworkGuestRef.current = false;
      d().isNetworkHostRef.current = false;
      d().setActiveRoomId(null);
      d().setWaitingQueueRoomId(null);
      d().setWipeNetworkVote(null);
      d().setMyWipeVote(null);
      d().setSkipTravelVote(null);
      d().setMySkipVote(null);
      d().setPlayerCast(null);
      d().playerCastRef.current = null;
      d().setCompanionCasts({});

      if (goSummary) {
        if (rsm) rsm.phase = 'SUMMARY';
        d().setRunPhase('SUMMARY');
        d().setLobbySubView('ROOM_LIST');
      } else {
        const engine = d().engineRef.current;
        if (engine) engine.reset();
        if (rsm) rsm.phase = 'LOBBY';
        d().setRunPhase('LOBBY');
        d().setLobbySubView('ROOM_LIST');
        d().setFriendlyUnits([]);
        d().setBossUnit(undefined);
      }
      netClient.ensureConnected();
      if (netClient.connected) d().setNetConnected(true);
      d().setRoomsTick((t) => t + 1);

      const notice =
        reason === 'host_timeout'
          ? '与房主失联超过 10 秒，已退出房间'
          : '房主已离开，已退出房间';
      try {
        window.dispatchEvent(new CustomEvent('cata_ui_error', { detail: { text: notice } }));
      } catch {}
    };

    const unsub = netClient.subscribe((msg) => {
      if (
        isHostAliveSignal(msg.type, {
          roomId: msg.roomId || (msg.payload as { roomId?: string } | undefined)?.roomId,
          activeRoomId: d().activeRoomIdRef.current,
        })
      ) {
        lastHostSignalMs = Date.now();
      }
      if (msg.type === 'AUTH_OK' || msg.type === 'CONNECTED') {
        d().setNetConnected(true);
        d().setRoomsTick((t) => t + 1);
        lastHostSignalMs = Date.now();
      }
      if (msg.type === 'DISCONNECTED' || msg.type === 'AUTH_FAIL') {
        // Only mark offline if the socket is truly gone (ignore stale close races)
        if (!netClient.connected) {
          d().setNetConnected(false);
          if (d().activeRoomIdRef.current) {
            window.dispatchEvent(
              new CustomEvent('cata_ui_error', {
                detail: { text: '⚠️ 与游戏服务器 (3001) 断开连接，战斗已暂停等待重连…' },
              })
            );
          }
        }
      }
      if (msg.type === 'SESSION_KICKED') {
        // Same account logged in elsewhere — full logout; show notice immediately (no alert deferral)
        const reason =
          (msg.payload as { reason?: string } | undefined)?.reason ||
          '账号已在其他地方登录，请重新登录';
        try {
          d().accountMgrRef.current.logout();
        } catch {}
        netClient.disconnect();
        d().setAccount(null);
        d().setSelectedCharId(null);
        d().setNetConnected(false);
        d().setActiveRoomId(null);
        d().isNetworkGuestRef.current = false;
        d().isNetworkHostRef.current = false;
        d().setLobbySubView('AUTH_CHAR');
        d().setRunPhase('LOBBY');
        d().setSessionKickNotice(reason);
        d().setAuthOpenRequest({ mode: 'login', id: Date.now() });
      }
      if (msg.type === 'ERROR') {
        const errText =
          (typeof msg.error === 'string' && msg.error) ||
          (msg.payload as { reason?: string } | undefined)?.reason ||
          '操作失败';
        window.alert(errText);
      }
      if (msg.type === 'ROOM_LIST_SYNC' && Array.isArray(msg.payload)) {
        const list = msg.payload as NetLobbyRoom[];
        const ids = new Set(list.map((r) => r.id));
        // 用服务端名单整表替换本地镜像，清掉旧房残留
        for (const existing of roomManager.listRooms()) {
          if (!ids.has(existing.id)) {
            roomManager.deleteRoom(existing.id);
          }
        }
        for (const room of list) {
          d().roomFacadeRef.current.upsertRoom(room);
        }
        // 再扫一遍纯 AI / 空房（listRooms 内也会 cleanup）
        roomManager.cleanupAiOnlyRooms();
        d().setRoomsTick((t) => t + 1);
      }
      if (msg.type === 'ROOM_UPDATE' && msg.payload) {
        const room = msg.payload as NetLobbyRoom;
        if (isRoomRecentlyLeft(room.id)) {
          d().setRoomsTick((t) => t + 1);
          return;
        }
        d().roomFacadeRef.current.upsertRoom(room);
        const isMember =
          !!d().currentChar && room.members.some((m) => m.id === d().currentChar.id && !m.isAi);
        if (isMember && d().currentChar) {
          d().setActiveRoomId(room.id);
          d().isNetworkHostRef.current = room.hostId === d().currentChar.id;
          d().isNetworkGuestRef.current =
            room.hostId !== d().currentChar.id &&
            room.members.some((m) => m.id === d().currentChar.id && !m.isAi);
          // Lobby room meta from server (map / difficulty / custom coeffs)
          const cfg = getDungeonConfig(room.dungeonId, room.difficulty);
          const tier = cfg.tier;
          d().setDungeonTier(tier);
          d().setSelectedDungeonId(room.dungeonId);
          d().setDungeonDifficulty(room.difficulty);
          if (room.customDifficulty) {
            d().setCustomDifficulty(room.customDifficulty);
          }
          const phase = d().rsmRef.current?.phase || 'LOBBY';
          const alreadyInRun = phase !== 'LOBBY' && phase !== 'SUMMARY';
          const roomInCombat = room.status === 'IN_COMBAT' || room.status === 'OUT_OF_COMBAT';

          if (room.status === 'LOBBY') {
            // Create / rejoin prep room: never keep a leftover dungeon phase from a prior run.
            // (Main router only shows LobbyScreen when runPhase === 'LOBBY'.)
            const rsm = d().rsmRef.current;
            const engine = d().engineRef.current;
            const leftoverDungeon = !!rsm && rsm.phase !== 'LOBBY';
            if (leftoverDungeon) {
              rsm!.phase = 'LOBBY';
              d().setWipeNetworkVote(null);
              d().setMyWipeVote(null);
              d().setSkipTravelVote(null);
              d().setMySkipVote(null);
              d().playerCastRef.current = null;
              d().setPlayerCast(null);
              d().setCompanionCasts({});
              d().setBossUnit(undefined);
              d().setBossTargetId(null);
              d().setGroundEffects([]);
              d().setFloatingTexts([]);
              if (engine) {
                try {
                  engine.reset();
                } catch {}
              }
              d().setFriendlyUnits([]);
            }
            d().setRunPhase('LOBBY');
            d().setLobbySubView('ROOM_DETAIL');
          } else if (roomInCombat && !alreadyInRun) {
            // Hot-join mid-boss: enter as guest; host COMBAT_STATE will sync HP/frames
            d().isNetworkGuestRef.current = room.hostId !== d().currentChar.id;
            d().isNetworkHostRef.current = room.hostId === d().currentChar.id;
            d().setWaitingQueueRoomId(null);
            netClient.beginCombatInputEpoch();
            beginCombatEffectEpoch();
            d().setupRaidUnitsRef.current(
              d().currentChar,
              tier,
              room.difficulty,
              room.customDifficulty || d().customDifficultyRef.current,
              room
            );
            {
              const meId = d().currentChar.id;
              const eng = d().engineRef.current;
              configureCombatAuthority({
                localPlayerId: meId,
                isNetworkHost: d().isNetworkHostRef.current,
                isNetworkGuest: d().isNetworkGuestRef.current,
                activeRoomId: room.id,
                // Host & guest share identical in-game sharded authority (self + owned pets/totems)
                isUnitLocalAuthority: makeGuestAuthorityPredicate(eng, meId),
              });
              installSummonReporters(eng);
            }
            d().setFriendlyUnits([...d().engineRef.current.friendlyUnits]);
            if (d().rsmRef.current) {
              d().rsmRef.current.dungeon = cfg;
              d().rsmRef.current.phase =
                room.status === 'OUT_OF_COMBAT' ? 'TRAVEL_RECOVERY' : 'BOSS_COMBAT';
              d().setRunPhase(d().rsmRef.current.phase);
            }
          } else if (alreadyInRun && roomInCombat) {
            // AI kicked mid-run (no REPLACE/HOT_SWAP): drop orphan AI seats + their spawns.
            // Never touch humans. If a human is already in room.members but not yet in the
            // engine, MEMBER_HOT_SWAP still needs that vacated AI body — do not prune it.
            const eng = d().engineRef.current;
            if (eng) {
              const memberIds = new Set(room.members.map((m) => m.id));
              const pendingHotJoin = room.members.some(
                (m) => !m.isAi && m.isPlayer && !eng.getUnit(m.id)
              );
              if (!pendingHotJoin) {
                const report = d().isNetworkHostRef.current;
                let pruned = false;
                for (const u of [...eng.friendlyUnits]) {
                  if (u.isPet || memberIds.has(u.id)) continue;
                  if (u.isHumanControlled || u.isPlayer) continue;
                  if (isTrackedAuthority(u.id)) continue;
                  clearOwnerCombatSpawns(eng, u.id, { reportDespawn: report });
                  eng.removeUnit(u.id);
                  clearAuthorityPresence(u.id);
                  pruned = true;
                }
                if (pruned) {
                  d().setFriendlyUnits([...eng.friendlyUnits]);
                  d().setGroundEffects([...(eng.effectsManager?.groundEffects || [])]);
                }
              }
            }
          } else if (!alreadyInRun) {
            d().setLobbySubView('ROOM_DETAIL');
          }
          // Client fallback for 快速游戏 when server ignored quickStart (old process)
          if (
            pendingQuickPlayStartRef.current &&
            room.hostId === d().currentChar.id &&
            room.status === 'LOBBY'
          ) {
            const quota = DUNGEON_ROLE_QUOTAS[room.dungeonId] || DUNGEON_ROLE_QUOTAS.shadowfang_keep;
            if (room.members.length < quota.capacity) {
              d().roomFacadeRef.current.autoFillAi(room.id);
            } else {
              const validation = d().roomFacadeRef.current.validateStartGame(room.id);
              if (validation.canStart) {
                pendingQuickPlayStartRef.current = false;
                d().isNetworkHostRef.current = true;
                d().isNetworkGuestRef.current = false;
                netClient.startRoom(room.id);
              }
            }
          } else if (
            pendingQuickPlayStartRef.current &&
            (room.status === 'IN_COMBAT' || room.status === 'OUT_OF_COMBAT')
          ) {
            pendingQuickPlayStartRef.current = false;
          }
        }
        d().setRoomsTick((t) => t + 1);
      }
      if (msg.type === 'ROOM_CLOSED' && msg.payload) {
        const body = msg.payload as { roomId: string; reason?: string; forceSummary?: boolean };
        const closedId = body.roomId || msg.roomId;
        if (closedId) d().roomFacadeRef.current.deleteRoom(closedId);
        if (
          closedId &&
          (d().activeRoomIdRef.current === closedId || d().waitingQueueRoomIdRef.current === closedId)
        ) {
          // 房主退出广播：客人立刻离开房间（战斗中可进结算）
          leaveActiveRoomAsGuest(body.reason || 'host_left', body.forceSummary);
        } else {
          d().setRoomsTick((t) => t + 1);
        }
      }
      if (msg.type === 'ROOM_START' && msg.payload) {
        const room = msg.payload as NetLobbyRoom;
        if (isRoomRecentlyLeft(room.id)) return;
        pendingQuickPlayStartRef.current = false;
        lastAppliedCombatSeqRef.current = 0;
        guestUnitsSeededRef.current = false;
        // New dungeon visit → fresh cast-id epoch (leave/rejoin must not reuse old ids)
        netClient.beginCombatInputEpoch();
        netClient.clearHostInputAckState();
        beginCombatEffectEpoch();
        d().roomFacadeRef.current.upsertRoom(room);
        d().setActiveRoomId(room.id);
        d().isNetworkHostRef.current = !!(d().currentChar && room.hostId === d().currentChar.id);
        d().isNetworkGuestRef.current = !!(d().currentChar && room.hostId !== d().currentChar.id);
        const meId = d().currentChar?.id || null;
        const engine = d().engineRef.current;
        configureCombatAuthority({
          localPlayerId: meId,
          isNetworkHost: d().isNetworkHostRef.current,
          isNetworkGuest: d().isNetworkGuestRef.current,
          activeRoomId: room.id,
          // Both host & guest only own self + pets; server owns Boss/AI/World
          isUnitLocalAuthority: makeGuestAuthorityPredicate(engine, meId || ''),
        });
        installSummonReporters(engine);
        endAuthorityPresenceEpoch();
        const cfg = getDungeonConfig(room.dungeonId, room.difficulty);
        const tier = cfg.tier;
        const effectiveCustom = room.customDifficulty || d().customDifficultyRef.current;
        d().setDungeonTier(tier);
        d().setSelectedDungeonId(room.dungeonId);
        d().setDungeonDifficulty(room.difficulty);
        if (room.difficulty === 'CUSTOM') d().setCustomDifficulty(effectiveCustom);
        d().startAdventureRef.current({
          tier,
          difficulty: room.difficulty,
          customDiff: effectiveCustom,
          activeRoom: room,
        });
        // Both host & guest report initial authority state to server ASAP
        if ((d().isNetworkHostRef.current || d().isNetworkGuestRef.current) && meId) {
          publishOwnerSnapshot(
            buildLocalOwnerSnapshot(engine, meId, {
              groundEffects: (engine.effectsManager?.groundEffects || [])
                .filter((g) => g.ownerId === meId)
                .map(serializeGroundEffectWire),
            })
          );
        }
      }
      if (msg.type === 'INPUT_ACK' && msg.payload) {
        const body = msg.payload as {
          acks?: Array<{ clientInputId: string; attempt: number }>;
          ackedInputIds?: string[];
        };
        if (body.acks?.length) {
          netClient.ackReliableInputs(body.acks);
        } else {
          // Legacy: id-only — stop retry, no RTT sample
          netClient.ackReliableInputs(body.ackedInputIds);
        }
      }
      if (
        msg.type === 'COMBAT_STATE' &&
        msg.payload &&
        (d().isNetworkHostRef.current || d().isNetworkGuestRef.current)
      ) {
        const snap = msg.payload as NetworkCombatSnapshot;
        // Room isolation: ignore snapshots from other rooms
        const myRoom = d().activeRoomIdRef.current;
        if (snap.roomId && myRoom && snap.roomId !== myRoom) return;
        if (msg.roomId && myRoom && msg.roomId !== myRoom) return;

        // 兜底 ack（即时 INPUT_ACK 丢了时仍能停重传）
        netClient.ackReliableInputs(snap.ackedInputIds);

        // 全量状态快照：只接受更新的 seq（乱序旧包丢弃；中间丢包由后续快照补血量/位置）
        const seq = typeof snap.seq === 'number' ? snap.seq : msg.seq ?? 0;
        const prevSeq = lastAppliedCombatSeqRef.current;
        if (seq > 0 && seq <= prevSeq) return;
        const seqGap = seq > 0 && prevSeq > 0 && seq > prevSeq + 1;
        if (seq > 0) lastAppliedCombatSeqRef.current = seq;

        const engine = d().engineRef.current;
        const rsm = d().rsmRef.current;
        const myId = d().currentChar?.id || null;
        const myChar = d().currentChar;
        // 无权威座位（Boss/AI/房主等）从全量持续同步；本人权威座位永不覆盖。
        // seq-gap 时同样走 preserve 路径补齐丢包。
        if (snap.units?.length) {
          applyWorldSnapshotsPreservingAuthority(engine, snap.units);
          guestUnitsSeededRef.current = true;
        } else if (seqGap) {
          // gap without units — nothing to mirror
        }
        syncPreservedIdentityFromSnapshot(engine, snap.units || [], myId, myChar);
        if (myId) {
          for (const u of engine.friendlyUnits) {
            if (u.id === myId) continue;
            if ((snap.units || []).find((s) => s.id === u.id)?.isHumanControlled) {
              u.isHumanControlled = true;
            }
          }
        }
        d().setFriendlyUnits([...engine.friendlyUnits]);
        d().setBossUnit(engine.bossUnit ? { ...engine.bossUnit } : undefined);
        if (snap.bossTargetId !== undefined) d().setBossTargetId(snap.bossTargetId ?? null);
        if (snap.runPhase) {
          if (rsm) rsm.phase = snap.runPhase as RunPhase;
          d().setRunPhase(snap.runPhase as RunPhase);
        }
        // Follow host dungeon clock (maze progress / wipe retry refresh)
        if (rsm) {
          if (typeof snap.travelRemainingMs === 'number') {
            rsm.travelRemainingMs = snap.travelRemainingMs;
            d().setTravelRemainingMs(snap.travelRemainingMs);
          }
          if (typeof snap.totalTravelMs === 'number') {
            rsm.totalTravelMs = snap.totalTravelMs;
          }
          if (typeof snap.reviveProgress === 'number') {
            const prog = Math.max(0, Math.min(1, snap.reviveProgress));
            d().setReviveProgress?.(prog);
            d().setRevivingUnitId?.(prog > 0 ? 'raid' : null);
          }
          if (typeof snap.isCorpseRunning === 'boolean') {
            rsm.isCorpseRunning = snap.isCorpseRunning;
            d().setIsCorpseRunning?.(snap.isCorpseRunning);
          }
          if (typeof snap.corpseRunTimerMs === 'number') {
            rsm.corpseRunTimerMs = snap.corpseRunTimerMs;
            d().setCorpseRunTimerMs?.(snap.corpseRunTimerMs);
          }
          if (typeof snap.currentBossIndex === 'number') {
            rsm.currentBossIndex = snap.currentBossIndex;
          }
          if (typeof snap.isCleared === 'boolean') {
            rsm.isCleared = snap.isCleared;
          }
          if (typeof snap.totalDurationSec === 'number') {
            rsm.totalRunDurationSec = snap.totalDurationSec;
            d().setTotalDurationSec?.(Math.round(snap.totalDurationSec));
          }
          // Host reports only fill gaps — guests keep local kill deltas for self-register
          if (Array.isArray(snap.encounterReports)) {
            mergeHostEncounterReports(rsm, snap.encounterReports);
          }
          // Record boss kills from mirrored combatStats (no host report required)
          noteGuestCombatSnapshot({
            state: getLocalEncounterRecorder(rsm),
            rsm,
            engine,
            nowMs: typeof snap.timeMs === 'number' ? snap.timeMs : Date.now(),
          });
        }

        d().guestCdTimelinesRef.current = snap.cooldowns || [];
        d().guestGcdTimelinesRef.current = snap.gcds || [];
        const overheadRef = d().guestBossOverheadSkillRef ?? fallbackBossOverheadSkillRef;
        overheadRef.current = snap.bossOverheadSkillName ?? null;
        if ('extraAction' in snap) {
          d().setGuestExtraAction?.(snap.extraAction ?? null);
        }

        // Host-world ground mirror (AI/boss/enemy rings+terrain) — empty array clears despawns
        if (Array.isArray(snap.groundEffects)) {
          mergeGroundEffectsPreservingAuthority(engine, snap.groundEffects, (fx) =>
            d().setGroundEffects(fx as GroundEffect[])
          );
        }

        // Floating combat text from host (guest never sims damage — mirror atmosphere numbers)
        if (Array.isArray(snap.floatingTexts)) {
          d().setFloatingTexts(
            snap.floatingTexts.map((f) => ({
              id: f.id,
              targetId: f.targetId,
              sourceId: f.sourceId,
              text: f.text,
              category: f.category,
              isCrit: !!f.isCrit,
              isFromPlayerOrPet: f.isFromPlayerOrPet,
              isToPlayer: f.isToPlayer,
              xOffset: f.xOffset,
              createdAtMs: f.createdAtMs,
            }))
          );
        }

        // Host-relayed actor→target actions for cast/ground/summon VFX hooks
        if (Array.isArray(snap.recentActions) && snap.recentActions.length > 0) {
          dispatchCombatFxActions(snap.recentActions, { roomId: snap.roomId });
        }

        // Host-authoritative DBM tactical alerts
        if (Array.isArray(snap.dbmAlerts) && snap.dbmAlerts.length > 0) {
          d().onDbmAlerts?.(snap.dbmAlerts);
        }

        // Maze: seed + trash HP/tombstones from host (guest mirrors, does not sim trash DPS)
        if (
          snap.mazeSeed != null ||
          snap.mazeTrash ||
          snap.mazeDungeonId ||
          snap.mazeLeadDist != null ||
          snap.mazeSctEvents
        ) {
          applyGuestMazeSync({
            roomId: snap.roomId || msg.roomId || d().activeRoomIdRef.current,
            mazeSeed: snap.mazeSeed,
            mazeDungeonId: snap.mazeDungeonId,
            mazeStageIndex: snap.mazeStageIndex,
            mazeLeadDist: snap.mazeLeadDist,
            mazeTrash: snap.mazeTrash,
            sctEvents: snap.mazeSctEvents,
          });
        }

        // Companion / boss cast bars: EFFECT timelines are authoritative (CAST_START/LAND).
        // COMBAT_STATE.casts fills gaps only — never replace EFFECT rows (avoids wiping a
        // CAST_START that arrived before the next snap). Preserve land/interrupt flashes.
        {
          const now = Date.now();
          const bossId = engine.bossUnit?.id;
          const tl = d().guestCastTimelinesRef.current;
          const have = new Set(tl.map((c) => c.unitId));
          for (const c of snap.casts || []) {
            if (c.unitId === myId || c.interrupted) continue;
            if (!have.has(c.unitId)) {
              tl.push(c);
              have.add(c.unitId);
            }
          }
          const castsRef = d().companionCastsRef ?? fallbackCompanionCastsRef;
          const companionSnapshot = companionCastsFromTimelines(tl, myId, now, castsRef.current);
          castsRef.current = companionSnapshot;
          d().setCompanionCasts(companionSnapshot);
          if (bossId && engine.bossUnit) {
            syncBossCastHud({
              boss: engine.bossUnit as any,
              cast: companionSnapshot[bossId],
              recentOverheadSkillName: overheadRef.current,
              setGuestBossCasting: d().setGuestBossCasting,
            });
            d().setBossUnit({ ...engine.bossUnit });
          } else {
            d().setGuestBossCasting(null);
          }
        }
        // Own GCD/CD stay local — do not snap from host gcds/cooldowns (latency hitch).
      }
      if (msg.type === 'CAST_INTERRUPT' && msg.payload) {
        const body = msg.payload as { unitId: string; spellId?: string };
        // Host-forced stop (reject / remote interrupt). Self ESC/MOVE already cleared locally.
        if (d().currentChar && body.unitId === d().currentChar.id) {
          const local = d().playerCastRef.current;
          if (!body.spellId || !local || local.spellId === body.spellId) {
            d().playerCastRef.current = null;
            d().setPlayerCast(null);
          }
        }
        const castsRef = d().companionCastsRef ?? fallbackCompanionCastsRef;
        const nextCasts = { ...castsRef.current };
        delete nextCasts[body.unitId];
        castsRef.current = nextCasts;
        d().setCompanionCasts(nextCasts);
        d().guestCastTimelinesRef.current = d().guestCastTimelinesRef.current.filter((c) => c.unitId !== body.unitId);
      }
      if (msg.type === 'PLAYER_INPUT' && msg.payload) {
        const input = msg.payload as PlayerInputPayload;
        if (input.playerId) noteAuthorityPacket(input.playerId, 'PLAYER_INPUT');
        if (
          input.kind === 'MOVE' &&
          typeof input.x === 'number' &&
          typeof input.y === 'number' &&
          input.playerId &&
          input.playerId !== d().currentChar?.id
        ) {
          const u = d().engineRef.current.getUnit(input.playerId);
          if (u) {
            u.position = { x: input.x, y: input.y };
          }
        }
        if (d().isNetworkHostRef.current) {
          d().pendingGuestInputsRef.current.push(input);
        }
      }
      if (msg.type === 'GM_COMMAND' && msg.payload) {
        const gmCmd = msg.payload as GmCommandPayload;
        if (d().isNetworkHostRef.current || d().isNetworkGuestRef.current) {
          d().onGmCommand?.(gmCmd);
        }
      }
      if (msg.type === 'COMBAT_EFFECT' && msg.payload) {
        const effect = msg.payload as CombatEffect;
        const engine = d().engineRef.current;
        if (d().isNetworkHostRef.current || d().isNetworkGuestRef.current) {
          ingestCombatEffect(engine, effect, { onHudEffect: applyCastHud });
        }
        d().setFriendlyUnits([...engine.friendlyUnits]);
        d().setBossUnit(engine.bossUnit ? { ...engine.bossUnit } : undefined);
      }
      if (msg.type === 'OWNER_SNAPSHOT' && msg.payload) {
        const snap = msg.payload as OwnerSnapshot;
        const engine = d().engineRef.current;
        const room = d().activeRoomIdRef.current
          ? d().roomFacadeRef.current.getRoom(d().activeRoomIdRef.current)
          : null;
        // Stale leaver snap after AI takeover — erase traces, do not merge
        if (
          snap.ownerId &&
          !snap.purge &&
          room &&
          purgeStaleOwnerIfNotInRoom(engine, snap.ownerId, room)
        ) {
          d().setFriendlyUnits([...engine.friendlyUnits]);
          d().setGroundEffects([...(engine.effectsManager?.groundEffects || [])]);
          return;
        }
        if (
          (d().isNetworkHostRef.current || d().isNetworkGuestRef.current) &&
          snap.ownerId !== d().currentChar?.id
        ) {
          mergeOwnerSnapshotUnits(engine, snap);
          d().setFriendlyUnits([...engine.friendlyUnits]);
          d().setBossUnit(engine.bossUnit ? { ...engine.bossUnit } : undefined);
          d().setGroundEffects([...(engine.effectsManager?.groundEffects || [])]);
        }
      }
      if (msg.type === 'COMBAT_BATCH' && msg.payload) {
        const batch = msg.payload as CombatBatch;
        const engine = d().engineRef.current;
        // Effects + owner snaps only (steady state). World unit mirror is recovery-only.
        applyCombatBatch(engine, batch, {
          mergeOwnerSnapshot: (snap) => mergeOwnerSnapshotUnits(engine, snap),
          onHudEffect: applyCastHud,
        });
        if (d().isNetworkHostRef.current || d().isNetworkGuestRef.current) {
          if (batch.world?.runPhase) {
            const rsm = d().rsmRef.current;
            if (rsm) rsm.phase = batch.world.runPhase as RunPhase;
            d().setRunPhase(batch.world.runPhase as RunPhase);
          }
          // Non-authority seats + host-world ground from attached full mirror
          // (COMBAT_STATE 丢包时 batch.world 仍可补 AI/怪物光圈与 buff)
          if (batch.world?.units?.length) {
            applyWorldSnapshotsPreservingAuthority(engine, batch.world.units);
            guestUnitsSeededRef.current = true;
          }
          if (Array.isArray(batch.world?.groundEffects)) {
            mergeGroundEffectsPreservingAuthority(engine, batch.world.groundEffects, (fx) =>
              d().setGroundEffects(fx as GroundEffect[])
            );
          }
        }
        d().setFriendlyUnits([...engine.friendlyUnits]);
        d().setBossUnit(engine.bossUnit ? { ...engine.bossUnit } : undefined);
      }
      if (msg.type === 'MEMBER_HOT_SWAP' && msg.payload) {
        const body = msg.payload as {
          room: NetLobbyRoom;
          playerId: string;
          replacedAiId: string;
          playerName?: string;
          classId?: string;
          spec?: string;
          role?: string;
          unitSnapshot?: NetworkCombatSnapshot['units'][number];
        };
        d().roomFacadeRef.current.upsertRoom(body.room);
        if (d().isNetworkHostRef.current) {
          trackAuthoritySeat(body.playerId);
        }
        const engine = d().engineRef.current;
        const member = body.room.members.find((m) => m.id === body.playerId);
        const joinerIdentity = {
          id: body.playerId,
          name: body.playerName || member?.name || body.playerId,
          classId: (body.classId || member?.classId || 'MAGE') as any,
          spec: body.spec || member?.spec || 'FIRE',
          role: (body.role || member?.role || 'DPS') as any,
        };
        const markLocalPlayerFlags = () => {
          const myId = d().currentChar?.id;
          if (!myId || !engine) return;
          for (const u of engine.friendlyUnits) {
            const isMe = u.id === myId;
            u.isPlayer = isMe;
            if (isMe) {
              u.isHumanControlled = true;
              u.name = d().currentChar!.name || u.name;
              u.classId = d().currentChar!.classId || u.classId;
              u.spec = d().currentChar!.lastSpec || u.spec;
              delete (u as { unitKind?: string }).unitKind;
            }
          }
        };
        const inCombatView =
          d().isNetworkHostRef.current ||
          d().isNetworkGuestRef.current ||
          (d().rsmRef.current?.phase !== 'LOBBY' && d().rsmRef.current?.phase !== 'SUMMARY');

        if (inCombatView && engine) {
          if (body.replacedAiId) {
            clearOwnerCombatSpawns(engine, body.replacedAiId, {
              reportDespawn: d().isNetworkHostRef.current,
            });
            clearAuthorityPresence(body.replacedAiId);
          }
          if (body.unitSnapshot) {
            // AI gone + player unit applied — raid frames refresh immediately
            engine.applyNetworkUnitSnapshots([
              ...engine
                .buildNetworkUnitSnapshots()
                .filter((u) => u.id !== body.replacedAiId && u.id !== body.playerId),
              {
                ...body.unitSnapshot,
                // Guarantee joiner identity even if host snapshot lagged
                id: body.playerId,
                name: joinerIdentity.name,
                classId: joinerIdentity.classId,
                spec: joinerIdentity.spec,
                role: joinerIdentity.role,
                isHumanControlled: true,
              },
            ]);
            markLocalPlayerFlags();
            d().setFriendlyUnits([...engine.friendlyUnits]);
            d().setGroundEffects([...(engine.effectsManager?.groundEffects || [])]);
          } else if (d().isNetworkHostRef.current && body.replacedAiId) {
            // Always seat the joiner (inherit AI, or spawn if ROOM_UPDATE already deleted it)
            ensureHotJoinedSeat(engine, body.replacedAiId, joinerIdentity, body.room);
            d().setFriendlyUnits([...engine.friendlyUnits]);
            d().setGroundEffects([...(engine.effectsManager?.groundEffects || [])]);
            const roomId = d().activeRoomIdRef.current || body.room.id;
            if (netClient.connected && roomId) {
              const unitSnap = engine
                .buildNetworkUnitSnapshots()
                .find((u) => u.id === body.playerId);
              netClient.sendHotSwap(roomId, {
                roomId,
                room: body.room,
                playerId: body.playerId,
                replacedAiId: body.replacedAiId,
                playerName: joinerIdentity.name,
                classId: joinerIdentity.classId,
                spec: joinerIdentity.spec,
                role: joinerIdentity.role,
                unitSnapshot: unitSnap,
              });
            }
          } else if (body.replacedAiId) {
            ensureHotJoinedSeat(engine, body.replacedAiId, joinerIdentity, body.room);
            markLocalPlayerFlags();
            d().setFriendlyUnits([...engine.friendlyUnits]);
            d().setGroundEffects([...(engine.effectsManager?.groundEffects || [])]);
          }
        }

        if (d().currentChar && body.playerId === d().currentChar.id && !isRoomRecentlyLeft(body.room.id)) {
          d().setWaitingQueueRoomId(null);
          d().setActiveRoomId(body.room.id);
          d().isNetworkHostRef.current = body.room.hostId === d().currentChar.id;
          d().isNetworkGuestRef.current = body.room.hostId !== d().currentChar.id;
          const phase = d().rsmRef.current?.phase || 'LOBBY';
          const roomInCombat =
            body.room.status === 'IN_COMBAT' || body.room.status === 'OUT_OF_COMBAT';
          if (roomInCombat && (phase === 'LOBBY' || phase === 'SUMMARY')) {
            const cfg = getDungeonConfig(body.room.dungeonId, body.room.difficulty);
            const tier = cfg.tier;
            d().setDungeonTier(tier);
            d().setSelectedDungeonId(body.room.dungeonId);
            d().setDungeonDifficulty(body.room.difficulty);
            netClient.beginCombatInputEpoch();
            beginCombatEffectEpoch();
            d().setupRaidUnitsRef.current(
              d().currentChar,
              tier,
              body.room.difficulty,
              body.room.customDifficulty || d().customDifficultyRef.current,
              body.room
            );
            {
              const meId = d().currentChar.id;
              const eng = d().engineRef.current;
              configureCombatAuthority({
                localPlayerId: meId,
                isNetworkHost: d().isNetworkHostRef.current,
                isNetworkGuest: d().isNetworkGuestRef.current,
                activeRoomId: body.room.id,
                isUnitLocalAuthority: d().isNetworkHostRef.current
                  ? makeHostAuthorityPredicate(eng, meId)
                  : makeGuestAuthorityPredicate(eng, meId),
              });
              installSummonReporters(eng);
            }
            if (body.unitSnapshot && d().engineRef.current) {
              d().engineRef.current.applyNetworkUnitSnapshots([
                ...d()
                  .engineRef.current.buildNetworkUnitSnapshots()
                  .filter((u) => u.id !== body.replacedAiId && u.id !== body.playerId),
                {
                  ...body.unitSnapshot,
                  id: body.playerId,
                  name: joinerIdentity.name,
                  classId: joinerIdentity.classId,
                  spec: joinerIdentity.spec,
                  role: joinerIdentity.role,
                  isHumanControlled: true,
                },
              ]);
            }
            markLocalPlayerFlags();
            d().setFriendlyUnits([...d().engineRef.current.friendlyUnits]);
            if (d().rsmRef.current) {
              d().rsmRef.current.dungeon = cfg;
              d().rsmRef.current.phase =
                body.room.status === 'OUT_OF_COMBAT' ? 'TRAVEL_RECOVERY' : 'BOSS_COMBAT';
              d().setRunPhase(d().rsmRef.current.phase);
            }
          } else {
            markLocalPlayerFlags();
            if (engine) d().setFriendlyUnits([...engine.friendlyUnits]);
          }
        }
        d().setRoomsTick((t) => t + 1);
      }
      if (msg.type === 'MEMBER_REPLACE_AI' && msg.payload) {
        const body = msg.payload as { room: NetLobbyRoom; playerId: string; aiMemberId: string };
        d().roomFacadeRef.current.upsertRoom(body.room);
        clearAuthorityPresence(body.playerId);
        if (d().isNetworkHostRef.current || d().isNetworkGuestRef.current) {
          const engine = d().engineRef.current;
          // Host: wipe leaver gather/snaps, remap-or-spawn AI, publish purge + AI mirror.
          // Guests: same local wipe + remap so map/roster don't keep a ghost human.
          applyPlayerLeaveAiTakeover(engine, {
            playerId: body.playerId,
            aiMemberId: body.aiMemberId,
            room: body.room,
            isHost: d().isNetworkHostRef.current,
          });
          d().setFriendlyUnits([...engine.friendlyUnits]);
          d().setGroundEffects([...(engine.effectsManager?.groundEffects || [])]);
        }
        if (d().currentChar && body.playerId === d().currentChar.id) {
          d().isNetworkGuestRef.current = false;
          d().isNetworkHostRef.current = body.room.hostId === d().currentChar.id;
        }
        d().setRoomsTick((t) => t + 1);
      }
      if (msg.type === 'HOST_TRANSFER' && msg.payload) {
        const body = msg.payload as { newHostId: string; room: NetLobbyRoom };
        d().roomFacadeRef.current.upsertRoom(body.room);
        if (d().currentChar) {
          d().isNetworkHostRef.current = body.newHostId === d().currentChar.id;
          d().isNetworkGuestRef.current = body.newHostId !== d().currentChar.id && body.room.members.some((m) => m.id === d().currentChar.id && !m.isAi);
        }
        d().setRoomsTick((t) => t + 1);
      }
      if (msg.type === 'VOTE_START' || msg.type === 'VOTE_STATE') {
        const vote = (msg.payload as any)?.vote || (msg.payload as NetworkVoteState);
        if (!vote?.kind) return;
        // 已结束的状态包 / 乱序迟到包：清面板，勿把上一轮投票刷回来
        if (vote.resolved) {
          if (vote.kind === 'WIPE') {
            d().setWipeNetworkVote(null);
            d().setMyWipeVote(null);
          } else if (vote.kind === 'SKIP_TRAVEL') {
            d().setSkipTravelVote(null);
            d().setMySkipVote(null);
          }
          return;
        }
        const snap = {
          ...vote,
          votes: { ...(vote.votes || {}) },
          eligiblePlayerIds: [...(vote.eligiblePlayerIds || [])],
        };
        if (vote.kind === 'WIPE') {
          d().setWipeNetworkVote(snap);
          if (d().currentChar && snap.votes?.[d().currentChar.id]) {
            d().setMyWipeVote(snap.votes[d().currentChar.id] as 'RETRY' | 'FINISH');
          }
        } else if (vote.kind === 'SKIP_TRAVEL') {
          d().setSkipTravelVote(snap);
          if (d().currentChar && snap.votes?.[d().currentChar.id]) {
            d().setMySkipVote(snap.votes[d().currentChar.id] as 'YES' | 'NO');
          }
        }
      }
      if (msg.type === 'VOTE_RESULT' && msg.payload) {
        const body = msg.payload as VoteResultPayload;
        if (body.kind === 'WIPE') {
          d().setWipeNetworkVote(null);
          d().setMyWipeVote(null);
          // Server executes retryFromWipe / finishFromWipe and broadcasts COMBAT_STATE / ROOM_CLOSED
        } else if (body.kind === 'SKIP_TRAVEL') {
          d().setSkipTravelVote(null);
          d().setMySkipVote(null);
          // Server executes fastForwardTravel and broadcasts COMBAT_STATE
        }
      }
    });

    return () => {
      setHostEffectHudHook(null);
      unsub();
    };
  }, [charId, charSpec, charClassId, username]); // refresh AUTH on char / spec switch
}
