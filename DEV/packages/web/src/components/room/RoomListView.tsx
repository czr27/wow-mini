import React, { useState } from 'react';
import { getSfxVolume, setSfxVolume } from '../../utils/combatSfx.js';
import type {
  ClassId,
  DungeonDifficulty,
  CustomDifficultySettings,
} from '@cata-raid-sim/engine';
import {
  type LobbyRoom,
  DUNGEON_ROLE_QUOTAS,
  SELECTABLE_DUNGEONS,
  DEFAULT_CUSTOM_DIFFICULTY,
  getRoleBySpec,
  hasJoinableSeat,
} from '@cata-raid-sim/engine';
import { DismissibleModal } from '../DismissibleModal.js';
import { DungeonPicker } from './DungeonPicker.js';

const LAST_CREATE_ROOM_KEY = 'cata_last_create_room';

type LastCreateRoomPrefs = {
  dungeonId: string;
  difficulty: DungeonDifficulty;
};

function loadLastCreateRoomPrefs(): LastCreateRoomPrefs {
  try {
    const raw = localStorage.getItem(LAST_CREATE_ROOM_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LastCreateRoomPrefs>;
      const dungeonId =
        typeof parsed.dungeonId === 'string' &&
        SELECTABLE_DUNGEONS.some((d) => d.id === parsed.dungeonId)
          ? parsed.dungeonId
          : 'shadowfang_keep';
      const difficulty: DungeonDifficulty =
        parsed.difficulty === 'NORMAL' ||
        parsed.difficulty === 'HEROIC' ||
        parsed.difficulty === 'CUSTOM'
          ? parsed.difficulty
          : 'NORMAL';
      return { dungeonId, difficulty };
    }
  } catch {}
  // Fallback: reuse adventure-level dungeon prefs if present
  try {
    const savedDungeon = localStorage.getItem('cata_dungeon_id');
    const savedDiff = localStorage.getItem('cata_dungeon_difficulty');
    const dungeonId =
      savedDungeon && SELECTABLE_DUNGEONS.some((d) => d.id === savedDungeon)
        ? savedDungeon
        : 'shadowfang_keep';
    const difficulty: DungeonDifficulty =
      savedDiff === 'NORMAL' || savedDiff === 'HEROIC' || savedDiff === 'CUSTOM'
        ? savedDiff
        : 'NORMAL';
    return { dungeonId, difficulty };
  } catch {}
  return { dungeonId: 'shadowfang_keep', difficulty: 'NORMAL' };
}

function saveLastCreateRoomPrefs(prefs: LastCreateRoomPrefs) {
  try {
    localStorage.setItem(LAST_CREATE_ROOM_KEY, JSON.stringify(prefs));
    localStorage.setItem('cata_dungeon_id', prefs.dungeonId);
    localStorage.setItem('cata_dungeon_difficulty', prefs.difficulty);
    const dungeon = SELECTABLE_DUNGEONS.find((d) => d.id === prefs.dungeonId);
    if (dungeon) localStorage.setItem('cata_dungeon_tier', dungeon.tier);
  } catch {}
}

interface RoomListViewProps {
  rooms: LobbyRoom[];
  player: {
    id: string;
    name: string;
    classId: ClassId;
    spec: string;
  };
  customDifficulty?: CustomDifficultySettings;
  onChangeCustomDifficulty?: (settings: CustomDifficultySettings) => void;
  onCreateRoom: (
    name: string,
    dungeonId: string,
    difficulty: DungeonDifficulty,
    customDiff?: CustomDifficultySettings
  ) => void;
  onJoinRoom: (roomId: string) => void;
  onJoinWaitingQueue: (roomId: string) => void;
  onQuickJoin: () => void;
  onBackToCharacterSelect?: () => void;
}

