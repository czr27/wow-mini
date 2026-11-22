import React, { useEffect, useRef, useState } from 'react';
import { SPELL_ICONS } from '../assets/pixelIcons.js';
import type { PlayerCastState } from './ActionBar.js';

export interface PlayerCastBarProps {
  playerCast: PlayerCastState | null;
  onCancelCast?: () => void;
}

const STORAGE_KEY_POS = 'cata_player_castbar_pos';
const STORAGE_KEY_LOCKED = 'cata_player_castbar_locked';
const FRAME_WIDTH = 320;
const FRAME_HEIGHT = 64;

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
    if (raw !== null) {
      return JSON.parse(raw);
    }
  } catch {}
  return false;
}

export const PlayerCastBar: React.FC<PlayerCastBarProps> = ({
  playerCast,
  onCancelCast,
}) => {
  const [pos, setPos] = useState<{ x: number; y: number }>(loadSavedPosition);
  const [isLocked, setIsLocked] = useState<boolean>(loadSavedLocked);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const latestPosRef = useRef<{ x: number; y: number }>(pos);

  useEffect(() => {
    latestPosRef.current = pos;
  }, [pos]);

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

  // Listen to toggle lock custom event from anywhere in the UI
  useEffect(() => {
    const handleToggle = () => {
      toggleLock();
    };
    window.addEventListener('cata_toggle_castbar_lock', handleToggle);
    return () => window.removeEventListener('cata_toggle_castbar_lock', handleToggle);
  }, []);

  // Screen resize handler to keep within boundaries
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

  // Drag listeners
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const maxX = Math.max(0, window.innerWidth - FRAME_WIDTH);
      const maxY = Math.max(0, window.innerHeight - FRAME_HEIGHT);
      const newX = Math.max(0, Math.min(maxX, dragRef.current.origX + dx));
      const newY = Math.max(0, Math.min(maxY, dragRef.current.origY + dy));
      const nextPos = { x: newX, y: newY };
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

  // If not casting and window is locked, stay invisible
  if (!playerCast && isLocked) {
    return null;
  }

  // Preview anchor mode when not actively casting but unlocked
  if (!playerCast) {
    return (
      <div
        style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
        onMouseDown={handleMouseDown}
        className={`fixed z-50 w-80 select-none cursor-grab transition-shadow ${
          isDragging
            ? 'cursor-grabbing shadow-[0_0_24px_rgba(245,158,11,0.6)] ring-2 ring-amber-400'
            : 'shadow-2xl hover:border-amber-400'
        }`}
      >
        <div className="bg-[#10101e]/92 border-2 border-dashed border-amber-500/70 rounded-lg p-2 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between text-xs font-bold mb-1">
            <div className="flex items-center space-x-1 text-amber-300">
              <span className="text-gray-400 text-xs select-none">⠿</span>
              <span className="font-extrabold text-[11px]">⚡ 玩家技能读条 (按住拖拽定位)</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  resetPosition();
                }}
                className="text-[9px] text-gray-300 hover:text-white px-1.5 py-0.5 rounded bg-gray-800/80 border border-gray-600 transition"
                title="重置到屏幕居中默认位置"
              >
                重置
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleLock(true);
                }}
                className="text-[10px] text-amber-300 font-bold hover:text-amber-200 px-1.5 py-0.5 rounded bg-amber-600/30 border border-amber-500/50 flex items-center space-x-0.5 transition"
                title="位置满意后锁定 (施法时在此处显示)"
              >
                <span>🔒</span>
                <span>锁定</span>
              </button>
            </div>
          </div>
          <div className="w-full bg-[#080812] h-2.5 rounded overflow-hidden border border-amber-950/80 relative">
            <div className="h-full bg-gradient-to-r from-amber-500/60 to-yellow-400/60 w-3/5" />
          </div>
          <div className="flex justify-between items-center text-[9px] text-gray-400 mt-1">
            <span className="text-amber-200/80">按住边框拖拽移动到任意位置</span>
            <span className="text-gray-400">调整完毕点击锁定</span>
          </div>
        </div>
      </div>
    );
  }

  // Active Cast Bar
  return (
    <div
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
      onMouseDown={handleMouseDown}
      className={`fixed z-50 w-80 select-none transition-shadow ${
        isDragging
          ? 'cursor-grabbing shadow-[0_0_24px_rgba(245,158,11,0.6)] ring-2 ring-amber-400'
          : isLocked
          ? 'shadow-2xl'
          : 'cursor-grab hover:ring-1 hover:ring-amber-400/50 shadow-2xl'
      }`}
    >
      <div className="bg-[#10101e]/95 border-2 border-amber-500/80 rounded-lg p-2 shadow-2xl backdrop-blur animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between text-xs font-bold mb-1">
          <div className="flex items-center space-x-1.5 min-w-0">
            {!isLocked && (
              <span className="text-gray-400 text-xs cursor-grab select-none mr-0.5" title="拖拽手柄">
                ⠿
              </span>
            )}
            <div
              className="w-4 h-4 rounded overflow-hidden flex-shrink-0"
              dangerouslySetInnerHTML={{ __html: SPELL_ICONS[playerCast.spellId] || '' }}
            />
            <span className="text-white font-extrabold truncate">{playerCast.spellName}</span>
          </div>
          <div className="flex items-center space-x-2 flex-shrink-0">
            <span className="font-mono text-[11px] text-amber-300">
              {(playerCast.elapsedMs / 1000).toFixed(1)}s / {(playerCast.totalMs / 1000).toFixed(1)}s
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleLock();
              }}
              className="text-[10px] text-gray-400 hover:text-amber-300 px-1 py-0.2 rounded hover:bg-white/10 transition"
              title={isLocked ? '已锁定位置 (点击解锁可拖拽)' : '未锁定位置 (按住可拖拽)'}
            >
              {isLocked ? '🔒' : '🔓'}
            </button>
          </div>
        </div>

        <div className="w-full bg-[#080812] h-2.5 rounded overflow-hidden border border-amber-950 relative">
          <div
            className={`h-full transition-all duration-75 shadow-inner ${
              playerCast.isChannel
                ? 'bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-300'
                : 'bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-300'
            }`}
            style={{ width: `${Math.min(100, Math.max(0, playerCast.progress * 100))}%` }}
          />
        </div>

        <div className="flex justify-between items-center text-[9px] text-gray-400 mt-0.5">
          <span>{playerCast.isChannel ? '引导法术中...' : '施法读条中...'}</span>
          {onCancelCast && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCancelCast();
              }}
              className="text-red-400 hover:text-red-300 underline"
            >
              [按 ESC 打断]
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
