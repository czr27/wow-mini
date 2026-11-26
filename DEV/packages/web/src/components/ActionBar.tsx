import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  isOffGcdSpellId,
  getSpellByAnyId,
  getHastedCastTimeMs,
  LEVEL_80_MAX_HASTE,
  type KeybindingMap,
  type ClassId,
  type SpellResourceCostBundle,
  type UnitCrowdControlInfo,
} from '@cata-raid-sim/engine';
import { SPELL_ICONS, SPELL_TOOLTIPS } from '../assets/pixelIcons.js';
import { sanitizeSavedActionBarPos, clampHudPosToViewport } from '../utils/hudLayout.js';
export { PlayerCastBar } from './PlayerCastBar.js';
export type { PlayerCastBarProps } from './PlayerCastBar.js';

export interface ActionSlot {
  slotIdx: number;
  spellId: string;
  name: string;
  iconText: string;
  cdRemainingMs: number;
  totalCdMs: number;
  costText?: string;
  colorHex: string;
}

export interface PlayerCastState {
  spellName: string;
  spellId: string;
  progress: number; // 0 to 1
  elapsedMs: number;
  totalMs: number;
  isChannel?: boolean;
  targetId?: string;
  isHarmful?: boolean;
  maxAllowedRange?: number;
  totalCdMs?: number;
  /**
   * Local wall-clock start (guest cast bar). Progress is computed from Date.now()
   * so the bar does not hitch on host COMBAT_STATE / timeline echo.
   */
  startedAtMs?: number;
  /** 读条技能延迟至施法成功结束时再扣除的资源（引导技能起手已扣除，不填此项） */
  deferredCosts?: SpellResourceCostBundle;
}

/** Advance (or finish) a locally owned cast bar. Returns null when complete. */
export function advanceLocalPlayerCast(
  cast: PlayerCastState,
  now = Date.now()
): PlayerCastState | null {
  const total = Math.max(1, cast.totalMs || 1);
  const started = cast.startedAtMs ?? now - (cast.elapsedMs || 0);
  const elapsedMs = Math.max(0, now - started);
  if (elapsedMs >= total) return null;
  return {
    ...cast,
    startedAtMs: started,
    elapsedMs,
    progress: Math.min(1, elapsedMs / total),
  };
}

/**
 * Cataclysm 4.3 Off-GCD Spells (不进入公共CD，且施放时不触发公共CD的技能)
 */
export const OFF_GCD_SPELLS = new Set<string>([
  // Druid
  'natures_swiftness', 'barkskin', 'skull_bash', 'berserk',
  // Death Knight
  'mind_freeze', 'dark_command', 'pillar_of_frost', 'rune_strike', 'vampiric_blood', 'icebound_fortitude', 'anti_magic_shell',
  // Shaman
  'wind_shear', 'bloodlust', 'heroism', 'shamanistic_rage', 'thunderstorm',
  // Mage
  'counterspell', 'arcane_power', 'time_warp', 'ice_block',
  // Rogue
  'kick', 'feint', 'adrenaline_rush', 'vendetta', 'evasion', 'cloak_of_shadows', 'shadow_dance',
  // Warrior
  'pummel', 'taunt', 'shield_wall', 'last_stand', 'berserker_rage',
  // Paladin
  'rebuke', 'hand_of_reckoning', 'divine_protection', 'ardent_defender', 'avenging_wrath',
  // Hunter
  'silencing_shot', 'bestial_wrath', 'rapid_fire', 'deterrence',
  // Priest
  'silence', 'pain_suppression', 'guardian_spirit', 'dispersion',
  // Warlock
  'fel_hunter_spell_lock', 'spell_lock', 'metamorphosis',
]);

export function isOffGcdSpell(spellId: string): boolean {
  return OFF_GCD_SPELLS.has(spellId) || isOffGcdSpellId(spellId);
}

interface Props {
  classId: ClassId;
  specId: string;
  keybindings: KeybindingMap;
  slots: ActionSlot[];
  gcdRemainingMs: number;
  gcdTotalMs?: number;
  onCastSlot: (slotIdx: number, opts?: { selfCast?: boolean }) => void;
  onSwapSlots?: (srcIdx: number, destIdx: number) => void;
  onAssignSlot?: (slotIdx: number, spellId: string) => void;
  onClearSlot?: (slotIdx: number) => void;
  playerCast?: PlayerCastState | null;
  onCancelCast?: () => void;
  dkRunes?: Array<{ type: 'BLOOD' | 'FROST' | 'UNHOLY'; cdMs: number }>;
  comboPoints?: number;
  holyPower?: number;
  isInCombat?: boolean;
  outOfRangeSpells?: Record<string, boolean>;
  isPlayerDead?: boolean;
  activeGroundSpellId?: string | null;
  insufficientResourceSpells?: Record<string, boolean>;
  spellResourceErrors?: Record<string, string>;
  crowdControl?: UnitCrowdControlInfo | null;
  initialPos?: { x: number; y: number } | null;
  onSavePos?: (pos: { x: number; y: number } | null) => void;
}