export const RoomListView: React.FC<RoomListViewProps> = ({
  rooms,
  player,
  customDifficulty = DEFAULT_CUSTOM_DIFFICULTY,
  onChangeCustomDifficulty,
  onCreateRoom,
  onJoinRoom,
  onJoinWaitingQueue,
  onQuickJoin,
  onBackToCharacterSelect,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sfxVolPct, setSfxVolPct] = useState(() => Math.round(getSfxVolume() * 100));
  const [selectedMapFilter, setSelectedMapFilter] = useState<string>('ALL');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newRoomName, setNewRoomName] = useState(`${player.name}的队伍`);
  const [newDungeonId, setNewDungeonId] = useState<string>(
    () => loadLastCreateRoomPrefs().dungeonId
  );
  const [newDifficulty, setNewDifficulty] = useState<DungeonDifficulty>(
    () => loadLastCreateRoomPrefs().difficulty
  );

  const updateCoeff = (key: keyof CustomDifficultySettings, val: number) => {
    if (onChangeCustomDifficulty) {
      onChangeCustomDifficulty({
        ...customDifficulty,
        [key]: Math.max(0.01, Math.min(20, Number.isFinite(val) ? val : 1.0)),
      });
    }
  };

  // Filtered rooms
  const filteredRooms = rooms.filter(r => {
    const matchesSearch = r.name.toLowerCase().includes(searchTerm.toLowerCase()) || r.id.includes(searchTerm);
    const matchesMap = selectedMapFilter === 'ALL' || r.dungeonId === selectedMapFilter;
    return matchesSearch && matchesMap;
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomName.trim()) return;
    saveLastCreateRoomPrefs({ dungeonId: newDungeonId, difficulty: newDifficulty });
    onCreateRoom(
      newRoomName.trim(),
      newDungeonId,
      newDifficulty,
      newDifficulty === 'CUSTOM' ? customDifficulty : undefined
    );
    setShowCreateModal(false);
  };

  return (
    <div className="flex flex-col h-full min-h-0 w-full bg-slate-950 text-slate-100 select-none">
      {/* Top Room Header */}
      <div className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-3 bg-gradient-to-r from-slate-900 via-amber-950/40 to-slate-900 border-b border-amber-500/30 shadow-lg">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded bg-amber-500/20 border border-amber-500 flex items-center justify-center font-black text-amber-400 text-base">
            🏰
          </div>
          <div>
            <h2 className="text-base font-bold tracking-wider text-amber-300">
              副本大厅
            </h2>
            <p className="text-xs text-slate-400">
              组队房间列表 · 集合石
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label
            className="flex items-center gap-2 px-2.5 py-1 rounded bg-slate-800/90 border border-slate-700 text-xs text-slate-300"
            title="战斗与施法音效音量（默认 30%）"
          >
            <span>{sfxVolPct === 0 ? '🔇' : '🔊'}</span>
            <span className="hidden sm:inline text-slate-400">音效</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={sfxVolPct}
              onChange={(e) => {
                const pct = Number(e.target.value);
                setSfxVolPct(pct);
                setSfxVolume(pct / 100);
              }}
              className="w-20 accent-amber-500 cursor-pointer"
            />
            <span className="w-8 text-right tabular-nums text-amber-300">{sfxVolPct}%</span>
          </label>

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

      {/* Main Content Area — full-bleed; room table scrolls when many rooms */}
      <div className="flex-1 min-h-0 flex flex-col p-3 sm:p-4 gap-3 w-full overflow-hidden">
        {/* Action Toolbar */}
        <div className="shrink-0 flex flex-wrap items-center justify-between gap-4 bg-slate-900/90 p-3 rounded-lg border border-slate-800 shadow">
          {/* Left search & filter */}
          <div className="flex flex-wrap items-center gap-3">
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

            <DungeonPicker
              mode="filter"
              label="地图筛选"
              value={selectedMapFilter}
              onChange={setSelectedMapFilter}
            />
          </div>

          {/* Right Action Buttons */}
          <div className="flex items-center space-x-3">
            <button
              onClick={onQuickJoin}
              className="px-4 py-2 rounded font-bold text-xs bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow transition flex items-center space-x-1"
            >
              <span>⚡ 快速游戏</span>
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
        <div className="flex-1 min-h-0 bg-slate-900/70 border border-slate-800 rounded-lg overflow-y-auto overscroll-contain shadow-inner">
          {filteredRooms.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-500 space-y-2">
              <span className="text-4xl">🏰</span>
              <p className="text-sm">暂无匹配的房间，点击上方“创建房间”发起副本挑战！</p>
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/95 text-slate-400 sticky top-0 border-b border-slate-800 z-10">
                <tr>
                  <th className="py-2.5 px-4 w-20">房号</th>
                  <th className="py-2.5 px-4">房间名称</th>
                  <th className="py-2.5 px-4">副本地图</th>
                  <th className="py-2.5 px-4 w-28">难度</th>
                  <th className="py-2.5 px-4 w-48">人数 总数(AI)</th>
                  <th className="py-2.5 px-4 w-20 whitespace-nowrap">状态</th>
                  <th className="py-2.5 px-4 w-32 text-center">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredRooms.map((room, idx) => {
                  const quota = DUNGEON_ROLE_QUOTAS[room.dungeonId] || DUNGEON_ROLE_QUOTAS.shadowfang_keep;
                  const tanks = room.members.filter(m => m.role === 'TANK').length;
                  const healers = room.members.filter(m => m.role === 'HEALER').length;
                  const dps = room.members.filter(m => m.role === 'DPS').length;
                  const humanCount = room.members.filter(m => m.isPlayer && !m.isAi).length;
                  const aiCount = room.members.filter(m => m.isAi).length;
                  const totalCount = room.members.length;
                  const playersFull = humanCount >= quota.capacity;
                  const isInCombat = room.status === 'IN_COMBAT' || room.status === 'OUT_OF_COMBAT';
                  const playerRole = getRoleBySpec(player.classId, player.spec);
                  const hasSeat = hasJoinableSeat(room, playerRole);
                  const canJoin = !playersFull && hasSeat;
                  const joinBlockedReason = playersFull
                    ? '人数已满'
                    : !hasSeat
                      ? room.difficulty === 'CUSTOM'
                        ? '无空位'
                        : '职责满员'
                      : '';

                  return (
                    <tr
                      key={room.id}
                      className={`transition ${
                        !canJoin
                          ? 'bg-slate-950/80 opacity-45 cursor-not-allowed'
                          : 'hover:bg-slate-800/50 cursor-pointer'
                      }`}
                    >
                      <td className={`py-3 px-4 font-mono font-bold ${playersFull ? 'text-slate-600' : 'text-amber-400'}`}>
                        #{String(idx + 1).padStart(2, '0')}
                      </td>
                      <td className="py-3 px-4">
                        <div className={`font-semibold ${playersFull ? 'text-slate-500' : 'text-slate-200'}`}>{room.name}</div>
                        <div className="text-[10px] text-slate-500">ID: {room.id}</div>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${
                          playersFull
                            ? 'bg-slate-900 text-slate-600 border-slate-800'
                            : 'bg-slate-800 text-slate-300 border-slate-700'
                        }`}>
                          {quota.dungeonName} ({quota.tier === '5man' ? '5人' : '20人'})
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`font-bold ${
                            playersFull
                              ? 'text-slate-600'
                              : room.difficulty === 'HEROIC'
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
                        <div className="flex flex-col space-y-0.5">
                          <div className="flex items-center space-x-2">
                            <span
                              className={`font-mono font-bold ${
                                playersFull ? 'text-slate-500' : 'text-emerald-400'
                              }`}
                              title="总数(AI数) · 括号外=玩家+AI，括号内=AI"
                            >
                              {totalCount}/{quota.capacity} ({aiCount})
                            </span>
                            <span className={`text-[10px] ${playersFull ? 'text-slate-600' : 'text-slate-400'}`}>
                              玩家{humanCount} · AI{aiCount}
                            </span>
                          </div>
                          <span className={`text-[10px] ${playersFull ? 'text-slate-600' : 'text-slate-400'}`}>
                            🛡️{tanks} 💚{healers} ⚔️{dps}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {isInCombat ? (
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border whitespace-nowrap ${
                            playersFull
                              ? 'bg-slate-900 text-slate-600 border-slate-700'
                              : 'bg-rose-950/80 text-rose-300 border-rose-700/50 animate-pulse'
                          }`}>
                            战斗中
                          </span>
                        ) : (
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border whitespace-nowrap ${
                            playersFull
                              ? 'bg-slate-900 text-slate-600 border-slate-700'
                              : 'bg-emerald-950/80 text-emerald-300 border-emerald-700/50'
                          }`}>
                            等待中
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {!canJoin ? (
                          <span
                            className="px-3 py-1 rounded font-bold text-xs bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed"
                            title={joinBlockedReason}
                          >
                            {joinBlockedReason || '无法加入'}
                          </span>
                        ) : isInCombat ? (
                          <button
                            onClick={() => onJoinRoom(room.id)}
                            className="px-3 py-1 rounded font-bold text-xs bg-rose-600 hover:bg-rose-500 text-white shadow transition"
                            title={
                              room.difficulty === 'CUSTOM'
                                ? '战斗中可加入并顶替 AI（优先坦克同职业→输出→治疗）'
                                : '战斗中可加入游戏并顶替同职责 AI'
                            }
                          >
                            加入游戏
                          </button>
                        ) : (
                          <button
                            onClick={() => onJoinRoom(room.id)}
                            className="px-3 py-1 rounded font-bold text-xs bg-amber-500 hover:bg-amber-400 text-slate-950 shadow transition"
                          >
                            加入游戏
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
        <DismissibleModal
          onClose={() => setShowCreateModal(false)}
          overlayClassName="bg-black/70"
          panelClassName="bg-slate-900 border border-amber-500/40 rounded-xl shadow-2xl max-w-lg w-full p-6 text-slate-100 animate-in fade-in zoom-in-95 duration-150"
          aria-label="创建房间"
        >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <h2 className="text-base font-bold text-amber-300 flex items-center space-x-2">
                <span>➕</span>
                <span>创建房间</span>
              </h2>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm font-bold"
                aria-label="关闭"
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
                <DungeonPicker
                  mode="select"
                  value={newDungeonId}
                  onChange={(id) => {
                    setNewDungeonId(id);
                  }}
                  listMaxHeightClassName="max-h-56"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">难度选择</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewDifficulty('NORMAL')}
                    className={`p-2 rounded border text-center transition ${
                      newDifficulty === 'NORMAL'
                        ? 'border-sky-500 bg-sky-950/30 text-sky-300 font-bold'
                        : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    普通难度
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewDifficulty('HEROIC')}
                    className={`p-2 rounded border text-center transition ${
                      newDifficulty === 'HEROIC'
                        ? 'border-red-500 bg-red-950/30 text-red-300 font-bold'
                        : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    英雄难度
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewDifficulty('CUSTOM')}
                    className={`p-2 rounded border text-center transition ${
                      newDifficulty === 'CUSTOM'
                        ? 'border-violet-500 bg-violet-950/40 text-violet-300 font-bold'
                        : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    ⚙️ 自定义模式
                  </button>
                </div>

                {newDifficulty === 'CUSTOM' && (
                  <div className="mt-2.5 p-3 rounded-lg bg-slate-950/90 border border-violet-500/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-violet-300">快速预设（进房后可微调全部10项）</span>
                      <div className="flex items-center space-x-1">
                        <button
                          type="button"
                          onClick={() => onChangeCustomDifficulty?.({
                            playerDamageCoeff: 2.0, playerHealingCoeff: 2.0, playerHpCoeff: 1.5, playerMpCoeff: 1.5,
                            aiDamageCoeff: 1.5, aiHealingCoeff: 1.5, aiHpCoeff: 1.2, aiMpCoeff: 1.2,
                            enemyDamageCoeff: 0.6, bossHpCoeff: 0.7,
                          })}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700/50 hover:bg-emerald-900"
                        >
                          爽快割草
                        </button>
                        <button
                          type="button"
                          onClick={() => onChangeCustomDifficulty?.({
                            playerDamageCoeff: 0.8, playerHealingCoeff: 0.8, playerHpCoeff: 0.8, playerMpCoeff: 0.8,
                            aiDamageCoeff: 0.8, aiHealingCoeff: 0.8, aiHpCoeff: 0.8, aiMpCoeff: 0.8,
                            enemyDamageCoeff: 2.0, bossHpCoeff: 2.5,
                          })}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-700/50 hover:bg-rose-900"
                        >
                          地狱挑战
                        </button>
                        <button
                          type="button"
                          onClick={() => onChangeCustomDifficulty?.({ ...DEFAULT_CUSTOM_DIFFICULTY })}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700"
                        >
                          重置 1.0x
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <div>
                        <div className="flex justify-between text-slate-400">
                          <span>敌方伤害:</span>
                          <span className="font-mono text-rose-300">{customDifficulty.enemyDamageCoeff.toFixed(2)}x</span>
                        </div>
                        <input
                          type="range" min="0.01" max="20.0" step="0.05"
                          value={customDifficulty.enemyDamageCoeff}
                          onChange={(e) => updateCoeff('enemyDamageCoeff', parseFloat(e.target.value))}
                          className="w-full h-1 bg-slate-800 rounded accent-rose-400"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-slate-400">
                          <span>BOSS血量:</span>
                          <span className="font-mono text-amber-300">{customDifficulty.bossHpCoeff.toFixed(2)}x</span>
                        </div>
                        <input
                          type="range" min="0.01" max="20.0" step="0.05"
                          value={customDifficulty.bossHpCoeff}
                          onChange={(e) => updateCoeff('bossHpCoeff', parseFloat(e.target.value))}
                          className="w-full h-1 bg-slate-800 rounded accent-amber-400"
                        />
                      </div>
                    </div>
                  </div>
                )}
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
                  创建
                </button>
              </div>
            </form>
        </DismissibleModal>
      )}
    </div>
  );
};
