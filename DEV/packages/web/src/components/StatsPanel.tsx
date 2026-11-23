import React, { useState, useEffect, useRef } from 'react';
import type { Unit } from '@cata-raid-sim/engine';
import { normalizeCombatSkillName } from '@cata-raid-sim/engine';
import { CLASS_COLORS } from './AuthAndCharacterModal.js';
import { CLASS_PIXEL_AVATARS } from '../assets/pixelIcons.js';

/** Merge bounce / bloom variants (e.g. 治疗链(第2跳)) into the base skill for meters. */
function mergeSkillMap(raw: Record<string, number> | undefined): Record<string, number> {
  if (!raw) return {};
  const out: Record<string, number> = {};
  for (const [name, amt] of Object.entries(raw)) {
    if (!(amt > 0)) continue;
    const key = normalizeCombatSkillName(name) || name;
    out[key] = (out[key] || 0) + amt;
  }
  return out;
}

interface Props {
  units: Unit[];
  durationSec: number;
  initialPos?: { x: number; y: number } | null;
  onSavePos?: (pos: { x: number; y: number }) => void;
}

const STORAGE_KEY_POS = 'cata_stats_panel_pos';
const STORAGE_KEY_SIZE = 'cata_stats_panel_size';
const STORAGE_KEY_LOCKED = 'cata_stats_panel_locked';

const DEFAULT_SIZE = { width: 300, height: 280 };
const MIN_WIDTH = 240;
const MAX_WIDTH = 800;
const MIN_HEIGHT = 160;
const MAX_HEIGHT = 800;

function getDefaultPosition(w: number, h: number): { x: number; y: number } {
  if (typeof window !== 'undefined') {
    return {
      x: Math.max(16, window.innerWidth - w - 24),
      y: Math.max(70, window.innerHeight - h - 120),
    };
  }
  return { x: 960, y: 520 };
}

function loadSavedPosition(w: number, h: number): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_POS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        const maxX = Math.max(0, (typeof window !== 'undefined' ? window.innerWidth : 1920) - w);
        const maxY = Math.max(0, (typeof window !== 'undefined' ? window.innerHeight : 1080) - 40);
        return {
          x: Math.max(0, Math.min(maxX, parsed.x)),
          y: Math.max(0, Math.min(maxY, parsed.y)),
        };
      }
    }
  } catch {}
  return getDefaultPosition(w, h);
}

function loadSavedSize(): { width: number; height: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SIZE);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.width === 'number' && typeof parsed.height === 'number') {
        const maxW = typeof window !== 'undefined' ? Math.min(MAX_WIDTH, window.innerWidth - 30) : MAX_WIDTH;
        const maxH = typeof window !== 'undefined' ? Math.min(MAX_HEIGHT, window.innerHeight - 30) : MAX_HEIGHT;
        return {
          width: Math.max(MIN_WIDTH, Math.min(maxW, parsed.width)),
          height: Math.max(MIN_HEIGHT, Math.min(maxH, parsed.height)),
        };
      }
    }
  } catch {}
  return DEFAULT_SIZE;
}

function loadSavedLocked(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_LOCKED) === 'true';
  } catch {}
  return false;
}

