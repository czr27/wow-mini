import React, { useState } from 'react';
import type { ClassId, DungeonDifficulty, CustomDifficultySettings } from '@cata-raid-sim/engine';
import {
  type LobbyRoom,
  type RoomMember,
  type MapSwitchValidation,
  type SpecSelectionCheck,
  type StartGameValidation,
  CLASS_SPECS_MAP,
  DUNGEON_ROLE_QUOTAS,
  DEFAULT_CUSTOM_DIFFICULTY,
} from '@cata-raid-sim/engine';

/** Local RoomManager or networked facade — structural ops used by the room UI. */
export interface RoomController {
  validateStartGame(roomId: string): StartGameValidation;
  validateMapSwitch(roomId: string, dungeonId: string): MapSwitchValidation;
  canSelectSpec(roomId: string, memberId: string, spec: string, classId: ClassId): SpecSelectionCheck;
  autoFillAi(roomId: string): { success: boolean; addedCount: number } | void;
  addAiMember(roomId: string): unknown;
  kickMember(roomId: string, memberId: string): boolean | void;
  setPlayerReady(roomId: string, playerId: string, isReady: boolean): boolean | void;
  switchMap(roomId: string, targetDungeonId: string): boolean | void;
  setRoomDifficulty(
    roomId: string,
    difficulty: DungeonDifficulty,
    customDifficulty?: CustomDifficultySettings
  ): boolean | void;
  changeMemberSpec(
    roomId: string,
    memberId: string,
    newClassId: ClassId,
    newSpec: string,
    options?: { allowOverQuota?: boolean }
  ): boolean | void;
}

interface RoomDetailViewProps {
  room: LobbyRoom;
  currentPlayerId: string;
  roomManager: RoomController;
  customDifficulty: CustomDifficultySettings;
  onChangeCustomDifficulty: (settings: CustomDifficultySettings) => void;
  onLeaveRoom: () => void;
  onStartGame: () => void;
  onRefreshRoom: () => void;
}

const CLASS_META: Record<ClassId, { label: string; color: string }> = {
  DK: { label: '死亡骑士', color: '#C41F3B' },
  DRUID: { label: '德鲁伊', color: '#FF7D0A' },
  SHAMAN: { label: '萨满祭司', color: '#0070DE' },
  MAGE: { label: '法师', color: '#69CCF0' },
  ROGUE: { label: '潜行者', color: '#FFF569' },
  WARRIOR: { label: '战士', color: '#C79C6E' },
  PALADIN: { label: '圣骑士', color: '#F58CBA' },
  HUNTER: { label: '猎人', color: '#ABD473' },
  PRIEST: { label: '牧师', color: '#FFFFFF' },
  WARLOCK: { label: '术士', color: '#9482C9' },
};

function getSpecLabel(classId: ClassId, specId: string): string {
  const found = CLASS_SPECS_MAP[classId]?.find(s => s.id.toUpperCase() === (specId || '').toUpperCase());
  return found ? found.name : specId;
}

function formatCoeff(v: number): string {
  return (Number.isFinite(v) ? v : 1).toFixed(2);
}

