import React, { useState, useEffect, useRef } from 'react';
import type { Unit } from '@cata-raid-sim/engine';
import { CLASS_PIXEL_AVATARS, SPELL_ICONS } from '../assets/pixelIcons.js';
import { CLASS_COLORS_CATA } from './RaidFrames.js';
import { AuraIconList, CastBarSpellHover, type UnitFrameCastState } from './AuraTooltip.js';
import { clampHudPosToViewport } from '../utils/hudLayout.js';

export interface FocusUnitFrameProps {
  unit: Unit;
  allUnits?: Unit[];
  castState?: UnitFrameCastState | null;
  onClearFocus?: () => void;
  onSelectTarget?: (id: string) => void;
  onSetFocus?: (id: string) => void;
}

const STORAGE_KEY = 'cata_focus_frame_pos';
const DEFAULT_POS = { x: 285, y: 200 };
const FRAME_WIDTH = 230;
const FRAME_HEIGHT = 125;

function clampFramePos(pos: { x: number; y: number }): { x: number; y: number } {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 1080;
  return clampHudPosToViewport(pos, vw, vh, FRAME_WIDTH, FRAME_HEIGHT);
}

function loadSavedPosition(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        return clampFramePos(parsed);
      }
    }
  } catch {}
  return clampFramePos(DEFAULT_POS);
}

