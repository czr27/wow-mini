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
} from '@cata-raid-sim/engine';
import {
  roomManager,
  getRoleBySpec,
  DRAGON_SOUL_CONFIG,
  SHADOWFANG_KEEP_CONFIG,
} from '@cata-raid-sim/engine';
import type { PlayerCastState } from '../components/ActionBar.js';
import { netClient } from '../net/NetClient.js';
import type { NetworkRoomFacade } from '../net/NetworkRoomFacade.js';
import { buildCastFromTimeline, gcdRemainingFromTimelines } from '../net/netTimeline.js';
import type { RoomLobbySubView, StartAdventureOverrides } from './useRoomLobby.js';

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
  setWaitingQueueRoomId: Dispatch<SetStateAction<string | null>>;
  setDungeonTier: Dispatch<SetStateAction<'5man' | '20man'>>;
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
};

/** WebSocket connect + room/combat sync subscription (from App). */
export function useNetworkRoomSync(deps: NetworkRoomSyncDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const charId = deps.currentChar?.id;
  const username = deps.account?.username;

  useEffect(() => {
    const account = depsRef.current.account;
    if (!account) return;

    const d = () => depsRef.current;
    const currentChar = d().currentChar;

    // Always attach to the game server (incl. localhost). Session id may be
    // a placeholder until the player has a character.
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
        // Same character reconnected elsewhere — drop this socket only (other accounts on this PC stay fine)
        netClient.disconnect();
        d().setNetConnected(false);
        d().setActiveRoomId(null);
        d().isNetworkGuestRef.current = false;
        d().isNetworkHostRef.current = false;
        d().setLobbySubView('AUTH_CHAR');
        d().setRunPhase('LOBBY');
        window.alert((msg.payload as any)?.reason || '同一角色已在其他窗口登录，本窗口已断开联机');
      }
      if (msg.type === 'ROOM_LIST_SYNC' && Array.isArray(msg.payload)) {
        const list = msg.payload as NetLobbyRoom[];
        const ids = new Set(list.map((r) => r.id));
        // Mirror purge must use local RoomManager — facade.listRooms() may already be net-synced
        for (const existing of roomManager.listRooms()) {
          if (!ids.has(existing.id)) {
            roomManager.deleteRoom(existing.id);
          }
        }
        for (const room of list) {
          d().roomFacadeRef.current.upsertRoom(room);
        }
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
          const tier: '5man' | '20man' = room.dungeonId === 'dragon_soul' ? '20man' : '5man';
          d().setDungeonTier(tier);
          d().setDungeonDifficulty(room.difficulty);
          if (room.customDifficulty) {
            d().setCustomDifficulty(room.customDifficulty);
          }
          const phase = d().rsmRef.current?.phase || 'LOBBY';
          const alreadyInRun = phase !== 'LOBBY' && phase !== 'SUMMARY';
          const roomInCombat = room.status === 'IN_COMBAT' || room.status === 'OUT_OF_COMBAT';
          if (roomInCombat && !alreadyInRun) {
            // Hot-join mid-boss: enter as guest; host COMBAT_STATE will sync HP/frames
            d().isNetworkGuestRef.current = room.hostId !== d().currentChar.id;
            d().isNetworkHostRef.current = room.hostId === d().currentChar.id;
            d().setWaitingQueueRoomId(null);
            d().setupRaidUnitsRef.current(
              d().currentChar,
              tier,
              room.difficulty,
              room.customDifficulty || d().customDifficultyRef.current,
              room
            );
            d().setFriendlyUnits([...d().engineRef.current.friendlyUnits]);
            if (d().rsmRef.current) {
              d().rsmRef.current.dungeon =
                tier === '20man' ? DRAGON_SOUL_CONFIG : SHADOWFANG_KEEP_CONFIG;
              d().rsmRef.current.phase =
                room.status === 'OUT_OF_COMBAT' ? 'TRAVEL_RECOVERY' : 'BOSS_COMBAT';
              d().setRunPhase(d().rsmRef.current.phase);
            }
          } else if (!alreadyInRun) {
            d().setLobbySubView('ROOM_DETAIL');
          }
        }
        d().setRoomsTick((t) => t + 1);
      }
      if (msg.type === 'ROOM_CLOSED' && msg.payload) {
        const body = msg.payload as { roomId: string; reason?: string };
        const closedId = body.roomId || msg.roomId;
        if (closedId) d().roomFacadeRef.current.deleteRoom(closedId);
        if (closedId && (d().activeRoomIdRef.current === closedId || d().waitingQueueRoomIdRef.current === closedId)) {
          d().isNetworkGuestRef.current = false;
          d().isNetworkHostRef.current = false;
          d().setActiveRoomId(null);
          d().setWaitingQueueRoomId(null);
          d().setWipeNetworkVote(null);
          d().setSkipTravelVote(null);
          const engine = d().engineRef.current;
          const rsm = d().rsmRef.current;
          if (engine) engine.reset();
          if (rsm) rsm.phase = 'LOBBY';
          d().setRunPhase('LOBBY');
          d().setLobbySubView('ROOM_LIST');
          d().setFriendlyUnits([]);
          d().setBossUnit(undefined);
          d().setPlayerCast(null);
          d().playerCastRef.current = null;
          d().setCompanionCasts({});
          // Room teardown must not drop the account session
          netClient.ensureConnected();
          if (netClient.connected) d().setNetConnected(true);
        }
        d().setRoomsTick((t) => t + 1);
      }
      if (msg.type === 'ROOM_START' && msg.payload) {
        const room = msg.payload as NetLobbyRoom;
        d().roomFacadeRef.current.upsertRoom(room);
        d().setActiveRoomId(room.id);
        d().isNetworkHostRef.current = !!(d().currentChar && room.hostId === d().currentChar.id);
        d().isNetworkGuestRef.current = !!(d().currentChar && room.hostId !== d().currentChar.id);
        const tier: '5man' | '20man' = room.dungeonId === 'dragon_soul' ? '20man' : '5man';
        const effectiveCustom = room.customDifficulty || d().customDifficultyRef.current;
        d().setDungeonTier(tier);
        d().setDungeonDifficulty(room.difficulty);
        if (room.difficulty === 'CUSTOM') d().setCustomDifficulty(effectiveCustom);
        d().startAdventureRef.current({
          tier,
          difficulty: room.difficulty,
          customDiff: effectiveCustom,
          activeRoom: room,
        });
      }
      if (msg.type === 'COMBAT_STATE' && msg.payload && d().isNetworkGuestRef.current) {
        const snap = msg.payload as NetworkCombatSnapshot;
        // Room isolation: ignore snapshots from other rooms
        const myRoom = d().activeRoomIdRef.current;
        if (snap.roomId && myRoom && snap.roomId !== myRoom) return;
        if (msg.roomId && myRoom && msg.roomId !== myRoom) return;

        const engine = d().engineRef.current;
        const rsm = d().rsmRef.current;
        engine.applyNetworkUnitSnapshots(snap.units);
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
        }

        d().guestCastTimelinesRef.current = snap.casts || [];
        d().guestCdTimelinesRef.current = snap.cooldowns || [];
        d().guestGcdTimelinesRef.current = snap.gcds || [];

        // Apply cast timelines to local player cast bar / companion casts
        const now = Date.now();
        const myId = d().currentChar?.id;
        const myCast = (snap.casts || []).find((c) => c.unitId === myId && !c.interrupted);
        if (myCast) {
          const built = buildCastFromTimeline(myCast, now);
          if (built) {
            d().playerCastRef.current = built as any;
            d().setPlayerCast(built as any);
          } else {
            d().playerCastRef.current = null;
            d().setPlayerCast(null);
          }
        } else if ((snap.interrupts || []).some((i) => i.unitId === myId) || (snap.casts || []).some((c) => c.unitId === myId && c.interrupted)) {
          d().playerCastRef.current = null;
          d().setPlayerCast(null);
        }

        const companion: Record<string, { spellName: string; progress: number }> = {};
        for (const c of snap.casts || []) {
          if (c.interrupted || c.unitId === myId) continue;
          const built = buildCastFromTimeline(c, now);
          if (built) companion[c.unitId] = { spellName: built.spellName, progress: built.progress };
        }
        d().setCompanionCasts(companion);

        if (myId) {
          const gcd = gcdRemainingFromTimelines(snap.gcds, myId, now);
          d().setPlayerGcdRemainingMs(gcd.remaining);
          d().setPlayerGcdTotalMs(gcd.total);
        }
      }
      if (msg.type === 'CAST_INTERRUPT' && msg.payload) {
        const body = msg.payload as { unitId: string; spellId?: string };
        if (d().currentChar && body.unitId === d().currentChar.id) {
          d().playerCastRef.current = null;
          d().setPlayerCast(null);
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
      if (msg.type === 'MEMBER_HOT_SWAP' && msg.payload) {
        const body = msg.payload as {
          room: NetLobbyRoom;
          playerId: string;
          replacedAiId: string;
          unitSnapshot?: NetworkCombatSnapshot['units'][number];
        };
        d().roomFacadeRef.current.upsertRoom(body.room);
        const engine = d().engineRef.current;
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
              body.unitSnapshot,
            ]);
            d().setFriendlyUnits([...engine.friendlyUnits]);
          } else if (d().isNetworkHostRef.current && body.replacedAiId) {
            const member = body.room.members.find((m) => m.id === body.playerId);
            roomManager.inheritCombatUnitFromAi(engine, body.replacedAiId, {
              id: body.playerId,
              name: member?.name || body.playerId,
              classId: (member?.classId || 'MAGE') as any,
              spec: member?.spec || 'FIRE',
              role: (member?.role || 'DPS') as any,
            });
            d().setFriendlyUnits([...engine.friendlyUnits]);
            // Push unit snapshot so guests/joiner see AI disappear + player appear
            if (netClient.connected && d().activeRoomIdRef.current) {
              const unitSnap = engine
                .buildNetworkUnitSnapshots()
                .find((u) => u.id === body.playerId);
              netClient.sendHotSwap(d().activeRoomIdRef.current, {
                roomId: d().activeRoomIdRef.current,
                room: body.room,
                playerId: body.playerId,
                replacedAiId: body.replacedAiId,
                unitSnapshot: unitSnap,
              });
            }
          } else if (body.replacedAiId) {
            // Guest/joiner: drop AI unit from local frames until full snapshot arrives
            const aiUnit = engine.getUnit(body.replacedAiId);
            if (aiUnit) {
              engine.removeUnit(body.replacedAiId);
              d().setFriendlyUnits([...engine.friendlyUnits]);
            }
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
            const tier: '5man' | '20man' =
              body.room.dungeonId === 'dragon_soul' ? '20man' : '5man';
            d().setDungeonTier(tier);
            d().setDungeonDifficulty(body.room.difficulty);
            d().setupRaidUnitsRef.current(
              d().currentChar,
              tier,
              body.room.difficulty,
              body.room.customDifficulty || d().customDifficultyRef.current,
              body.room
            );
            d().setFriendlyUnits([...d().engineRef.current.friendlyUnits]);
            if (d().rsmRef.current) {
              d().rsmRef.current.dungeon =
                tier === '20man' ? DRAGON_SOUL_CONFIG : SHADOWFANG_KEEP_CONFIG;
              d().rsmRef.current.phase =
                body.room.status === 'OUT_OF_COMBAT' ? 'TRAVEL_RECOVERY' : 'BOSS_COMBAT';
              d().setRunPhase(d().rsmRef.current.phase);
            }
          }
        }
        d().setRoomsTick((t) => t + 1);
      }
      if (msg.type === 'MEMBER_REPLACE_AI' && msg.payload) {
        const body = msg.payload as { room: NetLobbyRoom; playerId: string; aiMemberId: string };
        d().roomFacadeRef.current.upsertRoom(body.room);
        if (d().isNetworkHostRef.current || d().isNetworkGuestRef.current) {
          const engine = d().engineRef.current;
          const unit = engine.getUnit(body.playerId);
          if (unit) {
            // Keep combat unit id; mark as AI until next full snapshot
            unit.isPlayer = false;
            const aiMeta = body.room.members.find((m) => m.id === body.aiMemberId);
            if (aiMeta) {
              unit.name = aiMeta.name;
              unit.classId = aiMeta.classId as any;
              unit.spec = aiMeta.spec;
              unit.role = aiMeta.role as any;
            }
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
        if (vote.kind === 'WIPE') {
          d().setWipeNetworkVote({ ...vote });
          if (d().currentChar && vote.votes?.[d().currentChar.id]) {
            d().setMyWipeVote(vote.votes[d().currentChar.id] as 'RETRY' | 'FINISH');
          }
        } else if (vote.kind === 'SKIP_TRAVEL') {
          d().setSkipTravelVote({ ...vote });
          if (d().currentChar && vote.votes?.[d().currentChar.id]) {
            d().setMySkipVote(vote.votes[d().currentChar.id] as 'YES' | 'NO');
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
          }
        }
      }
    });

    return () => {
      unsub();
    };
  }, [charId, username]); // reconnect when account or selected character changes
}
