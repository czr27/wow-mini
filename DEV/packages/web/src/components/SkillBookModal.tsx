import React, { useState, useEffect } from 'react';
import {
  ALL_CLASSES_NORMALIZED,
  getSpellByAnyId,
  getHastedCastTimeMs,
  LEVEL_80_MAX_HASTE,
  type ClassId,
  type KeybindingMap,
} from '@cata-raid-sim/engine';
import { SPELL_ICONS, SPELL_TOOLTIPS, type SpellTooltipInfo } from '../assets/pixelIcons.js';
import { CLASS_NAMES, CLASS_COLORS, CLASS_SPECS } from './AuthAndCharacterModal.js';
import type { ActionSlot } from './ActionBar.js';
import { resolveSlotHotkey } from './ActionBar.js';
import { DismissibleModal } from './DismissibleModal.js';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  classId: ClassId;
  specId: string;
  keybindings: KeybindingMap;
  onSaveKeybinding: (slotIdx: number, hotkey: string) => void;
  onChangeSpec?: (specId: string) => void;
  slots?: ActionSlot[];
  onSwapSlots?: (srcIdx: number, destIdx: number, targetCharId?: string, targetSpecId?: string) => void;
  onAssignSlot?: (slotIdx: number, spellId: string, targetCharId?: string, targetSpecId?: string) => void;
  onClearSlot?: (slotIdx: number, targetCharId?: string, targetSpecId?: string) => void;
}

function buildClassSpellList(classId: ClassId): Array<{ spellId: string; name: string; reqSpec?: string }> {
  const cls = ALL_CLASSES_NORMALIZED[classId];
  if (!cls) return [];
  const totalSpecs = cls.specs.length;
  return cls.allSpells.map(sp => {
    // Keep existing UI short alias IDs for backward compatibility
    let spellId = sp.shortId;
    if (sp.id === 'shaman_spirit_link_totem') spellId = 'spirit_link';
    else if (sp.id === 'shaman_mana_tide_totem') spellId = 'mana_tide';
    else if (sp.id === 'shaman_heroism') spellId = 'bloodlust';
    const reqSpec = sp.specIds.length === 1 && totalSpecs > 1 ? sp.specIds[0] : undefined;
    return { spellId, name: sp.name, reqSpec };
  });
}

// Complete catalog of spells for ALL 10 Cataclysm classes & 30 specs
export const CLASS_ALL_SPELLS: Record<ClassId, Array<{ spellId: string; name: string; reqSpec?: string }>> = {
  DK: buildClassSpellList('DK'),
  DRUID: buildClassSpellList('DRUID'),
  SHAMAN: buildClassSpellList('SHAMAN'),
  MAGE: buildClassSpellList('MAGE'),
  ROGUE: buildClassSpellList('ROGUE'),
  WARRIOR: buildClassSpellList('WARRIOR'),
  PALADIN: buildClassSpellList('PALADIN'),
  HUNTER: buildClassSpellList('HUNTER'),
  PRIEST: buildClassSpellList('PRIEST'),
  WARLOCK: buildClassSpellList('WARLOCK'),
};

/** Display order matches combat habit: Bar 3 on top, then 2, then 1 */
const ACTION_BAR_ROWS: Array<{ tab: number }> = [
  { tab: 2 },
  { tab: 1 },
  { tab: 0 },
];

export function getSpellTooltipWithFallback(spellId: string, classId: ClassId): SpellTooltipInfo | null {
  if (SPELL_TOOLTIPS[spellId]) return SPELL_TOOLTIPS[spellId];
  const sp = getSpellByAnyId(spellId, classId);
  if (!sp) return null;
  const schoolNameMap: Record<string, string> = {
    PHYSICAL: '物理',
    FIRE: '火焰',
    FROST: '冰霜',
    SHADOW: '暗影',
    NATURE: '自然',
    ARCANE: '奥术',
    HOLY: '神圣',
  };
  const resourceNameMap: Record<string, string> = {
    MANA: '法力值',
    ENERGY: '能量',
    RAGE: '怒气',
    FOCUS: '集中值',
    RUNIC_POWER: '符文能量',
    HOLY_POWER: '神圣能量',
    COMBO_POINTS: '连击点',
    RUNE: '符文',
    NONE: '无消耗',
  };
  const hastedMs = sp.castTimeMs > 0 ? getHastedCastTimeMs(sp.castTimeMs, LEVEL_80_MAX_HASTE) : 0;
  const castTimeText =
    sp.castTimeMs <= 0
      ? (sp.gcdCategory === 'OFF_GCD' ? '瞬发（不占GCD）' : '瞬发')
      : `${(hastedMs / 1000).toFixed(2)} 秒施法（基础 ${(sp.castTimeMs / 1000).toFixed(1)}s）`;
  const costText =
    sp.resourceCostAmount > 0
      ? `${sp.resourceCostAmount} ${resourceNameMap[sp.resourceKind] || sp.resourceKind}`
      : '无消耗';
  const cdText = sp.cooldownMs > 0 ? `${(sp.cooldownMs / 1000).toFixed(sp.cooldownMs % 1000 ? 1 : 0)} 秒` : '无冷却';
  return {
    name: sp.name,
    cost: costText,
    castTime: castTimeText,
    cooldown: cdText,
    range: sp.school === 'PHYSICAL' && sp.classId !== 'HUNTER' ? '近战范围' : '40 码',
    school: schoolNameMap[sp.school] || sp.school,
    description: sp.description,
  };
}

