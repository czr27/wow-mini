import React, { useState, useEffect, useRef } from 'react';
import type { RoomChatMessage } from '@cata-raid-sim/engine';
import { CLASS_COLORS } from './AuthAndCharacterModal.js';
import { clampHudPosToViewport } from '../utils/hudLayout.js';

interface Props {
  variant: 'lobby' | 'combat';
  messages: RoomChatMessage[];
  onSendMessage: (text: string) => void;
}

const STORAGE_KEY_CHAT_POS = 'cata_chat_panel_pos';

function getDefaultCombatSize(): { width: number; height: number } {
  if (typeof window !== 'undefined') {
    const w = Math.max(260, Math.round(window.innerWidth / 3));
    // 4 rows of action bar slots (4 * 44px + 3 * 4px = 188px) + compact header/input padding
    const h = 212;
    return { width: w, height: h };
  }
  return { width: 420, height: 212 };
}

function getDefaultCombatPos(w: number, h: number): { x: number; y: number } {
  if (typeof window !== 'undefined') {
    return clampHudPosToViewport(
      { x: 16, y: Math.max(70, window.innerHeight - h - 16) },
      window.innerWidth,
      window.innerHeight,
      w,
      h
    );
  }
  return { x: 16, y: 500 };
}

function loadSavedChatPos(w: number, h: number): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CHAT_POS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
        const vh = typeof window !== 'undefined' ? window.innerHeight : 1080;
        return clampHudPosToViewport(parsed, vw, vh, w, h);
      }
    }
  } catch {}
  return getDefaultCombatPos(w, h);
}

