import React, { useEffect, useRef, useState } from 'react';
import { SPELL_ICONS } from '../assets/pixelIcons.js';
import type { PlayerCastState } from './ActionBar.js';

export interface PlayerCastBarProps {
  playerCast: PlayerCastState | null;
  onCancelCast?: () => void;
}

/**
 * Classic WoW cast-bar proportions (vs previous 320×64 frame):
 * - width −30% → 224
 * - height +20% → 77
 *
 * Visual rules (Blizzard classic / community consensus):
 * - Gray metal border, dark recessed track
 * - Cast & channel both fill L→R (yellow cast / green channel)
 * - Centered spell name + remaining seconds on the right
 * - Spark rides the leading edge
 * - Successful finish → snap full green briefly
 * - Interrupt / fail → snap red with "Interrupted"
 */
const FRAME_WIDTH = 224;
const FRAME_HEIGHT = 77;
const BAR_HEIGHT = 18;
const ICON_SIZE = 22;
const FLASH_MS = 650;

const STORAGE_KEY_POS = 'cata_player_castbar_pos';
const STORAGE_KEY_LOCKED = 'cata_player_castbar_locked';

type FlashKind = 'success' | 'interrupted';

interface FlashState {
  kind: FlashKind;
  spellName: string;
  spellId: string;
  isChannel: boolean;
  until: number;
}

function getDefaultPos(): { x: number; y: number } {
  if (typeof window !== 'undefined') {
    const x = Math.max(0, Math.round((window.innerWidth - FRAME_WIDTH) / 2));
    const y = Math.max(0, Math.round(window.innerHeight - 250));
    return { x, y };
  }
  return { x: 400, y: 650 };
}

function loadSavedPosition(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_POS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        const maxX = Math.max(0, (typeof window !== 'undefined' ? window.innerWidth : 1920) - FRAME_WIDTH);
        const maxY = Math.max(0, (typeof window !== 'undefined' ? window.innerHeight : 1080) - FRAME_HEIGHT);
        return {
          x: Math.max(0, Math.min(maxX, parsed.x)),
          y: Math.max(0, Math.min(maxY, parsed.y)),
        };
      }
    }
  } catch {}
  return getDefaultPos();
}

function loadSavedLocked(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LOCKED);
    if (raw !== null) return JSON.parse(raw);
  } catch {}
  return false;
}

function formatRemain(elapsedMs: number, totalMs: number, isChannel?: boolean): string {
  const remain = isChannel
    ? Math.max(0, totalMs - elapsedMs)
    : Math.max(0, totalMs - elapsedMs);
  return (remain / 1000).toFixed(1);
}

