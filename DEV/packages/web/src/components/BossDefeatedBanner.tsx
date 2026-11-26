import React from 'react';
import { getSpellIconUrl } from '../assets/pixelIcons.js';

export interface BossDefeatedBannerInfo {
  id: string;
  name: string;
  stageNumber: number;
  durationSec?: number;
  fadingOut?: boolean;
}

interface Props {
  info: BossDefeatedBannerInfo | null;
}

export const BossDefeatedBanner: React.FC<Props> = ({ info }) => {
  if (!info) return null;

  const iconUrl = getSpellIconUrl(info.id);

  return (
    <div
      className={`absolute top-[12px] left-1/2 -translate-x-1/2 z-30 w-[min(92vw,460px)] pointer-events-none select-none transition-all duration-500 ${
        info.fadingOut ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
      }`}
    >
      <div className="relative w-full px-5 py-3.5 rounded-xl bg-gradient-to-b from-[#1a1326]/95 via-[#12101f]/95 to-[#0b0d18]/95 border-2 border-amber-400/85 shadow-[0_0_32px_rgba(251,191,36,0.42)] flex flex-col items-center text-center space-y-1.5 backdrop-blur-md">
        <div className="flex items-center justify-center gap-2.5">
          <div className="relative flex-shrink-0">
            <div className="w-10 h-10 rounded-lg bg-[#090B14] border-2 border-amber-400/90 shadow-[0_0_14px_rgba(251,191,36,0.5)] flex items-center justify-center overflow-hidden">
              {iconUrl ? (
                <img
                  src={iconUrl}
                  alt={info.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-xl leading-none">🏆</span>
              )}
            </div>
            <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 text-[#090B14] text-[10px] font-black flex items-center justify-center shadow">
              ✓
            </span>
          </div>

          <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/50 text-amber-300 text-[11px] font-extrabold tracking-wider whitespace-nowrap">
            第 {info.stageNumber} 关通关
          </span>
          {typeof info.durationSec === 'number' && info.durationSec > 0 && (
            <span className="text-[11px] font-mono text-emerald-300/90 font-bold whitespace-nowrap">
              耗时 {Math.round(info.durationSec)}s
            </span>
          )}
        </div>

        <div className="w-full text-lg font-black tracking-wide leading-snug text-amber-300 drop-shadow-[0_2px_8px_rgba(251,191,36,0.45)] text-center">
          {info.name} · 首领已击败！
        </div>

        <div className="w-full text-xs text-cyan-300/90 font-semibold tracking-wide leading-snug text-center">
          ✦ 战斗胜利奖励：全队回复整备，正在前往下一首领…
        </div>
      </div>
    </div>
  );
};
