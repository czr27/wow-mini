import React from 'react';
import type { NetworkVoteState, Unit } from '@cata-raid-sim/engine';

interface Props {
  targetBossName: string;
  remainingMs: number;
  totalMs?: number;
  deadUnits?: Unit[];
  isReviving?: boolean;
  reviveProgress?: number;
  revivingTargetName?: string;
  isPlayerHealer?: boolean;
  onPlayerRevive?: () => void;
  onFastForward: () => void;
  isCorpseRunning?: boolean;
  corpseRunRemainingMs?: number;
  /** Multiplayer skip-travel vote (majority YES; 10s timeout = NO) */
  skipTravelVote?: NetworkVoteState | null;
  mySkipVote?: 'YES' | 'NO' | null;
  onSkipTravelVote?: (choice: 'YES' | 'NO') => void;
  dungeonTier?: '5man' | '20man';
}

const shellClass =
  'w-full max-w-[560px] mx-auto rounded-2xl border backdrop-blur-md shadow-[0_12px_40px_rgba(0,0,0,0.45)] overflow-hidden';

export const TravelRecovery: React.FC<Props> = ({
  targetBossName,
  remainingMs,
  totalMs = 7000,
  deadUnits = [],
  isReviving = false,
  reviveProgress = 0,
  onFastForward,
  isCorpseRunning = false,
  corpseRunRemainingMs = 0,
  skipTravelVote = null,
  mySkipVote = null,
  onSkipTravelVote,
  dungeonTier = '5man',
}) => {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const hasDeadMembers = deadUnits.length > 0;
  const corpseRunSec = Math.max(0, corpseRunRemainingMs / 1000).toFixed(1);
  const progressPct = Math.min(
    100,
    Math.max(0, totalMs > 0 ? ((totalMs - remainingMs) / totalMs) * 100 : 0)
  );
  const partyLabel = dungeonTier === '20man' ? '20 人团队' : '5 人小队';

  if (isCorpseRunning) {
    const runPct = Math.min(100, Math.max(0, (1 - corpseRunRemainingMs / 10000) * 100));
    return (
      <div className={`${shellClass} border-red-500/50 bg-[#1a0608]/92`}>
        <div className="px-3.5 pt-2.5 pb-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-red-100 tracking-wide">跑尸惩罚</div>
            <div className="text-[10px] text-red-200/70 truncate">
              全员阵亡 · 倒计时结束后群体复活并继续行军
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono text-sm font-bold text-amber-300 tabular-nums">{corpseRunSec}s</span>
            <span className="px-2.5 py-1 rounded-lg text-[10px] font-semibold text-red-200/60 bg-black/35 border border-red-900/60">
              不可跳过
            </span>
          </div>
        </div>
        <div className="h-1.5 bg-black/50">
          <div
            className="h-full bg-gradient-to-r from-red-700 via-orange-500 to-amber-400 transition-[width] duration-75 ease-linear"
            style={{ width: `${runPct}%` }}
          />
        </div>
      </div>
    );
  }

  if (hasDeadMembers) {
    const revPct = Math.min(100, Math.max(0, reviveProgress * 100));
    return (
      <div className={`${shellClass} border-amber-500/45 bg-[#1a1206]/92`}>
        <div className="px-3.5 pt-2.5 pb-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-amber-100 tracking-wide truncate">
              系统群体复活（8s）· {deadUnits.map((u) => u.name).join('、')}
            </div>
            <div className="text-[10px] text-amber-200/70 truncate">
              {isReviving
                ? `正在读条群体复活中… ${Math.round(revPct)}%`
                : '全员齐备后方可继续行军'}
            </div>
          </div>
          <div className="shrink-0 font-mono text-sm font-bold text-amber-300 tabular-nums">
            {Math.max(0, ((1 - reviveProgress) * 8)).toFixed(1)}s
          </div>
        </div>
        <div className="h-1.5 bg-black/50">
          <div
            className="h-full bg-gradient-to-r from-amber-600 via-amber-400 to-emerald-400 transition-[width] duration-75 ease-linear"
            style={{ width: `${revPct}%` }}
          />
        </div>
      </div>
    );
  }

  const skipVoteActive =
    !!skipTravelVote &&
    !skipTravelVote.resolved &&
    Date.now() - skipTravelVote.startedAtMs < skipTravelVote.timeoutMs;

  if (skipVoteActive && skipTravelVote) {
    // 只统计可投票人；与服务端 hasMajorityYes 口径一致（发起跳过已记 YES）
    const yes = skipTravelVote.eligiblePlayerIds.filter(
      (id) => skipTravelVote.votes[id] === 'YES'
    ).length;
    const no = skipTravelVote.eligiblePlayerIds.filter(
      (id) => skipTravelVote.votes[id] === 'NO'
    ).length;
    const need = Math.floor(skipTravelVote.eligiblePlayerIds.length / 2) + 1;
    const voteLeftSec = Math.max(
      0,
      Math.ceil((skipTravelVote.timeoutMs - (Date.now() - skipTravelVote.startedAtMs)) / 1000)
    );
    return (
      <div className={`${shellClass} border-amber-400/50 bg-[#1a1408]/94`}>
        <div className="px-3.5 pt-2.5 pb-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-amber-100">跳过行军投票</div>
            <div className="text-[10px] text-amber-200/70">
              同意 {yes}/{skipTravelVote.eligiblePlayerIds.length}（过半数需 ≥{need}）· 反对 {no} · 超时算不同意
            </div>
          </div>
          <span className="font-mono text-sm font-bold text-amber-300 tabular-nums shrink-0">{voteLeftSec}s</span>
        </div>
        <div className="px-3.5 pb-2.5 flex items-center justify-center gap-2">
          <button
            type="button"
            disabled={!!mySkipVote}
            onClick={() => onSkipTravelVote?.('YES')}
            className={`px-4 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${
              mySkipVote === 'YES'
                ? 'bg-emerald-600 text-white border-emerald-300 ring-2 ring-amber-300/80'
                : 'bg-emerald-800/80 hover:bg-emerald-700 text-emerald-50 border-emerald-500/40'
            } ${mySkipVote && mySkipVote !== 'YES' ? 'opacity-45' : ''}`}
          >
            同意跳过
          </button>
          <button
            type="button"
            disabled={!!mySkipVote}
            onClick={() => onSkipTravelVote?.('NO')}
            className={`px-4 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${
              mySkipVote === 'NO'
                ? 'bg-slate-600 text-white border-slate-300 ring-2 ring-amber-300/80'
                : 'bg-slate-800/80 hover:bg-slate-700 text-slate-100 border-slate-500/40'
            } ${mySkipVote && mySkipVote !== 'NO' ? 'opacity-45' : ''}`}
          >
            不同意
          </button>
        </div>
      </div>
    );
  }

  // Default: unified march strip — status + progress + skip
  return (
    <div
      className={`${shellClass} border-cyan-500/25`}
      style={{
        background:
          'linear-gradient(135deg, rgba(8,20,32,0.94) 0%, rgba(12,28,40,0.92) 55%, rgba(18,24,20,0.9) 100%)',
      }}
    >
      <div className="px-3.5 pt-2.5 pb-2 flex items-center gap-3">
        {/* March destination + progress */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <div className="text-[11px] font-semibold text-slate-100/95 truncate">
              <span className="text-slate-400 font-medium">前往 · </span>
              {targetBossName || '首领'}
            </div>
            <div className="text-[10px] text-slate-400 shrink-0 tabular-nums">
              {partyLabel} · {Math.round(progressPct)}%
            </div>
          </div>
          <div className="h-1.5 rounded-full bg-black/45 overflow-hidden border border-white/5">
            <div
              className="h-full rounded-full transition-[width] duration-150 ease-out"
              style={{
                width: `${progressPct}%`,
                background: 'linear-gradient(90deg, #0e7490, #22d3ee, #67e8f9)',
              }}
            />
          </div>
          <div className="mt-1 text-[9px] text-slate-500 truncate">
            自动赶路中（Buff时间）
          </div>
        </div>

        {/* Countdown + skip */}
        <div className="shrink-0 flex items-center gap-2">
          <div className="text-right leading-none pr-0.5">
            <div className="font-mono text-base font-bold text-cyan-100 tabular-nums tracking-tight">
              {seconds}
              <span className="text-[10px] font-semibold text-cyan-300/70 ml-0.5">s</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onFastForward}
            className="group relative h-8 flex items-center px-3.5 rounded-xl text-[11px] font-extrabold tracking-wide leading-none text-[#1a1205] border border-amber-300/70 transition-transform hover:scale-[1.03] active:scale-[0.97] shadow-[0_4px_18px_rgba(245,158,11,0.35)]"
            style={{
              background: 'linear-gradient(160deg, #fbbf24 0%, #f59e0b 48%, #d97706 100%)',
            }}
          >
            <span className="relative z-10 flex items-center gap-1">
              <span aria-hidden className="opacity-80 text-[10px]">
                ▶▶
              </span>
              跳过
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
