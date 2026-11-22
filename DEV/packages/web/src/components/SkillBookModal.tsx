import React, { useState, useEffect } from 'react';
import type { ClassId, KeybindingMap } from '@cata-raid-sim/engine';
import { SPELL_ICONS, SPELL_TOOLTIPS } from '../assets/pixelIcons.js';
import { CLASS_NAMES, CLASS_COLORS } from './AuthAndCharacterModal.js';
import type { ActionSlot } from './ActionBar.js';
import { DEFAULT_KEYBINDINGS } from './ActionBar.js';

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

// Complete catalog of spells per class & spec
export const CLASS_ALL_SPELLS: Record<ClassId, Array<{ spellId: string; name: string; reqSpec?: string }>> = {
  DK: [
    // Blood Tank
    { spellId: 'death_strike', name: '灵界打击', reqSpec: 'BLOOD' },
    { spellId: 'heart_strike', name: '心脏打击', reqSpec: 'BLOOD' },
    { spellId: 'death_and_decay', name: '枯萎凋零', reqSpec: 'BLOOD' },
    { spellId: 'rune_strike', name: '符文打击', reqSpec: 'BLOOD' },
    { spellId: 'dark_command', name: '黑暗命令', reqSpec: 'BLOOD' },
    { spellId: 'bone_shield', name: '白骨之盾', reqSpec: 'BLOOD' },
    { spellId: 'vampiric_blood', name: '吸血鬼之血', reqSpec: 'BLOOD' },
    // Frost DPS
    { spellId: 'howling_blast', name: '凛风冲击', reqSpec: 'FROST' },
    { spellId: 'frost_strike', name: '冰霜打击', reqSpec: 'FROST' },
    { spellId: 'obliterate', name: '湮灭', reqSpec: 'FROST' },
    { spellId: 'pillar_of_frost', name: '冰霜之柱', reqSpec: 'FROST' },
    { spellId: 'horn_of_winter', name: '寒冬号角', reqSpec: 'FROST' },
    // Shared
    { spellId: 'mind_freeze', name: '心灵冰冻' },
  ],
  DRUID: [
    // Restoration Healer
    { spellId: 'lifebloom', name: '生命绽放', reqSpec: 'RESTORATION' },
    { spellId: 'rejuvenation', name: '回春术', reqSpec: 'RESTORATION' },
    { spellId: 'regrowth', name: '愈合', reqSpec: 'RESTORATION' },
    { spellId: 'healing_touch', name: '治疗之触', reqSpec: 'RESTORATION' },
    { spellId: 'nourish', name: '滋养', reqSpec: 'RESTORATION' },
    { spellId: 'swiftmend', name: '迅捷治愈', reqSpec: 'RESTORATION' },
    { spellId: 'wild_growth', name: '野性成长', reqSpec: 'RESTORATION' },
    { spellId: 'tranquility', name: '宁静', reqSpec: 'RESTORATION' },
    { spellId: 'natures_swiftness', name: '自然迅捷', reqSpec: 'RESTORATION' },
    { spellId: 'natures_cure', name: '自然之愈', reqSpec: 'RESTORATION' },
    { spellId: 'revive', name: '起死回生', reqSpec: 'RESTORATION' },
    // Balance DPS
    { spellId: 'starsurge', name: '星涌术', reqSpec: 'BALANCE' },
    { spellId: 'wrath', name: '愤怒', reqSpec: 'BALANCE' },
    { spellId: 'starfire', name: '星火术', reqSpec: 'BALANCE' },
    { spellId: 'moonfire', name: '月火术', reqSpec: 'BALANCE' },
    { spellId: 'sunfire', name: '日火术', reqSpec: 'BALANCE' },
    { spellId: 'remove_corruption', name: '解除腐蚀', reqSpec: 'BALANCE' },
    // Shared
    { spellId: 'innervate', name: '激活' },
    { spellId: 'rebirth', name: '复生' },
  ],
  SHAMAN: [
    // Restoration Healer
    { spellId: 'riptide', name: '激流', reqSpec: 'RESTORATION' },
    { spellId: 'healing_wave', name: '治疗波', reqSpec: 'RESTORATION' },
    { spellId: 'healing_surge', name: '治疗之涌', reqSpec: 'RESTORATION' },
    { spellId: 'greater_healing_wave', name: '强效治疗波', reqSpec: 'RESTORATION' },
    { spellId: 'chain_heal', name: '治疗链', reqSpec: 'RESTORATION' },
    { spellId: 'healing_rain', name: '治疗之雨', reqSpec: 'RESTORATION' },
    { spellId: 'spirit_link', name: '灵魂链接图腾', reqSpec: 'RESTORATION' },
    { spellId: 'ancestral_spirit', name: '先祖之魂', reqSpec: 'RESTORATION' },
    // Elemental DPS
    { spellId: 'lightning_bolt', name: '闪电箭', reqSpec: 'ELEMENTAL' },
    { spellId: 'lava_burst', name: '熔岩爆裂', reqSpec: 'ELEMENTAL' },
    { spellId: 'chain_lightning', name: '闪电链', reqSpec: 'ELEMENTAL' },
    { spellId: 'flame_shock', name: '烈焰震击', reqSpec: 'ELEMENTAL' },
    { spellId: 'earth_shock', name: '大地震击', reqSpec: 'ELEMENTAL' },
    // Shared
    { spellId: 'cleanse_spirit', name: '净化灵魂' },
    { spellId: 'wind_shear', name: '风剪' },
    { spellId: 'bloodlust', name: '嗜血' },
  ],
  MAGE: [
    // Fire
    { spellId: 'fireball', name: '火球术', reqSpec: 'FIRE' },
    { spellId: 'living_bomb', name: '活动炸弹', reqSpec: 'FIRE' },
    { spellId: 'pyroblast', name: '炎爆术', reqSpec: 'FIRE' },
    { spellId: 'combustion', name: '燃烧', reqSpec: 'FIRE' },
    // Frost
    { spellId: 'frostbolt', name: '寒冰箭', reqSpec: 'FROST' },
    { spellId: 'ice_lance', name: '冰枪术', reqSpec: 'FROST' },
    { spellId: 'deep_freeze', name: '深度冻结', reqSpec: 'FROST' },
    { spellId: 'frozen_orb', name: '寒冰宝珠', reqSpec: 'FROST' },
    // Arcane
    { spellId: 'arcane_blast', name: '奥术冲击', reqSpec: 'ARCANE' },
    { spellId: 'arcane_missiles', name: '奥术飞弹', reqSpec: 'ARCANE' },
    { spellId: 'arcane_barrage', name: '奥术弹幕', reqSpec: 'ARCANE' },
    { spellId: 'arcane_power', name: '奥术强化', reqSpec: 'ARCANE' },
    // Shared
    { spellId: 'remove_curse', name: '解除诅咒' },
    { spellId: 'counterspell', name: '法术反制' },
    { spellId: 'time_warp', name: '时间扭曲' },
  ],
  ROGUE: [
    // Combat
    { spellId: 'sinister_strike', name: '影袭', reqSpec: 'COMBAT' },
    { spellId: 'slice_and_dice', name: '切割' },
    { spellId: 'eviscerate', name: '刺骨' },
    { spellId: 'adrenaline_rush', name: '冲动', reqSpec: 'COMBAT' },
    // Assassination
    { spellId: 'mutilate', name: '毁伤', reqSpec: 'ASSASSINATION' },
    { spellId: 'envenom', name: '毒伤', reqSpec: 'ASSASSINATION' },
    { spellId: 'rupture', name: '割裂', reqSpec: 'ASSASSINATION' },
    { spellId: 'vendetta', name: '宿敌', reqSpec: 'ASSASSINATION' },
    // Shared
    { spellId: 'kick', name: '脚踢' },
    { spellId: 'feint', name: '佯攻' },
  ],
  WARRIOR: [],
  PALADIN: [],
  HUNTER: [],
  PRIEST: [],
  WARLOCK: [],
};

