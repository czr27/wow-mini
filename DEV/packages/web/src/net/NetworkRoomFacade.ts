import {
  RoomManager,
  type ClassId,
  type CustomDifficultySettings,
  type DungeonDifficulty,
  type LobbyRoom,
  type RoleId,
  type SpecSelectionCheck,
  type StartGameValidation,
  type MapSwitchValidation,
} from '@cata-raid-sim/engine';
import { netClient } from './NetClient.js';

/**
 * When WebSocket is connected, mutations go to the server; local RoomManager
 * is a mirror updated via ROOM_UPDATE / ROOM_LIST_SYNC.
 * Offline: mutations run on the local RoomManager (single-player).
 */
export class NetworkRoomFacade {
  createRoomLocal: RoomManager['createRoom'];
  startGameLocal: RoomManager['startGame'];
  joinWaitingQueue: RoomManager['joinWaitingQueue'];
  leaveWaitingQueue: RoomManager['leaveWaitingQueue'];
  updateCombatBossState: RoomManager['updateCombatBossState'];
  substituteOutOfCombat: RoomManager['substituteOutOfCombat'];
  getWaitingQueueStatus: RoomManager['getWaitingQueueStatus'];

  constructor(private readonly local: RoomManager) {
    // Bound in constructor body: with useDefineForClassFields, field
    // initializers run before parameter properties are assigned.
    this.createRoomLocal = this.local.createRoom.bind(this.local);
    this.startGameLocal = this.local.startGame.bind(this.local);
    this.joinWaitingQueue = this.local.joinWaitingQueue.bind(this.local);
    this.leaveWaitingQueue = this.local.leaveWaitingQueue.bind(this.local);
    this.updateCombatBossState = this.local.updateCombatBossState.bind(this.local);
    this.substituteOutOfCombat = this.local.substituteOutOfCombat.bind(this.local);
    this.getWaitingQueueStatus = this.local.getWaitingQueueStatus.bind(this.local);
  }

  get connected() {
    return netClient.connected;
  }

  getRoom(roomId: string): LobbyRoom | undefined {
    return this.local.getRoom(roomId);
  }

  listRooms(): LobbyRoom[] {
    if (this.connected && netClient.rooms.length > 0) {
      return netClient.rooms;
    }
    return this.local.listRooms();
  }

  upsertRoom(room: LobbyRoom) {
    this.local.upsertRoom(room);
  }

  validateStartGame(roomId: string): StartGameValidation {
    return this.local.validateStartGame(roomId);
  }

  validateMapSwitch(roomId: string, dungeonId: string): MapSwitchValidation {
    return this.local.validateMapSwitch(roomId, dungeonId);
  }

  canSelectSpec(
    roomId: string,
    memberId: string,
    spec: string,
    classId: ClassId
  ): SpecSelectionCheck {
    return this.local.canSelectSpec(roomId, memberId, spec, classId);
  }

  autoFillAi(roomId: string) {
    if (this.connected) {
      netClient.roomAction(roomId, { action: 'AUTO_FILL_AI' });
      return { success: true, addedCount: 0 };
    }
    return this.local.autoFillAi(roomId);
  }

  addAiMember(roomId: string, role?: RoleId) {
    if (this.connected) {
      netClient.roomAction(roomId, { action: 'ADD_AI', role });
      return null;
    }
    return this.local.addAiMember(roomId, role);
  }

  kickMember(roomId: string, memberId: string) {
    if (this.connected) {
      netClient.roomAction(roomId, { action: 'KICK', memberId });
      return true;
    }
    return this.local.kickMember(roomId, memberId);
  }

  setPlayerReady(roomId: string, playerId: string, isReady: boolean) {
    if (this.connected) {
      netClient.roomAction(roomId, { action: 'SET_READY', ready: isReady });
      return true;
    }
    return this.local.setPlayerReady(roomId, playerId, isReady);
  }

  switchMap(roomId: string, targetDungeonId: string) {
    if (this.connected) {
      netClient.roomAction(roomId, { action: 'SWITCH_MAP', dungeonId: targetDungeonId });
      return true;
    }
    return this.local.switchMap(roomId, targetDungeonId);
  }

  setRoomDifficulty(
    roomId: string,
    difficulty: DungeonDifficulty,
    customDifficulty?: CustomDifficultySettings
  ) {
    if (this.connected) {
      netClient.roomAction(roomId, {
        action: 'SET_DIFFICULTY',
        difficulty,
        customDifficulty,
      });
      return true;
    }
    return this.local.setRoomDifficulty(roomId, difficulty, customDifficulty);
  }

  changeMemberSpec(
    roomId: string,
    memberId: string,
    newClassId: ClassId,
    newSpec: string,
    options?: { allowOverQuota?: boolean }
  ) {
    if (this.connected) {
      netClient.roomAction(roomId, {
        action: 'CHANGE_SPEC',
        memberId,
        classId: newClassId,
        spec: newSpec,
      });
      return true;
    }
    return this.local.changeMemberSpec(roomId, memberId, newClassId, newSpec, options);
  }

  leaveRoom(roomId: string, memberId: string) {
    if (this.connected) {
      netClient.leaveRoom(roomId);
      return { removed: true, roomDeleted: false };
    }
    return this.local.leaveRoom(roomId, memberId);
  }

  /** Host destroys room for all clients (wipe FINISH / explicit close). */
  closeRoom(roomId: string, reason = 'destroyed') {
    if (this.connected) {
      netClient.closeRoom(roomId, reason);
      this.local.destroyRoom(roomId);
      return true;
    }
    return this.local.destroyRoom(roomId);
  }

  deleteRoom(roomId: string) {
    return this.local.deleteRoom(roomId);
  }

  cleanupAiOnlyRooms() {
    return this.local.cleanupAiOnlyRooms();
  }
}
