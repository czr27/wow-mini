import React, { useEffect, useRef, useState } from 'react';
import { SPELL_ICONS } from '../assets/pixelIcons.js';
import type { PlayerCastState } from './ActionBar.js';
import { clampHudPosToViewport } from '../utils/hudLayout.js';
import { useSmoothCastProgress } from '../hooks/useSmoothCastProgress.js';

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
 * - Successful finish → snap full green briefly
 * - Interrupt / fail → snap red with "Interrupted"
 */
const FRAME_WIDTH = 224;
const FRAME_HEIGHT = 77;
const BAR_HEIGHT = 18;
const ICON_SIZE = 22;
const FLASH_MS = 650;

const STORAGE_KEY_POS = 'cata_player_castbar_pos_v5';
const STORAGE_KEY_LOCKED = 'cata_player_castbar_locked';

/** ActionBar default: bottom-4, 3×h-11 rows + gaps/padding/border */
const ACTION_BAR_BOTTOM_MARGIN_PX = 16;
const ACTION_BAR_SLOT_PX = 44; // w-11 h-11
const ACTION_BAR_HEIGHT_PX =
  ACTION_BAR_SLOT_PX * 3 + // 3 rows
  4 * 2 + // space-y-1 between rows
  8 * 2 + // p-2
  2 * 2; // border-2
/** Gap above action-bar top edge = 0.5 slot */
const CAST_BAR_GAP_ABOVE_ACTION_BAR_PX = ACTION_BAR_SLOT_PX * 0.5;

type FlashKind = 'success' | 'interrupted';

interface FlashState {
  kind: FlashKind;
  spellName: string;
  spellId: string;
  isChannel: boolean;
  until: number;
}

/**
 * Default: horizontally centered; vertically 0.5 action-bar slot above the
 * default action bar's top edge.
 */
function clampCastBarPos(pos: { x: number; y: number }): { x: number; y: number } {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 1080;
  return clampHudPosToViewport(pos, vw, vh, FRAME_WIDTH, FRAME_HEIGHT);
}

function getDefaultPos(): { x: number; y: number } {
  if (typeof window !== 'undefined') {
    const x = Math.round((window.innerWidth - FRAME_WIDTH) / 2);
    const y = Math.round(
      window.innerHeight -
        ACTION_BAR_BOTTOM_MARGIN_PX -
        ACTION_BAR_HEIGHT_PX -
        CAST_BAR_GAP_ABOVE_ACTION_BAR_PX -
        FRAME_HEIGHT,
    );
    return clampCastBarPos({ x, y });
  }
  return clampCastBarPos({ x: 400, y: 650 });
}

