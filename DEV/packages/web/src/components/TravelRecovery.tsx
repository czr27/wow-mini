import React from 'react';
import type { Unit } from '@cata-raid-sim/engine';

interface Props {
  targetBossName: string;
  remainingMs: number;
  totalMs?: number;
  deadUnits?: Unit[];
  isReviving?: boolean;
  revivingTargetName?: string;
  isPlayerHealer?: boolean;
  onPlayerRevive?: () => void;
  onFastForward: () => void;
  isCorpseRunning?: boolean;
  corpseRunRemainingMs?: number;
}

export const TravelRecovery: React.FC<Props> = ({
  targetBossName,
  remainingMs,
  deadUnits = [],
  isReviving = false,
  revivingTargetName = '',
  isPlayerHealer = false,
  onPlayerRevive,
  onFastForward,
  isCorpseRunning = false,
  corpseRunRemainingMs = 0,
}) => {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const hasDeadMembers = deadUnits.length > 0;
  const corpseRunSec = Math.max(0, (corpseRunRemainingMs / 1000)).toFixed(1);

  if (isCorpseRunning) {
    const progressPct = Math.min(100, Math.max(0, (1 - corpseRunRemainingMs / 10000) * 100));

    return (
      <div className="w-full max-w-2xl mx-auto py-1 px-3">
        <div className="bg-red-950/90 border-2 border-red-500 rounded-xl p-2.5 shadow-2xl backdrop-blur flex flex-col space-y-1.5 animate-pulse">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="text-xl">💀</span>
              <div>
                <div className="text-xs font-black text-red-200 tracking-wide flex items-center space-x-1.5">
                  <span>所有能够复活的队员均已阵亡！</span>
                  <span className="bg-red-800 text-white text-[10px] px-1.5 py-0.2 rounded font-mono font-bold">
                    跑尸惩罚 10s
                  </span>
                </div>
                <div className="text-[10px] text-red-300/80">
                  全队正在释放灵魂奔回副本，倒计时结束后全员群体复活并开启行军
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <span className="text-sm font-mono font-black text-amber-300 bg-black/60 px-2 py-0.5 rounded border border-amber-400/40">
                {corpseRunSec}s
              </span>
              <button
                disabled
                className="px-3 py-1.5 bg-gray-800 text-gray-400 font-bold text-xs rounded-lg border border-gray-700 cursor-not-allowed opacity-60"
                title="跑尸惩罚期间无法跳过行军"
              >
                跑尸中不可跳过
              </button>
            </div>
          </div>

          {/* Corpse Run Progress Bar */}
          <div className="w-full bg-black/70 rounded-full h-2 overflow-hidden border border-red-500/40">
            <div
              className="bg-gradient-to-r from-red-600 via-orange-500 to-amber-400 h-full transition-all duration-75 ease-linear rounded-full"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  if (hasDeadMembers) {
    return (
      <div className="w-full max-w-2xl mx-auto py-1 px-3">
        <div className="bg-amber-950/85 border-2 border-amber-500/80 rounded-xl p-2.5 shadow-xl backdrop-blur flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="text-xl">🪦</span>
            <div>
              <div className="text-xs font-black text-amber-200 tracking-wide flex items-center space-x-1">
                <span>队友阵亡：{deadUnits.map(u => u.name).join('、')}</span>
                <span className="bg-amber-800/80 text-amber-100 text-[10px] px-1.5 py-0.2 rounded font-bold">
                  等待复活
                </span>
              </div>
              <div className="text-[10px] text-amber-300/80">
                {isReviving
                  ? `✨ 正在施放【起死回生】复活【${revivingTargetName || '阵亡队员'}】...`
                  : '等待存活的治疗者施法复活，全员齐备方可行军探索'}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {isPlayerHealer && onPlayerRevive && (
              <button
                type="button"
                onClick={onPlayerRevive}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg shadow border border-emerald-400 flex items-center space-x-1"
              >
                <span>✨</span>
                <span>复活队友</span>
              </button>
            )}

            <button
              disabled
              className="px-3 py-1.5 bg-gray-800 text-gray-400 font-bold text-xs rounded-lg border border-gray-700 cursor-not-allowed opacity-60"
              title="有队友处于阵亡状态，需等待全部复活后方可推进"
            >
              等待复活中
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center py-1">
      <button
        onClick={onFastForward}
        className="px-6 py-2 bg-gradient-to-r from-amber-600 via-amber-500 to-yellow-500 hover:from-amber-500 hover:to-yellow-400 text-white font-extrabold rounded-xl shadow-lg border border-amber-400/60 flex items-center space-x-2 text-xs transition transform hover:scale-105 active:scale-95 cursor-pointer backdrop-blur"
        title={`点击立即跳过行军，直接开启与【${targetBossName}】的战斗`}
      >
        <span className="text-sm">⏩</span>
        <span className="tracking-wide">跳过行军</span>
        <span className="bg-black/40 px-1.5 py-0.5 rounded text-[10px] font-mono text-amber-200 border border-amber-300/30">
          {seconds}s
        </span>
      </button>
    </div>
  );
};