export function formatSimplifiedHotkey(hotkey: string): string {
  if (!hotkey) return '';
  let s = hotkey.toLowerCase().trim();
  s = s.replace(/shift\+/g, 's+');
  s = s.replace(/ctrl\+/g, 'c+');
  s = s.replace(/control\+/g, 'c+');
  s = s.replace(/alt\+/g, 'a+');
  return s;
}

/**
 * Resolve a slot hotkey for display.
 * - missing/undefined → default binding
 * - explicit '' → unbound / conflict cleared → show N/A
 */
export function resolveSlotHotkey(
  keybindings: Record<number, string> | KeybindingMap | undefined,
  slotIdx: number
): { key: string; isUnbound: boolean } {
  const raw = keybindings?.[slotIdx];
  if (raw === '') return { key: 'N/A', isUnbound: true };
  if (raw != null && String(raw).trim() !== '') {
    return { key: String(raw), isUnbound: false };
  }
  const fallback = DEFAULT_KEYBINDINGS[slotIdx];
  return { key: fallback || '?', isUnbound: false };
}

export const DEFAULT_KEYBINDINGS: Record<number, string> = {
  // Row 1 (Bar 1: 0..11) -> 12345QERTFCX
  0: '1', 1: '2', 2: '3', 3: '4', 4: '5', 5: 'Q', 6: 'E', 7: 'R', 8: 'T', 9: 'F', 10: 'C', 11: 'X',
  // Row 2 (Bar 2: 12..23) -> SHIFT + Row 1
  12: 'SHIFT+1', 13: 'SHIFT+2', 14: 'SHIFT+3', 15: 'SHIFT+4', 16: 'SHIFT+5', 17: 'SHIFT+Q',
  18: 'SHIFT+E', 19: 'SHIFT+R', 20: 'SHIFT+T', 21: 'SHIFT+F', 22: 'SHIFT+C', 23: 'SHIFT+X',
  // Row 3 (Bar 3: 24..35) -> ` + F2..F12 (F1 triggers browser Help in some browsers, replaced with `)
  24: '`', 25: 'F2', 26: 'F3', 27: 'F4', 28: 'F5', 29: 'F6',
  30: 'F7', 31: 'F8', 32: 'F9', 33: 'F10', 34: 'F11', 35: 'F12',
};

