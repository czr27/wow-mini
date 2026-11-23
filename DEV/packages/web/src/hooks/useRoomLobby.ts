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
} from '@cata-raid-sim/engine';
import { netClient } from '../net/NetClient.js';
import type { NetworkRoomFacade } from '../net/NetworkRoomFacade.js';

export type RoomLobbySubView = 'AUTH_CHAR' | 'ROOM_LIST' | 'ROOM_DETAIL';

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
    setActiveRoomId,
    setLobbySubView,
    setRoomsTick,
    setWaitingQueueRoomId,
    onCustomDifficultyChange,
  } = deps;

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
      onCustomDifficultyChange(customDiff);
    }
    const host = {
      id: currentChar.id,
      name: currentChar.name,
      classId: currentChar.classId,
      spec: currentChar.lastSpec,
      role: getRoleBySpec(currentChar.classId, currentChar.lastSpec),
    };
    if (!netClient.connected) {
      window.alert('尚未连接到游戏服务器。请确认服务端已启动（端口 3001），房间一律由服务器管理。');
      return;
    }
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
    netClient.joinRoom(roomId);
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
    netClient.joinRoom(roomId);
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
    for (const r of rooms) {
      const quota = DUNGEON_ROLE_QUOTAS[r.dungeonId] || DUNGEON_ROLE_QUOTAS.shadowfang_keep;
      const humans = r.members.filter(m => m.isPlayer && !m.isAi).length;
      if (humans >= quota.capacity) continue;
      if (r.status === 'LOBBY' || r.status === 'IN_COMBAT' || r.status === 'OUT_OF_COMBAT') {
        const roleCount = r.members.filter(m => m.role === pRole).length;
        if (roleCount <= (quota.roles[pRole]?.max ?? 5)) {
          handleJoinRoom(r.id);
          return;
        }
      }
    }
    handleCreateRoom(
      `${currentChar.name}的速推队`,
      'shadowfang_keep',
      dungeonDifficulty,
      dungeonDifficulty === 'CUSTOM' ? customDifficulty : undefined
    );
  };

  const handleStartGameFromRoom = () => {
    if (!activeRoomId || !currentChar) return;
    const room = roomFacadeRef.current.getRoom(activeRoomId) || roomManager.getRoom(activeRoomId);
    if (!room) return;
    const validation = roomFacadeRef.current.validateStartGame(activeRoomId);
    if (!validation.canStart) {
      return;
    }
    if (!netClient.connected) {
      window.alert('尚未连接到游戏服务器。请确认服务端已启动（端口 3001）。');
      return;
    }
    isNetworkHostRef.current = true;
    isNetworkGuestRef.current = false;
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
