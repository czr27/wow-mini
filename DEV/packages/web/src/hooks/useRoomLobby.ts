import type { MutableRefObject } from 'react';
import type {
  CharacterRecord,
  CombatEngine,
  CustomDifficultySettings,
  DungeonDifficulty,
  LobbyRoom,
  Unit,
} from '@cata-raid-sim/engine';
import {
  roomManager,
  getRoleBySpec,
  DUNGEON_ROLE_QUOTAS,
  hasJoinableSeat,
} from '@cata-raid-sim/engine';
import { netClient } from '../net/NetClient.js';
import type { NetworkRoomFacade } from '../net/NetworkRoomFacade.js';

export type RoomLobbySubView = 'AUTH_CHAR' | 'ROOM_LIST' | 'ROOM_DETAIL';

/** Host quick-play: client fills AI + starts if server has not already. */
export const pendingQuickPlayStartRef = { current: false };

export type StartAdventureOverrides = {
  tier?: '5man' | '20man';
  difficulty?: DungeonDifficulty;
  customDiff?: CustomDifficultySettings;
  activeRoom?: LobbyRoom;
};

export type RoomLobbyDeps = {
  currentChar: CharacterRecord | null;
  activeRoomId: string | null;
  dungeonDifficulty: DungeonDifficulty;
  customDifficulty: CustomDifficultySettings;
  roomFacadeRef: MutableRefObject<NetworkRoomFacade>;
  isNetworkHostRef: MutableRefObject<boolean>;
  isNetworkGuestRef: MutableRefObject<boolean>;
  /** retained for App wiring / future combat remaps */
  engineRef: MutableRefObject<CombatEngine>;
  /** Clear leftover dungeon phase before create/join lobby */
  rsmRef?: MutableRefObject<{ phase: string } | null>;
  setRunPhase?: (phase: 'LOBBY') => void;
  startAdventureRef: MutableRefObject<(overrides?: StartAdventureOverrides) => void>;
  setActiveRoomId: (id: string | null) => void;
  setLobbySubView: (view: RoomLobbySubView) => void;
  setRoomsTick: (updater: (t: number) => number) => void;
  setWaitingQueueRoomId: (id: string | null) => void;
  setFriendlyUnits: (units: Unit[]) => void;
  setDungeonTier: (tier: '5man' | '20man') => void;
  setDungeonDifficulty: (diff: DungeonDifficulty) => void;
  setCustomDifficulty: (settings: CustomDifficultySettings) => void;
  onCustomDifficultyChange: (settings: CustomDifficultySettings) => void;
};

/**
 * Server-authoritative lobby actions (leave / create / join / queue / quick-join / start).
 * Rooms are never created purely locally — WebSocket to the game server is required.
 */
