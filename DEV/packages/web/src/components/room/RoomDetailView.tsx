import React, { useState } from 'react';
import type { ClassId, DungeonDifficulty } from '@cata-raid-sim/engine';
import {
  type LobbyRoom,
  type RoomMember,
  CLASS_SPECS_MAP,
  DUNGEON_ROLE_QUOTAS,
  RoomManager,
} from '@cata-raid-sim/engine';

interface RoomDetailViewProps {
  room: LobbyRoom;
  currentPlayerId: string;
  roomManager: RoomManager;
  onLeaveRoom: () => void;
  onStartGame: () => void;
  onRefreshRoom: () => void;
}

export const RoomDetailView: React.FC<RoomDetailViewProps> = ({
  room,
  currentPlayerId,
  roomManager,
  onLeaveRoom,
  onStartGame,
  onRefreshRoom,
}) => {
  const [editingMember, setEditingMember] = useState<RoomMember | null>(null);

  const quota = DUNGEON_ROLE_QUOTAS[room.dungeonId] || DUNGEON_ROLE_QUOTAS.shadowfang_keep;
  const isHost = room.hostId === currentPlayerId;
  const currentMember = room.members.find(m => m.id === currentPlayerId);

  // Validation
  const startValidation = roomManager.validateStartGame(room.id);
  const mapSwitchToSFK = roomManager.validateMapSwitch(room.id, 'shadowfang_keep');
  const mapSwitchToDS = roomManager.validateMapSwitch(room.id, 'dragon_soul');

  // Counts
  const tanks = room.members.filter(m => m.role === 'TANK').length;
  const healers = room.members.filter(m => m.role === 'HEALER').length;
  const dps = room.members.filter(m => m.role === 'DPS').length;

  const handleQuickFillAi = () => {
    roomManager.autoFillAi(room.id);
    onRefreshRoom();
  };

  const handleKick = (memberId: string) => {
    roomManager.kickMember(room.id, memberId);
    onRefreshRoom();
  };

  const handleToggleReady = () => {
    if (!currentMember) return;
    roomManager.setPlayerReady(room.id, currentPlayerId, !currentMember.isReady);
    onRefreshRoom();
  };

  const handleSwitchMap = (targetDungeonId: string) => {
    const success = roomManager.switchMap(room.id, targetDungeonId);
    if (success) {
      onRefreshRoom();
    }
  };

  const handleSelectSpec = (classId: ClassId, specId: string) => {
    if (!editingMember) return;
    const check = roomManager.canSelectSpec(room.id, editingMember.id, specId, classId);
    if (!check.allowed) return;

    roomManager.changeMemberSpec(room.id, editingMember.id, classId, specId);
    setEditingMember(null);
    onRefreshRoom();
  };

  return (
    <div className="flex flex-col h-full w-full bg-slate-950 text-slate-100 select-none overflow-y-auto">
      {/* Room Header */}
      <div className="flex flex-wrap items-center justify-between px-6 py-3 bg-gradient-to-r from-slate-900 via-amber-950/40 to-slate-900 border-b border-amber-500/30 shadow-lg">
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
              <span>副本: <strong className="text-amber-200">{quota.dungeonName} ({quota.tier === '5man' ? '5人' : '20人'})</strong></span>
              <span>难度: <strong className="text-red-400">{room.difficulty === 'HEROIC' ? '英雄模式' : '普通模式'}</strong></span>
              <span>房主: <strong className="text-amber-300">{room.members.find(m => m.isHost)?.name || '未知'}</strong></span>
            </div>
          </div>
        </div>

        {/* Map Switcher (Host only) */}
        {isHost && (
          <div className="flex items-center space-x-2 bg-slate-900/90 px-3 py-1.5 rounded-lg border border-slate-800">
            <span className="text-xs text-slate-400 font-semibold">切换地图:</span>
            <div className="relative group">
              <button
                disabled={room.dungeonId === 'shadowfang_keep' || !mapSwitchToSFK.canSwitch}
                onClick={() => handleSwitchMap('shadowfang_keep')}
                className={`px-3 py-1 rounded text-xs transition font-semibold ${
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
                className={`px-3 py-1 rounded text-xs transition font-semibold ${
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
        )}
      </div>

      {/* Main Grid View */}
      <div className="flex-1 p-6 max-w-7xl mx-auto w-full flex flex-col space-y-4">
        {/* Roster Summary Bar */}
        <div className="flex items-center justify-between bg-slate-900/80 p-3 rounded-lg border border-slate-800 text-xs">
          <div className="flex items-center space-x-4">
            <span className="text-slate-400">
              队伍容量: <strong className="text-amber-300 font-mono">{room.members.length} / {quota.capacity}</strong>
            </span>
            <div className="flex items-center space-x-3">
              <span className="px-2 py-0.5 rounded bg-blue-950/60 border border-blue-600/40 text-blue-300">
                🛡️ 坦克: {tanks} / {quota.roles.TANK.max}
              </span>
              <span className="px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-600/40 text-emerald-300">
                💚 治疗: {healers} / {quota.roles.HEALER.max}
              </span>
              <span className="px-2 py-0.5 rounded bg-amber-950/60 border border-amber-600/40 text-amber-300">
                ⚔️ 输出: {dps} / {quota.roles.DPS.max}
              </span>
            </div>
          </div>

          {/* AI One-Click Fill Button (Host only) */}
          {isHost && (
            <button
              onClick={handleQuickFillAi}
              className="px-4 py-1.5 rounded font-bold text-xs bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-slate-950 shadow transition flex items-center space-x-1"
            >
              <span>🤖 一键添加 AI 补齐槽位</span>
            </button>
          )}
        </div>

        {/* Slot Grid (5-man or 20-man) */}
        <div
          className={`grid gap-3 ${
            quota.tier === '5man' ? 'grid-cols-1 md:grid-cols-5' : 'grid-cols-2 md:grid-cols-4 lg:grid-cols-5'
          }`}
        >
          {room.slots.map(slot => {
            const member = slot.member;
            const roleBadge = slot.role === 'TANK' ? '🛡️' : slot.role === 'HEALER' ? '💚' : '⚔️';
            const roleName = slot.role === 'TANK' ? '坦克' : slot.role === 'HEALER' ? '治疗' : '输出';
            const isSelf = member?.id === currentPlayerId;

            if (!member || !slot.occupied) {
              return (
                <div
                  key={slot.index}
                  className="bg-slate-900/40 border border-dashed border-slate-800 rounded-lg p-4 flex flex-col items-center justify-center min-h-[140px] text-center"
                >
                  <span className="text-2xl mb-1 opacity-50">{roleBadge}</span>
                  <div className="text-xs font-semibold text-slate-500">空槽位 ({roleName})</div>
                  <div className="text-[10px] text-slate-600 mt-1"># 槽位 {slot.index + 1}</div>
                </div>
              );
            }

            return (
              <div
                key={slot.index}
                className={`relative rounded-lg p-4 border transition flex flex-col justify-between min-h-[140px] ${
                  member.isHost
                    ? 'bg-amber-950/20 border-amber-500/50 shadow-md'
                    : isSelf
                    ? 'bg-sky-950/20 border-sky-500/50'
                    : 'bg-slate-900/90 border-slate-800'
                }`}
              >
                {/* Slot Top Bar */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-1">
                    <span className="text-sm">{roleBadge}</span>
                    <span className="text-[11px] font-bold text-slate-400">{roleName}</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    {member.isHost && (
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500 text-slate-950">
                        房主
                      </span>
                    )}
                    {member.isAi ? (
                      <span className="px-1.5 py-0.2 rounded text-[10px] bg-slate-800 text-slate-400 border border-slate-700">
                        AI
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.2 rounded text-[10px] bg-sky-900/70 text-sky-300 border border-sky-700">
                        玩家
                      </span>
                    )}
                  </div>
                </div>

                {/* Member Info */}
                <div>
                  <div className="text-sm font-bold text-slate-200 truncate">{member.name}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {member.classId} · {member.spec}
                  </div>
                </div>

                {/* Ready Badge & Actions */}
                <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between">
                  <span
                    className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded ${
                      member.isReady
                        ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/50'
                        : 'bg-rose-950/80 text-rose-300 border border-rose-700/50 animate-pulse'
                    }`}
                  >
                    {member.isReady ? '✓ 已准备' : '✕ 未准备'}
                  </span>

                  <div className="flex items-center space-x-1">
                    {/* Spec Change Button (Host can edit AI or self can edit self) */}
                    {(isHost || isSelf) && (
                      <button
                        onClick={() => setEditingMember(member)}
                        className="px-2 py-0.5 rounded text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
                      >
                        专精
                      </button>
                    )}

                    {/* Kick AI Button (Host only) */}
                    {isHost && member.isAi && (
                      <button
                        onClick={() => handleKick(member.id)}
                        className="px-2 py-0.5 rounded text-[10px] bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/60 transition"
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

        {/* Bottom Control & Start Game Panel */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4 mt-auto">
          {/* Left: Player Ready Toggle */}
          <div className="flex items-center space-x-3">
            {!isHost && currentMember && (
              <button
                onClick={handleToggleReady}
                className={`px-5 py-2 rounded-lg font-bold text-xs shadow transition ${
                  currentMember.isReady
                    ? 'bg-rose-700 hover:bg-rose-600 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                {currentMember.isReady ? '取消准备' : '准备就绪'}
              </button>
            )}

            {/* Validation reasons notice */}
            {!startValidation.canStart && (
              <div className="flex items-center space-x-2 text-xs text-amber-400/90 bg-amber-950/30 px-3 py-2 rounded border border-amber-900/50">
                <span>⚠️ 阻碍开局:</span>
                <span className="font-semibold">{startValidation.reasons.join('；')}</span>
              </div>
            )}
          </div>

          {/* Right: Start Game Button (Host Only) */}
          {isHost ? (
            <div className="relative group">
              <button
                disabled={!startValidation.canStart}
                onClick={onStartGame}
                className={`px-8 py-3 rounded-lg font-black text-sm tracking-widest shadow-xl transition flex items-center space-x-2 ${
                  startValidation.canStart
                    ? 'bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500 text-slate-950 hover:brightness-110 animate-pulse'
                    : 'bg-slate-800 text-slate-600 border border-slate-700 cursor-not-allowed opacity-60'
                }`}
              >
                <span>⚔️</span>
                <span>开始游戏</span>
              </button>
              {!startValidation.canStart && (
                <div className="absolute right-0 bottom-full mb-2 hidden group-hover:block bg-slate-900 text-amber-300 text-[11px] p-2 rounded shadow-2xl border border-amber-500/40 w-56">
                  <div className="font-bold mb-1">当前不可开局原因：</div>
                  {startValidation.reasons.map((r, i) => (
                    <div key={i}>• {r}</div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-slate-400">
              等待房主开启副本战斗...
            </div>
          )}
        </div>
      </div>

      {/* Spec Adjuster Modal with Greying Out Logic */}
      {editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-amber-500/40 rounded-xl shadow-2xl max-w-lg w-full p-6 text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <h2 className="text-sm font-bold text-amber-300">
                修改成员专精 — {editingMember.name} ({editingMember.classId})
              </h2>
              <button
                onClick={() => setEditingMember(null)}
                className="text-slate-400 hover:text-slate-200 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400 mb-4">
              请选择要切换的专精。若目标专精对应角色分工超出当前副本上限，该选项将自动置灰禁用。
            </p>

            {/* Spec Options List */}
            <div className="space-y-4">
              {(Object.keys(CLASS_SPECS_MAP) as ClassId[])
                .filter(cid => (editingMember.isAi ? true : cid === editingMember.classId))
                .map(cid => (
                  <div key={cid} className="space-y-1.5">
                    <div className="text-[11px] font-bold text-slate-400">{cid} 职业专精:</div>
                    <div className="grid grid-cols-2 gap-2">
                      {CLASS_SPECS_MAP[cid].map(s => {
                        const check = roomManager.canSelectSpec(room.id, editingMember.id, s.id, cid);
                        const isCurrent = editingMember.classId === cid && editingMember.spec === s.id;
                        const roleBadge = s.role === 'TANK' ? '🛡️' : s.role === 'HEALER' ? '💚' : '⚔️';

                        return (
                          <button
                            key={s.id}
                            disabled={!check.allowed && !isCurrent}
                            onClick={() => handleSelectSpec(cid, s.id)}
                            className={`p-2.5 rounded-lg border text-left transition flex flex-col justify-between ${
                              isCurrent
                                ? 'border-amber-500 bg-amber-950/40 text-amber-300 font-bold'
                                : check.allowed
                                ? 'border-slate-800 bg-slate-950 text-slate-200 hover:border-slate-700 hover:bg-slate-800/40'
                                : 'border-slate-900 bg-slate-950/60 text-slate-600 cursor-not-allowed opacity-50'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold">{s.name}</span>
                              <span className="text-xs">{roleBadge}</span>
                            </div>
                            {!check.allowed && !isCurrent && (
                              <span className="text-[10px] text-red-400/80 mt-1">
                                {check.reason}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
            </div>

            <div className="pt-4 border-t border-slate-800 flex justify-end mt-4">
              <button
                onClick={() => setEditingMember(null)}
                className="px-4 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
