import React, { useEffect, useRef, useState } from 'react';
import type { DbmAlert, DbmRoleHint, DbmSeverity } from '@cata-raid-sim/engine';

interface Props {
  alerts: DbmAlert[];
  enabled: boolean;
  initialPos?: { x: number; y: number } | null;
  onSavePos?: (pos: { x: number; y: number }) => void;
  /** 测试预览时使用 fixed 定位到实际战斗 HUD 出现的位置 */
  fixedOverlay?: boolean;
}

const STORAGE_KEY_POS = 'cata_dbm_banner_pos';
const DEFAULT_POS = { x: 0, y: 12 };

function loadSavedPos(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_POS);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && typeof p.x === 'number' && typeof p.y === 'number') {
        return p;
      }
    }
  } catch {}
  return DEFAULT_POS;
}

const ROLE_LABEL: Record<DbmRoleHint, string> = {
  ALL: '全团',
  TANK: '坦克',
  HEALER: '治疗',
  DPS: '输出',
};

const SEVERITY_STYLE: Record<
  DbmSeverity,
  { border: string; bg: string; title: string; badge: string; icon: string }
> = {
  CRITICAL: {
    border: 'border-red-500/80 shadow-[0_0_16px_rgba(239,68,68,0.35)] animate-pulse',
    bg: 'bg-[#2a0d12]/55',
    title: 'text-red-200',
    badge: 'bg-red-600/70 text-white border-red-400/50',
    icon: '🚨',
  },
  WARN: {
    border: 'border-amber-400/75 shadow-[0_0_12px_rgba(251,191,36,0.25)]',
    bg: 'bg-[#261c0b]/55',
    title: 'text-amber-200',
    badge: 'bg-amber-600/65 text-amber-50 border-amber-400/45',
    icon: '⚠️',
  },
  INFO: {
    border: 'border-sky-400/65 shadow-[0_0_10px_rgba(56,189,248,0.18)]',
    bg: 'bg-[#0f1d2e]/55',
    title: 'text-sky-200',
    badge: 'bg-sky-700/65 text-sky-100 border-sky-400/40',
    icon: '📢',
  },
};

export const DbmAlertBanner: React.FC<Props> = ({
  alerts,
  enabled,
  initialPos = null,
  onSavePos,
  fixedOverlay = false,
}) => {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pos, setPos] = useState<{ x: number; y: number }>(() =>
    initialPos && typeof initialPos.x === 'number' && typeof initialPos.y === 'number'
      ? initialPos
      : loadSavedPos()
  );
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ clientX: number; clientY: number; origX: number; origY: number } | null>(null);
  const latestPosRef = useRef(pos);
  latestPosRef.current = pos;

  useEffect(() => {
    if (initialPos && typeof initialPos.x === 'number' && typeof initialPos.y === 'number') {
      setPos(initialPos);
    }
  }, [initialPos?.x, initialPos?.y]);

  useEffect(() => {
    if (!enabled || alerts.length === 0) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [enabled, alerts.length]);

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = e.clientX - dragStartRef.current.clientX;
      const dy = e.clientY - dragStartRef.current.clientY;
      const maxX = typeof window !== 'undefined' ? Math.max(160, window.innerWidth / 2 - 120) : 500;
      const maxY = typeof window !== 'undefined' ? Math.max(120, window.innerHeight - 140) : 600;
      const next = {
        x: Math.round(Math.max(-maxX, Math.min(maxX, dragStartRef.current.origX + dx))),
        y: Math.round(Math.max(0, Math.min(maxY, dragStartRef.current.origY + dy))),
      };
      latestPosRef.current = next;
      setPos(next);
    };
    const handleUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
      const saved = latestPosRef.current;
      try {
        localStorage.setItem(STORAGE_KEY_POS, JSON.stringify(saved));
      } catch {}
      onSavePos?.(saved);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDragging, onSavePos]);

  if (!enabled || alerts.length === 0) return null;

  const active = alerts
    .filter((a) => nowMs - a.atMs < (a.ttlMs || 3500))
    .slice(-3)
    .reverse();

  if (active.length === 0) return null;

  return (
    <div
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        dragStartRef.current = {
          clientX: e.clientX,
          clientY: e.clientY,
          origX: pos.x,
          origY: pos.y,
        };
        setIsDragging(true);
      }}
      style={{
        top: `${fixedOverlay ? 56 + pos.y : pos.y}px`,
        left: `calc(50% + ${pos.x}px)`,
        transform: 'translateX(-50%)',
      }}
      title="按住拖动调整 DBM 播报位置"
      className={`${
        fixedOverlay ? 'fixed z-[120]' : 'absolute z-20'
      } flex flex-col items-center gap-1.5 pointer-events-auto cursor-grab active:cursor-grabbing select-none w-[min(92vw,460px)] group`}
      data-testid="dbm-alert-banner"
    >
      {active.map((alert) => {
        const st = SEVERITY_STYLE[alert.severity] || SEVERITY_STYLE.WARN;
        const role = ROLE_LABEL[alert.roleHint || 'ALL'];
        return (
          <div
            key={alert.id}
            className={`w-full rounded-lg border px-3.5 py-2 backdrop-blur-sm transition-all ${st.bg} ${st.border}`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-sm leading-none shrink-0">{st.icon}</span>
                <span className={`font-extrabold text-xs tracking-wide truncate drop-shadow ${st.title}`}>
                  {alert.title}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[9px] text-gray-300/70 opacity-0 group-hover:opacity-100 transition-opacity">
                  ⋮⋮ 拖动
                </span>
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${st.badge}`}
                >
                  {role}
                </span>
              </div>
            </div>
            <div className="text-[11px] font-semibold text-gray-100 mt-0.5 pl-5 leading-snug drop-shadow">
              {alert.advice}
            </div>
          </div>
        );
      })}
    </div>
  );
};