export function useRoomLobby(deps: RoomLobbyDeps) {
  const {
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
    setActiveRoomId,
    setLobbySubView,
    setRoomsTick,
    setWaitingQueueRoomId,
    setFriendlyUnits,
    onCustomDifficultyChange,
  } = deps;

  /** Ensure lobby UI can show: clear leftover BOSS_COMBAT / TRAVEL from a prior unfinished run. */
  const ensureLobbyPhase = () => {
    if (rsmRef?.current && rsmRef.current.phase !== 'LOBBY') {
      rsmRef.current.phase = 'LOBBY';
    }
    setRunPhase?.('LOBBY');
    try {
      engineRef.current?.reset();
    } catch {}
    setFriendlyUnits([]);
  };

  const handleLeaveActiveRoom = () => {
    if (activeRoomId && currentChar) {
      const room = roomFacadeRef.current.getRoom(activeRoomId) || roomManager.getRoom(activeRoomId);
      const isHost = room?.hostId === currentChar.id || isNetworkHostRef.current;
      if (isHost) {
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
    ensureLobbyPhase();
    setActiveRoomId(null);
    setLobbySubView('ROOM_LIST');
    setRoomsTick(t => t + 1);
  };

  /** Push latest spec/role to server session before create/join (avoid stale AUTH). */
  const syncAuthSpec = () => {
    if (!currentChar) return;
    const role = getRoleBySpec(currentChar.classId, currentChar.lastSpec);
    netClient.refreshAuthProfile({
      playerId: currentChar.id,
      playerName: currentChar.name,
      classId: currentChar.classId,
      spec: currentChar.lastSpec,
      role,
    });
  };

  const currentPlayerInfo = () => {
    if (!currentChar) return null;
    return {
      id: currentChar.id,
      name: currentChar.name,
      classId: currentChar.classId,
      spec: currentChar.lastSpec,
      role: getRoleBySpec(currentChar.classId, currentChar.lastSpec),
    };
  };

  const handleCreateRoom = (
    name: string,
    dungeonId: string,
    difficulty: DungeonDifficulty,
    customDiff?: CustomDifficultySettings
  ) => {
    if (!currentChar) return;
    if (customDiff) {
      onCustomDifficultyChange(customDiff);
    }
    const host = currentPlayerInfo()!;
    if (!netClient.connected) {
      window.alert('尚未连接到游戏服务器。请确认服务端已启动（端口 3001），房间一律由服务器管理。');
      return;
    }
    // Leave any prior unfinished dungeon UI before opening a fresh prep room
    if (activeRoomId) {
      handleLeaveActiveRoom();
    } else {
      ensureLobbyPhase();
    }
    syncAuthSpec();
    netClient.createRoom({
      name,
      dungeonId,
      difficulty,
      customDifficulty: difficulty === 'CUSTOM' ? (customDiff || customDifficulty) : undefined,
      host,
    });
    setLobbySubView('ROOM_DETAIL');
    setRoomsTick(t => t + 1);
  };

  const handleJoinRoom = (roomId: string) => {
    if (!currentChar) return;
    if (!netClient.connected) {
      window.alert('尚未连接到游戏服务器。请确认服务端已启动（端口 3001），房间一律由服务器管理。');
      return;
    }
    // Joining a lobby seat must not keep a leftover combat phase on screen
    ensureLobbyPhase();
    syncAuthSpec();
    netClient.joinRoom(roomId, currentPlayerInfo()!);
    setActiveRoomId(roomId);
    setLobbySubView('ROOM_DETAIL');
    setRoomsTick(t => t + 1);
  };

  const handleJoinWaitingQueue = (roomId: string) => {
    if (!currentChar) return;
    if (!netClient.connected) {
      window.alert('尚未连接到游戏服务器。请确认服务端已启动（端口 3001），房间一律由服务器管理。');
      return;
    }
    syncAuthSpec();
    netClient.joinRoom(roomId, currentPlayerInfo()!);
    setWaitingQueueRoomId(roomId);
    setRoomsTick(t => t + 1);
  };

  const handleQuickJoin = () => {
    if (!currentChar) return;
    if (!netClient.connected) {
      window.alert('尚未连接到游戏服务器。请确认服务端已启动（端口 3001），房间一律由服务器管理。');
      return;
    }
    const pRole = getRoleBySpec(currentChar.classId, currentChar.lastSpec);
    const rooms = roomFacadeRef.current.listRooms();
    // Prefer mid-run rooms that still have human capacity (hot-join / swap AI).
    const hotJoinable = rooms.filter((r) => {
      const quota = DUNGEON_ROLE_QUOTAS[r.dungeonId] || DUNGEON_ROLE_QUOTAS.shadowfang_keep;
      const humans = r.members.filter((m) => m.isPlayer && !m.isAi).length;
      if (humans >= quota.capacity) return false;
      if (r.status !== 'IN_COMBAT' && r.status !== 'OUT_OF_COMBAT') return false;
      // 普通/英雄：同职责；自定义：任意空位或任意 AI
      return hasJoinableSeat(r, pRole);
    });
    if (hotJoinable.length > 0) {
      const pick = hotJoinable[Math.floor(Math.random() * hotJoinable.length)];
      handleJoinRoom(pick.id);
      return;
    }
    // No hot-join target: create random dungeon + difficulty, fill AI, start immediately.
    const dungeonIds = [
      'shadowfang_keep',
      'deadmines',
      'scarlet_monastery',
      'stratholme',
      'zulgurub',
      'dragon_soul',
    ] as const;
    const difficulties: DungeonDifficulty[] = ['NORMAL', 'HEROIC'];
    const dungeonId = dungeonIds[Math.floor(Math.random() * dungeonIds.length)];
    const difficulty = difficulties[Math.floor(Math.random() * difficulties.length)];
    const host = {
      id: currentChar.id,
      name: currentChar.name,
      classId: currentChar.classId,
      spec: currentChar.lastSpec,
      role: pRole,
    };
    if (activeRoomId) {
      handleLeaveActiveRoom();
    } else {
      ensureLobbyPhase();
    }
    pendingQuickPlayStartRef.current = true;
    syncAuthSpec();
    netClient.createRoom({
      name: `${currentChar.name}的快速游戏`,
      dungeonId,
      difficulty,
      host,
      quickStart: true,
    });
    setLobbySubView('ROOM_DETAIL');
    setRoomsTick((t) => t + 1);
  };

  const handleStartGameFromRoom = () => {
    if (!activeRoomId || !currentChar) return;
    if (!netClient.connected) {
      window.alert('尚未连接到游戏服务器。请确认服务端已启动（端口 3001）。');
      return;
    }
    let room = roomFacadeRef.current.getRoom(activeRoomId) || roomManager.getRoom(activeRoomId);
    if (!room) return;

    let validation =
      roomFacadeRef.current.validateStartGameRoom?.(room) ??
      roomFacadeRef.current.validateStartGame(activeRoomId);

    // 与界面「AI 补齐后可开局」对齐：本地镜像若仍显示未满，再乐观补一次后再校验
    if (!validation.canStart && validation.reasons.some((r) => r.includes('未满'))) {
      roomFacadeRef.current.autoFillAi(activeRoomId);
      setRoomsTick((t) => t + 1);
      room = roomFacadeRef.current.getRoom(activeRoomId) || roomManager.getRoom(activeRoomId);
      if (!room) return;
      validation =
        roomFacadeRef.current.validateStartGameRoom?.(room) ??
        roomFacadeRef.current.validateStartGame(activeRoomId);
    }

    if (!validation.canStart) {
      window.alert(`无法开局：${validation.reasons.join('；')}`);
      return;
    }
    isNetworkHostRef.current = true;
    isNetworkGuestRef.current = false;
    // 服务端 startGame 也会再 autoFill，覆盖「START 早于 AUTO_FILL 到达」的竞态
    netClient.startRoom(activeRoomId);
  };

  return {
    handleLeaveActiveRoom,
    handleCreateRoom,
    handleJoinRoom,
    handleJoinWaitingQueue,
    handleQuickJoin,
    handleStartGameFromRoom,
  };
}
