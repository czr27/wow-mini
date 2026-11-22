import React, { useState } from 'react';
import type {
  EncounterReport,
  DungeonRunExport,
  DungeonClearCertificate,
  ClassId,
} from '@cata-raid-sim/engine';
import { CLASS_COLORS, CLASS_NAMES } from './AuthAndCharacterModal.js';

interface Props {
  dungeonName: string;
  totalDurationSec: number;
  encounters: EncounterReport[];
  characterName: string;
  characterClass: ClassId;
  characterSpec: string;
  onExportCsv: () => void;
  onExportJson: () => void;
  onClaimCertificate?: () => void;
  onOpenLeaderboard: () => void;
  onReturnToLobby: () => void;
  isCertificateClaimed: boolean;
  isCleared?: boolean;
}

export const SummaryPage: React.FC<Props> = ({
  dungeonName,
  totalDurationSec,
  encounters,
  characterName,
  characterClass,
  characterSpec,
  onExportCsv,
  onExportJson,
  onClaimCertificate,
  onOpenLeaderboard,
  onReturnToLobby,
  isCertificateClaimed,
  isCleared,
}) => {
  const [viewMode, setViewMode] = useState<'OVERALL' | number>('OVERALL');

  // Calculate overall roster stats
  const memberMap: Record<
    string,
    {
      unitId: string;
      name: string;
      classId: string;
      role: string;
      isPlayer: boolean;
      totalDamage: number;
      totalHealing: number;
      damageTaken: number;
      interrupts: number;
      deaths: number;
    }
  > = {};

  for (const enc of encounters) {
    for (const u of enc.unitStats) {
      if (!memberMap[u.unitId]) {
        memberMap[u.unitId] = {
          unitId: u.unitId,
          name: u.name,
          classId: u.classId,
          role: u.role,
          isPlayer: u.isPlayer,
          totalDamage: 0,
          totalHealing: 0,
          damageTaken: 0,
          interrupts: 0,
          deaths: 0,
        };
      }
      memberMap[u.unitId].totalDamage += u.totalDamage;
      memberMap[u.unitId].totalHealing += u.totalHealing;
      memberMap[u.unitId].damageTaken += u.damageTaken;
      memberMap[u.unitId].interrupts += u.interrupts;
      memberMap[u.unitId].deaths += u.deaths;
    }
  }

  const dur = Math.max(1, totalDurationSec);
  const overallStats = Object.values(memberMap).map(m => ({
    ...m,
    totalDamage: Math.max(0, m.totalDamage),
    totalHealing: Math.max(0, m.totalHealing),
    dps: Math.max(0, Math.round(m.totalDamage / dur)),
    hps: Math.max(0, Math.round(m.totalHealing / dur)),
  }));

  overallStats.sort((a, b) => b.dps - a.dps);

  const displayList =
    viewMode === 'OVERALL'
      ? overallStats
      : encounters[viewMode]?.unitStats || [];

  const totalKills = encounters.filter(e => e.result === 'KILL').length;
  const isTrulyCleared = isCleared !== undefined
    ? isCleared
    : (encounters.length > 0 && encounters.every(e => e.result === 'KILL'));

  return (
    <div className="w-full max-w-5xl mx-auto bg-[#131326] border-2 border-amber-500/70 rounded-2xl shadow-2xl p-6 text-gray-200 select-none space-y-5 animate-in fade-in">
      
      {/* Header Banner */}
      <div className="flex flex-wrap items-center justify-between border-b border-amber-500/30 pb-4 gap-3">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-3xl">{isTrulyCleared ? '🎉' : '⚔️'}</span>
            <h2 className="text-2xl font-extrabold text-amber-300">
              {isTrulyCleared ? `副本通关战报 — ${dungeonName}` : `副本战斗结算 — ${dungeonName}`}
            </h2>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            总耗时：<span className="text-amber-400 font-bold font-mono">{totalDurationSec}</span> 秒 · 击杀首领：
            <span className={isTrulyCleared ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
              {totalKills}
            </span>
            {isTrulyCleared ? ' 位全通' : ` / ${encounters.length} 位`}
          </p>
        </div>

        {/* Claim Reward Certificate & View Leaderboard */}
        <div className="flex items-center space-x-2">
          {isTrulyCleared ? (
            <div className="px-3.5 py-2 bg-emerald-950/80 border border-emerald-500/60 rounded-xl shadow-lg flex items-center space-x-2">
              <span className="text-lg">📜</span>
              <div className="text-left">
                <div className="text-xs font-extrabold text-emerald-300 flex items-center space-x-1">
                  <span>✓ 通关奖励已自动发放</span>
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.2 rounded border border-emerald-500/40">已存入背包</span>
                </div>
                <div className="text-[10px] text-emerald-400/80">已自动提报至世界英雄榜</div>
              </div>
            </div>
          ) : (
            <div className="px-3.5 py-2 bg-red-950/70 border border-red-500/40 rounded-xl shadow flex items-center space-x-1.5 text-xs text-red-300">
              <span>⚠️</span>
              <div>
                <div className="font-bold">未完全通关副本</div>
                <div className="text-[10px] text-gray-400">仅完全通关才可结算通关证明奖励</div>
              </div>
            </div>
          )}

          <button
            onClick={onOpenLeaderboard}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-xl font-bold text-xs text-amber-300 border border-slate-500 shadow flex items-center space-x-1"
          >
            <span>🏆</span>
            <span>查看世界排名</span>
          </button>
        </div>
      </div>

      {/* View Switcher Pills */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setViewMode('OVERALL')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
            viewMode === 'OVERALL'
              ? 'bg-amber-500 text-black shadow'
              : 'bg-[#1e1e36] text-gray-400 hover:text-white'
          }`}
        >
          全程总计
        </button>

        {encounters.map((enc, idx) => {
          const isWipe = enc.result === 'WIPE';
          return (
            <button
              key={`${enc.bossId}_${idx}`}
              onClick={() => setViewMode(idx)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 ${
                viewMode === idx
                  ? isWipe
                    ? 'bg-red-700 text-white shadow'
                    : 'bg-amber-500 text-black shadow'
                  : isWipe
                  ? 'bg-red-950/60 text-red-300 border border-red-800/50 hover:bg-red-900/40'
                  : 'bg-[#1e1e36] text-gray-400 hover:text-white'
              }`}
            >
              <span>{isWipe ? '💀' : '⚔️'}</span>
              <span>
                {idx + 1}号 {enc.bossName} {isWipe ? '(灭团)' : `(${enc.durationSec}s)`}
              </span>
            </button>
          );
        })}
      </div>

      {/* Wipe Defeat Banner if current view is a wipe */}
      {typeof viewMode === 'number' && encounters[viewMode]?.result === 'WIPE' && (
        <div className="bg-red-950/70 border-2 border-red-600/80 rounded-xl p-3 text-xs text-red-200 flex flex-wrap items-center justify-between gap-2 shadow-lg">
          <div className="flex items-center space-x-2">
            <span className="text-xl">💀</span>
            <div>
              <span className="font-extrabold text-red-400 text-sm">灭团尝试记录</span>
              <p className="text-[11px] text-gray-300 mt-0.5">
                {encounters[viewMode].wipeCause || '团队在首领狂暴或高额伤害下全员阵亡'}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-4 font-mono text-xs">
            <div>
              <span className="text-gray-400 text-[10px] block">Boss剩余血量</span>
              <span className="text-red-300 font-bold text-sm">
                {encounters[viewMode].bossRemainingHpPct !== undefined ? `${encounters[viewMode].bossRemainingHpPct}%` : '未记录'}
              </span>
            </div>
            <div>
              <span className="text-gray-400 text-[10px] block">存活战斗时间</span>
              <span className="text-amber-300 font-bold text-sm">{encounters[viewMode].durationSec}s</span>
            </div>
            <div>
              <span className="text-gray-400 text-[10px] block">累计灭团尝试</span>
              <span className="text-orange-400 font-bold text-sm">{encounters[viewMode].wipesBeforeKill}次</span>
            </div>
          </div>
        </div>
      )}

      {/* Main Stats Table */}
      <div className="bg-[#181832] border border-[#2b2b4c] rounded-xl overflow-hidden shadow">
        <table className="w-full text-xs text-left">
          <thead className="bg-[#101020] text-gray-400 uppercase text-[10px] tracking-wider border-b border-[#242442]">
            <tr>
              <th className="py-2.5 px-3">成员</th>
              <th className="py-2.5 px-3">职业</th>
              <th className="py-2.5 px-3">职责</th>
              <th className="py-2.5 px-3 text-right">DPS</th>
              <th className="py-2.5 px-3 text-right">总伤害</th>
              <th className="py-2.5 px-3 text-right">HPS</th>
              <th className="py-2.5 px-3 text-right">总治疗</th>
              <th className="py-2.5 px-3 text-right">承受伤害</th>
              <th className="py-2.5 px-3 text-center">打断</th>
              <th className="py-2.5 px-3 text-center">死亡</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#20203a]">
            {displayList.map(u => {
              const classColor = CLASS_COLORS[u.classId as any] || '#ccc';
              return (
                <tr key={u.unitId} className={u.isPlayer ? 'bg-amber-500/10' : 'hover:bg-[#1e1e38]'}>
                  <td className="py-2.5 px-3 font-bold flex items-center space-x-1.5">
                    <span style={{ color: classColor }}>{u.name}</span>
                    {u.isPlayer && <span className="text-[9px] bg-amber-500 text-black px-1 rounded font-bold">我</span>}
                  </td>
                  <td className="py-2.5 px-3 text-gray-400">{CLASS_NAMES[u.classId as any] || u.classId}</td>
                  <td className="py-2.5 px-3 text-gray-400">{u.role}</td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-red-400">{u.dps.toLocaleString()}</td>
                  <td className="py-2.5 px-3 text-right font-mono text-gray-300">{u.totalDamage.toLocaleString()}</td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400">{u.hps.toLocaleString()}</td>
                  <td className="py-2.5 px-3 text-right font-mono text-gray-300">{u.totalHealing.toLocaleString()}</td>
                  <td className="py-2.5 px-3 text-right font-mono text-amber-200">{u.damageTaken.toLocaleString()}</td>
                  <td className="py-2.5 px-3 text-center font-mono text-blue-300">{u.interrupts}</td>
                  <td className="py-2.5 px-3 text-center font-mono text-gray-400">{u.deaths}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Export & Navigation Footer */}
      <div className="flex flex-wrap items-center justify-between border-t border-[#252540] pt-4 gap-2">
        <div className="flex items-center space-x-2">
          <button
            onClick={onExportCsv}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-600 rounded-lg text-xs font-bold flex items-center space-x-1 shadow"
          >
            <span>📥</span>
            <span>导出 CSV (Excel友好)</span>
          </button>

          <button
            onClick={onExportJson}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-blue-300 border border-slate-600 rounded-lg text-xs font-bold flex items-center space-x-1 shadow"
          >
            <span>💾</span>
            <span>导出 JSON (完整分段原始数据)</span>
          </button>
        </div>

        <button
          onClick={onReturnToLobby}
          className="px-6 py-2.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 text-white font-extrabold rounded-xl shadow-lg transition active:scale-95 text-xs"
        >
          返回大厅 / 准备下一次挑战
        </button>
      </div>
    </div>
  );
};