export const RoomDetailView: React.FC<RoomDetailViewProps> = ({
  room,
  currentPlayerId,
  roomManager,
  customDifficulty,
  onChangeCustomDifficulty,
  onLeaveRoom,
  onStartGame,
}) => {
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [showCustomConfigModal, setShowCustomConfigModal] = useState(false);

  const quota = DUNGEON_ROLE_QUOTAS[room.dungeonId] || DUNGEON_ROLE_QUOTAS.shadowfang_keep;
  const isHost = room.hostId === currentPlayerId;
  const currentMember = room.members.find(m => m.id === currentPlayerId);
  const editingMember = editingMemberId
    ? room.members.find(m => m.id === editingMemberId) || null
    : null;

  const activeCustom = room.customDifficulty || customDifficulty || DEFAULT_CUSTOM_DIFFICULTY;

  // Validation
  const startValidation = roomManager.validateStartGame(room.id);
  const mapSwitchToSFK = roomManager.validateMapSwitch(room.id, 'shadowfang_keep');
  const mapSwitchToDS = roomManager.validateMapSwitch(room.id, 'dragon_soul');

  // Counts (always derived live from room.members)
  const tanks = room.members.filter(m => m.role === 'TANK').length;
  const healers = room.members.filter(m => m.role === 'HEALER').length;
  const dps = room.members.filter(m => m.role === 'DPS').length;
  const humanCount = room.members.filter(m => m.isPlayer && !m.isAi).length;
  const aiCount = room.members.filter(m => m.isAi).length;
  const isRaid = quota.tier === '20man';

  const handleQuickFillAi = () => {
    roomManager.autoFillAi(room.id);
  };

  const handleAddSingleAi = () => {
    if (!isHost) return;
    roomManager.addAiMember(room.id);
  };

  const handleKick = (memberId: string) => {
    roomManager.kickMember(room.id, memberId);
  };

  const handleToggleReady = () => {
    if (!currentMember) return;
    // Server applies SET_READY then ROOM_UPDATE; UI waits for that sync
    roomManager.setPlayerReady(room.id, currentPlayerId, !currentMember.isReady);
  };

  const handleSwitchMap = (targetDungeonId: string) => {
    // Host SWITCH_MAP → server → ROOM_UPDATE to all members
    roomManager.switchMap(room.id, targetDungeonId);
  };

  const handleSwitchDifficulty = (diff: DungeonDifficulty) => {
    if (!isHost) return;
    roomManager.setRoomDifficulty(room.id, diff, diff === 'CUSTOM' ? activeCustom : undefined);
    if (diff === 'CUSTOM') setShowCustomConfigModal(true);
    else setShowCustomConfigModal(false);
  };

  const handleUpdateCustomSettings = (next: CustomDifficultySettings) => {
    // Persist prefs locally; authoritative room state comes back via ROOM_UPDATE
    onChangeCustomDifficulty(next);
    roomManager.setRoomDifficulty(room.id, 'CUSTOM', next);
  };

  const updateCoeff = (key: keyof CustomDifficultySettings, val: number) => {
    const clamped = Math.max(0.01, Math.min(20.0, Number.isFinite(val) ? val : 1.0));
    handleUpdateCustomSettings({
      ...activeCustom,
      [key]: Math.round(clamped * 100) / 100,
    });
  };

  const handleSelectSpec = (classId: ClassId, specId: string) => {
    if (!editingMember) return;
    // Server CHANGE_SPEC → ROOM_UPDATE; start-game validation enforces quotas
    roomManager.changeMemberSpec(room.id, editingMember.id, classId, specId, { allowOverQuota: true });
    setEditingMemberId(null);
  };

  const diffLabel =
    room.difficulty === 'HEROIC'
      ? '英雄模式'
      : room.difficulty === 'CUSTOM'
      ? '自定义模式'
      : '普通模式';
  const diffColor =
    room.difficulty === 'HEROIC'
      ? 'text-red-400'
      : room.difficulty === 'CUSTOM'
      ? 'text-violet-400'
      : 'text-sky-400';

  return (
    <div className="flex flex-col h-full min-h-0 w-full bg-slate-950 text-slate-100 select-none overflow-hidden">
      {/* Room Header */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3 bg-gradient-to-r from-slate-900 via-amber-950/40 to-slate-900 border-b border-amber-500/30 shadow-lg">
        <div className="flex items-center space-x-4">
          <button
            onClick={onLeaveRoom}
            className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs transition"
          >
            ← 退出房间
          </button>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-base font-bold text-amber-300">{room.name}</h1>
              <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                ID: {room.id}
              </span>
            </div>
            <div className="text-xs text-slate-400 flex items-center space-x-3 mt-0.5">
              <span>
                副本:{' '}
                <strong className="text-amber-200">
                  {quota.dungeonName} ({quota.tier === '5man' ? '5人' : '20人'})
                </strong>
              </span>
              <span>
                难度: <strong className={diffColor}>{diffLabel}</strong>
              </span>
              <span>
                房主:{' '}
                <strong className="text-amber-300">
                  {room.members.find(m => m.isHost)?.name || '未知'}
                </strong>
              </span>
            </div>
          </div>
        </div>

        {/* Host Controls: Map Switcher & Difficulty Switcher */}
        {isHost && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Map Switcher */}
            <div className="flex items-center space-x-1.5 bg-slate-900/90 px-3 py-1.5 rounded-lg border border-slate-800">
              <span className="text-xs text-slate-400 font-semibold">地图:</span>
              <div className="relative group">
                <button
                  disabled={room.dungeonId === 'shadowfang_keep' || !mapSwitchToSFK.canSwitch}
                  onClick={() => handleSwitchMap('shadowfang_keep')}
                  className={`px-2.5 py-1 rounded text-xs transition font-semibold ${
                    room.dungeonId === 'shadowfang_keep'
                      ? 'bg-amber-600 text-white font-bold'
                      : mapSwitchToSFK.canSwitch
                      ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      : 'bg-slate-900 text-slate-600 border border-red-900/40 cursor-not-allowed opacity-60'
                  }`}
                >
                  影牙城堡 (5人)
                </button>
                {!mapSwitchToSFK.canSwitch && room.dungeonId !== 'shadowfang_keep' && (
                  <div className="absolute left-0 top-full mt-1 z-30 hidden group-hover:block bg-slate-900 text-red-400 text-[11px] p-2 rounded shadow-xl border border-red-500/40 w-48 whitespace-normal">
                    <div className="font-bold mb-1">无法切换地图：</div>
                    {mapSwitchToSFK.errors.map((err, i) => (
                      <div key={i}>• {err}</div>
                    ))}
                  </div>
                )}
              </div>

              <div className="relative group">
                <button
                  disabled={room.dungeonId === 'dragon_soul' || !mapSwitchToDS.canSwitch}
                  onClick={() => handleSwitchMap('dragon_soul')}
                  className={`px-2.5 py-1 rounded text-xs transition font-semibold ${
                    room.dungeonId === 'dragon_soul'
                      ? 'bg-amber-600 text-white font-bold'
                      : mapSwitchToDS.canSwitch
                      ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      : 'bg-slate-900 text-slate-600 border border-red-900/40 cursor-not-allowed opacity-60'
                  }`}
                >
                  巨龙之魂 (20人)
                </button>
                {!mapSwitchToDS.canSwitch && room.dungeonId !== 'dragon_soul' && (
                  <div className="absolute left-0 top-full mt-1 z-30 hidden group-hover:block bg-slate-900 text-red-400 text-[11px] p-2 rounded shadow-xl border border-red-500/40 w-48 whitespace-normal">
                    <div className="font-bold mb-1">无法切换地图：</div>
                    {mapSwitchToDS.errors.map((err, i) => (
                      <div key={i}>• {err}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Difficulty Switcher (Normal / Heroic / Custom) */}
            <div className="flex items-center space-x-1.5 bg-slate-900/90 px-3 py-1.5 rounded-lg border border-slate-800">
              <span className="text-xs text-slate-400 font-semibold">难度:</span>
              <button
                onClick={() => handleSwitchDifficulty('NORMAL')}
                className={`px-2.5 py-1 rounded text-xs transition font-semibold ${
                  room.difficulty === 'NORMAL'
                    ? 'bg-sky-600 text-white font-bold'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                普通
              </button>
              <button
                onClick={() => handleSwitchDifficulty('HEROIC')}
                className={`px-2.5 py-1 rounded text-xs transition font-semibold ${
                  room.difficulty === 'HEROIC'
                    ? 'bg-red-600 text-white font-bold'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                英雄
              </button>
              <button
                onClick={() => handleSwitchDifficulty('CUSTOM')}
                className={`px-2.5 py-1 rounded text-xs transition font-semibold ${
                  room.difficulty === 'CUSTOM'
                    ? 'bg-violet-600 text-white font-bold'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                ⚙️ 自定义
              </button>
              {room.difficulty === 'CUSTOM' && (
                <button
                  onClick={() => setShowCustomConfigModal(true)}
                  className="px-2 py-1 rounded text-[11px] bg-violet-950/70 hover:bg-violet-900/80 text-violet-200 border border-violet-500/40 transition"
                >
                  设置参数
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Main Grid View */}
      <div className="flex-1 min-h-0 p-3 sm:p-4 w-full flex flex-col gap-3 overflow-y-auto overscroll-contain">
        {/* Roster Summary Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/80 p-3 rounded-lg border border-slate-800 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-slate-400">
              队伍容量:{' '}
              <strong className="text-amber-300 font-mono" title="总数/上限 (AI数)">
                {room.members.length}/{quota.capacity} ({aiCount})
              </strong>
              <span className="ml-2 text-slate-500">玩家{humanCount}</span>
            </span>
            <div className="flex items-center space-x-2">
              <span
                className={`px-2 py-0.5 rounded border ${
                  tanks >= quota.roles.TANK.min && tanks <= quota.roles.TANK.max
                    ? 'bg-blue-950/60 border-blue-600/40 text-blue-300'
                    : 'bg-rose-950/60 border-rose-500/60 text-rose-300'
                }`}
              >
                🛡️ 坦克: {tanks} / {quota.roles.TANK.min === quota.roles.TANK.max ? quota.roles.TANK.max : `${quota.roles.TANK.min}-${quota.roles.TANK.max}`}
              </span>
              <span
                className={`px-2 py-0.5 rounded border ${
                  healers >= quota.roles.HEALER.min && healers <= quota.roles.HEALER.max
                    ? 'bg-emerald-950/60 border-emerald-600/40 text-emerald-300'
                    : 'bg-rose-950/60 border-rose-500/60 text-rose-300'
                }`}
              >
                💚 治疗: {healers} / {quota.roles.HEALER.min === quota.roles.HEALER.max ? quota.roles.HEALER.max : `${quota.roles.HEALER.min}-${quota.roles.HEALER.max}`}
              </span>
              <span
                className={`px-2 py-0.5 rounded border ${
                  dps >= quota.roles.DPS.min && dps <= quota.roles.DPS.max
                    ? 'bg-amber-950/60 border-amber-600/40 text-amber-300'
                    : 'bg-rose-950/60 border-rose-500/60 text-rose-300'
                }`}
              >
                ⚔️ 输出: {dps} / {quota.roles.DPS.min === quota.roles.DPS.max ? quota.roles.DPS.max : `${quota.roles.DPS.min}-${quota.roles.DPS.max}`}
              </span>
            </div>
          </div>

          {/* AI One-Click Fill Button (Host only) */}
          {isHost && (
            <button
              onClick={handleQuickFillAi}
              className="px-4 py-1.5 rounded font-bold text-xs bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-slate-950 shadow transition flex items-center space-x-1"
            >
              <span>🤖 AI补齐</span>
            </button>
          )}
        </div>

        {/* Slot Grid — 20-man uses denser cards so 20 slots fit without large empty gaps */}
        <div
          className={`grid ${
            isRaid
              ? 'gap-1.5 grid-cols-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-10'
              : 'gap-3 grid-cols-1 md:grid-cols-5'
          }`}
        >
          {room.slots.map(slot => {
            const member = slot.member;
            const isSelf = member?.id === currentPlayerId;

            if (!member || !slot.occupied) {
              return (
                <div
                  key={slot.index}
                  onClick={isHost ? handleAddSingleAi : undefined}
                  className={`bg-slate-900/40 border border-dashed border-slate-800 flex flex-col items-center justify-center text-center transition ${
                    isRaid
                      ? 'rounded-md px-1.5 py-2 min-h-[72px]'
                      : 'rounded-lg p-4 min-h-[140px]'
                  } ${isHost ? 'hover:border-amber-500/50 hover:bg-slate-900/70 cursor-pointer' : ''}`}
                >
                  <span className={`${isRaid ? 'text-base' : 'text-2xl mb-1'} text-slate-600`}>＋</span>
                  <div className={`${isRaid ? 'text-[10px]' : 'text-xs'} font-semibold text-slate-500`}>
                    空槽位
                  </div>
                  {!isRaid && (
                    <div className="text-[10px] text-slate-600 mt-1">
                      # 槽位 {slot.index + 1}
                      {isHost ? ' · 点击添加 AI' : ''}
                    </div>
                  )}
                </div>
              );
            }

            // Always derive displayed role, class name, spec name & color from live member data
            const memberRoleBadge =
              member.role === 'TANK' ? '🛡️' : member.role === 'HEALER' ? '💚' : '⚔️';
            const memberRoleName =
              member.role === 'TANK' ? '坦克' : member.role === 'HEALER' ? '治疗' : '输出';
            const classMeta = CLASS_META[member.classId] || { label: member.classId, color: '#e2e8f0' };
            const specLabel = getSpecLabel(member.classId, member.spec);

            return (
              <div
                key={slot.index}
                className={`relative border transition flex flex-col ${
                  isRaid
                    ? 'rounded-md px-2 py-1.5 gap-1 min-h-0'
                    : 'rounded-lg p-4 justify-between min-h-[140px]'
                } ${
                  member.isHost
                    ? 'bg-amber-950/20 border-amber-500/50 shadow-md'
                    : isSelf
                    ? 'bg-sky-950/20 border-sky-500/50'
                    : 'bg-slate-900/90 border-slate-800'
                }`}
              >
                {/* Slot Top Bar */}
                <div className={`flex items-center justify-between ${isRaid ? 'gap-1' : 'mb-2'}`}>
                  <div className="flex items-center space-x-1 min-w-0">
                    <span className={isRaid ? 'text-xs' : 'text-sm'}>{memberRoleBadge}</span>
                    <span className={`${isRaid ? 'text-[9px]' : 'text-[11px]'} font-bold text-slate-300 truncate`}>
                      {memberRoleName}
                    </span>
                  </div>
                  <div className="flex items-center space-x-0.5 flex-shrink-0">
                    {member.isHost && (
                      <span className={`rounded font-bold bg-amber-500 text-slate-950 ${isRaid ? 'px-1 py-0 text-[8px]' : 'px-1.5 py-0.5 text-[10px]'}`}>
                        房主
                      </span>
                    )}
                    {member.isAi ? (
                      <span className={`rounded bg-slate-800 text-slate-400 border border-slate-700 ${isRaid ? 'px-1 py-0 text-[8px]' : 'px-1.5 py-0.5 text-[10px]'}`}>
                        AI
                      </span>
                    ) : (
                      <span className={`rounded bg-sky-900/70 text-sky-300 border border-sky-700 ${isRaid ? 'px-1 py-0 text-[8px]' : 'px-1.5 py-0.5 text-[10px]'}`}>
                        玩家
                      </span>
                    )}
                  </div>
                </div>

                {/* Member Info */}
                <div className="min-w-0">
                  <div
                    className={`${isRaid ? 'text-[11px] leading-tight' : 'text-sm'} font-bold truncate`}
                    style={{ color: classMeta.color }}
                  >
                    {member.name}
                  </div>
                  <div className={`${isRaid ? 'text-[9px]' : 'text-[11px] mt-0.5'} text-slate-400 truncate`}>
                    {classMeta.label} · {specLabel}
                  </div>
                </div>

                {/* Ready Badge & Actions */}
                <div
                  className={`flex items-center justify-between gap-1 ${
                    isRaid ? 'pt-1 border-t border-slate-800/60' : 'mt-3 pt-2 border-t border-slate-800/80'
                  }`}
                >
                  <span
                    className={`inline-flex items-center font-bold rounded ${
                      isRaid ? 'text-[8px] px-1 py-0' : 'text-[10px] px-2 py-0.5'
                    } ${
                      member.isReady
                        ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/50'
                        : 'bg-rose-950/80 text-rose-300 border border-rose-700/50 animate-pulse'
                    }`}
                  >
                    {member.isReady ? (isRaid ? '✓' : '✓ 已准备') : isRaid ? '…' : '✕ 未准备'}
                  </span>

                  <div className="flex items-center space-x-0.5">
                    {(isHost || isSelf) && (
                      <button
                        onClick={() => setEditingMemberId(member.id)}
                        className={`rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition ${
                          isRaid ? 'px-1 py-0 text-[8px]' : 'px-2 py-0.5 text-[10px]'
                        }`}
                      >
                        专精
                      </button>
                    )}

                    {isHost && member.isAi && (
                      <button
                        onClick={() => handleKick(member.id)}
                        className={`rounded bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/60 transition ${
                          isRaid ? 'px-1 py-0 text-[8px]' : 'px-2 py-0.5 text-[10px]'
                        }`}
                      >
                        踢出
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom Control & Start Game Panel — ready / start share same size & right slot */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4 mt-auto">
          <div className="flex items-center space-x-3 min-w-0">
            {!startValidation.canStart ? (
              <div className="flex items-center space-x-2 text-xs text-amber-400/90 bg-amber-950/30 px-3 py-2 rounded border border-amber-900/50">
                <span>⚠️ 阻碍开局:</span>
                <span className="font-semibold">{startValidation.reasons.join('；')}</span>
              </div>
            ) : (
              <div className="flex items-center space-x-2 text-xs text-emerald-300 bg-emerald-950/30 px-3 py-2 rounded border border-emerald-800/50">
                <span>✅ 队伍分工与准备校验通过，可以开局！</span>
              </div>
            )}
          </div>

          {isHost ? (
            <div className="relative group">
              <button
                disabled={!startValidation.canStart}
                onClick={onStartGame}
                className={`w-44 px-4 py-3 rounded-lg font-black text-sm tracking-widest shadow-xl transition flex items-center justify-center gap-2 ${
                  startValidation.canStart
                    ? 'bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500 text-slate-950 hover:brightness-110 animate-pulse'
                    : 'bg-slate-800 text-slate-600 border border-slate-700 cursor-not-allowed opacity-60'
                }`}
              >
                <span>⚔️</span>
                <span>开始游戏</span>
              </button>
              {!startValidation.canStart && (
                <div className="absolute right-0 bottom-full mb-2 hidden group-hover:block bg-slate-900 text-amber-300 text-[11px] p-2 rounded shadow-2xl border border-amber-500/40 w-64">
                  <div className="font-bold mb-1">当前不可开局原因：</div>
                  {startValidation.reasons.map((r, i) => (
                    <div key={i}>• {r}</div>
                  ))}
                </div>
              )}
            </div>
          ) : currentMember ? (
            <button
              onClick={handleToggleReady}
              className={`w-44 px-4 py-3 rounded-lg font-black text-sm tracking-widest shadow-xl transition flex items-center justify-center gap-2 ${
                currentMember.isReady
                  ? 'bg-gradient-to-r from-rose-600 via-rose-500 to-rose-600 text-white hover:brightness-110'
                  : 'bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-500 text-slate-950 hover:brightness-110 animate-pulse'
              }`}
            >
              <span>{currentMember.isReady ? '取消准备' : '准备就绪'}</span>
            </button>
          ) : (
            <div className="text-xs text-slate-400">等待房主开启副本战斗...</div>
          )}
        </div>
      </div>

      {/* Spec Adjuster Modal (Free Role Rearrangement; Start Check Validates Final Roster) */}
      {editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-amber-500/40 rounded-xl shadow-2xl max-w-lg w-full p-6 text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <h2 className="text-sm font-bold text-amber-300">
                修改成员职业/专精 — {editingMember.name} ({CLASS_META[editingMember.classId]?.label || editingMember.classId})
              </h2>
              <button
                onClick={() => setEditingMemberId(null)}
                className="text-slate-400 hover:text-slate-200 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400 mb-4">
              {editingMember.isAi
                ? '可自由切换任意职业与专精，AI 名称将自动同步为对应职业英雄；开始游戏前将统一校验队伍分工。'
                : '可自由切换当前职业专精；开始游戏前将统一校验队伍分工。'}
            </p>

            {/* Spec Options List */}
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
              {(Object.keys(CLASS_SPECS_MAP) as ClassId[])
                .filter(cid => (editingMember.isAi ? true : cid === editingMember.classId))
                .map(cid => {
                  const meta = CLASS_META[cid] || { label: cid, color: '#e2e8f0' };
                  return (
                    <div key={cid} className="space-y-1.5">
                      <div
                        className="text-xs font-bold flex items-center space-x-1.5"
                        style={{ color: meta.color }}
                      >
                        <span>{meta.label}</span>
                        <span className="text-[10px] text-slate-500 font-mono">({cid})</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {CLASS_SPECS_MAP[cid].map(s => {
                          const quotaHint = roomManager.canSelectSpec(
                            room.id,
                            editingMember.id,
                            s.id,
                            cid
                          );
                          const isCurrent =
                            editingMember.classId === cid &&
                            editingMember.spec.toUpperCase() === s.id.toUpperCase();
                          const roleBadge =
                            s.role === 'TANK' ? '🛡️' : s.role === 'HEALER' ? '💚' : '⚔️';

                          return (
                            <button
                              key={s.id}
                              onClick={() => handleSelectSpec(cid, s.id)}
                              className={`p-2.5 rounded-lg border text-left transition flex flex-col justify-between ${
                                isCurrent
                                  ? 'border-amber-500 bg-amber-950/40 text-amber-300 font-bold'
                                  : 'border-slate-800 bg-slate-950 text-slate-200 hover:border-amber-500/50 hover:bg-slate-800/60'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-[11px] font-bold">{s.name}</span>
                                <span className="text-xs">{roleBadge}</span>
                              </div>
                              {!quotaHint.allowed && !isCurrent && (
                                <span className="text-[9px] text-amber-400/80 mt-1">
                                  ⚠️ 将暂时超编
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </div>

            <div className="pt-4 border-t border-slate-800 flex justify-end mt-4">
              <button
                onClick={() => setEditingMemberId(null)}
                className="px-4 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Difficulty Settings Modal — overlay so room layout isn't squeezed */}
      {showCustomConfigModal && room.difficulty === 'CUSTOM' && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={() => setShowCustomConfigModal(false)}
        >
          <div
            className="bg-[#111124] border border-violet-500/50 rounded-xl shadow-2xl w-full max-w-3xl max-h-[88vh] overflow-y-auto p-4 space-y-3"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-violet-500/30">
              <div className="flex items-center space-x-2">
                <span className="text-violet-300 font-extrabold text-sm">
                  ⚙️ 自定义难度系数 (0.01x ~ 20.0x)
                </span>
                <span className="text-[10px] text-slate-400 font-mono">(开局立即生效)</span>
              </div>
              <button
                type="button"
                onClick={() => setShowCustomConfigModal(false)}
                className="text-slate-400 hover:text-white text-lg font-bold px-2 leading-none"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>

            {isHost && (
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    handleUpdateCustomSettings({
                      playerDamageCoeff: 2.0,
                      playerHealingCoeff: 2.0,
                      playerHpCoeff: 1.5,
                      playerMpCoeff: 1.5,
                      aiDamageCoeff: 1.5,
                      aiHealingCoeff: 1.5,
                      aiHpCoeff: 1.2,
                      aiMpCoeff: 1.2,
                      enemyDamageCoeff: 0.6,
                      bossHpCoeff: 0.7,
                    })
                  }
                  className="text-[10px] bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded hover:bg-emerald-900/90 font-bold transition"
                >
                  爽快割草
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleUpdateCustomSettings({
                      playerDamageCoeff: 0.8,
                      playerHealingCoeff: 0.8,
                      playerHpCoeff: 0.8,
                      playerMpCoeff: 0.8,
                      aiDamageCoeff: 0.8,
                      aiHealingCoeff: 0.8,
                      aiHpCoeff: 0.8,
                      aiMpCoeff: 0.8,
                      enemyDamageCoeff: 2.0,
                      bossHpCoeff: 2.5,
                    })
                  }
                  className="text-[10px] bg-red-950/80 text-red-300 border border-red-500/40 px-2 py-0.5 rounded hover:bg-red-900/90 font-bold transition"
                >
                  地狱挑战
                </button>
                <button
                  type="button"
                  onClick={() => handleUpdateCustomSettings({ ...DEFAULT_CUSTOM_DIFFICULTY })}
                  className="text-[10px] bg-slate-800 text-slate-300 border border-slate-600 px-2 py-0.5 rounded hover:bg-slate-700 font-bold transition"
                >
                  重置 1.0x
                </button>
              </div>
            )}

            {!isHost && (
              <p className="text-[11px] text-slate-400">仅房主可修改参数，当前为只读预览。</p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-[#181832] p-3 rounded-lg border border-blue-500/30 space-y-2">
                <div className="text-blue-300 text-[11px] font-bold pb-1 border-b border-blue-500/20">
                  👤 玩家参数
                </div>
                {(
                  [
                    ['playerDamageCoeff', '攻击系数', 'text-blue-300', 'accent-blue-400'],
                    ['playerHealingCoeff', '治疗系数', 'text-green-300', 'accent-green-400'],
                    ['playerHpCoeff', '血量系数', 'text-emerald-300', 'accent-emerald-400'],
                    ['playerMpCoeff', '蓝量系数', 'text-cyan-300', 'accent-cyan-400'],
                  ] as const
                ).map(([key, label, textCls, accentCls]) => (
                  <div key={key} className="space-y-0.5">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-slate-300">{label}:</span>
                      <span className={`${textCls} font-mono font-bold`}>{formatCoeff(activeCustom[key])}x</span>
                    </div>
                    <input
                      type="range"
                      min="0.01"
                      max="20.0"
                      step="0.01"
                      disabled={!isHost}
                      value={activeCustom[key]}
                      onChange={e => updateCoeff(key, parseFloat(e.target.value))}
                      className={`w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer ${accentCls}`}
                    />
                  </div>
                ))}
              </div>

              <div className="bg-[#181832] p-3 rounded-lg border border-purple-500/30 space-y-2">
                <div className="text-purple-300 text-[11px] font-bold pb-1 border-b border-purple-500/20">
                  🤖 友方 AI 参数
                </div>
                {(
                  [
                    ['aiDamageCoeff', '攻击系数', 'text-purple-300', 'accent-purple-400'],
                    ['aiHealingCoeff', '治疗系数', 'text-green-300', 'accent-green-400'],
                    ['aiHpCoeff', '血量系数', 'text-emerald-300', 'accent-emerald-400'],
                    ['aiMpCoeff', '蓝量系数', 'text-cyan-300', 'accent-cyan-400'],
                  ] as const
                ).map(([key, label, textCls, accentCls]) => (
                  <div key={key} className="space-y-0.5">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-slate-300">{label}:</span>
                      <span className={`${textCls} font-mono font-bold`}>{formatCoeff(activeCustom[key])}x</span>
                    </div>
                    <input
                      type="range"
                      min="0.01"
                      max="20.0"
                      step="0.01"
                      disabled={!isHost}
                      value={activeCustom[key]}
                      onChange={e => updateCoeff(key, parseFloat(e.target.value))}
                      className={`w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer ${accentCls}`}
                    />
                  </div>
                ))}
              </div>

              <div className="bg-[#181832] p-3 rounded-lg border border-red-500/30 space-y-2">
                <div className="text-red-300 text-[11px] font-bold pb-1 border-b border-red-500/20">
                  💀 敌方与首领
                </div>
                {(
                  [
                    ['enemyDamageCoeff', '敌方攻击系数', 'text-red-300', 'accent-red-400'],
                    ['bossHpCoeff', 'BOSS血量系数', 'text-amber-300', 'accent-amber-400'],
                  ] as const
                ).map(([key, label, textCls, accentCls]) => (
                  <div key={key} className="space-y-0.5">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-slate-300">{label}:</span>
                      <span className={`${textCls} font-mono font-bold`}>{formatCoeff(activeCustom[key])}x</span>
                    </div>
                    <input
                      type="range"
                      min="0.01"
                      max="20.0"
                      step="0.01"
                      disabled={!isHost}
                      value={activeCustom[key]}
                      onChange={e => updateCoeff(key, parseFloat(e.target.value))}
                      className={`w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer ${accentCls}`}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-3 border-t border-violet-500/30 flex justify-end">
              <button
                type="button"
                onClick={() => setShowCustomConfigModal(false)}
                className="px-5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