export const StatsPanel: React.FC<Props> = ({ units, durationSec, initialPos = null, onSavePos }) => {
  const [metric, setMetric] = useState<'DPS' | 'EFFECTIVE_HPS' | 'DAMAGE_TAKEN' | 'INTERRUPTS'>('DPS');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hoveredUnitId, setHoveredUnitId] = useState<string | null>(null);

  // Position and Size states
  const [size, setSize] = useState<{ width: number; height: number }>(loadSavedSize);
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    if (initialPos && typeof initialPos.x === 'number' && typeof initialPos.y === 'number') {
      return initialPos;
    }
    return loadSavedPosition(size.width, size.height);
  });
  const [isLocked, setIsLocked] = useState(loadSavedLocked);

  // Dragging and resizing states
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const hasMovedRef = useRef(false);
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
    type: 'se' | 'sw' | 'e' | 'w' | 's';
  } | null>(null);

  // Synchronize boundary on window resize
  useEffect(() => {
    const handleWindowResize = () => {
      setPos(prev => {
        const maxX = Math.max(0, window.innerWidth - size.width);
        const maxY = Math.max(0, window.innerHeight - (isCollapsed ? 36 : size.height));
        return {
          x: Math.max(0, Math.min(maxX, prev.x)),
          y: Math.max(0, Math.min(maxY, prev.y)),
        };
      });
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [size, isCollapsed]);

  // Drag listeners
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasMovedRef.current = true;
      }
      const maxX = Math.max(0, window.innerWidth - size.width);
      const maxY = Math.max(0, window.innerHeight - (isCollapsed ? 36 : size.height));
      const newX = Math.max(0, Math.min(maxX, dragRef.current.origX + dx));
      const newY = Math.max(0, Math.min(maxY, dragRef.current.origY + dy));
      setPos({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragRef.current = null;
      try {
        localStorage.setItem(STORAGE_KEY_POS, JSON.stringify(pos));
      } catch {}
      if (onSavePos) onSavePos(pos);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, pos, size, isCollapsed]);

  // Resize listeners
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const { startX, startY, origX, origY, origW, origH, type } = resizeRef.current;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      let newW = origW;
      let newH = origH;
      let newX = origX;
      let newY = origY;

      const maxAllowedW = Math.min(MAX_WIDTH, window.innerWidth - 20);
      const maxAllowedH = Math.min(MAX_HEIGHT, window.innerHeight - 20);

      if (type === 'se' || type === 'e') {
        const potentialW = origW + dx;
        newW = Math.max(MIN_WIDTH, Math.min(maxAllowedW, potentialW));
        // clamp to viewport right
        if (origX + newW > window.innerWidth) {
          newW = window.innerWidth - origX;
        }
      }

      if (type === 'sw' || type === 'w') {
        const potentialW = origW - dx;
        const clampedW = Math.max(MIN_WIDTH, Math.min(maxAllowedW, potentialW));
        newX = Math.max(0, origX + (origW - clampedW));
        newW = origW + (origX - newX);
      }

      if (type === 'se' || type === 'sw' || type === 's') {
        const potentialH = origH + dy;
        newH = Math.max(MIN_HEIGHT, Math.min(maxAllowedH, potentialH));
        // clamp to viewport bottom
        if (origY + newH > window.innerHeight) {
          newH = window.innerHeight - origY;
        }
      }

      setSize({ width: newW, height: newH });
      if (newX !== origX) {
        setPos(p => ({ ...p, x: newX }));
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      resizeRef.current = null;
      try {
        localStorage.setItem(STORAGE_KEY_SIZE, JSON.stringify(size));
        localStorage.setItem(STORAGE_KEY_POS, JSON.stringify(pos));
      } catch {}
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, size, pos]);

  const handleMouseDownHeader = (e: React.MouseEvent) => {
    if (isLocked) return;
    if ((e.target as HTMLElement).closest('button')) return;
    hasMovedRef.current = false;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    };
    setIsDragging(true);
  };

  const handleResizeStart = (e: React.MouseEvent, type: 'se' | 'sw' | 'e' | 'w' | 's') => {
    e.stopPropagation();
    e.preventDefault();
    if (isLocked || isCollapsed) return;
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
      origW: size.width,
      origH: size.height,
      type,
    };
    setIsResizing(true);
  };

  const toggleLock = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !isLocked;
    setIsLocked(next);
    try {
      localStorage.setItem(STORAGE_KEY_LOCKED, String(next));
    } catch {}
  };

  const resetPositionAndSize = (e: React.MouseEvent) => {
    e.stopPropagation();
    const defSize = DEFAULT_SIZE;
    const defPos = getDefaultPosition(defSize.width, defSize.height);
    setSize(defSize);
    setPos(defPos);
    try {
      localStorage.setItem(STORAGE_KEY_SIZE, JSON.stringify(defSize));
      localStorage.setItem(STORAGE_KEY_POS, JSON.stringify(defPos));
    } catch {}
  };

  const dur = Math.max(1, durationSec);

  const stats = units.map(u => {
    const rawDamage = Math.max(0, u.combatStats?.damageDealt || 0);
    const rawHeal = Math.max(0, u.combatStats?.healingDone || 0);
    const overheal = Math.max(0, u.combatStats?.overhealDone || 0);
    const interrupts = Math.max(0, u.combatStats?.interruptCount || 0);
    const damageTaken = Math.max(0, u.combatStats?.damageTaken || (u.maxHp - u.hp));

    return {
      id: u.id,
      name: u.name,
      classId: u.classId,
      isPlayer: u.isPlayer,
      dps: Math.max(0, Math.round(rawDamage / dur)),
      totalDamage: rawDamage,
      effectiveHps: Math.max(0, Math.round(rawHeal / dur)),
      totalHeal: rawHeal,
      damageTaken: Math.max(0, damageTaken),
      interrupts,
      skillDamage: u.combatStats?.skillDamage,
      skillHealing: u.combatStats?.skillHealing,
    };
  });

  if (metric === 'DPS') {
    stats.sort((a, b) => b.totalDamage - a.totalDamage);
  } else if (metric === 'EFFECTIVE_HPS') {
    stats.sort((a, b) => b.totalHeal - a.totalHeal);
  } else if (metric === 'DAMAGE_TAKEN') {
    stats.sort((a, b) => b.damageTaken - a.damageTaken);
  } else {
    stats.sort((a, b) => b.interrupts - a.interrupts);
  }

  const maxVal = Math.max(
    1,
    ...stats.map(s =>
      metric === 'DPS'
        ? s.totalDamage
        : metric === 'EFFECTIVE_HPS'
        ? s.totalHeal
        : metric === 'DAMAGE_TAKEN'
        ? s.damageTaken
        : s.interrupts
    )
  );

  const hoveredStat = hoveredUnitId ? stats.find(s => s.id === hoveredUnitId) : null;

  // Adaptive tooltip placement: show to the right if near screen left edge
  const isNearLeftEdge = pos.x < 320;
  const isNearBottomEdge = typeof window !== 'undefined' && pos.y > window.innerHeight - 300;

  return (
    <div
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        width: `${size.width}px`,
        height: isCollapsed ? 'auto' : `${size.height}px`,
        backgroundColor: '#10101c',
        opacity: 1,
      }}
      className={`fixed z-30 select-none border-2 border-[#33334d] rounded-xl flex flex-col overflow-visible shadow-[0_12px_40px_rgba(0,0,0,0.92)] transition-shadow ${
        isDragging
          ? 'cursor-grabbing shadow-[0_0_25px_rgba(245,158,11,0.45)] ring-1 ring-amber-400/50'
          : isResizing
          ? 'shadow-[0_0_25px_rgba(59,130,246,0.45)] ring-1 ring-blue-400/50'
          : ''
      }`}
    >
      {/* Title Bar (Draggable handle) */}
      <div
        onMouseDown={handleMouseDownHeader}
        onClick={() => {
          if (!hasMovedRef.current) {
            setIsCollapsed(!isCollapsed);
          }
        }}
        className={`bg-[#18182e] px-3 py-1.5 flex items-center justify-between border-b border-[#282846] rounded-t-[10px] select-none flex-shrink-0 ${
          isLocked ? 'cursor-default' : isDragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        style={{ backgroundColor: '#18182e', opacity: 1 }}
        title={isLocked ? '已锁定位置 (点击锁图标解锁)' : '拖拽可移动浮窗位置'}
      >
        <span className="text-xs font-bold text-amber-300 flex items-center space-x-1.5 min-w-0">
          <span className="text-gray-400 hover:text-amber-400 transition" title="拖动把手">
            ⠿
          </span>
          <span>📊</span>
          <span className="truncate">战斗统计 (Details!)</span>
        </span>

        {/* Header Action Controls */}
        <div className="flex items-center space-x-1 flex-shrink-0 ml-1">
          <span className="text-[10px] text-gray-400 font-mono mr-1">{dur}s</span>

          {/* Reset position & size button */}
          <button
            onClick={resetPositionAndSize}
            className="text-[11px] text-gray-400 hover:text-amber-300 px-1 py-0.5 rounded transition hover:bg-[#252545]"
            title="复位位置与尺寸"
          >
            ↺
          </button>

          {/* Lock / Unlock button */}
          <button
            onClick={toggleLock}
            className={`text-[11px] px-1 py-0.5 rounded transition hover:bg-[#252545] ${
              isLocked ? 'text-amber-400' : 'text-gray-400 hover:text-gray-200'
            }`}
            title={isLocked ? '已锁定 (点击解锁拖拽与缩放)' : '未锁定 (点击锁定位置)'}
          >
            {isLocked ? '🔒' : '🔓'}
          </button>

          {/* Collapse / Expand toggle button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsCollapsed(!isCollapsed);
            }}
            className="text-xs text-gray-400 hover:text-white px-1 py-0.5 rounded transition hover:bg-[#252545]"
            title={isCollapsed ? '展开统计' : '收起统计'}
          >
            {isCollapsed ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* Content Body (Flex Column filling remaining vertical space) */}
      {!isCollapsed && (
        <div
          className="p-2 space-y-2 flex-1 min-h-0 flex flex-col rounded-b-[10px] relative"
          style={{ backgroundColor: '#10101c', opacity: 1 }}
        >
          {/* Metric Tabs */}
          <div className="grid grid-cols-4 gap-1 text-[10px] font-bold flex-shrink-0">
            <button
              onClick={() => setMetric('DPS')}
              className={`py-1 rounded text-center transition ${
                metric === 'DPS' ? 'bg-red-600 text-white shadow' : 'bg-[#1a1a30] text-gray-400 hover:text-white'
              }`}
            >
              伤害
            </button>
            <button
              onClick={() => setMetric('EFFECTIVE_HPS')}
              className={`py-1 rounded text-center transition ${
                metric === 'EFFECTIVE_HPS' ? 'bg-emerald-600 text-white shadow' : 'bg-[#1a1a30] text-gray-400 hover:text-white'
              }`}
            >
              治疗
            </button>
            <button
              onClick={() => setMetric('DAMAGE_TAKEN')}
              className={`py-1 rounded text-center transition ${
                metric === 'DAMAGE_TAKEN' ? 'bg-amber-600 text-white shadow' : 'bg-[#1a1a30] text-gray-400 hover:text-white'
              }`}
            >
              承伤
            </button>
            <button
              onClick={() => setMetric('INTERRUPTS')}
              className={`py-1 rounded text-center transition ${
                metric === 'INTERRUPTS' ? 'bg-blue-600 text-white shadow' : 'bg-[#1a1a30] text-gray-400 hover:text-white'
              }`}
            >
              打断
            </button>
          </div>

          {/* Bars List (Scrollable and fills all remaining height!) */}
          <div className="space-y-1.5 flex-1 min-h-0 overflow-y-auto pr-1">
            {stats.map((s, idx) => {
              const val =
                metric === 'DPS'
                  ? s.totalDamage
                  : metric === 'EFFECTIVE_HPS'
                  ? s.totalHeal
                  : metric === 'DAMAGE_TAKEN'
                  ? s.damageTaken
                  : s.interrupts;
              const pct = (val / maxVal) * 100;
              const classColor = CLASS_COLORS[s.classId as any] || '#888';

              return (
                <div
                  key={s.id}
                  onMouseEnter={() => setHoveredUnitId(s.id)}
                  onMouseLeave={() => setHoveredUnitId(null)}
                  className={`relative rounded overflow-hidden bg-[#18182e] h-6 flex items-center px-1.5 cursor-pointer transition ${
                    hoveredUnitId === s.id ? 'ring-1 ring-amber-400 bg-[#222240]' : ''
                  }`}
                  style={{ backgroundColor: hoveredUnitId === s.id ? '#222240' : '#18182e' }}
                >
                  {/* Progress Fill */}
                  <div
                    className="absolute inset-0 opacity-40 transition-all duration-300 pointer-events-none"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: classColor,
                    }}
                  />
                  {/* Content Label */}
                  <div className="relative z-10 w-full flex items-center justify-between text-[11px] font-bold">
                    <span className="flex items-center space-x-1.5 min-w-0" style={{ color: classColor }}>
                      <span className="text-[9px] text-gray-400 font-mono">{idx + 1}.</span>
                      <div
                        className="w-4 h-4 rounded overflow-hidden flex-shrink-0"
                        dangerouslySetInnerHTML={{ __html: CLASS_PIXEL_AVATARS[s.classId] || '' }}
                      />
                      <span className="truncate">{s.name}</span>
                      {s.isPlayer && <span className="text-[8px] bg-amber-500 text-black px-1 rounded flex-shrink-0">我</span>}
                    </span>
                    <span className="font-mono text-gray-200 flex-shrink-0 ml-1">
                      {metric === 'DPS'
                        ? `${s.totalDamage.toLocaleString()} (${s.dps.toLocaleString()}/s)`
                        : metric === 'EFFECTIVE_HPS'
                        ? `${s.totalHeal.toLocaleString()} (${s.effectiveHps.toLocaleString()}/s)`
                        : metric === 'DAMAGE_TAKEN'
                        ? `${s.damageTaken.toLocaleString()} (${Math.round(s.damageTaken / dur).toLocaleString()}/s)`
                        : `${s.interrupts}次`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Resize Handles (Edges and Corners) - only when unlocked and expanded */}
          {!isLocked && (
            <>
              {/* Right edge */}
              <div
                onMouseDown={(e) => handleResizeStart(e, 'e')}
                className="absolute right-0 top-3 bottom-3 w-1.5 cursor-ew-resize hover:bg-amber-400/30 transition z-10"
                title="左右拉伸宽度"
              />
              {/* Left edge */}
              <div
                onMouseDown={(e) => handleResizeStart(e, 'w')}
                className="absolute left-0 top-3 bottom-3 w-1.5 cursor-ew-resize hover:bg-amber-400/30 transition z-10"
                title="向左拉伸宽度"
              />
              {/* Bottom edge */}
              <div
                onMouseDown={(e) => handleResizeStart(e, 's')}
                className="absolute bottom-0 left-3 right-3 h-1.5 cursor-ns-resize hover:bg-amber-400/30 transition z-10"
                title="向下拉伸高度"
              />
              {/* Bottom-left corner */}
              <div
                onMouseDown={(e) => handleResizeStart(e, 'sw')}
                className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize hover:bg-amber-400/50 rounded-bl-xl transition z-20"
                title="向左下调整大小"
              />
              {/* Bottom-right corner with visual handle lines */}
              <div
                onMouseDown={(e) => handleResizeStart(e, 'se')}
                className="absolute bottom-0.5 right-0.5 w-4 h-4 cursor-se-resize flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity z-20 group"
                title="拖动调整大小 (宽与高)"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" className="text-gray-400 group-hover:text-amber-400">
                  <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <line x1="9" y1="5" x2="5" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <line x1="9" y1="8" x2="8" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
            </>
          )}
        </div>
      )}

      {/* Authentic Details! Hover Skill Breakdown Tooltip (100% Opaque & Adaptive Direction) */}
      {hoveredStat && !isCollapsed && (
        <div
          style={{ backgroundColor: '#101020', opacity: 1 }}
          className={`absolute ${
            isNearLeftEdge ? 'left-full ml-2' : 'right-full mr-2'
          } ${
            isNearBottomEdge ? 'bottom-0' : 'top-0'
          } w-72 border-2 border-[#45456b] rounded-xl p-3 shadow-2xl z-50 pointer-events-none animate-in fade-in zoom-in-95 duration-100`}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#2b2b48] pb-1.5 mb-2">
            <div className="flex items-center space-x-1.5">
              <div
                className="w-4 h-4 rounded overflow-hidden flex-shrink-0"
                dangerouslySetInnerHTML={{ __html: CLASS_PIXEL_AVATARS[hoveredStat.classId] || '' }}
              />
              <span
                className="font-extrabold text-xs"
                style={{ color: CLASS_COLORS[hoveredStat.classId as any] || '#FFD700' }}
              >
                {hoveredStat.name}
              </span>
            </div>
            <span className="text-[10px] text-gray-300 font-mono">
              {metric === 'DPS'
                ? `${hoveredStat.totalDamage.toLocaleString()} (${hoveredStat.dps.toLocaleString()}/s)`
                : metric === 'EFFECTIVE_HPS'
                ? `${hoveredStat.totalHeal.toLocaleString()} (${hoveredStat.effectiveHps.toLocaleString()}/s)`
                : metric === 'DAMAGE_TAKEN'
                ? `${hoveredStat.damageTaken.toLocaleString()} (${Math.round(hoveredStat.damageTaken / dur).toLocaleString()}/s)`
                : `${hoveredStat.interrupts}次`}
            </span>
          </div>

          {/* Skill Breakdown List */}
          {(() => {
            let skillMap: Record<string, number> = {};
            if (metric === 'DPS' || metric === 'DAMAGE_TAKEN') {
              skillMap = mergeSkillMap(hoveredStat.skillDamage);
              if (Object.keys(skillMap).length === 0 && hoveredStat.totalDamage > 0) {
                skillMap = { '普通攻击': hoveredStat.totalDamage };
              }
            } else if (metric === 'EFFECTIVE_HPS') {
              skillMap = mergeSkillMap(hoveredStat.skillHealing);
              if (Object.keys(skillMap).length === 0 && hoveredStat.totalHeal > 0) {
                skillMap = { '基础治疗': hoveredStat.totalHeal };
              }
            }

            const entries = Object.entries(skillMap)
              .filter(([_, v]) => v > 0)
              .sort((a, b) => b[1] - a[1]);

            if (entries.length === 0) {
              return (
                <div className="text-[10px] text-gray-500 text-center py-2">
                  暂无技能成分数据
                </div>
              );
            }

            const topVal = entries[0][1] || 1;
            const totalSum = entries.reduce((sum, e) => sum + e[1], 0) || 1;
            const classColor = CLASS_COLORS[hoveredStat.classId as any] || '#38BDF8';

            return (
              <div className="space-y-1.5 max-h-60 overflow-y-auto pr-0.5">
                {entries.map(([skillName, amt], idx) => {
                  const barPct = Math.min(100, Math.max(0, (amt / topVal) * 100)); // #1 skill fills 100%!
                  const totalPct = ((amt / totalSum) * 100).toFixed(1);

                  return (
                    <div
                      key={skillName}
                      className="relative rounded overflow-hidden bg-[#18182e] h-5 flex items-center px-1.5 border border-[#2b2b48]/40"
                      style={{ backgroundColor: '#18182e' }}
                    >
                      {/* Proportional background bar (Top skill fills 100%) */}
                      <div
                        className="absolute inset-y-0 left-0 opacity-45 transition-all duration-200"
                        style={{
                          width: `${barPct}%`,
                          backgroundColor: classColor,
                        }}
                      />
                      {/* Skill Info */}
                      <div className="relative z-10 w-full flex items-center justify-between text-[10px] font-bold">
                        <span className="flex items-center space-x-1 truncate text-gray-200">
                          <span className="text-[9px] text-gray-400 font-mono">{idx + 1}.</span>
                          <span className="truncate">{skillName}</span>
                        </span>
                        <div className="flex items-center space-x-1.5 font-mono flex-shrink-0 ml-1">
                          <span className="text-gray-100">{amt.toLocaleString()}</span>
                          <span className="text-gray-400 text-[9px]">({totalPct}%)</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};
