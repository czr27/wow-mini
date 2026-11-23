import {
  RoomManager,
  validateStartGame as validateStartGameSnapshot,
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
 * Mutations go to the game server over WebSocket; local RoomManager is a
 * mirror updated via ROOM_UPDATE / ROOM_LIST_SYNC.
 * Callers must require netClient.connected — there is no intentional offline room mode.
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
    const fromNet = this.connected
      ? netClient.rooms.find((r) => r.id === roomId)
      : undefined;
    const fromLocal = this.local.getRoom(roomId);
    if (fromNet && fromLocal) {
      // 乐观 AI 补齐可能领先于服务器推送：取人数更多的那份
      const netN = fromNet.members?.length || 0;
      const localN = fromLocal.members?.length || 0;
      return localN > netN ? fromLocal : fromNet;
    }
    return fromNet || fromLocal;
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
    // 始终校验当前镜像里的这间房，禁止落到过期空房
    const room = this.getRoom(roomId);
    if (!room) {
      return {
        canStart: false,
        reasons: ['房间不存在'],
        isFull: false,
        isRoleCompositionValid: false,
        allReady: false,
      };
    }
    this.local.upsertRoom(room);
    return validateStartGameSnapshot(room);
  }

  /** 直接校验传入的房间快照（与界面展示的同一份） */
  validateStartGameRoom(room: LobbyRoom): StartGameValidation {
    this.local.upsertRoom(room);
    return validateStartGameSnapshot(room);
  }

  validateMapSwitch(roomId: string, dungeonId: string): MapSwitchValidation {
    const room = this.getRoom(roomId);
    if (room) this.local.upsertRoom(room);
    return this.local.validateMapSwitch(roomId, dungeonId);
  }

  canSelectSpec(
    roomId: string,
    memberId: string,
    spec: string,
    classId: ClassId
  ): SpecSelectionCheck {
    const room = this.getRoom(roomId);
    if (room) this.local.upsertRoom(room);
    return this.local.canSelectSpec(roomId, memberId, spec, classId);
  }

  autoFillAi(roomId: string, opts?: { replaceExistingAi?: boolean }) {
    if (this.connected) {
      // 先乐观补齐本地+net 镜像，开局校验立刻对上用户看到的名册；服务端 ROOM_UPDATE 再校正
      const snap = this.getRoom(roomId);
      if (snap) {
        const working = JSON.parse(JSON.stringify(snap)) as LobbyRoom;
        this.local.upsertRoom(working);
        const result = this.local.autoFillAi(roomId, opts);
        const filled = this.local.getRoom(roomId);
        if (filled) netClient.replaceRoom(filled);
        netClient.roomAction(roomId, {
          action: 'AUTO_FILL_AI',
          replaceExistingAi: !!opts?.replaceExistingAi,
        });
        return result;
      }
      netClient.roomAction(roomId, {
        action: 'AUTO_FILL_AI',
        replaceExistingAi: !!opts?.replaceExistingAi,
      });
      return { success: true, addedCount: 0, removedCount: 0 };
    }
    return this.local.autoFillAi(roomId, opts);
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