export const ActionBar: React.FC<Props> = ({
  classId,
  specId,
  keybindings,
  slots,
  gcdRemainingMs,
  gcdTotalMs = 1000,
  onCastSlot,
  onSwapSlots,
  onAssignSlot,
  onClearSlot,
  playerCast = null,
  onCancelCast,
  dkRunes,
  comboPoints = 0,
  holyPower = 0,
  isInCombat = false,
  outOfRangeSpells = {},
  isPlayerDead = false,
  activeGroundSpellId = null,
  insufficientResourceSpells = {},
  spellResourceErrors = {},
  crowdControl = null,
  initialPos = null,
  onSavePos,
}) => {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => sanitizeSavedActionBarPos(initialPos));
  const [isDraggingBar, setIsDraggingBar] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const barDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; latestX?: number; latestY?: number } | null>(null);
  const barContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const clean = sanitizeSavedActionBarPos(initialPos);
    if (clean === null) {
      if (pos !== null) setPos(null);
    } else if (clean.x !== pos?.x || clean.y !== pos?.y) {
      setPos(clean);
    }
  }, [initialPos]);

  // 自定义坐标：禁止压标题区 / 出屏；已出界自动拉回
  useEffect(() => {
    if (pos == null) return;
    const pullIn = () => {
      const el = barContainerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPos((prev) => {
        if (!prev) return prev;
        return clampHudPosToViewport(
          prev,
          window.innerWidth,
          window.innerHeight,
          rect.width || 560,
          rect.height || 180
        );
      });
    };
    pullIn();
    window.addEventListener('resize', pullIn);
    return () => window.removeEventListener('resize', pullIn);
  }, [pos == null]);

  useEffect(() => {
    if (!isDraggingBar) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!barDragRef.current || !barContainerRef.current) return;
      const dx = e.clientX - barDragRef.current.startX;
      const dy = e.clientY - barDragRef.current.startY;
      const rect = barContainerRef.current.getBoundingClientRect();
      const clamped = clampHudPosToViewport(
        { x: barDragRef.current.origX + dx, y: barDragRef.current.origY + dy },
        window.innerWidth,
        window.innerHeight,
        rect.width,
        rect.height
      );
      barDragRef.current.latestX = clamped.x;
      barDragRef.current.latestY = clamped.y;
      setPos(clamped);
    };

    const handleMouseUp = () => {
      if (!barDragRef.current) return;
      const finalX = barDragRef.current.latestX ?? pos?.x ?? 0;
      const finalY = barDragRef.current.latestY ?? pos?.y ?? 0;
      setIsDraggingBar(false);
      barDragRef.current = null;
      if (onSavePos) {
        onSavePos({ x: finalX, y: finalY });
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingBar, pos, onSavePos]);

  const handleBarDragStart = (e: React.MouseEvent) => {
    if (isLocked) return;
    if (e.button !== 0) return;
    const container = barContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const curX = pos?.x ?? rect.left;
    const curY = pos?.y ?? rect.top;
    barDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: curX,
      origY: curY,
      latestX: curX,
      latestY: curY,
    };
    if (!pos) {
      setPos({ x: curX, y: curY });
    }
    setIsDraggingBar(true);
  };

  const [hoveredSlot, setHoveredSlot] = useState<ActionSlot | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

  // ── 技能栏上方弹出红色小字报错 (UIErrorsFrame: 法力值不足 / 能量不足 / 怒气不足 / 目标太远了) ──
  const [uiErrorMessage, setUiErrorMessage] = useState<{ text: string; id: number } | null>(null);
  const uiErrorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const triggerUIError = useCallback((text: string) => {
    if (uiErrorTimerRef.current) clearTimeout(uiErrorTimerRef.current);
    setUiErrorMessage({ text, id: Date.now() });
    uiErrorTimerRef.current = setTimeout(() => {
      setUiErrorMessage(null);
    }, 1800);
  }, []);

  useEffect(() => {
    const handleCustomUiError = (e: any) => {
      if (e.detail?.text) {
        triggerUIError(e.detail.text);
      }
    };
    window.addEventListener('cata_ui_error', handleCustomUiError as EventListener);
    return () => {
      window.removeEventListener('cata_ui_error', handleCustomUiError as EventListener);
      if (uiErrorTimerRef.current) clearTimeout(uiErrorTimerRef.current);
    };
  }, [triggerUIError]);

  // ── Track pressed state for each slot (键盘按下保持按压效果，一旦弹起立即恢复) ──
  const [pressedSlots, setPressedSlots] = useState<Record<number, boolean>>({});
  const activeKeySlotsRef = useRef<Map<string, {
    slotIdx: number;
    requiresShift: boolean;
    requiresCtrl: boolean;
    requiresAlt: boolean;
  }>>(new Map());
  const fallbackTimersRef = useRef<Record<number, NodeJS.Timeout>>({});

  // 辅助方法：以防需要临时触发（如无真实按键事件的辅助触发）
  const triggerSlotPress = useCallback((slotIdx: number, durationMs: number = 80) => {
    if (fallbackTimersRef.current[slotIdx]) {
      clearTimeout(fallbackTimersRef.current[slotIdx]);
    }
    setPressedSlots((prev) => ({ ...prev, [slotIdx]: true }));
    fallbackTimersRef.current[slotIdx] = setTimeout(() => {
      setPressedSlots((prev) => {
        const isHeld = Array.from(activeKeySlotsRef.current.values()).some((v) => v.slotIdx === slotIdx);
        if (isHeld || !prev[slotIdx]) return prev;
        const next = { ...prev };
        delete next[slotIdx];
        return next;
      });
      delete fallbackTimersRef.current[slotIdx];
    }, durationMs);
  }, []);

  useEffect(() => {
    return () => {
      Object.values(fallbackTimersRef.current).forEach((t) => clearTimeout(t));
    };
  }, []);

  // 统一施法触发：受控拦截 + 资源不足拦截 + 超出施法距离拦截 + 界面红字报错
  const handleSlotCast = useCallback((idx: number, opts?: { selfCast?: boolean }) => {
    if (isPlayerDead) return;

    if (crowdControl?.isControlled) {
      triggerUIError(`⛓️ ${crowdControl.reason || '受控中，无法行动！'}`);
      return;
    }

    const slot = slots.find(s => s.slotIdx === idx);
    if (!slot) return;

    // 1. 检查资源不足（法力值不足 / 能量不足 / 怒气不足）
    if (insufficientResourceSpells?.[slot.spellId]) {
      const errText = spellResourceErrors?.[slot.spellId] || '法力值不足';
      triggerUIError(errText);
      return;
    }

    // 2. 检查超出施法距离（目标太远了；Alt 自我施法始终对自己生效，不拦截距离）
    if (!opts?.selfCast && outOfRangeSpells?.[slot.spellId]) {
      triggerUIError('目标太远了');
      return;
    }

    onCastSlot(idx, opts);
  }, [isPlayerDead, slots, insufficientResourceSpells, spellResourceErrors, outOfRangeSpells, triggerUIError, onCastSlot]);

  // 全局键盘监听器：精确记录键盘按下（保持按压效果）与弹起（立即恢复），同时监听窗口失焦与全局鼠标抬起
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 忽略输入框/文本域中的按键
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // ESC 键打断当前施法
      if (e.key === 'Escape' && playerCast && onCancelCast) {
        onCancelCast();
        return;
      }

      // 计算标准快捷键签名
      let baseKey = '';
      if (/^F([1-9]|1[0-2])$/i.test(e.key)) {
        baseKey = e.key.toUpperCase();
      } else if (e.code.startsWith('Digit')) {
        baseKey = e.code.replace('Digit', '');
      } else if (e.code.startsWith('Key')) {
        baseKey = e.code.replace('Key', '').toUpperCase();
      } else if (e.code === 'Backquote') {
        baseKey = '`';
      } else if (e.code === 'Minus') {
        baseKey = '-';
      } else if (e.code === 'Equal') {
        baseKey = '=';
      } else {
        baseKey = e.key.toUpperCase();
      }

      // Alt 不可用作技能绑定键；按住 Alt + 技能键吸收 Alt 并触发自我施法
      const modParts: string[] = [];
      if (e.ctrlKey) modParts.push('CTRL');
      if (e.shiftKey) modParts.push('SHIFT');
      modParts.push(baseKey);
      const keySig = modParts.join('+');

      // 匹配当前专精配置或默认的 36 槽位（空串 = 冲突清除后的 N/A，不响应）
      for (let idx = 0; idx < 36; idx++) {
        const { key: boundKey, isUnbound } = resolveSlotHotkey(keybindings, idx);
        if (isUnbound) continue;
        const normalized = boundKey.toUpperCase();
        if (normalized && normalized === keySig) {
          e.preventDefault();

          // 保持键盘按下状态：记录按下的键码和对应的槽位，持续保持按下效果，一旦弹起再恢复
          activeKeySlotsRef.current.set(e.code, {
            slotIdx: idx,
            requiresShift: normalized.includes('SHIFT'),
            requiresCtrl: normalized.includes('CTRL'),
            requiresAlt: false,
          });
          setPressedSlots((prev) => (prev[idx] ? prev : { ...prev, [idx]: true }));

          handleSlotCast(idx, e.altKey ? { selfCast: true } : undefined);
          break;
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      // 1. 若释放 Shift / Ctrl / Alt 修饰键，释放所有依赖该修饰键的槽位
      if (e.key === 'Shift' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        const slotsToRelease: number[] = [];
        for (const [code, info] of activeKeySlotsRef.current.entries()) {
          if (info.requiresShift) {
            slotsToRelease.push(info.slotIdx);
            activeKeySlotsRef.current.delete(code);
          }
        }
        if (slotsToRelease.length > 0) {
          setPressedSlots((prev) => {
            const next = { ...prev };
            slotsToRelease.forEach((idx) => delete next[idx]);
            return next;
          });
        }
      }

      if (e.key === 'Control' || e.code === 'ControlLeft' || e.code === 'ControlRight') {
        const slotsToRelease: number[] = [];
        for (const [code, info] of activeKeySlotsRef.current.entries()) {
          if (info.requiresCtrl) {
            slotsToRelease.push(info.slotIdx);
            activeKeySlotsRef.current.delete(code);
          }
        }
        if (slotsToRelease.length > 0) {
          setPressedSlots((prev) => {
            const next = { ...prev };
            slotsToRelease.forEach((idx) => delete next[idx]);
            return next;
          });
        }
      }

      if (e.key === 'Alt' || e.code === 'AltLeft' || e.code === 'AltRight') {
        const slotsToRelease: number[] = [];
        for (const [code, info] of activeKeySlotsRef.current.entries()) {
          if (info.requiresAlt) {
            slotsToRelease.push(info.slotIdx);
            activeKeySlotsRef.current.delete(code);
          }
        }
        if (slotsToRelease.length > 0) {
          setPressedSlots((prev) => {
            const next = { ...prev };
            slotsToRelease.forEach((idx) => delete next[idx]);
            return next;
          });
        }
      }

      // 2. 释放具体物理按键绑定的槽位
      const info = activeKeySlotsRef.current.get(e.code);
      if (info) {
        activeKeySlotsRef.current.delete(e.code);
        setPressedSlots((prev) => {
          if (!prev[info.slotIdx]) return prev;
          const next = { ...prev };
          delete next[info.slotIdx];
          return next;
        });
      }
    };

    const handleBlur = () => {
      // 窗口失焦时彻底清空按压状态，避免按键卡住
      activeKeySlotsRef.current.clear();
      setPressedSlots({});
    };

    const handleGlobalMouseUp = () => {
      // 全局鼠标抬起时，释放非键盘按压引起的槽位状态
      setPressedSlots((prev) => {
        const activeKeySlotIndices = new Set(
          Array.from(activeKeySlotsRef.current.values()).map((v) => v.slotIdx)
        );
        let hasChanges = false;
        const next: Record<number, boolean> = {};
        for (const k in prev) {
          const slotId = Number(k);
          if (activeKeySlotIndices.has(slotId)) {
            next[slotId] = true;
          } else {
            hasChanges = true;
          }
        }
        return hasChanges ? next : prev;
      });
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [keybindings, handleSlotCast, playerCast, onCancelCast]);

  const handleBarChromeMouseDown = (e: React.MouseEvent) => {
    // Drag only from outer padding / gaps — not from skill slots
    if ((e.target as HTMLElement).closest('[data-action-slot]')) return;
    handleBarDragStart(e);
  };

  return (
    <div
      ref={barContainerRef}
      data-testid="action-bar-container"
      className={`group/action-bar flex flex-col items-center select-none space-y-1.5 ${pos ? 'fixed z-30' : 'relative'}`}
      style={pos ? { left: `${pos.x}px`, top: `${pos.y}px` } : undefined}
    >
      {/* DK Runes or Rogue Combo Points Bar */}
      {classId === 'DK' && dkRunes && (
        <div className="flex items-center space-x-2 bg-[#121220]/90 border border-[#3b3b5c] px-3 py-1 rounded-lg backdrop-blur">
          <span className="text-[10px] text-gray-400 font-bold uppercase">符文系统:</span>
          <div className="flex space-x-1.5">
            {dkRunes.map((rune, idx) => {
              const color =
                rune.type === 'BLOOD'
                  ? '#C41F3B'
                  : rune.type === 'FROST'
                  ? '#0070DE'
                  : '#2E8B57';
              const isReady = rune.cdMs <= 0;
              return (
                <div
                  key={idx}
                  className="w-5 h-5 rounded-full border border-black/60 flex items-center justify-center text-[9px] font-bold text-white relative overflow-hidden"
                  style={{ backgroundColor: isReady ? color : '#222' }}
                >
                  {!isReady && (
                    <div
                      className="absolute bottom-0 left-0 right-0 opacity-40"
                      style={{
                        height: `${Math.min(100, (1 - rune.cdMs / 10000) * 100)}%`,
                        backgroundColor: color,
                      }}
                    />
                  )}
                  <span className="relative z-10">{rune.type[0]}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {classId === 'ROGUE' && (
        <div className="flex items-center space-x-1.5 bg-[#121220]/90 border border-[#3b3b5c] px-3 py-1 rounded-lg backdrop-blur">
          <span className="text-[10px] text-gray-400 font-bold uppercase">连击点:</span>
          <div className="flex space-x-1">
            {[1, 2, 3, 4, 5].map(pt => (
              <div
                key={pt}
                className={`w-4 h-4 rounded-full border border-black/80 transition-all ${
                  pt <= comboPoints
                    ? 'bg-amber-400 shadow-md shadow-amber-400/50 scale-110'
                    : 'bg-[#222]'
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {classId === 'PALADIN' && (
        <div className="flex items-center space-x-1.5 bg-[#121220]/90 border border-amber-500/40 px-3 py-1 rounded-lg backdrop-blur">
          <span className="text-[10px] text-amber-300 font-bold uppercase">神圣能量:</span>
          <div className="flex space-x-1.5">
            {[1, 2, 3].map(pt => (
              <div
                key={pt}
                className={`w-4 h-4 rounded-sm rotate-45 border border-black/80 transition-all ${
                  pt <= holyPower
                    ? 'bg-yellow-300 shadow-md shadow-yellow-400/60 scale-110'
                    : 'bg-[#222]'
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {/* 受控/沉默状态横幅提示 */}
      {crowdControl?.isControlled && !isPlayerDead && (
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 z-40 whitespace-nowrap text-center px-3 py-0.5 rounded-full bg-red-950/90 border border-red-500/80 text-red-200 text-[11px] font-bold shadow-lg backdrop-blur-sm pointer-events-none select-none">
          ⛓️ {crowdControl.spellName || '受控中'}
          {crowdControl.remainingMs && crowdControl.remainingMs > 0
            ? ` (${Math.max(1, Math.ceil(crowdControl.remainingMs / 1000))}s)`
            : ''}{' '}
          — 无法施放技能
        </div>
      )}

      {/* 技能栏上方弹出红色小字报错 (UIErrorsFrame: 法力值不足 / 能量不足 / 怒气不足 / 目标太远了) */}
      {uiErrorMessage && (
        <div
          key={uiErrorMessage.id}
          className={`absolute ${crowdControl?.isControlled && !isPlayerDead ? '-top-16' : '-top-7'} left-1/2 -translate-x-1/2 z-50 pointer-events-none flex items-center justify-center animate-bounce select-none`}
        >
          <div className="px-3.5 py-0.5 rounded bg-black/85 border border-red-600/80 shadow-[0_0_15px_rgba(239,68,68,0.85)] backdrop-blur-sm whitespace-nowrap text-center">
            <span className="font-sans font-black text-[13.5px] text-red-500 tracking-wider drop-shadow-[0_2px_4px_rgba(0,0,0,1)] whitespace-nowrap">
              {uiErrorMessage.text}
            </span>
          </div>
        </div>
      )}

      {/* 3 Action Bars: outer border only on hover; drag padding/gaps to move when unlocked */}
      <div
        data-testid="action-bar-drag-handle"
        onMouseDown={handleBarChromeMouseDown}
        className={`relative flex flex-col items-center space-y-1 bg-[#141424]/95 border-2 border-transparent group-hover/action-bar:border-[#2f2f4c] p-2 rounded-xl shadow-2xl backdrop-blur transition-colors ${
          isLocked ? 'cursor-default' : 'cursor-move'
        }`}
      >
        <button
          type="button"
          data-testid="action-bar-lock"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setIsLocked(!isLocked);
          }}
          className="absolute -top-1 -right-1 z-40 w-5 h-5 flex items-center justify-center text-[11px] rounded bg-black/70 border border-[#3e3e5c] text-amber-300 opacity-0 pointer-events-none group-hover/action-bar:opacity-100 group-hover/action-bar:pointer-events-auto transition-opacity hover:bg-black/90"
        >
          {isLocked ? '🔒' : '🔓'}
        </button>

        {/* Helper to render a 12-slot row - all 3 rows identically sized (w-11 h-11) and aligned */}
        {([
          { rowName: '动作条 3 (`~F12)', startIdx: 24, sizeCls: 'w-11 h-11', textCls: 'text-[10px]' },
          { rowName: '动作条 2 (Shift+1~X)', startIdx: 12, sizeCls: 'w-11 h-11', textCls: 'text-[10px]' },
          { rowName: '动作条 1 (主动作栏 1~X)', startIdx: 0, sizeCls: 'w-11 h-11', textCls: 'text-[10px]' },
        ] as const).map(({ rowName, startIdx, sizeCls, textCls }) => (
          <div key={startIdx} className="flex items-center space-x-0 border border-[#2f2f4c] rounded-lg overflow-hidden shadow-md bg-[#0a0a14]">
            {Array.from({ length: 12 }).map((_, col) => {
              const idx = startIdx + col;
              const slot = slots.find(s => s.slotIdx === idx);
              const { key: hotkeyRaw, isUnbound } = resolveSlotHotkey(keybindings, idx);

              const isOffGcd = slot ? isOffGcdSpell(slot.spellId) : false;
              const rawSpellCd = slot ? slot.cdRemainingMs : 0;
              const rawSpellTotalCd = slot ? (slot.totalCdMs > 0 ? slot.totalCdMs : rawSpellCd) : 0;

              // 每个技能的CD应该是两种CD剩余时长的最大值，不进入公共CD技能的不需要（分好组）
              const effectiveCdRemainingMs = isOffGcd
                ? rawSpellCd
                : Math.max(rawSpellCd, gcdRemainingMs);

              const effectiveTotalCdMs = isOffGcd
                ? (rawSpellTotalCd || 1000)
                : (rawSpellCd >= gcdRemainingMs
                    ? (rawSpellTotalCd || rawSpellCd || 1000)
                    : (gcdTotalMs || 1000));

              const isOnCd = effectiveCdRemainingMs > 0;
              const iconSvg = slot ? SPELL_ICONS[slot.spellId] : null;

              const isOutOfCombatOnly = slot
                ? ['revive', 'ancestral_spirit', 'druid_revive', 'shaman_ancestral_spirit', 'redemption', 'paladin_redemption', 'resurrection', 'priest_resurrection'].includes(slot.spellId)
                : false;
              const isCombatDisabled = isInCombat && isOutOfCombatOnly;
              const isOutOfRange = slot ? !!outOfRangeSpells[slot.spellId] : false;
              const isResourceShort = slot ? !!insufficientResourceSpells[slot.spellId] : false;

              const cdElapsedProgress = slot
                ? Math.min(1, Math.max(0, (effectiveTotalCdMs - effectiveCdRemainingMs) / effectiveTotalCdMs))
                : 1;
              const cdElapsedDeg = Math.min(360, Math.max(0, Math.round(cdElapsedProgress * 360)));
              const isCrowdControlled = !!crowdControl?.isControlled;
              const isReadyToCast = slot && !isOnCd && !isCombatDisabled && !isResourceShort && !isCrowdControlled;
              const isSlotPressed = !!pressedSlots[idx];
              const isGroundTargetActive = !!(activeGroundSpellId && slot?.spellId === activeGroundSpellId);

              return (
                <div
                  key={idx}
                  data-action-slot={idx}
                  draggable={!isPlayerDead && !!slot}
                  onDragStart={(e) => {
                    if (!slot) return;
                    setPressedSlots((prev) => {
                      if (!prev[idx]) return prev;
                      const next = { ...prev };
                      delete next[idx];
                      return next;
                    });
                    setDraggedIdx(idx);
                    (window as any).__cata_dragged_slot = idx;
                    (window as any).__cata_dragged_spell = null;
                    (window as any).__cata_slot_drop_handled = false;
                    (window as any).__cata_drag_start_coord = { x: e.clientX, y: e.clientY };
                    e.dataTransfer.effectAllowed = 'copyMove';
                    e.dataTransfer.setData('text/plain', idx.toString());
                    e.dataTransfer.setData('text/slotIdx', idx.toString());
                  }}
                  onDragEnd={(e) => {
                    const wasHandled = (window as any).__cata_slot_drop_handled;
                    const startCoord = (window as any).__cata_drag_start_coord;
                    const endCoord = (e.clientX || e.clientY)
                      ? { x: e.clientX, y: e.clientY }
                      : (window as any).__cata_last_drag_coord || startCoord;
                    const dist = startCoord && endCoord ? Math.hypot(endCoord.x - startCoord.x, endCoord.y - startCoord.y) : 0;

                    if (!wasHandled && dist > 35 && onClearSlot) {
                      onClearSlot(idx);
                    }

                    setDraggedIdx(null);
                    setTimeout(() => {
                      (window as any).__cata_dragged_slot = null;
                      (window as any).__cata_slot_drop_handled = false;
                      (window as any).__cata_drag_start_coord = null;
                    }, 200);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    (window as any).__cata_last_drag_coord = { x: e.clientX, y: e.clientY };
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    (window as any).__cata_slot_drop_handled = true;
                    let spellId = (window as any).__cata_dragged_spell || '';
                    let src: number | null = (window as any).__cata_dragged_slot !== undefined && (window as any).__cata_dragged_slot !== null
                      ? Number((window as any).__cata_dragged_slot)
                      : null;

                    if (!spellId && src === null) {
                      try {
                        const cSpell = e.dataTransfer.getData('text/spellId');
                        const cSlot = e.dataTransfer.getData('text/slotIdx');
                        const plain = e.dataTransfer.getData('text/plain') || '';
                        if (cSpell) spellId = cSpell;
                        else if (cSlot) src = parseInt(cSlot, 10);
                        else if (plain.startsWith('spell:')) spellId = plain.replace('spell:', '');
                        else if (plain.startsWith('slot:')) src = parseInt(plain.replace('slot:', ''), 10);
                        else if (plain && isNaN(parseInt(plain, 10))) spellId = plain;
                        else if (plain && !isNaN(parseInt(plain, 10))) src = parseInt(plain, 10);
                      } catch {}
                    }

                    if (spellId && onAssignSlot) {
                      onAssignSlot(idx, spellId);
                    } else if (typeof src === 'number' && !isNaN(src) && src !== idx && onSwapSlots) {
                      onSwapSlots(src, idx);
                    }
                    setDraggedIdx(null);
                    (window as any).__cata_dragged_spell = null;
                    (window as any).__cata_dragged_slot = null;
                  }}
                  onMouseEnter={(e) => {
                    if (slot) {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setTooltipPos({ x: rect.left, y: rect.top - 10 });
                      setHoveredSlot(slot);
                    }
                  }}
                  onMouseLeave={() => {
                    setHoveredSlot(null);
                    setPressedSlots((prev) => {
                      const isHeldByKeyboard = Array.from(activeKeySlotsRef.current.values()).some((v) => v.slotIdx === idx);
                      if (isHeldByKeyboard || !prev[idx]) return prev;
                      const next = { ...prev };
                      delete next[idx];
                      return next;
                    });
                  }}
                  onMouseDown={(e) => {
                    if (e.button === 0) {
                      setPressedSlots((prev) => ({ ...prev, [idx]: true }));
                    }
                  }}
                  onMouseUp={(e) => {
                    if (e.button === 0) {
                      setPressedSlots((prev) => {
                        const isHeldByKeyboard = Array.from(activeKeySlotsRef.current.values()).some((v) => v.slotIdx === idx);
                        if (isHeldByKeyboard || !prev[idx]) return prev;
                        const next = { ...prev };
                        delete next[idx];
                        return next;
                      });
                    }
                  }}
                  onClick={() => {
                    handleSlotCast(idx);
                  }}
                  className={`${sizeCls} border-r border-[#262640] last:border-r-0 flex flex-col items-center justify-between p-0.5 relative overflow-hidden transition-all duration-50 select-none cursor-pointer ${
                    isGroundTargetActive
                      ? 'ring-2 ring-amber-400 ring-offset-1 ring-offset-black animate-pulse shadow-[0_0_12px_rgba(251,191,36,0.85)] border-amber-300'
                      : ''
                  } ${
                    isSlotPressed
                      ? 'scale-[0.92] translate-y-[1.5px] border-slate-200/90 shadow-[inset_0_3px_8px_rgba(0,0,0,0.9)]'
                      : ''
                  } ${
                    draggedIdx === idx ? 'opacity-50 ring-2 ring-cyan-400' : ''
                  } ${
                    isPlayerDead
                      ? 'border-[#2d2d44] bg-[#141424] opacity-85 cursor-not-allowed'
                      : slot
                      ? isResourceShort
                        ? 'border-[#181826] bg-[#070710]'
                        : isOutOfRange || isCombatDisabled
                        ? 'border-[#252538] bg-[#0e0e1a] opacity-65'
                        : isReadyToCast
                        ? 'border-[#3e3e5c] bg-[#16162a] hover:border-[#5a5a84]'
                        : 'border-[#2d2d42] bg-[#121220] opacity-85'
                      : 'border-[#222238] bg-[#0c0c18] hover:border-[#383856] cursor-default'
                  }`}
                >
                  {/* Player Dead / Hard CC Mask */}
                  {(isPlayerDead || (isCrowdControlled && !!slot)) && (
                    <div
                      className={`absolute inset-0 z-25 pointer-events-none rounded-lg ${
                        isPlayerDead ? 'bg-black/80' : 'bg-black/70 backdrop-grayscale'
                      }`}
                    />
                  )}

                  {/* 资源不足（法力/能量/怒气不足）：技能图标直接变暗（灰化、变黑），图标饱和度降低，明显变暗淡 */}
                  {slot && isResourceShort && !isOnCd && !isPlayerDead && (
                    <div className="absolute inset-0 bg-black/65 pointer-events-none rounded-lg z-25 backdrop-grayscale" />
                  )}

                  {/* 无法释放（超出施法距离或脱战专用等）技能框半暗表示（不使用红点，半暗遮罩） */}
                  {slot && (isOutOfRange || isCombatDisabled) && !isResourceShort && !isOnCd && !isPlayerDead && (
                    <div className="absolute inset-0 bg-black/55 z-20 pointer-events-none rounded-lg" />
                  )}

                  {/* 技能按键始终显示在右上角；冲突清除后显示红色 N/A */}
                  {hotkeyRaw && (
                    <span
                      className={`absolute top-0.5 right-0.5 text-[8.5px] font-mono font-black drop-shadow-[0_1px_2px_rgba(0,0,0,1)] z-30 pointer-events-none select-none leading-none ${
                        isUnbound ? 'text-red-400' : 'text-gray-200/90'
                      }`}
                    >
                      {isUnbound ? 'N/A' : formatSimplifiedHotkey(hotkeyRaw)}
                    </span>
                  )}

                  {/* 50ms 快速干脆按下画面感蒙版 (凹陷与微光，与CD/无法使用暗色完全兼容不冲突) */}
                  {isSlotPressed && (
                    <div
                      className="absolute inset-0 rounded-lg pointer-events-none z-35 flex items-center justify-center overflow-hidden"
                      style={{
                        background: 'radial-gradient(circle, rgba(255, 255, 255, 0.28) 0%, rgba(255, 255, 255, 0.10) 65%, rgba(0, 0, 0, 0.35) 100%)',
                        boxShadow: 'inset 0 3px 6px rgba(0, 0, 0, 0.8), inset 0 0 10px rgba(255, 255, 255, 0.45), 0 0 0 1.5px rgba(255, 255, 255, 0.85)',
                      }}
                    >
                      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-white/10 pointer-events-none" />
                    </div>
                  )}

                  {/* Authentic Spell Icon */}
                  {slot ? (
                    <>
                      <div
                        className="w-full h-full rounded flex items-center justify-center overflow-hidden z-10 p-0.5"
                        style={{
                          filter: isResourceShort ? 'grayscale(90%) brightness(0.35) contrast(0.85)' : undefined,
                          transition: 'filter 0.15s ease-in-out',
                        }}
                      >
                        {iconSvg ? (
                          <div
                            className="w-full h-full flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:block"
                            dangerouslySetInnerHTML={{ __html: iconSvg }}
                          />
                        ) : (
                          <div
                            className="w-full h-full flex items-center justify-center text-xs font-bold text-white shadow-sm"
                            style={{ backgroundColor: slot.colorHex }}
                          >
                            {slot.iconText}
                          </div>
                        )}
                      </div>

                      {/* Radial Sector Cooldown Clock Sweep (顺时针旋转，扇形面积与倒计时反映剩余时长) */}
                      {isOnCd && (
                        <>
                          <div
                            className="absolute inset-0 rounded-lg pointer-events-none z-20"
                            style={{
                              background: `conic-gradient(transparent 0deg, transparent ${cdElapsedDeg}deg, rgba(0, 0, 0, 0.82) ${cdElapsedDeg}deg, rgba(0, 0, 0, 0.82) 360deg)`,
                            }}
                          />
                          <div className="absolute inset-0 flex items-center justify-center z-40 pointer-events-none">
                            <span className="text-[10px] font-mono font-extrabold text-amber-300 drop-shadow-[0_1px_3px_rgba(0,0,0,1)]">
                              {effectiveCdRemainingMs >= 2000
                                ? `${Math.ceil(effectiveCdRemainingMs / 1000)}s`
                                : `${(effectiveCdRemainingMs / 1000).toFixed(1)}s`}
                            </span>
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    <span className="text-[9px] text-gray-600 m-auto select-none">{idx + 1}</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Authentic WoW Cataclysm Spell Tooltip (with ClassRegistry fallback for all 10 classes) */}
      {hoveredSlot && (() => {
        const directTip = SPELL_TOOLTIPS[hoveredSlot.spellId];
        const norm = !directTip ? getSpellByAnyId(hoveredSlot.spellId, classId) : null;
        const tip = directTip || (norm ? {
          name: norm.name,
          cost: norm.resourceCostAmount > 0 ? `${norm.resourceCostAmount} ${norm.resourceKind}` : '无消耗',
          castTime: norm.castTimeMs <= 0
            ? (norm.gcdCategory === 'OFF_GCD' ? '瞬发（不占GCD）' : '瞬发')
            : `${(getHastedCastTimeMs(norm.castTimeMs, LEVEL_80_MAX_HASTE) / 1000).toFixed(2)} 秒施法`,
          cooldown: norm.cooldownMs > 0 ? `${(norm.cooldownMs / 1000).toFixed(0)} 秒` : '无冷却',
          range: norm.school === 'PHYSICAL' && norm.classId !== 'HUNTER' ? '近战范围' : '40 码',
          school: norm.school,
          description: norm.description,
        } : null);
        if (!tip) return null;
        return (
          <div
            className="fixed z-50 pointer-events-none w-72 bg-[#0d0d1e]/98 border-2 border-[#5c4a28] rounded-md p-3 shadow-2xl backdrop-blur font-sans text-xs text-gray-200"
            style={{
              left: `${Math.min(window.innerWidth - 300, Math.max(10, tooltipPos.x - 100))}px`,
              bottom: `${Math.max(80, window.innerHeight - tooltipPos.y + 12)}px`,
            }}
          >
            <div className="space-y-1.5">
              <div className="flex justify-between items-start border-b border-[#3e341f] pb-1">
                <span className="font-extrabold text-amber-300 text-sm tracking-wide">
                  {tip.name}
                </span>
                <span className="text-gray-300 font-mono text-[11px]">{tip.cost}</span>
              </div>
              <div className="flex justify-between text-[11px] text-gray-300">
                <span>{tip.castTime}</span>
                <span>{tip.range}</span>
              </div>
              <div className="flex justify-between text-[11px] text-gray-300">
                <span>冷却时间：{tip.cooldown}</span>
                <span className="text-amber-200">{tip.school}法术</span>
              </div>
              <div className="pt-1.5 border-t border-[#3e341f] text-[#ffd100] text-[11px] leading-relaxed">
                {tip.description}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