function formatTime(atMs: number): string {
  const d = new Date(atMs);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export const ChatPanel: React.FC<Props> = ({ variant, messages, onSendMessage }) => {
  const [draft, setDraft] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [size, setSize] = useState<{ width: number; height: number }>(getDefaultCombatSize);
  const [pos, setPos] = useState<{ x: number; y: number }>(() =>
    loadSavedChatPos(size.width, size.height)
  );
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const prevLenRef = useRef<number>(messages.length);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > prevLenRef.current) {
      if (isCollapsed) {
        setUnreadCount((c) => c + (messages.length - prevLenRef.current));
      }
      if (listRef.current) {
        listRef.current.scrollTop = listRef.current.scrollHeight;
      }
    }
    prevLenRef.current = messages.length;
  }, [messages.length, isCollapsed]);

  useEffect(() => {
    if (!isCollapsed && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
    if (!isCollapsed) {
      setUnreadCount(0);
    }
  }, [isCollapsed]);

  // Keep combat chat size/pos valid on resize
  useEffect(() => {
    if (variant !== 'combat') return;
    const onResize = () => {
      const nextW = Math.max(260, Math.round(window.innerWidth / 3));
      const nextH = 212;
      setSize({ width: nextW, height: nextH });
      setPos((prev) =>
        clampHudPosToViewport(prev, window.innerWidth, window.innerHeight, nextW, nextH)
      );
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [variant]);

  // Dragging handlers for combat HUD mode
  useEffect(() => {
    if (variant !== 'combat' || !isDragging) return;
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const clamped = clampHudPosToViewport(
        { x: dragRef.current.origX + dx, y: dragRef.current.origY + dy },
        window.innerWidth,
        window.innerHeight,
        size.width,
        isCollapsed ? 32 : size.height
      );
      setPos(clamped);
    };
    const onUp = () => {
      setIsDragging(false);
      dragRef.current = null;
      setPos((cur) => {
        try {
          localStorage.setItem(STORAGE_KEY_CHAT_POS, JSON.stringify(cur));
        } catch {}
        return cur;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [variant, isDragging, size.width, size.height, isCollapsed]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setDraft('');
  };

  const renderMessageList = (emptyText: string) => (
    <div
      ref={listRef}
      className="flex-1 min-h-0 overflow-y-auto px-2.5 py-1.5 space-y-1 text-xs leading-snug"
    >
      {messages.length === 0 ? (
        <div className="text-[11px] text-slate-500 italic py-1">{emptyText}</div>
      ) : (
        messages.map((m) => {
          if (m.senderKind === 'BOSS') {
            return (
              <div key={m.id} className="text-red-400 font-bold break-words">
                <span className="text-[10px] text-red-400/70 font-mono mr-1.5">
                  [{formatTime(m.atMs)}]
                </span>
                <span>[{m.senderName}]：{m.text}</span>
              </div>
            );
          }
          if (m.senderKind === 'SYSTEM') {
            return (
              <div key={m.id} className="text-amber-300/90 break-words">
                <span className="text-[10px] text-slate-500 font-mono mr-1.5">
                  [{formatTime(m.atMs)}]
                </span>
                <span>{m.text}</span>
              </div>
            );
          }
          const nameColor = m.classId ? CLASS_COLORS[m.classId] || '#e2e8f0' : '#e2e8f0';
          return (
            <div key={m.id} className="text-slate-200 break-words">
              <span className="text-[10px] text-slate-500 font-mono mr-1.5">
                [{formatTime(m.atMs)}]
              </span>
              <span className="font-bold mr-1" style={{ color: nameColor }}>
                [{m.senderName}]:
              </span>
              <span>{m.text}</span>
            </div>
          );
        })
      )}
    </div>
  );

  if (variant === 'lobby') {
    return (
      <div className="w-full bg-slate-900/90 border border-slate-800 rounded-lg overflow-hidden flex flex-col">
        <div className="px-3 py-1.5 bg-slate-950/60 border-b border-slate-800/80 flex items-center justify-between text-[11px]">
          <span className="font-bold text-amber-300 flex items-center gap-1.5">
            <span>💬</span>
            <span>队伍频道</span>
          </span>
          <span className="text-slate-500 text-[10px]">房间成员实时互通</span>
        </div>
        <div className="h-28 flex flex-col">
          {renderMessageList('暂无发言，输入内容与房间成员交流…')}
        </div>
        <form
          onSubmit={handleSubmit}
          className="px-2.5 py-1.5 border-t border-slate-800/80 bg-slate-950/40 flex items-center gap-2"
        >
          <input
            type="text"
            value={draft}
            maxLength={200}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="输入消息，按 Enter 发送…"
            className="flex-1 min-w-0 bg-slate-950/80 border border-slate-700/80 focus:border-amber-400 rounded px-2.5 py-1 text-xs text-slate-100 placeholder:text-slate-500 outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="px-3 py-1 rounded bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold text-xs transition shrink-0"
          >
            发送
          </button>
        </form>
      </div>
    );
  }

  // Combat HUD mode: semi-transparent, bottom-left, 1/3 screen width, 4 action-slot rows high, draggable & collapsible
  return (
    <div
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        width: `${size.width}px`,
        height: isCollapsed ? 'auto' : `${size.height}px`,
      }}
      className="fixed z-40 rounded-xl border border-[#323252]/70 bg-[#0a0a16]/65 hover:bg-[#0a0a16]/80 focus-within:bg-[#0a0a16]/85 backdrop-blur-sm shadow-xl flex flex-col overflow-hidden transition-colors select-none"
    >
      {/* Draggable Header */}
      <div
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          dragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            origX: pos.x,
            origY: pos.y,
          };
          setIsDragging(true);
        }}
        className={`px-2.5 py-1 border-b border-[#2a2a46]/70 bg-[#121226]/70 flex items-center justify-between ${
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        title="拖拽移动聊天窗口"
      >
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-300/95">
          <span className="text-slate-400">⠿</span>
          <span>💬 队伍聊天</span>
          {isCollapsed && unreadCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-red-600/90 text-white text-[9px] font-mono">
              {unreadCount}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsCollapsed((c) => !c);
          }}
          className="text-xs text-slate-300 hover:text-white px-1.5 py-0.5 rounded hover:bg-white/10 transition leading-none"
          title={isCollapsed ? '展开聊天' : '折叠聊天'}
        >
          {isCollapsed ? '▲' : '▼'}
        </button>
      </div>

      {!isCollapsed && (
        <>
          {renderMessageList('队伍聊天频道已就绪…')}
          <form
            onSubmit={handleSubmit}
            className="px-2 py-1 border-t border-[#2a2a46]/70 bg-[#080812]/70 flex items-center gap-1.5"
          >
            <input
              type="text"
              value={draft}
              maxLength={200}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.currentTarget.blur();
                }
              }}
              placeholder="输入消息 (Enter 发送)…"
              className="flex-1 min-w-0 bg-black/50 border border-slate-700/70 focus:border-amber-400 rounded px-2 py-0.5 text-[11px] text-slate-100 placeholder:text-slate-500 outline-none"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="px-2.5 py-0.5 rounded bg-amber-500/90 hover:bg-amber-400 disabled:bg-slate-800/70 disabled:text-slate-500 text-slate-950 font-bold text-[11px] transition shrink-0"
            >
              发送
            </button>
          </form>
        </>
      )}
    </div>
  );
};
