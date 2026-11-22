import React from 'react';
import type { EncounterReport } from '@cata-raid-sim/engine';
import { CLASS_COLORS } from './AuthAndCharacterModal.js';

interface Props {
  isOpen: boolean;
  timerMs: number;
  bossName: string;
  onVote: (choice: 'RETRY' | 'FINISH') => void;
  wipeReport?: EncounterReport | null;
}

export const WipeVoteModal: React.FC<Props> = ({
  isOpen,
  timerMs,
  bossName,
  onVote,
  wipeReport = null,
}) => {
  if (!isOpen) return null;

  const seconds = Math.max(0, Math.ceil(timerMs / 1000));

  return (
    <div className="fixed inset-0 bg-red-950/80 backdrop-blur-md flex items-center justify-center z-50 p-4 select-none">
      <div className="bg-[#181018] border-2 border-red-600 rounded-2xl p-6 max-w-lg w-full shadow-2xl text-center space-y-4 animate-in fade-in zoom-in-95">
        {/* Title */}
        <div className="flex items-center justify-center space-x-2">
          <span className="text-3xl animate-bounce">💀</span>
          <h3 className="text-xl font-extrabold text-red-400">团队灭团！战斗失败</h3>
          <span className="text-3xl animate-bounce">💀</span>
        </div>

        <p className="text-xs text-gray-300">
          团队在挑战「<strong className="text-amber-300">{bossName}</strong>」时不幸全员阵亡。
        </p>

        {/* ── Defeat / Wipe Detailed Statistics Panel ── */}
        <div className="bg-[#10080e] border border-red-900/70 rounded-xl p-3 text-left space-y-2">
          <div className="flex items-center justify-between text-xs border-b border-red-950/80 pb-1.5">
            <span className="font-bold text-red-300 flex items-center space-x-1">
              <span>📊</span>
              <span>灭团战报分析</span>
            </span>
            <span className="text-amber-400 font-mono text-[11px] font-bold">
              当前Boss第 {wipeReport ? wipeReport.wipesBeforeKill : 1} 次尝试
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-[#1a0e14] p-2 rounded border border-red-900/40">
              <span className="text-gray-400 text-[10px] block">首领剩余血量</span>
              <span className="text-red-400 font-mono font-extrabold text-base">
                {wipeReport && wipeReport.bossRemainingHpPct !== undefined
                  ? `${wipeReport.bossRemainingHpPct}%`
                  : '未记录'}
              </span>
            </div>

            <div className="bg-[#1a0e14] p-2 rounded border border-red-900/40">
              <span className="text-gray-400 text-[10px] block">战斗坚持时长</span>
              <span className="text-amber-300 font-mono font-extrabold text-base">
                {wipeReport ? `${wipeReport.durationSec}s` : '0s'}
              </span>
            </div>
          </div>

          {wipeReport?.wipeCause && (
            <div className="bg-red-950/60 p-2 rounded border border-red-800/50 text-[11px] text-red-200">
              <span className="text-red-400 font-bold">⚠️ 倒团原因：</span>
              <span>{wipeReport.wipeCause}</span>
            </div>
          )}

          {/* Unit Performance Breakdown */}
          {wipeReport && wipeReport.unitStats && wipeReport.unitStats.length > 0 && (
            <div className="space-y-1 pt-1">
              <div className="text-[10px] font-bold text-gray-400 flex justify-between px-1">
                <span>团员表现</span>
                <span>DPS / HPS / 承伤</span>
              </div>
              <div className="max-h-28 overflow-y-auto space-y-1 pr-1 font-mono text-[10px]">
                {wipeReport.unitStats.map(u => {
                  const color = CLASS_COLORS[u.classId as any] || '#888';
                  return (
                    <div
                      key={u.unitId}
                      className="flex items-center justify-between bg-black/40 px-2 py-1 rounded border border-white/5"
                    >
                      <span className="font-bold truncate max-w-[120px]" style={{ color }}>
                        {u.name} {u.isPlayer && '(我)'}
                      </span>
                      <div className="flex space-x-2 text-gray-300">
                        <span className="text-orange-300">{Math.max(0, u.dps)} DPS</span>
                        <span className="text-emerald-300">{Math.max(0, u.hps)} HPS</span>
                        <span className="text-red-300">{Math.round(u.damageTaken / 1000)}k 伤</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Vote Timer */}
        <div className="bg-[#120a10] border border-red-900/60 p-2 rounded-lg flex items-center justify-between px-4">
          <span className="text-xs text-gray-400">决议倒计时（超时自动重试）：</span>
          <span className="text-lg font-mono font-extrabold text-red-500">{seconds}s</span>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <button
            onClick={() => onVote('RETRY')}
            className="py-2.5 px-4 bg-gradient-to-r from-emerald-700 to-emerald-600 hover:from-emerald-600 hover:to-emerald-500 text-white font-extrabold rounded-xl shadow-lg border border-emerald-500/50 flex flex-col items-center justify-center active:scale-95 transition"
          >
            <span className="text-sm">🔄 重试当前首领</span>
            <span className="text-[9px] text-emerald-200 font-normal">脱战复活整备开怪</span>
          </button>

          <button
            onClick={() => onVote('FINISH')}
            className="py-2.5 px-4 bg-gradient-to-r from-slate-700 to-slate-600 hover:from-slate-600 hover:to-slate-500 text-gray-200 font-bold rounded-xl shadow border border-slate-500 flex flex-col items-center justify-center active:scale-95 transition"
          >
            <span className="text-sm">🏳️ 结束并结算</span>
            <span className="text-[9px] text-gray-400 font-normal">导出战报离开副本</span>
          </button>
        </div>
      </div>
    </div>
  );
};
