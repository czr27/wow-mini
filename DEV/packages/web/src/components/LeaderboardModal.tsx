import React, { useState } from 'react';
import type { LeaderboardEntry, LeaderboardMetric, ClassId } from '@cata-raid-sim/engine';
import { CLASS_COLORS, CLASS_NAMES } from './AuthAndCharacterModal.js';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  entries: LeaderboardEntry[];
}

export const LeaderboardModal: React.FC<Props> = ({ isOpen, onClose, entries }) => {
  const [activeMetric, setActiveMetric] = useState<LeaderboardMetric>('FAST_KILL');
  const [selectedBossId, setSelectedBossId] = useState<string>('ashbury');
  const [filterClass, setFilterClass] = useState<ClassId | 'ALL'>('ALL');

  if (!isOpen) return null;

  const bosses = [
    { id: 'ashbury', name: '1号 亚什布里' },
    { id: 'silverlaine', name: '2号 席瓦莱恩' },
    { id: 'springvale', name: '3号 斯普林瓦尔' },
    { id: 'walden', name: '4号 沃登勋爵' },
    { id: 'godfrey', name: '5号 高弗雷勋爵（尾王）' },
  ];

  let filtered = entries.filter(e => e.metric === activeMetric);
  if (activeMetric === 'FAST_KILL') {
    filtered = filtered.filter(e => e.bossId === selectedBossId);
    filtered.sort((a, b) => a.value - b.value); // Lower time is faster
  } else {
    filtered.sort((a, b) => b.value - a.value); // Higher DPS/HPS is better
  }

  if (filterClass !== 'ALL') {
    filtered = filtered.filter(e => e.characterClass === filterClass);
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-[#131326] border-2 border-amber-500/70 rounded-2xl shadow-2xl max-w-4xl w-full flex flex-col max-h-[88vh] overflow-hidden text-gray-200">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-[#2c2010] via-[#3b2d10] to-[#2c2010] border-b border-amber-500/40 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="text-3xl">🏆</span>
            <div>
              <h2 className="text-lg font-extrabold text-amber-300 tracking-wide flex items-center space-x-2">
                <span>大地的裂变 — 世界史诗战力榜</span>
                <span className="text-[10px] bg-red-600/30 text-red-300 border border-red-500/40 px-2 py-0.5 rounded-full font-bold">
                  全球实时天梯
                </span>
              </h2>
              <p className="text-xs text-amber-200/70">记录全服首领极限击杀、登顶极限秒伤与纯净非过量治疗</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl font-bold p-1 leading-none"
          >
            ✕
          </button>
        </div>

        {/* Metric Selector Tabs */}
        <div className="flex flex-wrap items-center justify-between border-b border-[#252540] px-6 bg-[#16162c] gap-2 py-2">
          <div className="flex space-x-2">
            <button
              onClick={() => setActiveMetric('FAST_KILL')}
              className={`py-2 px-3 text-xs font-bold rounded-lg transition flex items-center space-x-1.5 ${
                activeMetric === 'FAST_KILL'
                  ? 'bg-amber-500 text-black shadow'
                  : 'bg-[#1e1e36] text-gray-400 hover:text-gray-200'
              }`}
            >
              <span>⏱️</span>
              <span>首领极限速杀榜</span>
            </button>

            <button
              onClick={() => setActiveMetric('MAX_DPS')}
              className={`py-2 px-3 text-xs font-bold rounded-lg transition flex items-center space-x-1.5 ${
                activeMetric === 'MAX_DPS'
                  ? 'bg-red-500 text-white shadow'
                  : 'bg-[#1e1e36] text-gray-400 hover:text-gray-200'
              }`}
            >
              <span>💥</span>
              <span>最高秒伤极限榜 (DPS)</span>
            </button>

            <button
              onClick={() => setActiveMetric('MAX_EFFECTIVE_HPS')}
              className={`py-2 px-3 text-xs font-bold rounded-lg transition flex items-center space-x-1.5 ${
                activeMetric === 'MAX_EFFECTIVE_HPS'
                  ? 'bg-emerald-500 text-black shadow'
                  : 'bg-[#1e1e36] text-gray-400 hover:text-gray-200'
              }`}
            >
              <span>💚</span>
              <span>非过量有效治疗榜 (Effective HPS)</span>
            </button>
          </div>

          {/* Class Filter */}
          <div className="flex items-center space-x-2 text-xs">
            <span className="text-gray-400">职业筛选:</span>
            <select
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value as any)}
              className="bg-[#1b1b34] border border-[#3b3b5c] rounded px-2 py-1 text-xs text-amber-300 outline-none"
            >
              <option value="ALL">全部职业</option>
              <option value="DK">死亡骑士</option>
              <option value="DRUID">德鲁伊</option>
              <option value="SHAMAN">萨满祭司</option>
              <option value="MAGE">法师</option>
              <option value="ROGUE">潜行者</option>
              <option value="WARRIOR">战士</option>
              <option value="PALADIN">圣骑士</option>
              <option value="HUNTER">猎人</option>
              <option value="PRIEST">牧师</option>
              <option value="WARLOCK">术士</option>
            </select>
          </div>
        </div>

        {/* Sub-tabs for Boss Fast Kill */}
        {activeMetric === 'FAST_KILL' && (
          <div className="bg-[#121224] border-b border-[#252540] px-6 py-2.5 flex flex-wrap gap-2">
            {bosses.map(b => (
              <button
                key={b.id}
                onClick={() => setSelectedBossId(b.id)}
                className={`px-3 py-1 rounded text-xs font-bold transition ${
                  selectedBossId === b.id
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/60'
                    : 'bg-[#1b1b34] text-gray-400 hover:bg-[#252548]'
                }`}
              >
                {b.name}
              </button>
            ))}
          </div>
        )}

        {/* Leaderboard Table */}
        <div className="flex-1 overflow-y-auto p-6 bg-[#121224]">
          <div className="bg-[#181832] border border-[#2b2b4c] rounded-xl overflow-hidden shadow">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#101020] text-gray-400 uppercase text-[10px] tracking-wider border-b border-[#242442]">
                <tr>
                  <th className="py-2.5 px-4 text-center w-16">排名</th>
                  <th className="py-2.5 px-4">冒险者</th>
                  <th className="py-2.5 px-4">职业</th>
                  <th className="py-2.5 px-4">专精天赋</th>
                  <th className="py-2.5 px-4 text-right">
                    {activeMetric === 'FAST_KILL'
                      ? '击杀耗时'
                      : activeMetric === 'MAX_DPS'
                      ? '输出秒伤 (DPS)'
                      : '有效秒疗 (非Overheal)'}
                  </th>
                  <th className="py-2.5 px-4 text-right">上榜日期</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#20203a]">
                {filtered.map((item, idx) => {
                  const rank = idx + 1;
                  const rankBadge =
                    rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
                  const classColor = CLASS_COLORS[item.characterClass] || '#ccc';

                  return (
                    <tr
                      key={item.id}
                      className={`transition hover:bg-[#222244] ${
                        rank <= 3 ? 'bg-amber-500/5' : ''
                      }`}
                    >
                      <td className="py-2.5 px-4 text-center font-bold text-sm">
                        {rankBadge}
                      </td>
                      <td className="py-2.5 px-4 font-bold" style={{ color: classColor }}>
                        {item.characterName}
                      </td>
                      <td className="py-2.5 px-4 text-gray-400">
                        {CLASS_NAMES[item.characterClass]}
                      </td>
                      <td className="py-2.5 px-4 text-gray-300 font-mono text-[11px]">
                        {item.characterSpec}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono font-bold text-sm">
                        {activeMetric === 'FAST_KILL' ? (
                          <span className="text-amber-300">{item.value.toFixed(1)} 秒</span>
                        ) : activeMetric === 'MAX_DPS' ? (
                          <span className="text-red-400">{item.value.toLocaleString()} DPS</span>
                        ) : (
                          <span className="text-emerald-400">{item.value.toLocaleString()} HPS</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right text-gray-500 text-[10px]">
                        {new Date(item.recordedAtIso).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-gray-500">
                      该榜单当前筛选条件下暂无上榜记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-[#16162c] border-t border-[#252540] px-6 py-3 flex items-center justify-between">
          <span className="text-xs text-gray-400">
            * 每次副本通关击败尾王后，你的战斗数据将自动提报至全球世界排行榜
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded text-gray-200 font-bold"
          >
            返回
          </button>
        </div>
      </div>
    </div>
  );
};
