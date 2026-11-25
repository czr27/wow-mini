import React, { useRef } from 'react';
import { useSmoothCastProgress } from '../hooks/useSmoothCastProgress.js';

interface Props {
  bossName: string;
  hp: number;
  maxHp: number;
  targetName?: string;
  targetRole?: 'TANK' | 'HEALER' | 'DPS' | 'ENEMY';
  isTargetOT?: boolean;
  castBar?: {
    spellName: string;
    progressMs: number;
    totalMs: number;
    interruptible: boolean;
  } | null;
  debuffs?: Array<{ id: string; name: string; remainingMs: number }>;
}

export const BossBar: React.FC<Props> = ({
  bossName,
  hp,
  maxHp,
  targetName,
  targetRole,
  isTargetOT = false,
  castBar,
  debuffs = [],
}) => {
  const isDead = hp <= 0;
  const hpPct = isDead ? 0 : Math.max(0, Math.min(100, (hp / maxHp) * 100));
  const isCasting = !isDead && Boolean(castBar && castBar.progressMs < castBar.totalMs);
  const castFillRef = useRef<HTMLDivElement | null>(null);

  useSmoothCastProgress({
    active: isCasting,
    castKey: isCasting && castBar ? `${castBar.spellName}:${castBar.totalMs}` : '',
    elapsedMs: castBar?.progressMs ?? 0,
    totalMs: castBar?.totalMs ?? 1,
    fillRef: castFillRef,
  });

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col items-center select-none">
      {/* Boss Main Frame */}
      <div className="w-full bg-[#16162a]/95 border-2 border-[#4a2020] rounded-xl p-3 shadow-2xl backdrop-blur relative overflow-hidden">
        
        {/* Header Name & HP & Target of Boss */}
        <div className="flex items-center justify-between mb-1.5 text-sm font-extrabold">
          <div className="flex items-center space-x-2">
            <span className="text-red-500 text-base">{isDead ? '🪦' : '💀'}</span>
            <span className="text-red-400 tracking-wide text-base">{bossName}</span>
            {isDead && (
              <span className="bg-emerald-950 border border-emerald-500/60 text-emerald-300 text-xs px-2 py-0.5 rounded font-bold">
                ✓ 已被击败
              </span>
            )}
          </div>

          {/* Boss Target Frame (Boss的目标) */}
          {!isDead && targetName && (
            <div className={`flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full border text-xs font-mono ${
              isTargetOT
                ? 'bg-red-950/80 border-red-500 text-red-200 animate-pulse'
                : 'bg-black/60 border-slate-700 text-gray-300'
            }`}>
              <span className="text-gray-400 text-[11px]">首领当前目标:</span>
              <span className={`font-bold ${isTargetOT ? 'text-red-400 font-extrabold' : 'text-amber-300'}`}>
                {targetName}
              </span>
              {!isTargetOT && targetRole === 'TANK' && (
                <span className="text-[10px] text-gray-400">(坦克)</span>
              )}
            </div>
          )}

          <div className="font-mono text-gray-200">
            <span className="text-amber-300 mr-2">{Math.round(hpPct)}%</span>
            <span className="text-gray-400 text-xs">({hp.toLocaleString()} / {maxHp.toLocaleString()})</span>
          </div>
        </div>

        {/* Boss HP Bar */}
        <div className="w-full bg-[#0a0a14] h-5 rounded-lg overflow-hidden border border-red-950/80 relative">
          <div
            className={`h-full transition-all duration-150 shadow-inner ${
              isDead ? 'bg-gray-700' : 'bg-gradient-to-r from-red-700 via-red-600 to-amber-600'
            }`}
            style={{ width: `${hpPct}%` }}
          />
        </div>

        {/* Cast Bar (Only when boss is alive and casting) */}
        {isCasting && (
          <div className="mt-2 bg-[#0d0d1a] border border-blue-500/60 rounded-md p-1.5 shadow-md animate-pulse">
            <div className="flex items-center justify-between text-xs font-bold mb-1">
              <span className="text-blue-300 flex items-center space-x-1.5">
                <span>⚡ 正在施法：</span>
                <span className="text-white font-extrabold">{castBar.spellName}</span>
              </span>
              <span>
                {castBar.interruptible ? (
                  <span className="bg-red-600 text-white px-1.5 py-0.5 rounded text-[10px] font-extrabold tracking-wider animate-bounce">
                    [按快捷键打断！]
                  </span>
                ) : (
                  <span className="text-gray-400 text-[10px]">[不可打断]</span>
                )}
              </span>
            </div>
            <div className="w-full bg-[#06060e] h-2 rounded overflow-hidden">
              <div
                ref={castFillRef}
                className="h-full w-full bg-blue-500 origin-left"
                style={{ willChange: 'transform' }}
              />
            </div>
          </div>
        )}

        {/* Boss Debuffs */}
        {!isDead && debuffs.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2 pt-1 border-t border-[#2a2a44]">
            {debuffs.map(d => (
              <span
                key={d.id}
                className="text-[10px] bg-purple-950/80 border border-purple-500/50 text-purple-200 px-1.5 py-0.5 rounded font-mono"
              >
                {d.name} {Math.ceil(d.remainingMs / 1000)}s
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