export const SkillBookModal: React.FC<Props> = ({
  isOpen,
  onClose,
  classId,
  specId,
  keybindings,
  onSaveKeybinding,
  slots = [],
  onSwapSlots,
  onAssignSlot,
  onClearSlot,
}) => {
  const [selectedSpellId, setSelectedSpellId] = useState<string | null>(null);
  const [activeBarTab, setActiveBarTab] = useState<number>(-1); // Default to full 3-bar 36 slots view
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

  if (!isOpen) return null;

  const spells = CLASS_ALL_SPELLS[classId] || [];
  const classColor = CLASS_COLORS[classId] || '#FFD700';
  const activeSpell = spells.find(s => s.spellId === selectedSpellId) || spells[0];
  const tip = activeSpell ? SPELL_TOOLTIPS[activeSpell.spellId] : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 backdrop-blur-sm select-none">
      <div className="bg-[#121224] border-2 border-[#45456b] rounded-2xl w-full max-w-6xl xl:max-w-[1360px] 2xl:max-w-[1440px] max-h-[88vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="bg-[#1a1a36] px-5 py-3 border-b border-[#2d2d4e] flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <span className="text-xl">📖</span>
            <div>
              <h3 className="font-extrabold text-sm text-amber-300">
                技能书与快捷键配置中心 (Spellbook & Keybindings)
              </h3>
              <p className="text-[11px] text-gray-400">
                出征前查看全部技能说明与机制，可直接拖动技能至槽位自定义三栏动作条
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-lg font-bold px-2 py-1"
          >
            ✕
          </button>
        </div>

        {/* Content: Left Spell Grid + Right Detail Tooltip & Slot Binder */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 overflow-hidden">
          
          {/* Left Column: All Class Spells Grid (7 cols) */}
          <div className="md:col-span-7 p-4 border-r border-[#262642] overflow-y-auto space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-gray-300 border-b border-[#23233c] pb-1.5">
              <span>{CLASS_NAMES[classId]} - 全部可用法术与技能 ({spells.length})</span>
              <span className="text-amber-400">当前专精：{specId}</span>
            </div>

            <div className="text-[10px] text-gray-400 flex items-center space-x-1">
              <span>💡 提示：可直接鼠标拽动技能贴上下方动作条槽位，亦可拖动槽位调整顺序</span>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {spells.map(s => {
                const isSelected = s.spellId === activeSpell?.spellId;
                const iconSvg = SPELL_ICONS[s.spellId];
                const spellTip = SPELL_TOOLTIPS[s.spellId];

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
                    className={`p-2.5 rounded-xl border flex items-center space-x-3 cursor-grab active:cursor-grabbing transition ${
                      isSelected
                        ? 'border-amber-400 bg-amber-500/15 shadow-md ring-1 ring-amber-400/50'
                        : 'border-[#2d2d48] bg-[#16162a] hover:border-gray-500'
                    }`}
                  >
                    <div
                      className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 border border-black/80 shadow p-0.5 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
                      dangerouslySetInnerHTML={{ __html: iconSvg || '' }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-xs truncate" style={{ color: isSelected ? '#FFD700' : '#E0E0E0' }}>
                        {s.name}
                      </div>
                      <div className="text-[10px] text-gray-400 truncate mt-0.5">
                        {spellTip ? `${spellTip.castTime} · ${spellTip.school}` : ''}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Visual Slotted Action Bar with Tabs & Drag-Drop Assignment */}
            <div className="pt-3 border-t border-[#23233c] space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex space-x-1.5">
                  {[
                    { tab: -1, label: '全部三栏 (36格)' },
                    { tab: 0, label: '动作条 1 (1~=)' },
                    { tab: 1, label: '动作条 2 (Shift+1~=)' },
                    { tab: 2, label: '动作条 3 (F1~F12)' },
                  ].map(t => (
                    <button
                      key={t.tab}
                      onClick={() => setActiveBarTab(t.tab)}
                      className={`px-2.5 py-1 rounded text-[11px] font-bold transition ${
                        activeBarTab === t.tab
                          ? 'bg-amber-500 text-black shadow'
                          : 'bg-[#18182e] text-gray-400 hover:text-white'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <span className="text-[10px] text-amber-300 font-mono">
                  {sniffingSlotIdx !== null ? '⚡ 请在键盘上按下目标按键...' : '拖拽法术至槽位绑定 · 点击按键嗅探'}
                </span>
              </div>

              {/* Slots Grid: 36 slots or 12 slots */}
              <div className={`grid ${activeBarTab === -1 ? 'grid-cols-6 max-h-[220px] overflow-y-auto pr-1' : 'grid-cols-6'} gap-2`}>
                {(activeBarTab === -1 ? Array.from({ length: 36 }, (_, i) => i) : Array.from({ length: 12 }, (_, col) => activeBarTab * 12 + col)).map((slotIdx) => {
                  const slot = slots.find(s => s.slotIdx === slotIdx);
                  const currentKey = keybindings[slotIdx] || DEFAULT_KEYBINDINGS[slotIdx] || (slotIdx + 1).toString();
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
                      className={`bg-[#18182e] border-2 ${
                        isSniffing
                          ? 'border-amber-400 ring-2 ring-amber-400 bg-amber-500/10'
                          : 'border-[#3b3b5c] hover:border-amber-400'
                      } rounded-lg p-2 flex flex-col items-center justify-between min-h-[84px] transition cursor-pointer relative`}
                    >
                      {/* Slot Header */}
                      <div className="flex items-center justify-between w-full text-[9px] text-gray-400">
                        <span>#{slotIdx + 1}</span>
                        {/* Physical Key Sniffing Button */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSniffingSlotIdx(slotIdx);
                          }}
                          className={`px-1.5 py-0.5 rounded text-[8.5px] font-mono font-bold transition border ${
                            isSniffing
                              ? 'bg-amber-400 text-black border-amber-300 ring-2 ring-amber-300 animate-pulse'
                              : 'bg-black/70 text-amber-300 border-amber-500/40 hover:border-amber-400 hover:text-white'
                          }`}
                          title="点击嗅探并绑定物理按键/组合键"
                        >
                          {isSniffing ? '按键...' : (currentKey || '未绑')}
                        </button>
                      </div>

                      {/* Spell Content or Empty Dropzone */}
                      {slot ? (
                        <div className="flex flex-col items-center my-0.5 w-full">
                          <div
                            className="w-9 h-9 rounded overflow-hidden border border-black/80 shadow mb-1 p-0.5 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
                            dangerouslySetInnerHTML={{ __html: iconSvg || '' }}
                          />
                          <span className="text-[10.5px] text-amber-200 font-bold truncate max-w-full text-center">
                            {slot.name}
                          </span>
                        </div>
                      ) : (
                        <div className="flex-1 flex items-center justify-center text-[10px] text-gray-500 border border-dashed border-gray-700/60 rounded w-full my-0.5">
                          可拖入技能
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Column: Selected Spell Authentic WoW Tooltip (5 cols) */}
          <div className="md:col-span-5 p-4 bg-[#0e0e1c] flex flex-col justify-between overflow-y-auto">
            {activeSpell && tip ? (
              <div className="space-y-3">
                <div className="text-xs font-bold text-gray-400 border-b border-[#24243e] pb-1.5 flex items-center space-x-1.5">
                  <span>📜</span>
                  <span>魔兽世界 4.3 原版技能详细数值说明</span>
                </div>

                {/* WoW Classic Tooltip Parchment Box */}
                <div className="bg-[#0b0b18] border-2 border-[#5c4a28] rounded-xl p-4 shadow-xl text-gray-200 text-xs space-y-2">
                  <div className="flex items-center space-x-3 pb-2 border-b border-[#3e341f]">
                    <div
                      className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 border border-black/80 p-0.5 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
                      dangerouslySetInnerHTML={{ __html: SPELL_ICONS[activeSpell.spellId] || '' }}
                    />
                    <div>
                      <div className="font-extrabold text-amber-300 text-sm tracking-wide">
                        {tip.name}
                      </div>
                      <div className="text-gray-400 text-[10px] font-mono mt-0.5">
                        {tip.cost}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between text-[11px] text-gray-300 pt-1">
                    <span>{tip.castTime}</span>
                    <span>{tip.range}</span>
                  </div>

                  <div className="flex justify-between text-[11px] text-gray-300">
                    <span>冷却：{tip.cooldown}</span>
                    <span className="text-amber-200">{tip.school}系法术</span>
                  </div>

                  <div className="pt-2 border-t border-[#3e341f] text-[#ffd100] text-xs leading-relaxed">
                    {tip.description}
                  </div>
                </div>

                <div className="bg-[#141426] p-3 rounded-lg border border-[#2b2b48] text-xs text-gray-400 space-y-1">
                  <div className="font-bold text-gray-300">💡 提示：</div>
                  <div>· 回春术/生命绽放属于 HoT，持续按周期跳字并结算绽放。</div>
                  <div>· 宁静为全团范围引导法术，走动或被打断会终止。</div>
                  <div>· 战斗中可按 W A S D 走位躲避首领技能或进入法阵。</div>
                </div>
              </div>
            ) : null}

            <div className="pt-3 border-t border-[#23233c] flex justify-end">
              <button
                onClick={onClose}
                className="px-6 py-2 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white font-extrabold rounded-xl shadow-lg transition active:scale-95 text-xs"
              >
                保存配置并关闭
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};