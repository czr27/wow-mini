import React, { useState } from 'react';
import type { DungeonClearCertificate } from '@cata-raid-sim/engine';
import { CLASS_COLORS, CLASS_NAMES } from './AuthAndCharacterModal.js';

interface Props {
  certificate: DungeonClearCertificate | null;
  onClose: () => void;
}

export const ClearCertificateModal: React.FC<Props> = ({ certificate, onClose }) => {
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'BOSSES'>('OVERVIEW');
  const [selectedBossIndex, setSelectedBossIndex] = useState(0);

  if (!certificate) return null;

  const charClassColor = CLASS_COLORS[certificate.characterClass] || '#FFD700';
  const st = certificate.characterStats;

  const handleDownloadJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(certificate, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `${certificate.dungeonId}_Certificate_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const currentBossEnc = certificate.encounters[selectedBossIndex];

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-[#131326] border-2 border-amber-500/70 rounded-2xl shadow-2xl max-w-3xl w-full flex flex-col max-h-[88vh] overflow-hidden text-gray-200">
        
        {/* Certificate Header Banner */}
        <div className="bg-gradient-to-r from-[#2a2010] via-[#3a2e10] to-[#2a2010] border-b border-amber-500/40 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="text-3xl">📜</span>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-extrabold text-amber-300 tracking-wide">
                  副本通关证明 — {certificate.dungeonName}
                </h2>
                <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-full font-bold">
                  官方认证战报
                </span>
              </div>
              <p className="text-xs text-amber-200/70">
                持有者：<span className="font-bold" style={{ color: charClassColor }}>{certificate.characterName}</span>（{CLASS_NAMES[certificate.characterClass]} · {certificate.characterSpec}） · 通关时间：{new Date(certificate.clearedAtIso).toLocaleString()}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl font-bold p-1 leading-none"
          >
            ✕
          </button>
        </div>

        {/* Tab Controls */}
        <div className="flex border-b border-[#252540] px-6 bg-[#16162c]">
          <button
            onClick={() => setActiveTab('OVERVIEW')}
            className={`py-2.5 px-4 text-xs font-bold border-b-2 transition ${
              activeTab === 'OVERVIEW'
                ? 'border-amber-400 text-amber-300'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            📊 全程战力汇总
          </button>
          <button
            onClick={() => setActiveTab('BOSSES')}
            className={`py-2.5 px-4 text-xs font-bold border-b-2 transition ${
              activeTab === 'BOSSES'
                ? 'border-amber-400 text-amber-300'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            ⚔️ 逐 Boss 详细战报 ({certificate.encounters.length})
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5 bg-[#121224]">
          {activeTab === 'OVERVIEW' ? (
            <>
              {/* Highlight Metric Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-[#1a1a32] border border-[#2e2e50] p-3 rounded-xl text-center">
                  <div className="text-[11px] text-gray-400">总通关耗时</div>
                  <div className="text-lg font-extrabold text-amber-300 mt-0.5">{certificate.totalDurationSec} 秒</div>
                </div>
                <div className="bg-[#1a1a32] border border-[#2e2e50] p-3 rounded-xl text-center">
                  <div className="text-[11px] text-gray-400">平均输出 (DPS)</div>
                  <div className="text-lg font-extrabold text-red-400 mt-0.5">{st.dps.toLocaleString()}</div>
                </div>
                <div className="bg-[#1a1a32] border border-[#2e2e50] p-3 rounded-xl text-center">
                  <div className="text-[11px] text-gray-400">有效秒疗 (有效HPS)</div>
                  <div className="text-lg font-extrabold text-emerald-400 mt-0.5">{Math.max(0, st.effectiveHps).toLocaleString()}</div>
                </div>
                <div className="bg-[#1a1a32] border border-[#2e2e50] p-3 rounded-xl text-center">
                  <div className="text-[11px] text-gray-400">过量治疗占比</div>
                  <div className="text-lg font-extrabold text-teal-300 mt-0.5">{st.overhealPct}%</div>
                </div>
              </div>

              {/* Detailed Personal Stats Table */}
              <div className="bg-[#17172e] border border-[#2b2b4c] rounded-xl p-4 space-y-2">
                <h4 className="text-xs font-bold text-gray-300 uppercase tracking-wider mb-2">个人战斗表现统计</h4>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-[#242442]">
                    <span className="text-gray-400">累计造成伤害</span>
                    <span className="font-mono font-bold text-red-300">{st.totalDamage.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#242442]">
                    <span className="text-gray-400">有效治疗总量 (非Overheal)</span>
                    <span className="font-mono font-bold text-emerald-300">{st.effectiveHealing.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#242442]">
                    <span className="text-gray-400">累计承受伤害</span>
                    <span className="font-mono font-bold text-amber-300">{st.damageTaken.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#242442]">
                    <span className="text-gray-400">成功打断施法次数</span>
                    <span className="font-mono font-bold text-blue-300">{st.interrupts} 次</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#242442]">
                    <span className="text-gray-400">阵亡次数</span>
                    <span className="font-mono font-bold text-gray-300">{st.deaths} 次</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#242442]">
                    <span className="text-gray-400">击杀首领数量</span>
                    <span className="font-mono font-bold text-amber-400">{certificate.encounters.length} 位全通</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              {/* Boss Selector Pills */}
              <div className="flex flex-wrap gap-1.5">
                {certificate.encounters.map((enc, idx) => (
                  <button
                    key={enc.bossId}
                    onClick={() => setSelectedBossIndex(idx)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 ${
                      selectedBossIndex === idx
                        ? 'bg-amber-500 text-black shadow'
                        : 'bg-[#1b1b34] text-gray-400 hover:bg-[#252546]'
                    }`}
                  >
                    <span>{idx + 1}号</span>
                    <span>{enc.bossName}</span>
                  </button>
                ))}
              </div>

              {/* Single Boss Detail Box */}
              {currentBossEnc && (
                <div className="bg-[#17172e] border border-[#2b2b4c] rounded-xl p-4 space-y-4">
                  <div className="flex items-center justify-between border-b border-[#252542] pb-3">
                    <div>
                      <h4 className="font-bold text-sm text-amber-300">{currentBossEnc.bossName} 战斗战报</h4>
                      <div className="text-[11px] text-gray-400 mt-0.5">
                        耗时：{currentBossEnc.durationSec} 秒 · 灭团重试：{currentBossEnc.wipesBeforeKill} 次 · 结果：
                        <span className="text-emerald-400 font-bold ml-1">首领击杀 (KILL)</span>
                      </div>
                    </div>
                  </div>

                  {/* Team Members Performance on this Boss */}
                  <div>
                    <h5 className="text-[11px] font-bold text-gray-400 uppercase mb-2">团队成员该场数据</h5>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-[#121224] text-gray-400 border-b border-[#262646]">
                          <tr>
                            <th className="py-1.5 px-2">成员</th>
                            <th className="py-1.5 px-2">职业</th>
                            <th className="py-1.5 px-2">DPS</th>
                            <th className="py-1.5 px-2">总伤害</th>
                            <th className="py-1.5 px-2">HPS</th>
                            <th className="py-1.5 px-2">承受伤害</th>
                            <th className="py-1.5 px-2">打断</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#20203a]">
                          {currentBossEnc.unitStats.map(u => (
                            <tr key={u.unitId} className={u.isPlayer ? 'bg-amber-500/10' : ''}>
                              <td className="py-1.5 px-2 font-bold flex items-center space-x-1">
                                <span style={{ color: CLASS_COLORS[u.classId as any] || '#ccc' }}>{u.name}</span>
                                {u.isPlayer && <span className="text-[9px] bg-amber-500 text-black px-1 rounded font-bold">我</span>}
                              </td>
                              <td className="py-1.5 px-2 text-gray-400">{CLASS_NAMES[u.classId as any] || u.classId}</td>
                              <td className="py-1.5 px-2 font-mono text-red-300">{u.dps.toLocaleString()}</td>
                              <td className="py-1.5 px-2 font-mono text-gray-300">{u.totalDamage.toLocaleString()}</td>
                              <td className="py-1.5 px-2 font-mono text-emerald-300">{Math.max(0, u.hps).toLocaleString()}</td>
                              <td className="py-1.5 px-2 font-mono text-amber-200">{u.damageTaken.toLocaleString()}</td>
                              <td className="py-1.5 px-2 font-mono text-blue-300">{u.interrupts}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="bg-[#16162c] border-t border-[#252540] px-6 py-3 flex items-center justify-between">
          <button
            onClick={handleDownloadJson}
            className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded text-amber-300 font-bold border border-slate-500 flex items-center space-x-1"
          >
            <span>💾</span>
            <span>导出通关原始 JSON 证据</span>
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs bg-amber-600 hover:bg-amber-500 text-white font-bold rounded shadow"
          >
            关闭凭证
          </button>
        </div>
      </div>
    </div>
  );
};
