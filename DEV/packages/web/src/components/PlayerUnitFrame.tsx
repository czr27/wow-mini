import React, { useState, useEffect, useRef } from 'react';
import type { Unit, ClassId } from '@cata-raid-sim/engine';
import { CLASS_PIXEL_AVATARS } from '../assets/pixelIcons.js';
import { CLASS_COLORS_CATA } from './RaidFrames.js';
import { clampHudPosToViewport } from '../utils/hudLayout.js';

export interface PlayerUnitFrameProps {
  player: Unit;
  isInCombat?: boolean;
  dkRunes?: Array<{ type: 'BLOOD' | 'FROST' | 'UNHOLY'; cdMs: number }>;
  onSelect?: () => void;
  onSetFocus?: () => void;
}

const STORAGE_KEY = 'cata_player_frame_pos';
const DEFAULT_POS = { x: 24, y: 64 };
const FRAME_WIDTH = 250;
const FRAME_HEIGHT = 110;

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

export const PlayerUnitFrame: React.FC<PlayerUnitFrameProps> = ({
  player,
  isInCombat = false,
  dkRunes,
  onSelect,
  onSetFocus,
}) => {
  const [pos, setPos] = useState<{ x: number; y: number }>(loadSavedPosition);
  const [isDragging, setIsDragging] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // 已出界（含压到标题区）自动拉回
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

  // Health and percentage calculations
  const hpPct = player.maxHp > 0 ? Math.max(0, Math.min(100, (player.hp / player.maxHp) * 100)) : 0;
  const classColor = CLASS_COLORS_CATA[player.classId] || '#69CCF0';

  // Absorb shield calculation
  let absorbAmount = player.absorb || 0;
  const boneShieldBuff = player.buffs?.find(b => b.spellId === 'bone_shield');
  if (boneShieldBuff && absorbAmount === 0) {
    absorbAmount += (boneShieldBuff.stacks || 1) * 4000;
  }
  const absorbPct = player.maxHp > 0 ? Math.min(100 - hpPct, (absorbAmount / player.maxHp) * 100) : 0;

  // Power bar adaptation (all 10 Cataclysm classes)
  const isRogue = player.classId === 'ROGUE';
  const isDK = player.classId === 'DK';
  const isWarrior = player.classId === 'WARRIOR';
  const isHunter = player.classId === 'HUNTER';

  let powerBarColor = '#0070DE'; // Blue Mana
  let powerCurrent = player.mp || 0;
  let powerMax = player.maxMp || 45000;
  let powerText = `${Math.round(powerCurrent).toLocaleString()} / ${Math.round(powerMax).toLocaleString()}`;
  let powerPct = powerMax > 0 ? Math.max(0, Math.min(100, (powerCurrent / powerMax) * 100)) : 0;

  if (isRogue) {
    powerBarColor = '#FFF569'; // Yellow Energy
    powerCurrent = Math.round(player.energy ?? 100);
    powerMax = 100;
    powerText = `${powerCurrent} / 100`;
    powerPct = Math.max(0, Math.min(100, powerCurrent));
  } else if (isWarrior) {
    const rageRes = player.resources?.find(r => r.kind === 'RAGE');
    powerBarColor = '#DC2626'; // Crimson Rage
    powerCurrent = Math.round(rageRes?.current ?? player.rage ?? 0);
    powerMax = rageRes?.max ?? 100;
    powerText = `${powerCurrent} / ${powerMax}`;
    powerPct = powerMax > 0 ? Math.max(0, Math.min(100, (powerCurrent / powerMax) * 100)) : 0;
  } else if (isHunter) {
    const focusRes = player.resources?.find(r => r.kind === 'FOCUS');
    powerBarColor = '#F97316'; // Orange Focus
    powerCurrent = Math.round(focusRes?.current ?? player.focus ?? 100);
    powerMax = focusRes?.max ?? 100;
    powerText = `${powerCurrent} / ${powerMax}`;
    powerPct = powerMax > 0 ? Math.max(0, Math.min(100, (powerCurrent / powerMax) * 100)) : 0;
  } else if (isDK) {
    const rpRes = player.resources?.find(r => r.kind === 'RUNIC_POWER');
    powerBarColor = '#00D8FF'; // Cyan Runic Power
    powerCurrent = Math.round(rpRes?.current ?? player.runicPower ?? 0);
    powerMax = rpRes?.max ?? 100;
    powerText = `${powerCurrent} / ${powerMax}`;
    powerPct = powerMax > 0 ? Math.max(0, Math.min(100, (powerCurrent / powerMax) * 100)) : 0;
  }

  // Fallback default DK runes if none provided
  const activeDkRunes = isDK
    ? dkRunes || [
        { type: 'BLOOD', cdMs: 0 },
        { type: 'BLOOD', cdMs: 0 },
        { type: 'FROST', cdMs: 0 },
        { type: 'FROST', cdMs: 0 },
        { type: 'UNHOLY', cdMs: 0 },
        { type: 'UNHOLY', cdMs: 0 },
      ]
    : null;

  return (
    <div
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
      className={`fixed z-40 select-none transition-shadow ${
        isDragging ? 'cursor-grabbing shadow-[0_0_24px_rgba(245,158,11,0.5)]' : 'shadow-2xl'
      }`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        if (e.shiftKey) {
          e.preventDefault();
          if (onSetFocus) onSetFocus();
        } else {
          if (onSelect) onSelect();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (onSetFocus) onSetFocus();
      }}
    >
      {/* Outer Blizzard Metallic Silver/Gold Beveled Oval Frame */}
      <div
        onMouseDown={handleMouseDown}
        className={`relative bg-gradient-to-b from-[#252538] via-[#141424] to-[#0a0a14] border-2 border-[#8a8a9e] rounded-2xl p-2 shadow-[0_8px_24px_rgba(0,0,0,0.85)] ring-1 ring-white/10 ${
          isLocked ? 'cursor-default' : 'cursor-grab'
        }`}
      >
        {/* Header Bar: Character Name + Level + Lock Toggle */}
        <div className="flex items-center justify-between px-1 pb-1 border-b border-[#2d2d44]/70 mb-1.5">
          <div className="flex items-center space-x-1.5">
            <span
              className="text-[12px] font-black text-white tracking-wide truncate max-w-[130px]"
              style={{
                textShadow:
                  '0 0 3px #000, 0 1px 2px #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000',
              }}
            >
              {player.name}
            </span>
            <span className="text-[9px] px-1 py-0.2 rounded font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
              Lv.80
            </span>
          </div>

          <div className="flex items-center space-x-1">
            <button
              onClick={() => setIsLocked(!isLocked)}
              className="text-[10px] text-gray-400 hover:text-amber-300 px-1 py-0.5 rounded hover:bg-white/10 transition"
            >
              {isLocked ? '🔒' : '🔓'}
            </button>
          </div>
        </div>

        {/* Main Body: Circular Medallion Avatar on Left + Bars on Right */}
        <div className="flex items-center space-x-2.5">
          {/* Avatar Medallion with Level 80 circular badge & Combat indicator */}
          <div className="relative flex-shrink-0">
            <div
              onClick={() => onSelect && onSelect()}
              className="w-13 h-13 rounded-full border-2 border-[#d4af37] bg-black overflow-hidden relative shadow-[0_0_8px_rgba(0,0,0,0.9)] cursor-pointer hover:border-amber-300 transition"
              style={{ width: '52px', height: '52px' }}
              dangerouslySetInnerHTML={{ __html: CLASS_PIXEL_AVATARS[player.classId] || '' }}
            />

            {/* Level 80 circular badge at bottom-left */}
            <div
              className="absolute -bottom-1 -left-1 w-5 h-5 rounded-full bg-[#1b1b32] border-2 border-[#d4af37] flex items-center justify-center text-[9px] font-black text-amber-300 shadow-[0_2px_4px_rgba(0,0,0,0.9)] z-20 pointer-events-none"
            >
              80
            </div>

            {/* In-combat crossed swords indicator (⚔️) */}
            {isInCombat && (
              <div
                className="absolute -top-1.5 -left-1.5 text-sm animate-pulse z-20 filter drop-shadow-[0_0_6px_rgba(239,68,68,0.95)] pointer-events-none"
              >
                ⚔️
              </div>
            )}
          </div>

          {/* Right Column: Health Bar & Adaptive Power Bar */}
          <div className="flex flex-col space-y-1 w-[150px]">
            {/* ── Health Bar ──────────────────────────────────────────────── */}
            <div className="relative h-[20px] rounded bg-[#101018] border border-[#2b2b3e] overflow-hidden shadow-inner flex items-center justify-center">
              {/* Base Health Layer */}
              <div
                className="absolute inset-y-0 left-0 transition-all duration-150 z-0"
                style={{
                  width: `${hpPct}%`,
                  backgroundColor: classColor,
                  backgroundImage: 'linear-gradient(to bottom, rgba(255,255,255,0.28), rgba(0,0,0,0.32))',
                }}
              />

              {/* Absorb Shield Layer */}
              {absorbPct > 0 && (
                <div
                  className="absolute inset-y-0 transition-all duration-150 z-[1] border-l border-yellow-200/80"
                  style={{
                    left: `${hpPct}%`,
                    width: `${absorbPct}%`,
                    backgroundColor: 'rgba(254, 240, 138, 0.45)',
                    backgroundImage:
                      'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,0.2) 4px, rgba(255,255,255,0.2) 8px)',
                  }}
                />
              )}

              {/* Health Text Overlay */}
              <span
                className="relative z-10 text-[9px] font-mono font-black text-white pointer-events-none"
                style={{
                  textShadow:
                    '0 0 3px #000, 0 1px 2px #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000',
                }}
              >
                {player.hp.toLocaleString()} / {player.maxHp.toLocaleString()} ({Math.round(hpPct)}%)
              </span>
            </div>

            {/* ── Adaptive Power Bar (Mana / Energy / Runic Power) ────────── */}
            <div className="relative h-[13px] rounded bg-[#0a0a14] border border-[#1e1e2d] overflow-hidden shadow-inner flex items-center justify-center">
              <div
                className="absolute inset-y-0 left-0 transition-all duration-150 z-0"
                style={{
                  width: `${powerPct}%`,
                  backgroundColor: powerBarColor,
                  backgroundImage: 'linear-gradient(to bottom, rgba(255,255,255,0.25), rgba(0,0,0,0.35))',
                }}
              />
              <span
                className="relative z-10 text-[8px] font-mono font-bold text-white pointer-events-none"
                style={{
                  textShadow: '0 0 2px #000, 0 1px 1px #000',
                }}
              >
                {powerText}
              </span>
            </div>

            {/* ── DK 6 Rune Slots Indicator (Blood/Frost/Unholy) ─────────────── */}
            {isDK && activeDkRunes && (
              <div className="flex items-center justify-between pt-0.5 px-0.5">
                {activeDkRunes.map((rune, idx) => {
                  const runeColor =
                    rune.type === 'BLOOD'
                      ? '#C41F3B'
                      : rune.type === 'FROST'
                      ? '#00D8FF'
                      : '#10B981';
                  const isReady = (rune.cdMs || 0) <= 0;

                  return (
                    <div
                      key={idx}
                      className={`w-[20px] h-[7px] rounded-sm border relative overflow-hidden transition-all ${
                        isReady
                          ? 'border-white/40 shadow-[0_0_4px_rgba(255,255,255,0.4)]'
                          : 'border-black/60 opacity-40'
                      }`}
                      style={{ backgroundColor: isReady ? runeColor : '#181822' }}
                    >
                      {/* Sweep CD animation */}
                      {!isReady && (
                        <div
                          className="h-full bg-white/30 transition-all duration-100"
                          style={{ width: `${Math.max(0, 100 - (rune.cdMs / 10000) * 100)}%` }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
