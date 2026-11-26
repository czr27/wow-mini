import React from 'react';
import type {
  CharacterRecord,
  ClassId,
  CustomDifficultySettings,
  LobbyRoom,
  RoomChatMessage,
} from '@cata-raid-sim/engine';
import type { NetworkRoomFacade } from '../net/NetworkRoomFacade.js';
import { RoomListView, RoomDetailView } from '../components/room/index.js';

export type LobbySubView = 'AUTH_CHAR' | 'ROOM_LIST' | 'ROOM_DETAIL';

export type LobbyScreenProps = {
  subView: LobbySubView;
  currentChar: CharacterRecord | null;
  rooms: LobbyRoom[];
  activeRoom: LobbyRoom | null;
  customDifficulty: CustomDifficultySettings;
  roomFacade: NetworkRoomFacade;
  onChangeCustomDifficulty: (settings: CustomDifficultySettings) => void;
  onCreateRoom: (
    name: string,
    dungeonId: string,
    difficulty: 'NORMAL' | 'HEROIC' | 'CUSTOM',
    customDiff?: CustomDifficultySettings
  ) => void;
  onJoinRoom: (roomId: string) => void;
  onJoinWaitingQueue: (roomId: string) => void;
  onQuickJoin: () => void;
  onLeaveRoom: () => void;
  onStartGame: () => void;
  onRefreshRoom: () => void;
  onBackToCharacterSelect: () => void;
  chatMessages?: RoomChatMessage[];
  onSendChat?: (text: string) => void;
  /** Auth / character panel when not in room list/detail */
  authPanel: React.ReactNode;
};

/** Lobby router shell: room list / room detail / auth children. */
export function LobbyScreen(props: LobbyScreenProps) {
  const {
    subView,
    currentChar,
    rooms,
    activeRoom,
    customDifficulty,
    roomFacade,
    onChangeCustomDifficulty,
    onCreateRoom,
    onJoinRoom,
    onJoinWaitingQueue,
    onQuickJoin,
    onLeaveRoom,
    onStartGame,
    onRefreshRoom,
    onBackToCharacterSelect,
    chatMessages,
    onSendChat,
    authPanel,
  } = props;

  if (subView === 'ROOM_LIST' && currentChar) {
    return (
      <div className="flex-1 min-h-0 w-full h-full flex flex-col">
        <RoomListView
          rooms={rooms}
          player={{
            id: currentChar.id,
            name: currentChar.name,
            classId: currentChar.classId as ClassId,
            spec: currentChar.lastSpec,
          }}
          customDifficulty={customDifficulty}
          onChangeCustomDifficulty={onChangeCustomDifficulty}
          onCreateRoom={onCreateRoom}
          onJoinRoom={onJoinRoom}
          onJoinWaitingQueue={onJoinWaitingQueue}
          onQuickJoin={onQuickJoin}
          onBackToCharacterSelect={onBackToCharacterSelect}
        />
      </div>
    );
  }

  if (subView === 'ROOM_DETAIL' && activeRoom && currentChar) {
    return (
      <div className="flex-1 min-h-0 w-full h-full flex flex-col">
        <RoomDetailView
          room={activeRoom}
          currentPlayerId={currentChar.id}
          roomManager={roomFacade}
          customDifficulty={customDifficulty}
          onChangeCustomDifficulty={onChangeCustomDifficulty}
          onLeaveRoom={onLeaveRoom}
          onStartGame={onStartGame}
          onRefreshRoom={onRefreshRoom}
          chatMessages={chatMessages}
          onSendChat={onSendChat}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 w-full h-full flex flex-col overflow-hidden">
      {authPanel}
    </div>
  );
}
