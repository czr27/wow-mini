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
import { buildCastFromTimeline } from '../net/netTimeline.js';
import {
  pendingQuickPlayStartRef,
  type RoomLobbySubView,
  type StartAdventureOverrides,
} from './useRoomLobby.js';
import { applyGuestMazeSync } from '../combat/mazeSyncBridge.js';
import {
  applyCombatBatch,
  beginCombatEffectEpoch,
  configureCombatAuthority,
  hostReceiveCombatEffect,
  hostReceiveOwnerSnapshot,
  makeGuestAuthorityPredicate,
  makeHostAuthorityPredicate,
  mergeOwnerSnapshotUnits,
  setHostEffectHudHook,
} from '../combat/networkCombatAuthority.js';
import {
  applyCastLifecycleToTimelines,
  companionCastsFromTimelines,
} from '../combat/castLifecycleNet.js';
import {
  getLocalEncounterRecorder,
  mergeHostEncounterReports,
  noteGuestCombatSnapshot,
} from '../combat/localEncounterRecorder.js';

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
  setWipeNetworkVote: Dispatch<SetStateAction<NetworkVoteState | null>>;
  setSkipTravelVote: Dispatch<SetStateAction<NetworkVoteState | null>>;
  setMyWipeVote: Dispatch<SetStateAction<'RETRY' | 'FINISH' | null>>;
  setMySkipVote: Dispatch<SetStateAction<'YES' | 'NO' | null>>;
  setGroundEffects: Dispatch<SetStateAction<GroundEffect[]>>;
  setFloatingTexts: Dispatch<SetStateAction<FloatingCombatText[]>>;
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
export function useNetworkRoomSync(deps: NetworkRoomSyncDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  /** Guest: ignore stale/out-of-order COMBAT_STATE; newer full snapshots heal missed ones */
  const lastAppliedCombatSeqRef = useRef(0);

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

    const applyCastHud = (e: import('@cata-raid-sim/engine').CombatEffect) => {
      const myId = d().currentChar?.id || null;
      if (e.kind !== 'CAST_START' && e.kind !== 'CAST_LAND' && e.kind !== 'INTERRUPT') return;
      d().guestCastTimelinesRef.current = applyCastLifecycleToTimelines(
        d().guestCastTimelinesRef.current,
        e,
        myId
      );
      d().setCompanionCasts((prev) => {
        const next = {
          ...prev,
          ...companionCastsFromTimelines(d().guestCastTimelinesRef.current, myId),
        };
        if (e.kind === 'CAST_LAND' || e.kind === 'INTERRUPT') delete next[e.sourceId];
        return next;
      });
    };
    setHostEffectHudHook(applyCastHud);

    const unsub = netClient.subscribe((msg) => {
      if (msg.type === 'AUTH_OK' || msg.type === 'CONNECTED') {
        d().setNetConnected(true);
        d().setRoomsTick((t) => t + 1);
      }
      if (msg.type === 'DISCONNECTED' || msg.type === 'AUTH_FAIL') {
        // Only mark offline if the socket is truly gone (ignore stale close races)
        if (!netClient.connected) {
          d().setNetConnected(false);
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
                isUnitLocalAuthority: d().isNetworkHostRef.current
                  ? makeHostAuthorityPredicate(eng, meId)
                  : makeGuestAuthorityPredicate(eng, meId),
              });
            }
            d().setFriendlyUnits([...d().engineRef.current.friendlyUnits]);
            if (d().rsmRef.current) {
              d().rsmRef.current.dungeon = cfg;
              d().rsmRef.current.phase =
                room.status === 'OUT_OF_COMBAT' ? 'TRAVEL_RECOVERY' : 'BOSS_COMBAT';
              d().setRunPhase(d().rsmRef.current.phase);
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
        if (closedId && (d().activeRoomIdRef.current === closedId || d().waitingQueueRoomIdRef.current === closedId)) {
          const rsm = d().rsmRef.current;
          const wasInRun =
            !!rsm && rsm.phase !== 'LOBBY' && rsm.phase !== 'SUMMARY';
          // Host left / returned to lobby mid-run → remaining players go to settlement
          const goSummary = !!(body.forceSummary || body.reason === 'host_left') && wasInRun;

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
          // Room teardown must not drop the account session
          netClient.ensureConnected();
          if (netClient.connected) d().setNetConnected(true);
        }
        d().setRoomsTick((t) => t + 1);
      }
      if (msg.type === 'ROOM_START' && msg.payload) {
        const room = msg.payload as NetLobbyRoom;
        pendingQuickPlayStartRef.current = false;
        lastAppliedCombatSeqRef.current = 0;
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
          isUnitLocalAuthority: d().isNetworkHostRef.current
            ? makeHostAuthorityPredicate(engine, meId || '')
            : makeGuestAuthorityPredicate(engine, meId || ''),
        });
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
      if (msg.type === 'COMBAT_STATE' && msg.payload && d().isNetworkGuestRef.current) {
        const snap = msg.payload as NetworkCombatSnapshot;
        // Room isolation: ignore snapshots from other rooms
        const myRoom = d().activeRoomIdRef.current;
        if (snap.roomId && myRoom && snap.roomId !== myRoom) return;
        if (msg.roomId && myRoom && msg.roomId !== myRoom) return;

        // 兜底 ack（即时 INPUT_ACK 丢了时仍能停重传）
        netClient.ackReliableInputs(snap.ackedInputIds);

        // 全量状态快照：只接受更新的 seq（乱序旧包丢弃；中间丢包由后续快照补血量/位置）
        const seq = typeof snap.seq === 'number' ? snap.seq : msg.seq ?? 0;
        if (seq > 0 && seq <= lastAppliedCombatSeqRef.current) return;
        if (seq > 0) lastAppliedCombatSeqRef.current = seq;

        const engine = d().engineRef.current;
        const rsm = d().rsmRef.current;
        engine.applyNetworkUnitSnapshots(snap.units);
        // Host snapshots use each member's real id; keep local controllability on this client
        const myId = d().currentChar?.id;
        const myChar = d().currentChar;
        if (myId) {
          for (const u of engine.friendlyUnits) {
            const isMe = u.id === myId;
            u.isPlayer = isMe;
            if (isMe) {
              u.isHumanControlled = true;
              // Never keep replaced AI name/class on the local seat
              if (myChar) {
                u.name = myChar.name || u.name;
                u.classId = myChar.classId || u.classId;
                u.spec = myChar.lastSpec || u.spec;
              }
              delete (u as { unitKind?: string }).unitKind;
            } else if ((snap.units || []).find((s) => s.id === u.id)?.isHumanControlled) {
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
          if (typeof snap.currentBossIndex === 'number') {
            rsm.currentBossIndex = snap.currentBossIndex;
          }
          if (typeof snap.isCleared === 'boolean') {
            rsm.isCleared = snap.isCleared;
          }
          if (typeof snap.totalDurationSec === 'number') {
            rsm.totalRunDurationSec = snap.totalDurationSec;
            d().setTotalDurationSec(Math.round(snap.totalDurationSec));
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

        d().guestCastTimelinesRef.current = snap.casts || [];
        d().guestCdTimelinesRef.current = snap.cooldowns || [];
        d().guestGcdTimelinesRef.current = snap.gcds || [];

        // Ground FX from host (reporter never applies local FX — only this snapshot)
        if (Array.isArray(snap.groundEffects)) {
          d().setGroundEffects(
            snap.groundEffects.map((g) => ({
              id: g.id,
              kind: g.kind,
              spellId: g.spellId,
              ownerId: g.ownerId,
              x: g.x,
              y: g.y,
              radius: g.radius,
              colorHex: g.colorHex,
              remainingMs: g.remainingMs,
              ...(g.facingRad != null ? { facingRad: g.facingRad } : {}),
              ...(g.coneAngleRad != null ? { coneAngleRad: g.coneAngleRad } : {}),
            })) as GroundEffect[]
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
          window.dispatchEvent(
            new CustomEvent('cata_combat_actions', { detail: { actions: snap.recentActions, roomId: snap.roomId } })
          );
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

        // Companion / boss cast bars from host timelines.
        // Guest's OWN cast bar is owned locally (see runCombatTick) — do not overwrite/clear
        // from snap.casts or the bar hitch-resets every COMBAT_STATE (~10Hz).
        const now = Date.now();
        const companion: Record<string, { spellName: string; progress: number; spellId?: string }> = {};
        let bossCasting: {
          spellName: string;
          spellId?: string;
          elapsedMs: number;
          castTimeMs: number;
          interruptible: boolean;
        } | null = null;
        const bossId = engine.bossUnit?.id;
        for (const c of snap.casts || []) {
          if (c.interrupted) continue;
          if (c.unitId === myId) continue;
          const built = buildCastFromTimeline(c, now);
          if (!built) continue;
          companion[c.unitId] = {
            spellName: built.spellName,
            progress: built.progress,
            spellId: built.spellId,
          };
          if (bossId && c.unitId === bossId) {
            bossCasting = {
              spellName: c.spellName,
              spellId: c.spellId,
              elapsedMs: Math.max(0, now - c.startedAtMs),
              castTimeMs: c.totalMs || 1,
              interruptible: c.interruptible !== false,
            };
          }
        }
        d().setCompanionCasts(companion);
        d().setGuestBossCasting(bossCasting);
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
        d().setCompanionCasts((prev) => {
          const next = { ...prev };
          delete next[body.unitId];
          return next;
        });
        d().guestCastTimelinesRef.current = d().guestCastTimelinesRef.current.filter((c) => c.unitId !== body.unitId);
      }
      if (msg.type === 'PLAYER_INPUT' && msg.payload && d().isNetworkHostRef.current) {
        d().pendingGuestInputsRef.current.push(msg.payload as PlayerInputPayload);
      }
      if (msg.type === 'COMBAT_EFFECT' && msg.payload && d().isNetworkHostRef.current) {
        hostReceiveCombatEffect(d().engineRef.current, msg.payload as CombatEffect);
      }
      if (msg.type === 'OWNER_SNAPSHOT' && msg.payload && d().isNetworkHostRef.current) {
        const snap = msg.payload as OwnerSnapshot;
        hostReceiveOwnerSnapshot(snap);
        mergeOwnerSnapshotUnits(d().engineRef.current, snap);
        d().setFriendlyUnits([...d().engineRef.current.friendlyUnits]);
      }
      if (msg.type === 'COMBAT_BATCH' && msg.payload) {
        const batch = msg.payload as CombatBatch;
        const engine = d().engineRef.current;
        // Host already applied host-authority effects on receive; still merge foreign snapshots / HUD
        applyCombatBatch(engine, batch, {
          mergeOwnerSnapshot: (snap) => mergeOwnerSnapshotUnits(engine, snap),
          onHudEffect: applyCastHud,
        });
        if (batch.world?.units && d().isNetworkGuestRef.current) {
          // Merge host world units but keep local player / pets from guest authority
          const me = d().currentChar?.id;
          const worldUnits = batch.world.units.filter(
            (u) => u.id !== me && u.ownerId !== me && !(u.isPet && u.ownerId === me)
          );
          const mine = engine
            .buildNetworkUnitSnapshots()
            .filter((u) => u.id === me || u.ownerId === me || (u.isPet && u.ownerId === me));
          engine.applyNetworkUnitSnapshots([...worldUnits, ...mine]);
          if (batch.world.runPhase) {
            const rsm = d().rsmRef.current;
            if (rsm) rsm.phase = batch.world.runPhase as RunPhase;
            d().setRunPhase(batch.world.runPhase as RunPhase);
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
          } else if (d().isNetworkHostRef.current && body.replacedAiId) {
            roomManager.inheritCombatUnitFromAi(engine, body.replacedAiId, joinerIdentity);
            d().setFriendlyUnits([...engine.friendlyUnits]);
            // Push unit snapshot so guests/joiner see AI disappear + player appear
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
            // Guest/joiner: drop AI unit; temporarily claim seat with joiner identity until host snapshot
            const aiUnit = engine.getUnit(body.replacedAiId);
            if (aiUnit) {
              roomManager.inheritCombatUnitFromAi(engine, body.replacedAiId, joinerIdentity);
            }
            markLocalPlayerFlags();
            d().setFriendlyUnits([...engine.friendlyUnits]);
          }
        }

        if (d().currentChar && body.playerId === d().currentChar.id) {
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
            // Hot-swap into live run: new epoch so CAST ids won't hit host's old ring
            netClient.beginCombatInputEpoch();
            d().setupRaidUnitsRef.current(
              d().currentChar,
              tier,
              body.room.difficulty,
              body.room.customDifficulty || d().customDifficultyRef.current,
              body.room
            );
            // Prefer host-inherited combat snapshot over fresh full-HP roster when available
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
        if (d().isNetworkHostRef.current || d().isNetworkGuestRef.current) {
          const engine = d().engineRef.current;
          const aiMeta = body.room.members.find((m) => m.id === body.aiMemberId);
          // Align engine unit id with room AI id so later hot-join can inherit the same seat
          // (keeping playerId caused orphan mis-claim → missing member + wrong class/role).
          const remapped = engine.remapUnitId(body.playerId, body.aiMemberId, {
            isPlayer: false,
            isHumanControlled: false,
            ...(aiMeta
              ? {
                  name: aiMeta.name,
                  classId: aiMeta.classId as any,
                  spec: aiMeta.spec,
                  role: aiMeta.role as any,
                }
              : {}),
          });
          if (remapped) {
            d().setFriendlyUnits([...engine.friendlyUnits]);
          }
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
          // Only host applies phase transition; guests follow COMBAT_STATE
          if (d().isNetworkHostRef.current && (body.result === 'RETRY' || body.result === 'FINISH')) {
            d().applyWipeVoteResultRef.current(body.result as 'RETRY' | 'FINISH');
          }
        } else if (body.kind === 'SKIP_TRAVEL') {
          d().setSkipTravelVote(null);
          d().setMySkipVote(null);
          if (body.result === 'YES' && d().isNetworkHostRef.current) {
            d().rsmRef.current?.fastForwardTravel();
            d().setRunPhase(d().rsmRef.current?.phase || 'BOSS_COMBAT');
            if ((d().rsmRef.current?.phase || 'BOSS_COMBAT') === 'BOSS_COMBAT') {
              d().setIsApproaching(true);
            }
          }
        }
      }
    });

    return () => {
      setHostEffectHudHook(null);
      unsub();
    };
  }, [charId, charSpec, charClassId, username]); // refresh AUTH on char / spec switch
}
