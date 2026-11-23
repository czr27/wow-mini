import React, { useEffect, useRef, useState } from 'react';
import type { Buff, Unit } from '@cata-raid-sim/engine';
import { SPELL_ICONS } from '../assets/pixelIcons.js';
import {
  formatAuraRemaining,
  getAuraCasterName,
  getAuraDescription,
  type AuraHoverData,
} from './AuraTooltip.js';
import { DEBUFF_REGISTRY } from './RaidFrames.js';

/** Blizzard BuffFrame.lua constants */
const BUFF_FLASH_TIME_ON = 0.75;
const BUFF_FLASH_TIME_OFF = 0.75;
const BUFF_MIN_ALPHA = 0.3;
const BUFF_WARNING_TIME_SEC = 31;
const BUFF_DURATION_WARNING_TIME_SEC = 60;
const BUFFS_PER_ROW = 8;
const MAX_BUFFS = 32;
const MAX_DEBUFFS = 16;

export function formatBuffDurationAbbrev(remainingMs: number): string | null {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0 || remainingMs >= 3_600_000) {
    return null;
  }
  const sec = remainingMs / 1000;
  if (sec >= 3600) {
    return `${Math.ceil(sec / 3600)}h`;
  }
  if (sec >= 60) {
    return `${Math.ceil(sec / 60)}m`;
  }
  if (sec >= 10) {
    return `${Math.ceil(sec)}s`;
  }
  return `${sec.toFixed(1)}s`;
}

function isPermanentAura(buff: Buff): boolean {
  return !buff.durationMs || buff.durationMs <= 0 || buff.remainingMs >= 3_600_000;
}

function debuffBorderClass(spellId: string): string {
  const dispel = DEBUFF_REGISTRY[spellId]?.dispelType;
  if (dispel === 'MAGIC') return 'border-blue-500 ring-1 ring-blue-500/50';
  if (dispel === 'CURSE') return 'border-purple-500 ring-1 ring-purple-500/50';
  if (dispel === 'POISON') return 'border-green-500 ring-1 ring-green-500/50';
  if (dispel === 'DISEASE') return 'border-amber-700 ring-1 ring-amber-700/50';
  return 'border-red-500 ring-1 ring-red-500/50';
}

interface AuraButtonProps {
  buff: Buff;
  flashAlpha: number;
  onHover: (data: AuraHoverData | null) => void;
}

const AuraButton: React.FC<AuraButtonProps> = ({ buff, flashAlpha, onHover }) => {
  const isDebuff = buff.kind === 'DEBUFF';
  const debuffMeta = DEBUFF_REGISTRY[buff.spellId];
  const svgIcon = SPELL_ICONS[buff.spellId];
  const remainingSec = buff.remainingMs / 1000;
  const shouldFlash = !isPermanentAura(buff) && remainingSec < BUFF_WARNING_TIME_SEC;
  const durationText = isPermanentAura(buff) ? null : formatBuffDurationAbbrev(buff.remainingMs);
  const durationWarn = remainingSec < BUFF_DURATION_WARNING_TIME_SEC;
  const borderColor = isDebuff
    ? debuffBorderClass(buff.spellId)
    : 'border-[#3e3e5c] hover:border-[#5a5a84]';

  return (
    <div className="flex flex-col items-center w-11 flex-shrink-0">
      <div
        className={`w-11 h-11 rounded-lg border relative overflow-hidden flex items-center justify-center bg-[#16162a] shadow cursor-pointer ${borderColor}`}
        style={{ opacity: shouldFlash ? flashAlpha : 1 }}
        onMouseEnter={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          onHover({
            buff,
            x: rect.left,
            y: rect.bottom + 6,
          });
        }}
        onMouseLeave={() => onHover(null)}
      >
        {svgIcon ? (
          <div
            className="w-full h-full p-0.5 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full pointer-events-none"
            dangerouslySetInnerHTML={{ __html: svgIcon }}
          />
        ) : (
          <span
            className="text-[11px] font-black z-10 pointer-events-none drop-shadow"
            style={{ color: isDebuff ? debuffMeta?.color || '#EF4444' : '#FACC15' }}
          >
            {debuffMeta?.label || buff.name.substring(0, 1)}
          </span>
        )}

        {buff.stacks > 1 && (
          <span className="absolute bottom-0 right-0 bg-black/95 text-amber-300 text-[10px] font-black font-mono px-0.5 rounded-tl leading-none z-20 border-t border-l border-amber-400/60 pointer-events-none shadow">
            {buff.stacks}
          </span>
        )}
      </div>

      {durationText ? (
        <span
          className={`mt-0.5 text-[10px] font-mono font-bold leading-none drop-shadow-[0_1px_2px_rgba(0,0,0,1)] ${
            durationWarn ? 'text-white' : 'text-[#ffd100]'
          }`}
        >
          {durationText}
        </span>
      ) : (
        <span className="mt-0.5 text-[10px] leading-none invisible">0s</span>
      )}
    </div>
  );
};

