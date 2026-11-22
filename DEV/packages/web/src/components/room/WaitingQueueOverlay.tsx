import React from 'react';
import type { RoleId } from '@cata-raid-sim/engine';

interface WaitingQueueOverlayProps {
  roomName: string;
  dungeonName: string;
  role: RoleId;
  queuePosition: number;
  totalWaiting: number;
  bossName?: string;
  bossHpPct?: number; // 0 - 100
  onExitQueue: () => void;
}

export const WaitingQueueOverlay: React.FC<WaitingQueueOverlayProps> = ({
  roomName,
  dungeonName,
  role,
  queuePosition,
  totalWaiting,
  bossName,
  bossHpPct = 100,
  onExitQueue,
}) => {
  const roleBadge = role === 'TANK' ? '🛡️ 坦克' : role === 'HEALER' ? '💚 治疗' : '⚔️ 输出';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 select-none animate-in fade-in duration-200">
      <div className="bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 border border-amber-500/40 rounded-2xl shadow-2xl max-w-lg w-full p-6 text-slate-100 relative overflow-hidden">
        {/* Glow ambient background effect */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Top Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-full bg-rose-500 animate-ping inline-block" />
            <h2 className="text-base font-bold text-amber-300">
              战斗观战中 · 等待脱战替补
            </h2>
          </div>
          <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-amber-500/10 border border-amber-500/40 text-amber-300">
            {roleBadge}
          </span>
        </div>

        {/* Room Info */}
        <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3 text-xs mb-4 flex items-center justify-between">
          <div>
            <div className="text-slate-400">目标房间: <strong className="text-slate-200">{roomName}</strong></div>
            <div className="text-slate-400 mt-0.5">副本挑战: <strong className="text-amber-200">{dungeonName}</strong></div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-slate-400">队列位置</div>
            <div className="text-base font-black text-amber-400 font-mono">
              第 {queuePosition} 位 <span className="text-xs text-slate-500 font-normal">/ 共 {totalWaiting} 人</span>
            </div>
          </div>
        </div>

        {/* Live Boss Health Progress Bar */}
        <div className="bg-slate-950/90 border border-rose-900/40 rounded-xl p-4 mb-5 shadow-inner">
          <div className="flex items-center justify-between text-xs mb-2">
            <div className="flex items-center space-x-2">
              <span className="text-rose-400 font-bold">⚔️ 当前交战首领:</span>
              <span className="font-extrabold text-slate-100">{bossName || '首领战斗进行中'}</span>
            </div>
            <div className="font-mono font-black text-rose-400 text-sm">
              {bossHpPct}%
            </div>
          </div>

          {/* Progress track */}
          <div className="w-full h-5 bg-slate-900 rounded-full overflow-hidden border border-slate-700/80 p-0.5 relative">
            <div
              className="h-full rounded-full transition-all duration-300 ease-out bg-gradient-to-r from-rose-600 via-red-500 to-amber-500 shadow-lg relative"
              style={{ width: `${Math.max(0, Math.min(100, bossHpPct))}%` }}
            >
              <div className="absolute inset-0 bg-white/10 animate-pulse" />
            </div>
          </div>

          <div className="text-[10px] text-slate-500 mt-2 text-center">
            实时轮询首领生命值进度 · 队伍正在奋力开荒中
          </div>
        </div>

        {/* Mechanics Notice */}
        <div className="bg-amber-950/20 border border-amber-900/40 rounded-lg p-3 text-xs text-amber-200/90 mb-5 space-y-1">
          <div className="font-bold flex items-center space-x-1 text-amber-300">
            <span>ℹ️</span>
            <span>脱战替补机制说明：</span>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-300">
            当队伍脱离战斗时（<strong className="text-amber-300">首领倒地</strong> 进入休整 或 <strong className="text-amber-300">团灭投票重试</strong>），系统将自动为您<strong className="text-amber-300">随机替换一名同分工 AI 成员</strong>，状态回满无缝接管，带您直接进入后续战斗！
          </p>
        </div>

        {/* Bottom Exit Button */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800">
          <span className="text-[11px] text-slate-500">
            您可以随时退出等待，不影响任何队伍进度
          </span>
          <button
            onClick={onExitQueue}
            className="px-5 py-2 rounded-lg font-bold text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 shadow transition"
          >
            退出等待
          </button>
        </div>
      </div>
    </div>
  );
};
