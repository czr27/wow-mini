import React, { useState } from 'react';
import type { ClassId, DungeonDifficulty } from '@cata-raid-sim/engine';
import { type LobbyRoom, DUNGEON_ROLE_QUOTAS, getRoleBySpec } from '@cata-raid-sim/engine';

interface RoomListViewProps {
  rooms: LobbyRoom[];
  player: {
    id: string;
    name: string;
    classId: ClassId;
    spec: string;
  };
  onCreateRoom: (name: string, dungeonId: string, difficulty: DungeonDifficulty) => void;
  onJoinRoom: (roomId: string) => void;
  onJoinWaitingQueue: (roomId: string) => void;
  onQuickJoin: () => void;
  onBackToCharacterSelect?: () => void;
}

export const RoomListView: React.FC<RoomListViewProps> = ({
  rooms,
  player,
  onCreateRoom,
  onJoinRoom,
  onJoinWaitingQueue,
  onQuickJoin,
  onBackToCharacterSelect,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMapFilter, setSelectedMapFilter] = useState<string>('ALL');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newRoomName, setNewRoomName] = useState(`${player.name}的队伍`);
  const [newDungeonId, setNewDungeonId] = useState<string>('shadowfang_keep');
  const [newDifficulty, setNewDifficulty] = useState<DungeonDifficulty>('HEROIC');

  const playerRole = getRoleBySpec(player.classId, player.spec);
  const roleBadge = playerRole === 'TANK' ? '🛡️ 坦克' : playerRole === 'HEALER' ? '💚 治疗' : '⚔️ 输出';

  // Filtered rooms
  const filteredRooms = rooms.filter(r => {
    const matchesSearch = r.name.toLowerCase().includes(searchTerm.toLowerCase()) || r.id.includes(searchTerm);
    const matchesMap = selectedMapFilter === 'ALL' || r.dungeonId === selectedMapFilter;
    return matchesSearch && matchesMap;
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomName.trim()) return;
    onCreateRoom(newRoomName.trim(), newDungeonId, newDifficulty);
    setShowCreateModal(false);
  };

  return (
    <div className="flex flex-col h-full w-full bg-slate-950 text-slate-100 select-none">
      {/* Top Room Header */}
      <div className="flex items-center justify-between px-6 py-3 bg-gradient-to-r from-slate-900 via-amber-950/40 to-slate-900 border-b border-amber-500/30 shadow-lg">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded bg-amber-500/20 border border-amber-500 flex items-center justify-center font-black text-amber-400 text-base">
            🏰
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-wider text-amber-300">
              副本大厅 · 组队房间列表
            </h1>
            <p className="text-xs text-slate-400">
              魔兽大灾变 4.3 战斗模拟专区 · 集合石组队
            </p>
          </div>
        </div>

        {/* Current Player Status Badge */}
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 bg-slate-900/80 px-3 py-1.5 rounded border border-slate-700 text-xs">
            <span className="text-slate-400">当前角色:</span>
            <span className="font-semibold text-amber-200">{player.name}</span>
            <span className="text-slate-500">({player.classId} - {player.spec})</span>
            <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 font-bold">
              {roleBadge}
            </span>
          </div>
          {onBackToCharacterSelect && (
            <button
              onClick={onBackToCharacterSelect}
              className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-600 text-xs transition"
            >
              返回角色选择
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col p-6 space-y-4 max-w-7xl mx-auto w-full overflow-hidden">
        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/90 p-3 rounded-lg border border-slate-800 shadow">
          {/* Left search & filter */}
          <div className="flex items-center space-x-3">
            <div className="relative">
              <input
                type="text"
                placeholder="搜索房间名或编号..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 w-56 focus:outline-none focus:border-amber-500"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1.5 text-slate-400 hover:text-slate-200 text-xs"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="flex items-center space-x-1 text-xs">
              <span className="text-slate-400 mr-1">地图筛选:</span>
              <button
                onClick={() => setSelectedMapFilter('ALL')}
                className={`px-2.5 py-1 rounded text-xs transition ${
                  selectedMapFilter === 'ALL'
                    ? 'bg-amber-600 text-white font-bold'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                全部
              </button>
              <button
                onClick={() => setSelectedMapFilter('shadowfang_keep')}
                className={`px-2.5 py-1 rounded text-xs transition ${
                  selectedMapFilter === 'shadowfang_keep'
                    ? 'bg-amber-600 text-white font-bold'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                影牙城堡 (5人)
              </button>
              <button
                onClick={() => setSelectedMapFilter('dragon_soul')}
                className={`px-2.5 py-1 rounded text-xs transition ${
                  selectedMapFilter === 'dragon_soul'
                    ? 'bg-amber-600 text-white font-bold'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                巨龙之魂 (20人)
              </button>
            </div>
          </div>

          {/* Right Action Buttons */}
          <div className="flex items-center space-x-3">
            <button
              onClick={onQuickJoin}
              className="px-4 py-2 rounded font-bold text-xs bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow transition flex items-center space-x-1"
            >
              <span>⚡ 快速加入</span>
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 rounded font-bold text-xs bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-slate-950 shadow transition flex items-center space-x-1"
            >
              <span>➕ 创建房间</span>
            </button>
          </div>
        </div>

        {/* Room Table */}
        <div className="flex-1 bg-slate-900/70 border border-slate-800 rounded-lg overflow-y-auto shadow-inner">
          {filteredRooms.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-500 space-y-2">
              <span className="text-4xl">🏰</span>
              <p className="text-sm">暂无匹配的房间，点击上方“创建房间”发起副本挑战！</p>
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 text-slate-400 sticky top-0 border-b border-slate-800 z-10">
                <tr>
                  <th className="py-2.5 px-4 w-20">房号</th>
                  <th className="py-2.5 px-4">房间名称</th>
                  <th className="py-2.5 px-4">副本地图</th>
                  <th className="py-2.5 px-4 w-28">难度</th>
                  <th className="py-2.5 px-4 w-40">人员分工状态</th>
                  <th className="py-2.5 px-4 w-28">房间状态</th>
                  <th className="py-2.5 px-4 w-32 text-center">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredRooms.map((room, idx) => {
                  const quota = DUNGEON_ROLE_QUOTAS[room.dungeonId] || DUNGEON_ROLE_QUOTAS.shadowfang_keep;
                  const tanks = room.members.filter(m => m.role === 'TANK').length;
                  const healers = room.members.filter(m => m.role === 'HEALER').length;
                  const dps = room.members.filter(m => m.role === 'DPS').length;
                  const isFull = room.members.length >= quota.capacity;
                  const isInCombat = room.status === 'IN_COMBAT';

                  return (
                    <tr
                      key={room.id}
                      className="hover:bg-slate-800/50 transition cursor-pointer"
                    >
                      <td className="py-3 px-4 font-mono font-bold text-amber-400">
                        #{String(idx + 1).padStart(2, '0')}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-200">{room.name}</div>
                        <div className="text-[10px] text-slate-500">ID: {room.id}</div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-800 text-slate-300 border border-slate-700">
                          {quota.dungeonName} ({quota.tier === '5man' ? '5人' : '20人'})
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`font-bold ${
                            room.difficulty === 'HEROIC'
                              ? 'text-red-400'
                              : room.difficulty === 'CUSTOM'
                              ? 'text-purple-400'
                              : 'text-sky-400'
                          }`}
                        >
                          {room.difficulty === 'HEROIC' ? '英雄模式' : room.difficulty === 'CUSTOM' ? '自定义' : '普通模式'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center space-x-2">
                          <span className={`font-mono font-bold ${isFull ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {room.members.length}/{quota.capacity}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            🛡️{tanks} 💚{healers} ⚔️{dps}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {isInCombat ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950/80 text-rose-300 border border-rose-700/50 animate-pulse">
                            ⚔️ 战斗进行中
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-700/50">
                            ⏳ 大厅等待中
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {isInCombat ? (
                          <button
                            onClick={() => onJoinWaitingQueue(room.id)}
                            className="px-3 py-1 rounded font-bold text-xs bg-rose-600 hover:bg-rose-500 text-white shadow transition"
                          >
                            等待加入
                          </button>
                        ) : (
                          <button
                            onClick={() => onJoinRoom(room.id)}
                            className="px-3 py-1 rounded font-bold text-xs bg-amber-500 hover:bg-amber-400 text-slate-950 shadow transition"
                          >
                            进入房间
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Create Room Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-amber-500/40 rounded-xl shadow-2xl max-w-md w-full p-6 text-slate-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <h2 className="text-base font-bold text-amber-300 flex items-center space-x-2">
                <span>➕</span>
                <span>创建全新副本房间</span>
              </h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">房间名称</label>
                <input
                  type="text"
                  required
                  value={newRoomName}
                  onChange={e => setNewRoomName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 text-xs"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">副本地图</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewDungeonId('shadowfang_keep')}
                    className={`p-3 rounded-lg border text-left transition ${
                      newDungeonId === 'shadowfang_keep'
                        ? 'border-amber-500 bg-amber-950/30 text-amber-300'
                        : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="font-bold text-xs">影牙城堡</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">5人小队 (1T 1H 3DPS)</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewDungeonId('dragon_soul')}
                    className={`p-3 rounded-lg border text-left transition ${
                      newDungeonId === 'dragon_soul'
                        ? 'border-amber-500 bg-amber-950/30 text-amber-300'
                        : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="font-bold text-xs">巨龙之魂</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">20人团本 (2T 4-5H 13-14DPS)</div>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">难度选择</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewDifficulty('HEROIC')}
                    className={`p-2 rounded border text-center transition ${
                      newDifficulty === 'HEROIC'
                        ? 'border-red-500 bg-red-950/30 text-red-300 font-bold'
                        : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    英雄难度 (Heroic)
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewDifficulty('NORMAL')}
                    className={`p-2 rounded border text-center transition ${
                      newDifficulty === 'NORMAL'
                        ? 'border-sky-500 bg-sky-950/30 text-sky-300 font-bold'
                        : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    普通难度 (Normal)
                  </button>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs transition shadow"
                >
                  确定创建
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