function AuraRow({
  auras,
  flashAlpha,
  onHover,
}: {
  auras: Buff[];
  flashAlpha: number;
  onHover: (data: AuraHoverData | null) => void;
}) {
  if (auras.length === 0) return null;

  const rows: Buff[][] = [];
  for (let i = 0; i < auras.length; i += BUFFS_PER_ROW) {
    rows.push(auras.slice(i, i + BUFFS_PER_ROW));
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {rows.map((row, rowIdx) => (
        <div key={rowIdx} className="flex flex-row-reverse flex-wrap justify-start gap-1">
          {row.map((b) => (
            <AuraButton key={b.id} buff={b} flashAlpha={flashAlpha} onHover={onHover} />
          ))}
        </div>
      ))}
    </div>
  );
}

export interface BuffFrameProps {
  player: Unit;
  allUnits?: Unit[];
}

/**
 * Classic BuffFrame: top-right self buffs/debuffs with duration text + expire flash.
 */
export const BuffFrame: React.FC<BuffFrameProps> = ({ player, allUnits = [] }) => {
  const [flashAlpha, setFlashAlpha] = useState(1);
  const [hoveredAura, setHoveredAura] = useState<AuraHoverData | null>(null);
  const flashStateRef = useRef<{ state: 0 | 1; time: number }>({ state: 1, time: BUFF_FLASH_TIME_ON });

  const allAuras = player.buffs || [];
  const buffs = allAuras.filter((b) => b.kind === 'BUFF').slice(0, MAX_BUFFS);
  const debuffs = allAuras.filter((b) => b.kind === 'DEBUFF').slice(0, MAX_DEBUFFS);

  const needsFlash = [...buffs, ...debuffs].some(
    (b) => !isPermanentAura(b) && b.remainingMs / 1000 < BUFF_WARNING_TIME_SEC,
  );

  useEffect(() => {
    if (!needsFlash) {
      setFlashAlpha(1);
      return;
    }

    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const elapsed = (now - last) / 1000;
      last = now;
      const st = flashStateRef.current;
      st.time -= elapsed;
      if (st.time < 0) {
        const overtime = -st.time;
        if (st.state === 0) {
          st.state = 1;
          st.time = BUFF_FLASH_TIME_ON;
        } else {
          st.state = 0;
          st.time = BUFF_FLASH_TIME_OFF;
        }
        if (overtime < st.time) st.time -= overtime;
      }
      let alpha: number;
      if (st.state === 1) {
        alpha = (BUFF_FLASH_TIME_ON - st.time) / BUFF_FLASH_TIME_ON;
      } else {
        alpha = st.time / BUFF_FLASH_TIME_ON;
      }
      alpha = alpha * (1 - BUFF_MIN_ALPHA) + BUFF_MIN_ALPHA;
      setFlashAlpha(alpha);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [needsFlash]);

  const tooltipBuff = hoveredAura
    ? allAuras.find((b) => b.id === hoveredAura.buff.id) || null
    : null;

  if (buffs.length === 0 && debuffs.length === 0) return null;

  return (
    <>
      <div className="absolute top-3 right-4 z-30 flex flex-col items-end gap-2 pointer-events-auto">
        <AuraRow auras={buffs} flashAlpha={flashAlpha} onHover={setHoveredAura} />
        <AuraRow auras={debuffs} flashAlpha={flashAlpha} onHover={setHoveredAura} />
      </div>

      {hoveredAura && tooltipBuff && (
        <div
          className="fixed z-50 pointer-events-none w-64 bg-[#0d0d1e]/98 border-2 border-[#5c4a28] rounded-md p-2.5 shadow-2xl backdrop-blur font-sans text-xs text-gray-200"
          style={{
            left: `${Math.min(window.innerWidth - 270, Math.max(10, hoveredAura.x - 200))}px`,
            top: `${Math.min(window.innerHeight - 160, Math.max(10, hoveredAura.y))}px`,
          }}
        >
          <div className="flex justify-between items-center border-b border-[#3e341f] pb-1">
            <span className="font-extrabold text-amber-300 text-[12px] tracking-wide">
              {tooltipBuff.name}
            </span>
            <span
              className={`text-[9.5px] font-bold px-1 rounded ${
                tooltipBuff.kind === 'BUFF'
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                  : 'bg-red-950 text-red-300 border border-red-500/40'
              }`}
            >
              {DEBUFF_REGISTRY[tooltipBuff.spellId]?.dispelType
                ? `${DEBUFF_REGISTRY[tooltipBuff.spellId].dispelType} 减益`
                : tooltipBuff.kind === 'BUFF'
                  ? '增益效果'
                  : '减益状态'}
            </span>
          </div>

          <div className="flex justify-between text-[10.5px] text-gray-300 py-1 border-b border-[#2d2d44]/50">
            <span>{formatAuraRemaining(tooltipBuff)}</span>
            <span className="text-amber-200/90 truncate max-w-[125px]">
              施法者: {getAuraCasterName(tooltipBuff, allUnits)}
            </span>
          </div>

          <div className="pt-1.5 text-[#ffd100] text-[11px] leading-relaxed">
            {getAuraDescription(tooltipBuff)}
          </div>

          {(tooltipBuff.stacks > 1 || (tooltipBuff.maxStacks && tooltipBuff.maxStacks > 1)) && (
            <div className="text-[10px] text-cyan-300 font-mono pt-1">
              当前层数: {tooltipBuff.stacks}
              {tooltipBuff.maxStacks ? ` / ${tooltipBuff.maxStacks} ` : ''}层
            </div>
          )}
        </div>
      )}
    </>
  );
};
