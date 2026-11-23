import React from 'react';

export type GameLoadingScreenProps = {
  percent: number;
  label: string;
};

/**
 * Full-screen boot overlay while ART icons / account data download.
 */
export const GameLoadingScreen: React.FC<GameLoadingScreenProps> = ({ percent, label }) => {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#0a0a14] text-gray-100 select-none overflow-hidden">
      {/* Atmosphere */}
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            'radial-gradient(ellipse 80% 55% at 50% 35%, rgba(180,120,40,0.22), transparent 70%), radial-gradient(ellipse 60% 40% at 50% 100%, rgba(30,40,80,0.35), transparent 60%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(255,255,255,0.04) 3px, rgba(255,255,255,0.04) 4px)',
        }}
      />

      <div className="relative z-10 w-full max-w-md px-8 flex flex-col items-center">
        <div className="text-5xl mb-3 drop-shadow-lg" aria-hidden>
          🐉
        </div>
        <h1 className="font-extrabold text-amber-300 text-2xl tracking-wide mb-1 text-center">
          魔兽大灾变模拟器
        </h1>
        <p className="text-gray-400 text-xs mb-8 tracking-wider">正在准备进入游戏</p>

        <div className="w-full">
          <div className="flex justify-between text-[11px] text-amber-200/90 mb-1.5 font-mono">
            <span className="truncate pr-2">{label || '加载中…'}</span>
            <span className="flex-shrink-0">{pct}%</span>
          </div>
          <div className="h-3 rounded-sm bg-[#1a1a2e] border border-[#3d3420] overflow-hidden shadow-inner">
            <div
              className="h-full rounded-sm transition-[width] duration-200 ease-out"
              style={{
                width: `${pct}%`,
                background:
                  'linear-gradient(90deg, #92400e 0%, #d97706 45%, #fbbf24 100%)',
                boxShadow: '0 0 12px rgba(251, 191, 36, 0.35)',
              }}
            />
          </div>
          <p className="mt-3 text-center text-[10px] text-gray-500">
            下载技能图标与界面资源，完成后自动进入
          </p>
        </div>
      </div>
    </div>
  );
};