function loadSavedPosition(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_POS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        return clampCastBarPos(parsed);
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
  const fillRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<HTMLSpanElement | null>(null);

  const activeCastKey = playerCast
    ? `${playerCast.spellId}:${playerCast.isChannel ? 'ch' : 'cast'}:${playerCast.totalMs}:${playerCast.startedAtMs ?? ''}`
    : '';

  useSmoothCastProgress({
    active: Boolean(playerCast),
    castKey: activeCastKey,
    elapsedMs: playerCast?.elapsedMs ?? 0,
    totalMs: playerCast?.totalMs ?? 1,
    fillRef,
    timerRef,
  });

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

  useEffect(() => {
    const handleToggle = () => toggleLock();
    window.addEventListener('cata_toggle_castbar_lock', handleToggle);
    return () => window.removeEventListener('cata_toggle_castbar_lock', handleToggle);
  }, []);

  useEffect(() => {
    const pullIn = () => {
      setPos((prev) => {
        const clamped = clampCastBarPos(prev);
        latestPosRef.current = clamped;
        return clamped;
      });
    };
    pullIn();
    window.addEventListener('resize', pullIn);
    return () => window.removeEventListener('resize', pullIn);
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const nextPos = clampCastBarPos({
        x: dragRef.current.origX + dx,
        y: dragRef.current.origY + dy,
      });
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

  // ── Layout shell (classic metal frame) ──────────────────────────────────
  const shellClass = `group/castbar fixed z-50 select-none ${
    isDragging
      ? 'cursor-grabbing'
      : isLocked
      ? 'cursor-default'
      : 'cursor-grab'
  }`;

  const renderLockButton = () => (
    <button
      type="button"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        toggleLock();
      }}
      className="absolute -top-1 -right-1 z-40 w-5 h-5 flex items-center justify-center text-[11px] rounded bg-black/70 border border-[#3e3e5c] text-amber-300 opacity-0 pointer-events-none group-hover/castbar:opacity-100 group-hover/castbar:pointer-events-auto transition-opacity hover:bg-black/90"
      title={isLocked ? '解锁读条位置（可拖动）' : '锁定读条位置'}
    >
      {isLocked ? '🔒' : '🔓'}
    </button>
  );

  const renderClassicBar = (opts: {
    spellName: string;
    spellId: string;
    fillPct: number;
    fillMode: 'cast' | 'channel' | 'success' | 'interrupted';
    timerText?: string;
    labelOverride?: string;
    preview?: boolean;
    smooth?: boolean;
  }) => {
    const {
      spellName,
      spellId,
      fillPct,
      fillMode,
      timerText = '',
      labelOverride,
      preview = false,
      smooth = false,
    } = opts;

    const pct = Math.min(100, Math.max(0, fillPct));
    const displayName = labelOverride || spellName;
    const fillBg =
      fillMode === 'interrupted'
        ? 'linear-gradient(180deg, #e05555 0%, #cc3333 40%, #991111 100%)'
        : fillMode === 'success' || fillMode === 'channel'
        ? 'linear-gradient(180deg, #66ee66 0%, #33cc33 40%, #1a991a 100%)'
        : 'linear-gradient(180deg, #ffe066 0%, #e6b800 42%, #b8860b 100%)';

    return (
      <div
        style={{ width: FRAME_WIDTH }}
        className={`relative ${preview ? 'opacity-80' : ''}`}
      >
        {renderLockButton()}

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
              {/* Fill (GPU-composited scaleX, no layout-thrashing width transition) */}
              <div
                ref={smooth ? fillRef : undefined}
                className="absolute inset-y-0 left-0 w-full origin-left"
                style={{
                  ...(smooth ? {} : { transform: `scaleX(${pct / 100})` }),
                  transformOrigin: 'left center',
                  willChange: 'transform',
                  background: fillBg,
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35)',
                }}
              />

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
                  ref={smooth ? timerRef : undefined}
                  className="font-mono font-bold"
                  style={{
                    fontSize: 10,
                    color: '#f5f5f5',
                    textShadow: '0 1px 2px #000',
                  }}
                >
                  {smooth ? null : timerText}
                </span>
              </div>
            </div>
          </div>
        </div>

      </div>
    );
  };

  // Idle: locked → invisible hover hotspot to unlock; unlocked → preview to drag
  if (!playerCast && !activeFlash) {
    if (isLocked) {
      // Small top-right hotspot so idle locked cast bar can be unlocked without covering the fight
      return (
        <div
          style={{ left: `${pos.x + FRAME_WIDTH - 28}px`, top: `${pos.y}px`, width: 28, height: 28 }}
          className={shellClass}
          title="悬停解锁读条位置"
        >
          {renderLockButton()}
        </div>
      );
    }
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
          labelOverride: activeFlash.kind === 'interrupted' ? '打断' : activeFlash.spellName,
        })}
      </div>
    );
  }

  if (!playerCast) return null;

  // Active cast / channel — always grow left → right at display refresh rate
  const isChannel = !!playerCast.isChannel;

  return (
    <div
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
      onMouseDown={handleMouseDown}
      className={shellClass}
    >
      {renderClassicBar({
        spellName: playerCast.spellName,
        spellId: playerCast.spellId,
        fillPct: 0,
        fillMode: isChannel ? 'channel' : 'cast',
        smooth: true,
      })}
    </div>
  );
};
