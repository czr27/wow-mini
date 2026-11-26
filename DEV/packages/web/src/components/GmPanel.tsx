import React, { useEffect, useRef, useState } from 'react';
import type { BossAI, CombatEngine, GmCommandPayload } from '@cata-raid-sim/engine';

interface Props {
  engine: CombatEngine;
  bossAi: BossAI | null;
  runPhase: string;
  initialPos?: { x: number; y: number } | null;
  onSavePos?: (pos: { x: number; y: number }) => void;
  onIssueGmCommand: (cmd: Omit<GmCommandPayload, 'playerId'>) => string;
  onDisableGm: () => void;
}

const STORAGE_KEY_POS = 'cata_gm_panel_pos';

function loadSavedPos(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_POS);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && typeof p.x === 'number' && typeof p.y === 'number') return p;
    }
  } catch {}
  return {
    x: typeof window !== 'undefined' ? Math.max(16, window.innerWidth - 336) : 900,
    y: 72,
  };
}

export const GmPanel: React.FC<Props> = ({
  engine,
  bossAi,
  runPhase,
  initialPos = null,
  onSavePos,
  onIssueGmCommand,
  onDisableGm,
}) => {
  const [pos, setPos] = useState<{ x: number; y: number }>(() =>
    initialPos && typeof initialPos.x === 'number' && typeof initialPos.y === 'number'
      ? initialPos
      : loadSavedPos()
  );
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [enemyDmgMult, setEnemyDmgMult] = useState(() => engine.gmEnemyDamageMult || 1);
  const [friendlyInv, setFriendlyInv] = useState(() => !!engine.gmFriendlyInvincible);
  const [enemyInv, setEnemyInv] = useState(() => !!engine.gmEnemyInvincible);
  const [lastFeedback, setLastFeedback] = useState<string | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const hasMovedRef = useRef(false);
  const latestPosRef = useRef(pos);
  latestPosRef.current = pos;

  useEffect(() => {
    if (initialPos && typeof initialPos.x === 'number' && typeof initialPos.y === 'number') {
      setPos(initialPos);
    }
  }, [initialPos?.x, initialPos?.y]);

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent) => {
      hasMovedRef.current = true;
      const maxX = typeof window !== 'undefined' ? Math.max(100, window.innerWidth - 300) : 1000;
      const maxY = typeof window !== 'undefined' ? Math.max(100, window.innerHeight - 60) : 700;
      const next = {
        x: Math.round(Math.max(8, Math.min(maxX, e.clientX - dragOffsetRef.current.x))),
        y: Math.round(Math.max(48, Math.min(maxY, e.clientY - dragOffsetRef.current.y))),
      };
      latestPosRef.current = next;
      setPos(next);
    };
    const handleUp = () => {
      setIsDragging(false);
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

  const sendCmd = (cmd: Omit<GmCommandPayload, 'playerId'>) => {
    const note = onIssueGmCommand(cmd);
    if (note) setLastFeedback(note);
  };

  const adjustEnemyDmg = (delta: number, reset = false) => {
    const next = reset
      ? 1.0
      : Math.round(Math.max(0.1, Math.min(5.0, enemyDmgMult + delta)) * 10) / 10;
    setEnemyDmgMult(next);
    sendCmd({ kind: 'ENEMY_DMG_MULT', mult: next });
  };

  const skills = bossAi?.skills || [];

  return (
    <div
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
      className="fixed z-[95] w-[308px] rounded-xl border border-amber-500/50 bg-[#121022]/90 backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.65)] text-gray-200 select-none"
      data-testid="gm-panel"
    >
      {/* Draggable Header */}
      <div
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          hasMovedRef.current = false;
          dragOffsetRef.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
          setIsDragging(true);
        }}
        onClick={() => {
          if (!hasMovedRef.current) setIsCollapsed((v) => !v);
        }}
        className="flex items-center justify-between px-3 py-2 border-b border-amber-500/30 bg-amber-950/35 rounded-t-xl cursor-grab active:cursor-grabbing"
      >
        <div className="flex items-center gap-1.5">
          <span className="text-xs">🛠️</span>
          <span className="text-xs font-extrabold text-amber-300 tracking-wide">GM 测试面板</span>
          <span className="text-[10px] text-amber-200/70">({isCollapsed ? '展开' : '折叠'})</span>
        </div>
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onDisableGm();
          }}
          title="退出 GM 模式（可再次连点角色分工图标12下解锁）"
          className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800/80 hover:bg-red-900/70 text-gray-300 hover:text-red-200 border border-gray-600/60 transition cursor-pointer"
        >
          🔒 退出GM
        </button>
      </div>

      {!isCollapsed && (
        <div className="p-2.5 space-y-2.5 max-h-[70vh] overflow-y-auto text-[11px]">
          {/* 己方血量 */}
          <div className="space-y-1">
            <div className="text-[10px] font-bold text-emerald-300/90">己方状态</div>
            <div className="grid grid-cols-4 gap-1">
              <button
                type="button"
                onClick={() => sendCmd({ kind: 'FRIENDLY_HP_PCT', deltaPct: 0.1 })}
                className="px-1.5 py-1 rounded bg-emerald-900/50 hover:bg-emerald-800/70 border border-emerald-500/40 text-emerald-200 font-semibold cursor-pointer"
              >
                +10%血
              </button>
              <button
                type="button"
                onClick={() => sendCmd({ kind: 'FRIENDLY_HP_PCT', deltaPct: -0.1 })}
                className="px-1.5 py-1 rounded bg-rose-900/45 hover:bg-rose-800/70 border border-rose-500/40 text-rose-200 font-semibold cursor-pointer"
              >
                -10%血
              </button>
              <button
                type="button"
                onClick={() => sendCmd({ kind: 'FRIENDLY_FULL_RESTORE' })}
                className="col-span-2 px-1.5 py-1 rounded bg-emerald-950/60 hover:bg-emerald-900/70 border border-emerald-500/40 text-emerald-100 font-semibold cursor-pointer"
              >
                全团复活满状态
              </button>
            </div>
          </div>

          {/* 敌方血量 */}
          <div className="space-y-1">
            <div className="text-[10px] font-bold text-red-300/90">敌方血量</div>
            <div className="grid grid-cols-4 gap-1">
              <button
                type="button"
                onClick={() => sendCmd({ kind: 'ENEMY_HP_PCT', deltaPct: 0.1 })}
                className="px-1.5 py-1 rounded bg-amber-900/45 hover:bg-amber-800/70 border border-amber-500/40 text-amber-200 font-semibold cursor-pointer"
              >
                +10%血
              </button>
              <button
                type="button"
                onClick={() => sendCmd({ kind: 'ENEMY_HP_PCT', deltaPct: -0.1 })}
                className="px-1.5 py-1 rounded bg-red-900/50 hover:bg-red-800/70 border border-red-500/40 text-red-200 font-semibold cursor-pointer"
              >
                -10%血
              </button>
              <button
                type="button"
                onClick={() => sendCmd({ kind: 'ENEMY_SET_HP_ONE' })}
                className="px-1.5 py-1 rounded bg-purple-900/50 hover:bg-purple-800/70 border border-purple-500/40 text-purple-200 font-semibold cursor-pointer"
              >
                1点血
              </button>
              <button
                type="button"
                onClick={() => sendCmd({ kind: 'ENEMY_KILL_ALL' })}
                className="px-1.5 py-1 rounded bg-red-950/80 hover:bg-red-800 border border-red-500/60 text-red-100 font-bold cursor-pointer"
              >
                秒杀
              </button>
            </div>
          </div>

          {/* 敌方伤害加成 */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-orange-300/90">敌方伤害倍率</span>
              <span className="text-[11px] font-extrabold text-orange-200 tabular-nums">
                {Math.round(enemyDmgMult * 100)}%
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1">
              <button
                type="button"
                onClick={() => adjustEnemyDmg(-0.1)}
                className="px-1.5 py-1 rounded bg-sky-900/45 hover:bg-sky-800/70 border border-sky-500/40 text-sky-200 font-semibold cursor-pointer"
              >
                伤害 -10%
              </button>
              <button
                type="button"
                onClick={() => adjustEnemyDmg(0.1)}
                className="px-1.5 py-1 rounded bg-orange-900/50 hover:bg-orange-800/70 border border-orange-500/40 text-orange-200 font-semibold cursor-pointer"
              >
                伤害 +10%
              </button>
              <button
                type="button"
                onClick={() => adjustEnemyDmg(0, true)}
                className="px-1.5 py-1 rounded bg-gray-800/70 hover:bg-gray-700 border border-gray-600/50 text-gray-200 font-semibold cursor-pointer"
              >
                重置100%
              </button>
            </div>
          </div>

          {/* 触发 Boss 机制 */}
          <div className="space-y-1 pt-1 border-t border-white/10">
            <div className="text-[10px] font-bold text-sky-300/90">
              触发当前 Boss 技能/机制 {engine.bossUnit ? `(${engine.bossUnit.name})` : ''}
            </div>
            {skills.length === 0 ? (
              <div className="text-[10px] text-gray-500 italic">进入 Boss 战后显示可触发技能</div>
            ) : (
              <div className="grid grid-cols-2 gap-1">
                {skills.map((skill) => (
                  <button
                    key={skill.id}
                    type="button"
                    onClick={() => sendCmd({ kind: 'TRIGGER_BOSS_SKILL', skillId: skill.id })}
                    title={skill.description}
                    className="px-2 py-1 rounded bg-indigo-950/70 hover:bg-indigo-800/70 border border-indigo-400/40 text-indigo-100 text-left truncate font-semibold cursor-pointer"
                  >
                    ⚡ {skill.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 副本测试辅助 */}
          <div className="space-y-1 pt-1 border-t border-white/10">
            <div className="text-[10px] font-bold text-amber-300/90">副本测试快捷</div>
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => sendCmd({ kind: 'RESET_COOLDOWNS' })}
                className="px-2 py-1 rounded bg-slate-800/80 hover:bg-slate-700 border border-slate-600/60 text-slate-200 cursor-pointer"
              >
                🔄 重置全部 CD
              </button>
              <button
                type="button"
                onClick={() => sendCmd({ kind: 'CLEAR_GROUND_HAZARDS' })}
                className="px-2 py-1 rounded bg-slate-800/80 hover:bg-slate-700 border border-slate-600/60 text-slate-200 cursor-pointer"
              >
                🧹 清地面危险区
              </button>
              <button
                type="button"
                onClick={() => sendCmd({ kind: 'FAST_FORWARD_10S' })}
                className="px-2 py-1 rounded bg-slate-800/80 hover:bg-slate-700 border border-slate-600/60 text-slate-200 cursor-pointer"
              >
                ⏩ 机制推进 +10s
              </button>
              <button
                type="button"
                onClick={() =>
                  sendCmd({
                    kind: 'SPAWN_WILD_PACK',
                    count: 3 + Math.floor(Math.random() * 3),
                  })
                }
                title="召唤 3~5 只野怪（1/30 Boss 血量、1/10 Boss 普攻）"
                className="px-2 py-1 rounded bg-purple-950/70 hover:bg-purple-800/70 border border-purple-400/50 text-purple-100 font-semibold cursor-pointer"
              >
                🐺 召唤野怪 (3~5只)
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = !friendlyInv;
                  setFriendlyInv(next);
                  sendCmd({ kind: 'TOGGLE_FRIENDLY_INVINCIBLE', enabled: next });
                }}
                className={`px-2 py-1 rounded border font-semibold cursor-pointer ${
                  friendlyInv
                    ? 'bg-emerald-700/80 border-emerald-400 text-white shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                    : 'bg-slate-800/80 hover:bg-slate-700 border-slate-600/60 text-slate-200'
                }`}
              >
                🛡️ 己方无敌{friendlyInv ? ' (开)' : ''}
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = !enemyInv;
                  setEnemyInv(next);
                  sendCmd({ kind: 'TOGGLE_ENEMY_INVINCIBLE', enabled: next });
                }}
                className={`px-2 py-1 rounded border font-semibold cursor-pointer ${
                  enemyInv
                    ? 'bg-red-700/80 border-red-400 text-white shadow-[0_0_8px_rgba(239,68,68,0.5)]'
                    : 'bg-slate-800/80 hover:bg-slate-700 border-slate-600/60 text-slate-200'
                }`}
              >
                👹 敌方无敌{enemyInv ? ' (开)' : ''}
              </button>
              {runPhase === 'TRAVEL_RECOVERY' && (
                <button
                  type="button"
                  onClick={() => sendCmd({ kind: 'SKIP_TRAVEL' })}
                  className="px-2 py-1 rounded bg-amber-900/60 hover:bg-amber-800 border border-amber-500/50 text-amber-100 font-semibold cursor-pointer"
                >
                  ⏭️ 跳过跑路
                </button>
              )}
            </div>
          </div>

          {lastFeedback && (
            <div className="text-[10px] text-amber-300/90 bg-amber-950/40 border border-amber-500/25 rounded px-2 py-1 truncate">
              {lastFeedback}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