export const PlayerCastBar: React.FC<PlayerCastBarProps> = ({
  playerCast,
  onCancelCast,
}) => {
  const [pos, setPos] = useState<{ x: number; y: number }>(loadSavedPosition);
  const [isLocked, setIsLocked] = useState<boolean>(loadSavedLocked);
  const [isDragging, setIsDragging] = useState(false);
  const [flash, setFlash] = useState<FlashState | null>(null);
  const [nowTick, setNowTick] = useState(0);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const latestPosRef = useRef<{ x: number; y: number }>(pos);
  const lastCastRef = useRef<PlayerCastState | null>(null);

  useEffect(() => {
    latestPosRef.current = pos;
  }, [pos]);

  // Detect cast end → WoW-style flash
  // - Finished cast/channel, or mid-channel stop → full green
  // - Interrupted cast-time spell → full red "Interrupted"
  useEffect(() => {
    if (playerCast) {
      lastCastRef.current = playerCast;
      setFlash(null);
      return;
    }
    const last = lastCastRef.current;
    if (!last) return;
    lastCastRef.current = null;
    const completed = last.progress >= 0.92;
    const channelStop = !!last.isChannel;
    // 引导结束/打断 → 满格变绿；其他中断 → 红
    const kind: FlashKind = completed || channelStop ? 'success' : 'interrupted';
    setFlash({
      kind,
      spellName: last.spellName,
      spellId: last.spellId,
      isChannel: !!last.isChannel,
      until: Date.now() + FLASH_MS,
    });
  }, [playerCast]);

  // Drive flash fade / clear
  useEffect(() => {
    if (!flash) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 50);
    const clearId = window.setTimeout(() => setFlash(null), Math.max(0, flash.until - Date.now()) + 20);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(clearId);
    };
  }, [flash]);

  const toggleLock = (forceVal?: boolean) => {
    setIsLocked((prev) => {
      const next = typeof forceVal === 'boolean' ? forceVal : !prev;
      try {
        localStorage.setItem(STORAGE_KEY_LOCKED, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const resetPosition = () => {
    const def = getDefaultPos();
    latestPosRef.current = def;
    setPos(def);
    try {
      localStorage.setItem(STORAGE_KEY_POS, JSON.stringify(def));
    } catch {}
  };

  useEffect(() => {
    const handleToggle = () => toggleLock();
    window.addEventListener('cata_toggle_castbar_lock', handleToggle);
    return () => window.removeEventListener('cata_toggle_castbar_lock', handleToggle);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setPos((prev) => {
        const maxX = Math.max(0, window.innerWidth - FRAME_WIDTH);
        const maxY = Math.max(0, window.innerHeight - FRAME_HEIGHT);
        const clamped = {
          x: Math.max(0, Math.min(maxX, prev.x)),
          y: Math.max(0, Math.min(maxY, prev.y)),
        };
        latestPosRef.current = clamped;
        return clamped;
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const maxX = Math.max(0, window.innerWidth - FRAME_WIDTH);
      const maxY = Math.max(0, window.innerHeight - FRAME_HEIGHT);
      const nextPos = {
        x: Math.max(0, Math.min(maxX, dragRef.current.origX + dx)),
        y: Math.max(0, Math.min(maxY, dragRef.current.origY + dy)),
      };
      latestPosRef.current = nextPos;
      setPos(nextPos);
    };
    const handleMouseUp = () => {
      setIsDragging(false);
      dragRef.current = null;
      try {
        localStorage.setItem(STORAGE_KEY_POS, JSON.stringify(latestPosRef.current));
      } catch {}
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

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

  const activeFlash = flash && Date.now() < flash.until ? flash : null;
  // silence unused nowTick warning by reading it (forces re-render during flash)
  void nowTick;

  if (!playerCast && !activeFlash && isLocked) {
    return null;
  }

  // ── Layout shell (classic metal frame) ──────────────────────────────────
  const shellClass = `fixed z-50 select-none ${
    isDragging
      ? 'cursor-grabbing'
      : isLocked
      ? ''
      : 'cursor-grab'
  }`;

  const renderClassicBar = (opts: {
    spellName: string;
    spellId: string;
    fillPct: number;
    fillMode: 'cast' | 'channel' | 'success' | 'interrupted';
    timerText: string;
    labelOverride?: string;
    showSpark?: boolean;
    preview?: boolean;
  }) => {
    const {
      spellName,
      spellId,
      fillPct,
      fillMode,
      timerText,
      labelOverride,
      showSpark = true,
      preview = false,
    } = opts;

    let fillColor = '#E6B800'; // classic yellow
    if (fillMode === 'channel') fillColor = '#2ECC71';
    if (fillMode === 'success') fillColor = '#33CC33';
    if (fillMode === 'interrupted') fillColor = '#CC3333';

    const pct = Math.min(100, Math.max(0, fillPct));
    const displayName = labelOverride || spellName;

    return (
      <div
        style={{ width: FRAME_WIDTH }}
        className={`relative ${preview ? 'opacity-80' : ''}`}
      >
        {/* Toolbar when unlocked */}
        {!isLocked && (
          <div className="flex items-center justify-between mb-1 px-0.5">
            <span className="text-[9px] text-amber-300/90 font-bold tracking-wide">
              {preview ? '⠿ 拖拽定位读条' : '⠿'}
            </span>
            <div className="flex items-center gap-1">
              {preview && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    resetPosition();
                  }}
                  className="text-[8px] text-gray-300 hover:text-white px-1 py-0.5 rounded bg-black/50 border border-gray-600"
                >
                  重置
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleLock(preview ? true : undefined);
                }}
                className="text-[8px] text-amber-200 hover:text-amber-100 px-1 py-0.5 rounded bg-black/50 border border-amber-700/60"
                title={isLocked ? '解锁' : '锁定位置'}
              >
                {preview ? '🔒 锁定' : isLocked ? '🔒' : '🔓'}
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-1.5">
          {/* Spell icon */}
          <div
            className="flex-shrink-0 rounded-sm border-2 border-[#6b6b6b] bg-[#1a1a1a] shadow-[inset_0_0_0_1px_#2a2a2a]"
            style={{ width: ICON_SIZE, height: ICON_SIZE }}
            dangerouslySetInnerHTML={{ __html: SPELL_ICONS[spellId] || '' }}
          />

          {/* Gray metal frame + recessed track */}
          <div
            className="relative flex-1 rounded-sm"
            style={{
              height: BAR_HEIGHT + 8,
              padding: 3,
              background: 'linear-gradient(180deg, #7a7a7a 0%, #4a4a4a 45%, #2e2e2e 100%)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.25)',
            }}
          >
            <div
              className="relative w-full h-full overflow-hidden rounded-[1px]"
              style={{
                height: BAR_HEIGHT,
                background: '#0a0a0a',
                boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.9)',
                border: '1px solid #1c1c1c',
              }}
            >
              {/* Fill */}
              <div
                className="absolute inset-y-0 left-0 transition-[width] duration-75"
                style={{
                  width: `${pct}%`,
                  background:
                    fillMode === 'interrupted'
                      ? 'linear-gradient(180deg, #e05555 0%, #cc3333 40%, #991111 100%)'
                      : fillMode === 'success' || fillMode === 'channel'
                      ? 'linear-gradient(180deg, #66ee66 0%, #33cc33 40%, #1a991a 100%)'
                      : 'linear-gradient(180deg, #ffe066 0%, #e6b800 42%, #b8860b 100%)',
                  boxShadow: `inset 0 1px 0 rgba(255,255,255,0.35), 0 0 6px ${fillColor}55`,
                }}
              />

              {/* Spark at leading edge */}
              {showSpark && pct > 1 && pct < 99.5 && fillMode !== 'interrupted' && fillMode !== 'success' && (
                <div
                  className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{
                    left: `calc(${pct}% - 6px)`,
                    width: 12,
                    height: BAR_HEIGHT + 8,
                    background:
                      'radial-gradient(ellipse at center, rgba(255,255,220,0.95) 0%, rgba(255,200,80,0.55) 40%, transparent 70%)',
                    mixBlendMode: 'screen',
                  }}
                />
              )}

              {/* Centered name */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-8">
                <span
                  className="truncate text-center font-bold tracking-wide"
                  style={{
                    fontSize: 11,
                    color: '#fff',
                    textShadow: '0 1px 2px #000, 0 0 4px #000',
                    maxWidth: '100%',
                  }}
                >
                  {displayName}
                </span>
              </div>

              {/* Remaining time (right) */}
              <div className="absolute inset-y-0 right-1.5 flex items-center pointer-events-none">
                <span
                  className="font-mono font-bold"
                  style={{
                    fontSize: 10,
                    color: '#f5f5f5',
                    textShadow: '0 1px 2px #000',
                  }}
                >
                  {timerText}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ESC hint under bar while casting */}
        {!preview && !activeFlash && onCancelCast && (
          <div className="mt-0.5 text-right">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCancelCast();
              }}
              className="text-[8px] text-red-400/80 hover:text-red-300 underline"
            >
              ESC 打断
            </button>
          </div>
        )}
      </div>
    );
  };

  // Preview anchor when unlocked & idle
  if (!playerCast && !activeFlash) {
    return (
      <div
        style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
        onMouseDown={handleMouseDown}
        className={shellClass}
      >
        {renderClassicBar({
          spellName: '治疗波',
          spellId: 'healing_wave',
          fillPct: 55,
          fillMode: 'cast',
          timerText: '1.2',
          preview: true,
        })}
      </div>
    );
  }

  // Flash overlay after cast ends
  if (!playerCast && activeFlash) {
    const remainFlash = Math.max(0, (activeFlash.until - Date.now()) / 1000);
    return (
      <div
        style={{ left: `${pos.x}px`, top: `${pos.y}px`, opacity: Math.min(1, remainFlash * 2.2) }}
        onMouseDown={handleMouseDown}
        className={shellClass}
      >
        {renderClassicBar({
          spellName: activeFlash.spellName,
          spellId: activeFlash.spellId,
          fillPct: 100,
          fillMode: activeFlash.kind === 'success' ? 'success' : 'interrupted',
          timerText: activeFlash.kind === 'success' ? '0.0' : '',
          labelOverride: activeFlash.kind === 'interrupted' ? 'Interrupted' : activeFlash.spellName,
          showSpark: false,
        })}
      </div>
    );
  }

  if (!playerCast) return null;

  // Active cast / channel — always grow left → right
  const isChannel = !!playerCast.isChannel;
  const fillPct = Math.min(100, Math.max(0, playerCast.progress * 100));

  return (
    <div
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
      onMouseDown={handleMouseDown}
      className={shellClass}
    >
      {renderClassicBar({
        spellName: playerCast.spellName,
        spellId: playerCast.spellId,
        fillPct,
        fillMode: isChannel ? 'channel' : 'cast',
        timerText: formatRemain(playerCast.elapsedMs, playerCast.totalMs, isChannel),
        showSpark: true,
      })}
    </div>
  );
};