export const FocusUnitFrame: React.FC<FocusUnitFrameProps> = ({
  unit,
  allUnits = [],
  castState = null,
  onClearFocus,
  onSelectTarget,
  onSetFocus,
}) => {
  const [pos, setPos] = useState<{ x: number; y: number }>(loadSavedPosition);
  const [isDragging, setIsDragging] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  useEffect(() => {
    setPos((prev) => clampFramePos(prev));
    const onResize = () => setPos((prev) => clampFramePos(prev));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Drag listeners with boundary clamping
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPos(
        clampFramePos({
          x: dragRef.current.origX + dx,
          y: dragRef.current.origY + dy,
        })
      );
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragRef.current = null;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
      } catch {}
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, pos]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isLocked) return;
    if ((e.target as HTMLElement).closest('button')) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    };
    setIsDragging(true);
  };

  const isBoss = unit.role === 'ENEMY' || unit.classId === 'BOSS' || (unit.maxHp > 500000 && !unit.isPlayer);
  const isFriendly = !isBoss && (unit.isPlayer || unit.role !== 'ENEMY');
  const isAlive = (unit.isAlive ?? unit.alive) && unit.hp > 0;
  const hpPct = unit.maxHp > 0 ? Math.max(0, Math.min(100, Math.round((unit.hp / unit.maxHp) * 100))) : 0;
  const unitClassColor = isBoss ? '#C41E3A' : CLASS_COLORS_CATA[unit.classId] || '#69CCF0';

  // ── Adaptive Power Bar (matches PlayerUnitFrame) ───────────────────────────
  const isRogue = unit.classId === 'ROGUE';
  const isDK = unit.classId === 'DK';
  const isWarrior = unit.classId === 'WARRIOR';
  const isHunter = unit.classId === 'HUNTER';

  let powerBarColor = '#0070DE';
  let powerCurrent = unit.mp || 0;
  let powerMax = unit.maxMp || (isFriendly ? 45000 : 100);
  let powerText = `${Math.round(powerCurrent).toLocaleString()} / ${Math.round(powerMax).toLocaleString()}`;
  let powerPct = powerMax > 0 ? Math.max(0, Math.min(100, (powerCurrent / powerMax) * 100)) : 0;

  if (isRogue) {
    powerBarColor = '#FFF569';
    powerCurrent = Math.round(unit.energy ?? 100);
    powerMax = 100;
    powerText = `${powerCurrent} / 100`;
    powerPct = Math.max(0, Math.min(100, powerCurrent));
  } else if (isWarrior) {
    const rageRes = unit.resources?.find(r => r.kind === 'RAGE');
    powerBarColor = '#DC2626';
    powerCurrent = Math.round(rageRes?.current ?? unit.rage ?? 0);
    powerMax = rageRes?.max ?? 100;
    powerText = `${powerCurrent} / ${powerMax}`;
    powerPct = powerMax > 0 ? Math.max(0, Math.min(100, (powerCurrent / powerMax) * 100)) : 0;
  } else if (isHunter) {
    const focusRes = unit.resources?.find(r => r.kind === 'FOCUS');
    powerBarColor = '#F97316';
    powerCurrent = Math.round(focusRes?.current ?? unit.focus ?? 100);
    powerMax = focusRes?.max ?? 100;
    powerText = `${powerCurrent} / ${powerMax}`;
    powerPct = powerMax > 0 ? Math.max(0, Math.min(100, (powerCurrent / powerMax) * 100)) : 0;
  } else if (isDK) {
    const rpRes = unit.resources?.find(r => r.kind === 'RUNIC_POWER');
    powerBarColor = '#00D8FF';
    powerCurrent = Math.round(rpRes?.current ?? unit.runicPower ?? 0);
    powerMax = rpRes?.max ?? 100;
    powerText = `${powerCurrent} / ${powerMax}`;
    powerPct = powerMax > 0 ? Math.max(0, Math.min(100, (powerCurrent / powerMax) * 100)) : 0;
  } else if (isBoss) {
    powerBarColor = unit.maxMp ? '#0070DE' : '#C41E3A';
    powerCurrent = Math.round(unit.mp ?? 0);
    powerMax = unit.maxMp || 100;
    powerText = `${powerCurrent} / ${powerMax}`;
    powerPct = powerMax > 0 ? Math.max(0, Math.min(100, (powerCurrent / powerMax) * 100)) : 0;
  }

  // Buffs & debuffs
  const allAuras = unit.buffs || [];
  const buffs = allAuras.filter(b => b.kind === 'BUFF');
  const debuffs = allAuras.filter(b => b.kind === 'DEBUFF');

  // Shield icon for uninterruptible casting
  const isShielded = castState ? !castState.interruptible : false;
  const prevCastProgressRef = useRef<number>(0);
  const targetCastRatio = castState
    ? castState.endFlash
      ? 1
      : Math.min(1, Math.max(0, castState.progress || 0))
    : 0;
  const snapCastBar =
    !castState ||
    Boolean(castState.endFlash) ||
    targetCastRatio < prevCastProgressRef.current - 0.05;
  prevCastProgressRef.current = targetCastRatio;

  const handleClickFrame = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    if (e.shiftKey) {
      e.preventDefault();
      if (onSetFocus) onSetFocus(unit.id);
    } else {
      if (onSelectTarget) onSelectTarget(unit.id);
    }
  };

  return (
    <div
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
      className={`fixed z-40 select-none transition-shadow group/focus-frame ${
        isDragging ? 'cursor-grabbing shadow-[0_0_24px_rgba(245,158,11,0.5)]' : ''
      }`}
      onClick={handleClickFrame}
    >
      {/* Transparent plate; hover → semi-transparent; lock/clear only on hover */}
      <div
        onMouseDown={handleMouseDown}
        className={`relative bg-transparent border-0 rounded-xl p-1.5 w-[230px] transition-colors group-hover/focus-frame:bg-black/45 ${
          isLocked ? 'cursor-default' : 'cursor-grab'
        }`}
      >
        {/* Header Bar: Focus Target Title + Name + Lock & Close Buttons */}
        <div className="flex items-center justify-between px-1 pb-1 mb-1">
          <div className="flex items-center space-x-1">
            <span className="text-[9px] px-1 py-0.2 rounded font-black bg-purple-900/60 text-purple-300 border border-purple-500/50">
              焦点
            </span>
            <span
              className="text-[11px] font-black text-white tracking-wide truncate max-w-[110px]"
              title={`[单击切目标 | Shift+点击设为焦点] ${unit.name}`}
              style={{
                textShadow:
                  '0 0 3px #000, 0 1px 2px #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000',
              }}
            >
              {unit.name}
            </span>
          </div>

          <div className="flex items-center space-x-1 opacity-0 pointer-events-none group-hover/focus-frame:opacity-100 group-hover/focus-frame:pointer-events-auto transition-opacity">
            <button
              onClick={() => setIsLocked(!isLocked)}
              className="text-[10px] text-gray-400 hover:text-amber-300 px-0.5 rounded hover:bg-black/40 transition"
              title={isLocked ? '已锁定位置 (点击解锁)' : '未锁定位置 (按住拖拽)'}
            >
              {isLocked ? '🔒' : '🔓'}
            </button>
            {onClearFocus && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClearFocus();
                }}
                className="text-[10px] text-gray-400 hover:text-red-400 px-1 rounded hover:bg-black/40 transition font-bold"
                title="清除焦点目标"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Main Body: Avatar + Health Bar + Power Bar */}
        <div className="flex items-center space-x-2">
          {/* Avatar circle with Level Badge */}
          <div className="relative flex-shrink-0">
            <div
              className="w-10 h-10 rounded-full border border-[#d4af37] bg-black overflow-hidden relative shadow cursor-pointer hover:border-amber-300 transition"
              title={`[单击切目标 | Shift+点击设为焦点] ${unit.name}`}
            >
              {isBoss ? (
                <div className="w-full h-full flex items-center justify-center bg-[#250508] text-xl">
                  🐉
                </div>
              ) : CLASS_PIXEL_AVATARS[unit.classId] ? (
                <div
                  className="w-full h-full pointer-events-none"
                  dangerouslySetInnerHTML={{ __html: CLASS_PIXEL_AVATARS[unit.classId] }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gray-900 text-sm">
                  👤
                </div>
              )}
            </div>

            {/* Level indicator: 80 for players, ?? 💀 for bosses */}
            <div
              className={`absolute -bottom-1 -left-1 px-1 py-0.2 rounded-full border flex items-center justify-center text-[7.5px] font-black shadow z-20 pointer-events-none ${
                isBoss
                  ? 'bg-red-950 border-red-500 text-red-300'
                  : 'bg-[#1b1b32] border-[#d4af37] text-amber-300'
              }`}
            >
              {isBoss ? '?? 💀' : '80'}
            </div>
          </div>

          {/* Health Bar & Adaptive Power Bar */}
          <div className="flex flex-col space-y-1 flex-1">
            {/* Health Bar */}
            <div className="relative h-[16px] rounded bg-[#101018] border border-[#2b2b3e] overflow-hidden shadow-inner flex items-center justify-center">
              {isAlive && (
                <div
                  className="absolute inset-y-0 left-0 transition-all duration-150 z-0"
                  style={{
                    width: `${hpPct}%`,
                    backgroundColor: unitClassColor,
                    backgroundImage: 'linear-gradient(to bottom, rgba(255,255,255,0.25), rgba(0,0,0,0.3))',
                  }}
                />
              )}

              <span
                className="relative z-10 text-[8.5px] font-mono font-black text-white pointer-events-none drop-shadow"
                style={{
                  textShadow:
                    '0 0 3px #000, 0 1px 2px #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000',
                }}
              >
                {!isAlive
                  ? '💀 阵亡'
                  : `${unit.hp >= 1000000 ? (unit.hp / 1000000).toFixed(1) + 'M' : Math.round(unit.hp / 1000) + 'k'} (${hpPct}%)`}
              </span>
            </div>

            {/* ── Adaptive Power Bar (Matches PlayerUnitFrame) ── */}
            <div className="relative h-[11px] rounded bg-[#0a0a14] border border-[#1e1e2d] overflow-hidden shadow-inner flex items-center justify-center">
              <div
                className="absolute inset-y-0 left-0 transition-all duration-150 z-0"
                style={{
                  width: `${powerPct}%`,
                  backgroundColor: powerBarColor,
                  backgroundImage: 'linear-gradient(to bottom, rgba(255,255,255,0.25), rgba(0,0,0,0.35))',
                }}
              />
              <span
                className="relative z-10 text-[7px] font-mono font-bold text-white pointer-events-none"
                style={{ textShadow: '0 0 2px #000, 0 1px 1px #000' }}
              >
                {powerText}
              </span>
            </div>
          </div>
        </div>

        {/* ── Buffs & Debuffs Complete Icon List with Hover Tooltip ───────── */}
        {(debuffs.length > 0 || buffs.length > 0) && (
          <div className="mt-1.5 pt-1 border-t border-[#2d2d44]/60 space-y-1">
            {debuffs.length > 0 && (
              <AuraIconList buffs={debuffs} allUnits={allUnits} iconSize="w-3.5 h-3.5" maxVisible={12} />
            )}
            {buffs.length > 0 && (
              <AuraIconList buffs={buffs} allUnits={allUnits} iconSize="w-3.5 h-3.5" maxVisible={12} />
            )}
          </div>
        )}

        {/* ── Real-time Focus Cast Bar (hover → spell description) ───────── */}
        {castState && (
          <div className="mt-1.5 pt-1 border-t border-[#2d2d44]/70">
            <CastBarSpellHover castState={castState}>
              <div
                className={`relative h-[18px] rounded bg-[#0e0e18] overflow-hidden shadow-md flex items-center justify-between px-1.5 cursor-help border ${
                  castState.endFlash === 'success'
                    ? 'border-emerald-400/80'
                    : castState.endFlash === 'interrupt'
                      ? 'border-red-500/80'
                      : 'border-amber-500/60'
                }`}
              >
                <div
                  className={`absolute inset-y-0 left-0 w-full origin-left z-0 ${
                    castState.endFlash === 'success'
                      ? 'bg-gradient-to-r from-emerald-700 via-emerald-500 to-lime-300'
                      : castState.endFlash === 'interrupt'
                        ? 'bg-gradient-to-r from-red-800 via-red-600 to-rose-400'
                        : 'bg-gradient-to-r from-amber-600 via-amber-500 to-yellow-400'
                  }`}
                  style={{
                    transform: `scaleX(${targetCastRatio})`,
                    transition: snapCastBar ? 'none' : 'transform 55ms linear',
                    willChange: 'transform',
                  }}
                />

                <div className="relative z-10 flex items-center space-x-1 pointer-events-none truncate max-w-[155px]">
                  {(castState.spellIcon || castState.spellId) &&
                  SPELL_ICONS[castState.spellIcon || castState.spellId || ''] ? (
                    <div
                      className="w-3.5 h-3.5 rounded overflow-hidden flex-shrink-0"
                      dangerouslySetInnerHTML={{
                        __html: SPELL_ICONS[castState.spellIcon || castState.spellId || ''],
                      }}
                    />
                  ) : (
                    <span className="text-[10px]">✨</span>
                  )}
                  <span
                    className="text-[9.5px] font-bold text-white tracking-wide truncate"
                    style={{ textShadow: '0 0 2px #000, 0 1px 2px #000' }}
                  >
                    {castState.endFlash === 'success'
                      ? `${castState.spellName} ✓`
                      : castState.endFlash === 'interrupt'
                        ? `${castState.spellName} ✕`
                        : castState.spellName}
                  </span>
                </div>

                {!isFriendly && !castState.endFlash && (
                  <div className="relative z-10 flex items-center pointer-events-none flex-shrink-0 ml-1">
                    {isShielded ? (
                      <span className="text-[10px] text-amber-300 filter drop-shadow">🛡️</span>
                    ) : (
                      <span className="text-[8px] font-bold text-emerald-300 bg-black/60 px-0.5 rounded border border-emerald-500/40">
                        打断
                      </span>
                    )}
                  </div>
                )}
              </div>
            </CastBarSpellHover>
          </div>
        )}
      </div>
    </div>
  );
};
