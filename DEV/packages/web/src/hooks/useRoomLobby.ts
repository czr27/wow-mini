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
 * Offline + networked lobby actions (leave / create / join / queue / quick-join / start).
 * WS subscribe stays in App until a later phase.
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
    startAdventureRef,
    setActiveRoomId,
    setLobbySubView,
    setRoomsTick,
    setWaitingQueueRoomId,
    setFriendlyUnits,
    setDungeonTier,
    setDungeonDifficulty,
    setCustomDifficulty,
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

    const quota = DUNGEON_ROLE_QUOTAS[room.dungeonId] || DUNGEON_ROLE_QUOTAS.shadowfang_keep;
    const humans = room.members.filter(m => m.isPlayer && !m.isAi).length;
    if (humans >= quota.capacity) return;

    const pRole = getRoleBySpec(currentChar.classId, currentChar.lastSpec);
    const join = roomManager.joinOrHotSwapPlayer(roomId, {
      id: currentChar.id,
      name: currentChar.name,
      classId: currentChar.classId,
      spec: currentChar.lastSpec,
      role: pRole,
    });
    if (!join.ok || !join.room) return;

    if (
      join.replacedAiId &&
      (join.room.status === 'IN_COMBAT' || join.room.status === 'OUT_OF_COMBAT') &&
      engineRef.current
    ) {
      roomManager.inheritCombatUnitFromAi(engineRef.current, join.replacedAiId, {
        id: currentChar.id,
        name: currentChar.name,
        classId: currentChar.classId,
        spec: currentChar.lastSpec,
        role: pRole,
      });
      setFriendlyUnits([...engineRef.current.friendlyUnits]);
    }

    isNetworkGuestRef.current = join.room.hostId !== currentChar.id;
    isNetworkHostRef.current = join.room.hostId === currentChar.id;
    setActiveRoomId(join.room.id);
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

    if (netClient.connected) {
      isNetworkHostRef.current = true;
      isNetworkGuestRef.current = false;
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

    startAdventureRef.current({
      tier,
      difficulty: room.difficulty,
      customDiff: effectiveCustom,
      activeRoom: room,
    });
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