export const SkillBookModal: React.FC<Props> = ({
  isOpen,
  onClose,
  classId,
  specId,
  keybindings,
  onSaveKeybinding,
  onChangeSpec,
  slots = [],
  onSwapSlots,
  onAssignSlot,
  onClearSlot,
}) => {
  const [selectedSpellId, setSelectedSpellId] = useState<string | null>(null);
  const [draggedSpellId, setDraggedSpellId] = useState<string | null>(null);
  const [draggedSlotIdx, setDraggedSlotIdx] = useState<number | null>(null);
  const [sniffingSlotIdx, setSniffingSlotIdx] = useState<number | null>(null);

  // Physical key sniffing listener
  useEffect(() => {
    if (sniffingSlotIdx === null) return;

    const handleSniffKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setSniffingSlotIdx(null);
        return;
      }

      const kLower = e.key.toLowerCase();
      if (kLower === 'shift' || kLower === 'control' || kLower === 'alt' || kLower === 'meta') {
        return; // wait for base key
      }

      let baseKey = '';
      if (e.code.startsWith('Digit')) {
        baseKey = e.code.replace('Digit', '');
      } else if (e.code.startsWith('Key')) {
        baseKey = e.code.replace('Key', '');
      } else if (e.key >= 'F1' && e.key <= 'F12') {
        baseKey = e.key.toUpperCase();
      } else if (e.code === 'Minus') {
        baseKey = '-';
      } else if (e.code === 'Equal') {
        baseKey = '=';
      } else {
        baseKey = e.key.toUpperCase();
      }

      const parts: string[] = [];
      if (e.ctrlKey) parts.push('CTRL');
      if (e.shiftKey) parts.push('SHIFT');
      if (e.altKey) parts.push('ALT');
      parts.push(baseKey);

      const resultKey = parts.join('+');
      onSaveKeybinding(sniffingSlotIdx, resultKey);
      setSniffingSlotIdx(null);
    };

    window.addEventListener('keydown', handleSniffKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleSniffKeyDown, { capture: true });
  }, [sniffingSlotIdx, onSaveKeybinding]);

  // Reset selection when class/spec changes so detail pane stays valid
  useEffect(() => {
    setSelectedSpellId(null);
    setSniffingSlotIdx(null);
  }, [classId, specId]);

  if (!isOpen) return null;

  const allSpells = CLASS_ALL_SPELLS[classId] || [];
  const spells = allSpells.filter(s => !s.reqSpec || s.reqSpec === specId);
  const classColor = CLASS_COLORS[classId] || '#FFD700';
  const specs = CLASS_SPECS[classId] || [];
  const activeSpell = spells.find(s => s.spellId === selectedSpellId) || spells[0];
  const tip = activeSpell ? getSpellTooltipWithFallback(activeSpell.spellId, classId) : null;
  const slottedSpellIds = new Set(slots.map(s => s.spellId).filter(Boolean));
  const unslottedCount = spells.filter(s => !slottedSpellIds.has(s.spellId)).length;

  const handleSwitchSpec = (nextSpec: string) => {
    if (nextSpec === specId) return;
    setSniffingSlotIdx(null);
    onChangeSpec?.(nextSpec);
  };

  const renderActionSlot = (slotIdx: number) => {
    const slot = slots.find(s => s.slotIdx === slotIdx);
    const { key: currentKey, isUnbound } = resolveSlotHotkey(keybindings, slotIdx);
    const iconSvg = slot ? SPELL_ICONS[slot.spellId] : null;
    const isSniffing = sniffingSlotIdx === slotIdx;

    return (
      <div
        key={slotIdx}
        draggable={!!slot}
        onDragStart={(e) => {
          if (!slot) return;
          setDraggedSlotIdx(slotIdx);
          setDraggedSpellId(null);
          (window as any).__cata_dragged_slot = slotIdx;
          (window as any).__cata_dragged_spell = null;
          (window as any).__cata_slot_drop_handled = false;
          (window as any).__cata_drag_start_coord = { x: e.clientX, y: e.clientY };
          e.dataTransfer.effectAllowed = 'copyMove';
          try {
            e.dataTransfer.setData('text/slotIdx', slotIdx.toString());
            e.dataTransfer.setData('text/plain', `slot:${slotIdx}`);
          } catch {}
        }}
        onDragEnd={(e) => {
          const wasHandled = (window as any).__cata_slot_drop_handled;
          const startCoord = (window as any).__cata_drag_start_coord;
          const endCoord = (e.clientX || e.clientY)
            ? { x: e.clientX, y: e.clientY }
            : (window as any).__cata_last_drag_coord || startCoord;
          const dist = startCoord && endCoord ? Math.hypot(endCoord.x - startCoord.x, endCoord.y - startCoord.y) : 0;

          if (!wasHandled && dist > 35 && onClearSlot) {
            onClearSlot(slotIdx);
          }

          setDraggedSlotIdx(null);
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
          let srcSlot: number | null = (window as any).__cata_dragged_slot !== undefined && (window as any).__cata_dragged_slot !== null
            ? Number((window as any).__cata_dragged_slot)
            : null;

          if (!spellId && srcSlot === null) {
            try {
              const cSpell = e.dataTransfer.getData('text/spellId');
              const cSlot = e.dataTransfer.getData('text/slotIdx');
              const plain = e.dataTransfer.getData('text/plain') || '';

              if (cSpell) {
                spellId = cSpell;
              } else if (cSlot) {
                srcSlot = parseInt(cSlot, 10);
              } else if (plain.startsWith('spell:')) {
                spellId = plain.replace('spell:', '');
              } else if (plain.startsWith('slot:')) {
                srcSlot = parseInt(plain.replace('slot:', ''), 10);
              } else if (plain && isNaN(parseInt(plain, 10))) {
                spellId = plain;
              } else if (plain && !isNaN(parseInt(plain, 10))) {
                srcSlot = parseInt(plain, 10);
              }
            } catch {}
          }

          if (!spellId && draggedSpellId) spellId = draggedSpellId;
          if (srcSlot === null && draggedSlotIdx !== null) srcSlot = draggedSlotIdx;

          if (spellId && onAssignSlot) {
            onAssignSlot(slotIdx, spellId);
          } else if (srcSlot !== null && !isNaN(srcSlot) && srcSlot !== slotIdx && onSwapSlots) {
            onSwapSlots(srcSlot, slotIdx);
          }

          setDraggedSpellId(null);
          setDraggedSlotIdx(null);
          (window as any).__cata_dragged_spell = null;
          (window as any).__cata_dragged_slot = null;
        }}
        onClick={() => {
          if (selectedSpellId && onAssignSlot) {
            onAssignSlot(slotIdx, selectedSpellId);
          } else if (slot) {
            setSelectedSpellId(slot.spellId);
          }
        }}
        className={`relative aspect-square w-full rounded border-2 overflow-hidden flex items-center justify-center transition cursor-pointer ${
          isSniffing
            ? 'border-amber-400 ring-2 ring-amber-400 bg-amber-500/15'
            : 'border-[#3b3b5c] bg-[#18182e] hover:border-amber-400'
        }`}
      >
        {slot ? (
          iconSvg ? (
            <div
              className="w-full h-full p-0.5 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
              dangerouslySetInnerHTML={{ __html: iconSvg }}
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center text-[10px] font-bold"
              style={{ color: classColor }}
            >
              {slot.name.slice(0, 2)}
            </div>
          )
        ) : (
          <div className="w-[70%] h-[70%] border border-dashed border-gray-700/50 rounded-sm" />
        )}

        {/* Keybind chip — click to sniff; N/A in red when unbound/conflict */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setSniffingSlotIdx(slotIdx);
          }}
          className={`absolute bottom-0 right-0 max-w-full px-0.5 leading-none text-[8px] font-mono font-bold truncate border-t border-l ${
            isSniffing
              ? 'bg-amber-400 text-black border-amber-300 animate-pulse'
              : isUnbound
              ? 'bg-black/90 text-red-400 border-red-500/50 hover:text-red-300'
              : 'bg-black/80 text-amber-300 border-amber-500/30 hover:text-white'
          }`}
        >
          {isSniffing ? '…' : isUnbound ? 'N/A' : (currentKey || '?')}
        </button>
      </div>
    );
  };

  return (
    <DismissibleModal
      open={isOpen}
      onClose={onClose}
      closeOnEscape={sniffingSlotIdx === null}
      overlayClassName="bg-black/85 p-3"
      panelClassName="bg-[#121224] border-2 border-[#45456b] rounded-2xl w-full max-w-6xl xl:max-w-[1360px] 2xl:max-w-[1440px] h-[min(92vh,920px)] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
      aria-label="技能书与快捷键配置中心"
    >

        {/* Header — fixed */}
        <div className="flex-shrink-0 bg-[#1a1a36] px-4 py-2 border-b border-[#2d2d4e] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="text-lg">📖</span>
            <div>
              <h3 className="font-extrabold text-sm text-amber-300">
                技能书与快捷键配置中心
              </h3>
              <p className="text-[10px] text-gray-400">
                切换专精查看可用技能与键位 · 关闭时自动保存
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-white text-lg font-bold px-2 py-0.5"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {/* Spec switcher */}
        {specs.length > 0 && (
          <div className="flex-shrink-0 px-3 py-1.5 border-b border-[#262642] flex flex-wrap items-center gap-1.5 bg-[#15152a]">
            <span className="text-[10px] text-gray-500 font-bold mr-1">专精</span>
            {specs.map(spec => {
              const active = spec.id === specId;
              return (
                <button
                  key={spec.id}
                  type="button"
                  onClick={() => handleSwitchSpec(spec.id)}
                  className={`text-[10px] font-bold px-2.5 py-1 rounded border transition ${
                    active
                      ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                      : 'bg-[#1a1a32] border-[#333355] text-gray-400 hover:border-gray-500 hover:text-gray-200'
                  }`}
                >
                  {spec.name}
                </button>
              );
            })}
          </div>
        )}

        {/* Upper: full-width compact spell cards — scrolls; height = remaining after bottom pane */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden border-b border-[#262642]">
          <div className="flex-shrink-0 px-3 pt-2 pb-1.5 flex items-center justify-between text-[11px] font-bold text-gray-300 border-b border-[#23233c]">
            <span className="flex items-center gap-2">
              <span>{CLASS_NAMES[classId]} · {spells.length} 技能</span>
              {unslottedCount > 0 && (
                <span className="font-normal text-[10px] text-sky-300/90 bg-sky-500/10 border border-sky-500/30 rounded px-1.5 py-0.5">
                  {unslottedCount} 个未装入动作条
                </span>
              )}
            </span>
            <span className="text-amber-400 font-normal text-[10px]">
              {specs.find(s => s.id === specId)?.name || specId}
            </span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
              {spells.map(s => {
                const isSelected = s.spellId === activeSpell?.spellId;
                const isUnslotted = !slottedSpellIds.has(s.spellId);
                const iconSvg = SPELL_ICONS[s.spellId];
                const spellTip = getSpellTooltipWithFallback(s.spellId, classId);

                return (
                  <div
                    key={s.spellId}
                    draggable
                    onDragStart={(e) => {
                      setDraggedSpellId(s.spellId);
                      setDraggedSlotIdx(null);
                      (window as any).__cata_dragged_spell = s.spellId;
                      (window as any).__cata_dragged_slot = null;
                      e.dataTransfer.effectAllowed = 'copyMove';
                      try {
                        e.dataTransfer.setData('text/spellId', s.spellId);
                        e.dataTransfer.setData('text/plain', `spell:${s.spellId}`);
                      } catch {}
                    }}
                    onDragEnd={() => {
                      setDraggedSpellId(null);
                      setTimeout(() => {
                        (window as any).__cata_dragged_spell = null;
                      }, 300);
                    }}
                    onClick={() => setSelectedSpellId(s.spellId)}
                    className={`px-1.5 py-1 rounded-md border flex items-center space-x-1.5 cursor-grab active:cursor-grabbing transition ${
                      isSelected
                        ? 'border-amber-400 bg-amber-500/15 ring-1 ring-amber-400/40'
                        : isUnslotted
                          ? 'border-sky-500/45 bg-[#12182a] hover:border-sky-400'
                          : 'border-[#2d2d48] bg-[#16162a] hover:border-gray-500 opacity-80'
                    }`}
                  >
                    {iconSvg ? (
                      <div
                        className="w-8 h-8 rounded overflow-hidden flex-shrink-0 border border-black/80 p-0.5 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
                        dangerouslySetInnerHTML={{ __html: iconSvg }}
                      />
                    ) : (
                      <div
                        className="w-8 h-8 rounded flex-shrink-0 border border-amber-500/40 flex items-center justify-center font-extrabold text-[10px]"
                        style={{ backgroundColor: '#1a1a32', color: classColor }}
                      >
                        {s.name.slice(0, 2)}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-[11px] leading-tight truncate" style={{ color: isSelected ? '#FFD700' : '#E0E0E0' }}>
                        {s.name}
                      </div>
                      <div className="text-[9px] text-gray-500 truncate leading-tight">
                        {spellTip ? `${spellTip.castTime} · ${spellTip.school}` : ''}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bottom locked pane: left = action bars (½ width → ~½ height), right = spell detail */}
        <div className="flex-shrink-0 border-t-2 border-[#3a3a5c] grid grid-cols-1 md:grid-cols-2 min-h-0">

          {/* Left half: 3×12 square action bars (Bar3→2→1, no row labels) */}
          <div className="bg-[#141428] px-2 py-1.5 space-y-0.5 border-r border-[#2a2a48] min-w-0">
            <div className="flex justify-end px-0.5">
              <span className="text-[9px] text-amber-300 font-mono shrink-0">
                {sniffingSlotIdx !== null ? '⚡ 按键…' : '拖入 · 角标绑键'}
              </span>
            </div>

            <div className="space-y-0.5">
              {ACTION_BAR_ROWS.map(row => (
                <div
                  key={row.tab}
                  className="grid grid-cols-12 gap-0.5 min-w-0 rounded px-0.5 py-0.5 bg-[#10101e]/60"
                >
                  {Array.from({ length: 12 }, (_, col) => row.tab * 12 + col).map(renderActionSlot)}
                </div>
              ))}
            </div>
          </div>

          {/* Right half: selected spell description */}
          <div className="bg-[#0e0e1c] p-2.5 flex flex-col min-h-0 overflow-hidden">
            {activeSpell && tip ? (
              <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
                <div className="text-[10px] font-bold text-gray-400 flex items-center space-x-1">
                  <span>📜</span>
                  <span>技能详细说明</span>
                </div>

                <div className="bg-[#0b0b18] border border-[#5c4a28] rounded-md p-2 text-gray-200 text-[11px] space-y-1">
                  <div className="flex items-center space-x-2 pb-1 border-b border-[#3e341f]">
                    {SPELL_ICONS[activeSpell.spellId] ? (
                      <div
                        className="w-8 h-8 rounded overflow-hidden flex-shrink-0 border border-black/80 p-0.5 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
                        dangerouslySetInnerHTML={{ __html: SPELL_ICONS[activeSpell.spellId] }}
                      />
                    ) : (
                      <div
                        className="w-8 h-8 rounded flex-shrink-0 border border-amber-500/50 flex items-center justify-center font-extrabold text-[10px]"
                        style={{ backgroundColor: '#1a1a32', color: classColor }}
                      >
                        {activeSpell.name.slice(0, 2)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="font-extrabold text-amber-300 text-xs tracking-wide truncate">
                        {tip.name}
                      </div>
                      <div className="text-gray-400 text-[9px] font-mono truncate">
                        {tip.cost}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between text-[10px] text-gray-300">
                    <span>{tip.castTime}</span>
                    <span>{tip.range}</span>
                  </div>

                  <div className="flex justify-between text-[10px] text-gray-300">
                    <span>冷却：{tip.cooldown}</span>
                    <span className="text-amber-200">{tip.school}系</span>
                  </div>

                  <div className="pt-1 border-t border-[#3e341f] text-[#ffd100] text-[11px] leading-snug">
                    {tip.description}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 text-[10px] text-gray-500 flex items-center justify-center">选择上方技能查看说明</div>
            )}

            <div className="pt-1.5 mt-auto border-t border-[#23233c] flex justify-end flex-shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1 bg-gradient-to-r from-slate-600 to-slate-500 hover:from-slate-500 hover:to-slate-400 text-white font-extrabold rounded-md shadow transition active:scale-95 text-[11px]"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
    </DismissibleModal>
  );
};
