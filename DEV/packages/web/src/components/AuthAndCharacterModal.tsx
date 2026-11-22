import React, { useState, useEffect } from 'react';
import type {
  CharacterRecord,
  ClassId,
  KeybindingMap,
  DungeonClearCertificate,
  DungeonDifficulty,
  CustomDifficultySettings,
} from '@cata-raid-sim/engine';
import { DEFAULT_CUSTOM_DIFFICULTY } from '@cata-raid-sim/engine';
import { CLASS_PIXEL_AVATARS, SPELL_ICONS, SPELL_TOOLTIPS } from '../assets/pixelIcons.js';
import { SkillBookModal } from './SkillBookModal.js';
import { getDefaultActionSlots } from '../assets/defaultActionSlots.js';
import type { ActionSlot } from './ActionBar.js';
import { DEFAULT_KEYBINDINGS } from './ActionBar.js';

function loadSavedSlots(charId: string, specId: string, classId: ClassId): ActionSlot[] {
  try {
    const raw = localStorage.getItem(`cata_slots_${charId}_${specId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return getDefaultActionSlots(classId, specId);
}

export const CLASS_COLORS: Record<ClassId, string> = {
  DK: '#C41F3B',
  DRUID: '#FF7D0A',
  SHAMAN: '#0070DE',
  MAGE: '#69CCF0',
  ROGUE: '#FFF569',
  WARRIOR: '#C79C6E',
  PALADIN: '#F58CBA',
  HUNTER: '#ABD473',
  PRIEST: '#FFFFFF',
  WARLOCK: '#9482C9',
};

export const CLASS_NAMES: Record<ClassId, string> = {
  DK: '死亡骑士',
  DRUID: '德鲁伊',
  SHAMAN: '萨满祭司',
  MAGE: '法师',
  ROGUE: '潜行者',
  WARRIOR: '战士',
  PALADIN: '圣骑士',
  HUNTER: '猎人',
  PRIEST: '牧师',
  WARLOCK: '术士',
};

export const CLASS_SPECS: Record<ClassId, { id: string; name: string; role: 'TANK' | 'HEALER' | 'DPS' }[]> = {
  DK: [
    { id: 'BLOOD', name: '鲜血（主坦）', role: 'TANK' },
    { id: 'FROST', name: '冰霜（输出）', role: 'DPS' },
  ],
  DRUID: [
    { id: 'RESTORATION', name: '恢复（治疗）', role: 'HEALER' },
    { id: 'BALANCE', name: '平衡（输出）', role: 'DPS' },
  ],
  SHAMAN: [
    { id: 'RESTORATION', name: '恢复（治疗）', role: 'HEALER' },
    { id: 'ELEMENTAL', name: '元素（输出）', role: 'DPS' },
  ],
  MAGE: [
    { id: 'FIRE', name: '火焰（输出）', role: 'DPS' },
    { id: 'FROST', name: '冰霜（输出）', role: 'DPS' },
    { id: 'ARCANE', name: '奥术（输出）', role: 'DPS' },
  ],
  ROGUE: [
    { id: 'COMBAT', name: '战斗（输出）', role: 'DPS' },
    { id: 'ASSASSINATION', name: '刺杀（输出）', role: 'DPS' },
  ],
  WARRIOR: [
    { id: 'PROTECTION', name: '防护（主坦）', role: 'TANK' },
    { id: 'ARMS', name: '武器（输出）', role: 'DPS' },
  ],
  PALADIN: [
    { id: 'HOLY', name: '神圣（治疗）', role: 'HEALER' },
    { id: 'PROTECTION', name: '防护（主坦）', role: 'TANK' },
    { id: 'RETRIBUTION', name: '惩戒（输出）', role: 'DPS' },
  ],
  HUNTER: [
    { id: 'MARKSMANSHIP', name: '射击（输出）', role: 'DPS' },
    { id: 'SURVIVAL', name: '生存（输出）', role: 'DPS' },
  ],
  PRIEST: [
    { id: 'HOLY', name: '神圣（治疗）', role: 'HEALER' },
    { id: 'DISCIPLINE', name: '戒律（治疗）', role: 'HEALER' },
    { id: 'SHADOW', name: '暗影（输出）', role: 'DPS' },
  ],
  WARLOCK: [
    { id: 'AFFLICTION', name: '痛苦（输出）', role: 'DPS' },
    { id: 'DESTRUCTION', name: '毁灭（输出）', role: 'DPS' },
  ],
};

interface Props {
  currentAccountName: string;
  characters: CharacterRecord[];
  selectedCharId: string | null;
  onSelectCharacter: (charId: string) => void;
  onCreateCharacter: (name: string, classId: ClassId, spec: string) => void;
  onDeleteCharacter: (charId: string) => void;
  onChangeSpec: (charId: string, spec: string) => void;
  onSaveKeybinding: (charId: string, spec: string, slotIdx: number, key: string) => void;
  onViewCertificate: (cert: DungeonClearCertificate) => void;
  onOpenLeaderboard: () => void;
  onStartAdventure: () => void;
  onLogin: (username: string) => void;
  dungeonTier?: '5man' | '20man';
  onSelectDungeonTier?: (tier: '5man' | '20man') => void;
  dungeonDifficulty?: DungeonDifficulty;
  onSelectDungeonDifficulty?: (diff: DungeonDifficulty) => void;
  customDifficulty?: CustomDifficultySettings;
  onChangeCustomDifficulty?: (settings: CustomDifficultySettings) => void;
  slots?: ActionSlot[];
  onSwapSlots?: (srcIdx: number, destIdx: number, targetCharId?: string, targetSpecId?: string) => void;
  onAssignSlot?: (slotIdx: number, spellId: string, targetCharId?: string, targetSpecId?: string) => void;
  onClearSlot?: (slotIdx: number, targetCharId?: string, targetSpecId?: string) => void;
}

export const AuthAndCharacterModal: React.FC<Props> = ({
  currentAccountName,
  characters,
  selectedCharId,
  onSelectCharacter,
  onCreateCharacter,
  onDeleteCharacter,
  onChangeSpec,
  onSaveKeybinding,
  onViewCertificate,
  onOpenLeaderboard,
  onStartAdventure,
  onLogin,
  dungeonTier = '5man',
  onSelectDungeonTier,
  dungeonDifficulty = 'NORMAL',
  onSelectDungeonDifficulty,
  customDifficulty = DEFAULT_CUSTOM_DIFFICULTY,
  onChangeCustomDifficulty,
  slots,
  onSwapSlots,
  onAssignSlot,
  onClearSlot,
}) => {
  const [draggedSlotIdx, setDraggedSlotIdx] = useState<number | null>(null);
  const [sniffingSlotIdx, setSniffingSlotIdx] = useState<number | null>(null);
  const [hoveredSlot, setHoveredSlot] = useState<ActionSlot | null>(null);

  const customSettings = customDifficulty || DEFAULT_CUSTOM_DIFFICULTY;
  const updateCoeff = (key: keyof CustomDifficultySettings, val: number) => {
    if (onChangeCustomDifficulty) {
      const clamped = Math.min(20.0, Math.max(0.01, Math.round(val * 100) / 100));
      onChangeCustomDifficulty({
        ...customSettings,
        [key]: clamped,
      });
    }
  };

  const formatCoeff = (val: number | undefined) => {
    const num = val ?? 1.0;
    if (num < 1) {
      return num.toFixed(2);
    }
    return (num * 10) % 1 === 0 ? num.toFixed(1) : num.toFixed(2);
  };
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isCreating, setIsCreating] = useState(false);
  const [isSkillBookOpen, setIsSkillBookOpen] = useState(false);
  const [newCharName, setNewCharName] = useState('');
  const [newCharClass, setNewCharClass] = useState<ClassId>('DK');
  const [newCharSpec, setNewCharSpec] = useState('BLOOD');
  const [editingKeybinding, setEditingKeybinding] = useState(false);
  const [loginInput, setLoginInput] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);

  const selectedChar = characters.find(c => c.id === selectedCharId) || characters[0];

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCharName.trim()) return;
    onCreateCharacter(newCharName.trim(), newCharClass, newCharSpec);
    setNewCharName('');
    setIsCreating(false);
  };

  const handleClassChange = (cls: ClassId) => {
    setNewCharClass(cls);
    setNewCharSpec(CLASS_SPECS[cls][0].id);
  };

  const currentSpecKeybindings: KeybindingMap = selectedChar
    ? selectedChar.specKeybindings?.[selectedChar.lastSpec] || {}
    : {};

  const activeSlots = (slots !== undefined && selectedChar?.id === selectedCharId)
    ? slots
    : (selectedChar
        ? loadSavedSlots(selectedChar.id, selectedChar.lastSpec, selectedChar.classId)
        : []);

  // Global keydown listener for sniffing hotkey in Lobby (Supports single keys like F2 and combos like Shift+C)
  useEffect(() => {
    if (sniffingSlotIdx === null || !selectedChar) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setSniffingSlotIdx(null);
        return;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        onSaveKeybinding(selectedChar.id, selectedChar.lastSpec, sniffingSlotIdx, '');
        setSniffingSlotIdx(null);
        return;
      }

      const kLower = e.key.toLowerCase();
      // Bare modifier press - wait for actual key
      if (['shift', 'control', 'alt', 'meta'].includes(kLower)) {
        return;
      }

      let baseKey = '';
      if (e.key >= 'F1' && e.key <= 'F12') {
        baseKey = e.key.toUpperCase();
      } else if (e.code.startsWith('Digit')) {
        baseKey = e.code.replace('Digit', '');
      } else if (e.code.startsWith('Key')) {
        baseKey = e.code.replace('Key', '').toUpperCase();
      } else if (e.code === 'Minus') {
        baseKey = '-';
      } else if (e.code === 'Equal') {
        baseKey = '=';
      } else if (e.code === 'Space') {
        baseKey = 'SPACE';
      } else if (e.code === 'Tab') {
        baseKey = 'TAB';
      } else if (e.code === 'Backquote') {
        baseKey = '`';
      } else if (e.key.length === 1) {
        baseKey = e.key.toUpperCase();
      } else {
        baseKey = e.code.toUpperCase();
      }

      if (!baseKey || ['SHIFT', 'CTRL', 'ALT', 'CONTROL'].includes(baseKey)) {
        return;
      }

      const parts: string[] = [];
      if (e.ctrlKey) parts.push('CTRL');
      if (e.altKey) parts.push('ALT');
      if (e.shiftKey) parts.push('SHIFT');
      parts.push(baseKey);

      const normalizedHotkey = parts.join('+');
      onSaveKeybinding(selectedChar.id, selectedChar.lastSpec, sniffingSlotIdx, normalizedHotkey);
      setSniffingSlotIdx(null);
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [sniffingSlotIdx, selectedChar, onSaveKeybinding]);

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-[#141424] border border-[#3b3b5c] rounded-xl shadow-2xl max-w-6xl xl:max-w-[1360px] 2xl:max-w-[1440px] w-full flex flex-col max-h-[92vh] overflow-hidden text-gray-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a44] bg-[#1a1a30]">
          <div className="flex items-center space-x-3">
            <span className="text-2xl">⚔️</span>
            <div>
              <h2 className="text-lg font-bold text-amber-300">魔兽大灾变副本模拟器 — 角色与冒险厅</h2>
              <p className="text-xs text-gray-400">
                当前账号：<span className="text-amber-400 font-semibold">{currentAccountName || '未登录'}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowLoginModal(true)}
              className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded transition border border-slate-500"
            >
              切换账号
            </button>
            <button
              onClick={onOpenLeaderboard}
              className="px-3 py-1.5 text-xs bg-amber-600 hover:bg-amber-500 text-white rounded font-bold shadow flex items-center space-x-1"
            >
              <span>🏆</span>
              <span>世界排行榜</span>
            </button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 overflow-hidden">
          
          {/* Left Column: Character List (3 cols / 25%) */}
          <div className="md:col-span-3 border-r border-[#2a2a44] p-4 flex flex-col overflow-y-auto bg-[#10101c]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-400">我的角色 ({characters.length})</span>
              <button
                onClick={() => setIsCreating(true)}
                className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 rounded flex items-center space-x-1 font-semibold"
              >
                <span>+</span>
                <span>创建角色</span>
              </button>
            </div>

            <div className="space-y-2 flex-1 overflow-y-auto pr-1">
              {characters.map(char => {
                const isSelected = char.id === selectedChar?.id;
                const classColor = CLASS_COLORS[char.classId];
                return (
                  <div
                    key={char.id}
                    onClick={() => onSelectCharacter(char.id)}
                    className={`p-3 rounded-lg border cursor-pointer transition flex items-center justify-between ${
                      isSelected
                        ? 'border-amber-400 bg-[#252540] shadow-md'
                        : 'border-[#2c2c46] bg-[#161628] hover:border-gray-500'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5">
                      <div
                        className="w-8 h-8 rounded-md overflow-hidden border border-[#3b3b5c] flex-shrink-0 shadow"
                        dangerouslySetInnerHTML={{ __html: CLASS_PIXEL_AVATARS[char.classId] }}
                      />
                      <div>
                        <div className="font-bold text-sm" style={{ color: classColor }}>
                          {char.name}
                        </div>
                        <div className="text-xs text-gray-400">
                          {CLASS_NAMES[char.classId]} · {char.lastSpec}
                        </div>
                      </div>
                    </div>
                    {characters.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`确定删除角色 "${char.name}" 吗？此操作无法撤销。`)) {
                            onDeleteCharacter(char.id);
                          }
                        }}
                        className="text-gray-500 hover:text-red-400 p-1 text-xs"
                        title="删除角色"
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Middle & Right Column: Character Details, Spec & Keybindings, Clear Proofs (9 cols / 75%) */}
          <div className="md:col-span-9 p-5 flex flex-col overflow-y-auto space-y-5 bg-[#141424]">
            {selectedChar ? (
              <>
                {/* ── Dungeon Mode & Difficulty Pre-Selection Card (R8) ─────────────── */}
                <div className="bg-[#1a1a32] border-2 border-amber-500/40 p-4 rounded-xl shadow-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-extrabold text-sm text-amber-300 flex items-center space-x-1.5">
                        <span>🏰</span>
                        <span>副本模式与挑战难度前置选择</span>
                      </h4>
                      <p className="text-xs text-gray-400 mt-0.5">
                        进本前配置副本规格与难度，进入挑战后锁定不可更改
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Dungeon Mode Selection (5man vs 20man) */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-gray-300">副本模式：</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => onSelectDungeonTier && onSelectDungeonTier('5man')}
                          className={`p-2.5 rounded-lg border text-left transition flex flex-col justify-between ${
                            dungeonTier === '5man'
                              ? 'bg-emerald-950/80 border-emerald-400 ring-2 ring-emerald-400/50 shadow-[0_0_12px_rgba(52,211,153,0.3)]'
                              : 'bg-black/40 border-gray-700 hover:border-gray-500 text-gray-300'
                          }`}
                        >
                          <div className="flex items-center space-x-1.5">
                            <span className="text-base">🏰</span>
                            <span className="font-extrabold text-xs text-white">5人地下城</span>
                          </div>
                          <span className="text-[10px] text-emerald-300 font-bold mt-1">
                            影牙城堡 (5 Boss 连战)
                          </span>
                          <span className="text-[9px] text-gray-400 mt-0.5">
                            1坦 · 1疗 · 3输出 经典队伍
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onSelectDungeonTier && onSelectDungeonTier('20man')}
                          className={`p-2.5 rounded-lg border text-left transition flex flex-col justify-between ${
                            dungeonTier === '20man'
                              ? 'bg-purple-950/80 border-purple-400 ring-2 ring-purple-400/50 shadow-[0_0_12px_rgba(192,132,252,0.3)]'
                              : 'bg-black/40 border-gray-700 hover:border-gray-500 text-gray-300'
                          }`}
                        >
                          <div className="flex items-center space-x-1.5">
                            <span className="text-base">🐉</span>
                            <span className="font-extrabold text-xs text-white">20人团队副本</span>
                          </div>
                          <span className="text-[10px] text-purple-300 font-bold mt-1">
                            巨龙之魂 (8 Boss 攻坚)
                          </span>
                          <span className="text-[9px] text-gray-400 mt-0.5">
                            2坦 · 4疗 · 14输出 史诗团本
                          </span>
                        </button>
                      </div>
                    </div>

                    {/* Difficulty Selection (Normal vs Heroic vs Custom) */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-gray-300">挑战难度：</label>
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => onSelectDungeonDifficulty && onSelectDungeonDifficulty('NORMAL')}
                          className={`p-2 rounded-lg border text-left transition flex flex-col justify-between ${
                            dungeonDifficulty === 'NORMAL'
                              ? 'bg-blue-950/80 border-blue-400 ring-2 ring-blue-400/50 shadow-[0_0_12px_rgba(96,165,250,0.3)]'
                              : 'bg-black/40 border-gray-700 hover:border-gray-500 text-gray-300'
                          }`}
                        >
                          <div className="flex items-center space-x-1.5">
                            <span className="text-base">⚔️</span>
                            <span className="font-extrabold text-xs text-white">普通难度</span>
                          </div>
                          <span className="text-[10px] text-blue-300 font-bold mt-1">
                            Normal (标准)
                          </span>
                          <span className="text-[9px] text-gray-400 mt-0.5">
                            常规机制
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onSelectDungeonDifficulty && onSelectDungeonDifficulty('HEROIC')}
                          className={`p-2 rounded-lg border text-left transition flex flex-col justify-between ${
                            dungeonDifficulty === 'HEROIC'
                              ? 'bg-amber-950/80 border-amber-400 ring-2 ring-amber-400/50 shadow-[0_0_12px_rgba(251,191,36,0.3)]'
                              : 'bg-black/40 border-gray-700 hover:border-gray-500 text-gray-300'
                          }`}
                        >
                          <div className="flex items-center space-x-1.5">
                            <span className="text-base">🛡️</span>
                            <span className="font-extrabold text-xs text-white">英雄难度</span>
                          </div>
                          <span className="text-[10px] text-amber-300 font-bold mt-1">
                            Heroic (1.5x)
                          </span>
                          <span className="text-[9px] text-gray-400 mt-0.5">
                            高压全团AOE
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onSelectDungeonDifficulty && onSelectDungeonDifficulty('CUSTOM')}
                          className={`p-2 rounded-lg border text-left transition flex flex-col justify-between ${
                            dungeonDifficulty === 'CUSTOM'
                              ? 'bg-violet-950/80 border-violet-400 ring-2 ring-violet-400/50 shadow-[0_0_12px_rgba(167,139,250,0.3)]'
                              : 'bg-black/40 border-gray-700 hover:border-gray-500 text-gray-300'
                          }`}
                        >
                          <div className="flex items-center space-x-1.5">
                            <span className="text-base">⚙️</span>
                            <span className="font-extrabold text-xs text-white">自定义难度</span>
                          </div>
                          <span className="text-[10px] text-violet-300 font-bold mt-1">
                            Custom (自由调节)
                          </span>
                          <span className="text-[9px] text-gray-400 mt-0.5">
                            独立玩家/AI攻防血蓝
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* ── Custom Difficulty Settings Panel ──────────────────────────── */}
                  {dungeonDifficulty === 'CUSTOM' && (
                    <div className="mt-3 p-3.5 bg-[#111124] border border-violet-500/50 rounded-xl space-y-3 shadow-inner">
                      <div className="flex items-center justify-between pb-2 border-b border-violet-500/30">
                        <div className="flex items-center space-x-2">
                          <span className="text-violet-300 font-extrabold text-xs">⚙️ 自定义难度数值系数设置 (0.01x ~ 20.0x)</span>
                          <span className="text-[10px] text-gray-400 font-mono">(调整后实时生效)</span>
                        </div>
                        <div className="flex items-center space-x-1.5">
                          <button
                            type="button"
                            onClick={() => onChangeCustomDifficulty && onChangeCustomDifficulty({
                              playerDamageCoeff: 2.0, playerHealingCoeff: 2.0, playerHpCoeff: 1.5, playerMpCoeff: 1.5,
                              aiDamageCoeff: 1.5, aiHealingCoeff: 1.5, aiHpCoeff: 1.2, aiMpCoeff: 1.2,
                              enemyDamageCoeff: 0.6, bossHpCoeff: 0.7,
                            })}
                            className="text-[9px] bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded hover:bg-emerald-900/90 font-bold transition"
                            title="玩家与AI大幅增强，首领与小怪削弱"
                          >
                            爽快割草
                          </button>
                          <button
                            type="button"
                            onClick={() => onChangeCustomDifficulty && onChangeCustomDifficulty({
                              playerDamageCoeff: 0.8, playerHealingCoeff: 0.8, playerHpCoeff: 0.8, playerMpCoeff: 0.8,
                              aiDamageCoeff: 0.8, aiHealingCoeff: 0.8, aiHpCoeff: 0.8, aiMpCoeff: 0.8,
                              enemyDamageCoeff: 2.0, bossHpCoeff: 2.5,
                            })}
                            className="text-[9px] bg-red-950/80 text-red-300 border border-red-500/40 px-2 py-0.5 rounded hover:bg-red-900/90 font-bold transition"
                            title="敌方攻击翻倍，首领血量2.5倍"
                          >
                            地狱挑战
                          </button>
                          <button
                            type="button"
                            onClick={() => onChangeCustomDifficulty && onChangeCustomDifficulty({ ...DEFAULT_CUSTOM_DIFFICULTY })}
                            className="text-[9px] bg-gray-800 text-gray-300 border border-gray-600 px-2 py-0.5 rounded hover:bg-gray-700 font-bold transition"
                            title="恢复全系数 1.0x 标准值"
                          >
                            重置 1.0x
                          </button>
                        </div>
                      </div>

                      {/* 3 Columns: Player (玩家), AI (友方AI), Enemy & Boss (敌方与首领) */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                        {/* 1. 玩家自身系数 (Player) */}
                        <div className="bg-[#181832] p-2.5 rounded-lg border border-blue-500/30 space-y-2">
                          <div className="flex items-center space-x-1 text-blue-300 text-[11px] font-bold pb-1 border-b border-blue-500/20">
                            <span>👤</span>
                            <span>玩家参数 (Player)</span>
                          </div>
                          {/* 玩家攻击系数 */}
                          <div className="space-y-0.5">
                            <div className="flex justify-between text-[10px]">
                              <span className="text-gray-300">攻击系数:</span>
                              <span className="text-blue-300 font-mono font-bold">{formatCoeff(customSettings.playerDamageCoeff)}x</span>
                            </div>
                            <input
                              type="range" min="0.01" max="20.0" step="0.01"
                              value={customSettings.playerDamageCoeff}
                              onChange={(e) => updateCoeff('playerDamageCoeff', parseFloat(e.target.value))}
                              className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-400"
                            />
                          </div>
                          {/* 玩家治疗系数 */}
                          <div className="space-y-0.5">
                            <div className="flex justify-between text-[10px]">
                              <span className="text-gray-300">治疗系数:</span>
                              <span className="text-green-300 font-mono font-bold">{formatCoeff(customSettings.playerHealingCoeff)}x</span>
                            </div>
                            <input
                              type="range" min="0.01" max="20.0" step="0.01"
                              value={customSettings.playerHealingCoeff}
                              onChange={(e) => updateCoeff('playerHealingCoeff', parseFloat(e.target.value))}
                              className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-400"
                            />
                          </div>
                          {/* 友方血量系数 (玩家) */}
                          <div className="space-y-0.5">
                            <div className="flex justify-between text-[10px]">
                              <span className="text-gray-300">血量系数:</span>
                              <span className="text-emerald-300 font-mono font-bold">{formatCoeff(customSettings.playerHpCoeff)}x</span>
                            </div>
                            <input
                              type="range" min="0.01" max="20.0" step="0.01"
                              value={customSettings.playerHpCoeff}
                              onChange={(e) => updateCoeff('playerHpCoeff', parseFloat(e.target.value))}
                              className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-emerald-400"
                            />
                          </div>
                          {/* 友方蓝量系数 (玩家) */}
                          <div className="space-y-0.5">
                            <div className="flex justify-between text-[10px]">
                              <span className="text-gray-300">蓝量系数:</span>
                              <span className="text-cyan-300 font-mono font-bold">{formatCoeff(customSettings.playerMpCoeff)}x</span>
                            </div>
                            <input
                              type="range" min="0.01" max="20.0" step="0.01"
                              value={customSettings.playerMpCoeff}
                              onChange={(e) => updateCoeff('playerMpCoeff', parseFloat(e.target.value))}
                              className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                            />
                          </div>
                        </div>

                        {/* 2. 友方 AI 系数 (AI Teammates) */}
                        <div className="bg-[#181832] p-2.5 rounded-lg border border-purple-500/30 space-y-2">
                          <div className="flex items-center space-x-1 text-purple-300 text-[11px] font-bold pb-1 border-b border-purple-500/20">
                            <span>🤖</span>
                            <span>友方 AI 参数 (AI Teammates)</span>
                          </div>
                          {/* AI 攻击系数 */}
                          <div className="space-y-0.5">
                            <div className="flex justify-between text-[10px]">
                              <span className="text-gray-300">攻击系数:</span>
                              <span className="text-purple-300 font-mono font-bold">{formatCoeff(customSettings.aiDamageCoeff)}x</span>
                            </div>
                            <input
                              type="range" min="0.01" max="20.0" step="0.01"
                              value={customSettings.aiDamageCoeff}
                              onChange={(e) => updateCoeff('aiDamageCoeff', parseFloat(e.target.value))}
                              className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-400"
                            />
                          </div>
                          {/* AI 治疗系数 */}
                          <div className="space-y-0.5">
                            <div className="flex justify-between text-[10px]">
                              <span className="text-gray-300">治疗系数:</span>
                              <span className="text-green-300 font-mono font-bold">{formatCoeff(customSettings.aiHealingCoeff)}x</span>
                            </div>
                            <input
                              type="range" min="0.01" max="20.0" step="0.01"
                              value={customSettings.aiHealingCoeff}
                              onChange={(e) => updateCoeff('aiHealingCoeff', parseFloat(e.target.value))}
                              className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-400"
                            />
                          </div>
                          {/* 友方血量系数 (AI) */}
                          <div className="space-y-0.5">
                            <div className="flex justify-between text-[10px]">
                              <span className="text-gray-300">血量系数:</span>
                              <span className="text-emerald-300 font-mono font-bold">{formatCoeff(customSettings.aiHpCoeff)}x</span>
                            </div>
                            <input
                              type="range" min="0.01" max="20.0" step="0.01"
                              value={customSettings.aiHpCoeff}
                              onChange={(e) => updateCoeff('aiHpCoeff', parseFloat(e.target.value))}
                              className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-emerald-400"
                            />
                          </div>
                          {/* 友方蓝量系数 (AI) */}
                          <div className="space-y-0.5">
                            <div className="flex justify-between text-[10px]">
                              <span className="text-gray-300">蓝量系数:</span>
                              <span className="text-cyan-300 font-mono font-bold">{formatCoeff(customSettings.aiMpCoeff)}x</span>
                            </div>
                            <input
                              type="range" min="0.01" max="20.0" step="0.01"
                              value={customSettings.aiMpCoeff}
                              onChange={(e) => updateCoeff('aiMpCoeff', parseFloat(e.target.value))}
                              className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                            />
                          </div>
                        </div>

                        {/* 3. 敌方与首领系数 (Enemy & Boss) */}
                        <div className="bg-[#181832] p-2.5 rounded-lg border border-red-500/30 space-y-2">
                          <div className="flex items-center space-x-1 text-red-300 text-[11px] font-bold pb-1 border-b border-red-500/20">
                            <span>💀</span>
                            <span>敌方与首领 (Enemy & Boss)</span>
                          </div>
                          {/* 敌方攻击系数 */}
                          <div className="space-y-0.5">
                            <div className="flex justify-between text-[10px]">
                              <span className="text-gray-300">敌方攻击系数:</span>
                              <span className="text-red-300 font-mono font-bold">{formatCoeff(customSettings.enemyDamageCoeff)}x</span>
                            </div>
                            <input
                              type="range" min="0.01" max="20.0" step="0.01"
                              value={customSettings.enemyDamageCoeff}
                              onChange={(e) => updateCoeff('enemyDamageCoeff', parseFloat(e.target.value))}
                              className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-red-400"
                            />
                          </div>
                          {/* BOSS血量系数 */}
                          <div className="space-y-0.5">
                            <div className="flex justify-between text-[10px]">
                              <span className="text-gray-300">BOSS血量系数:</span>
                              <span className="text-amber-300 font-mono font-bold">{formatCoeff(customSettings.bossHpCoeff)}x</span>
                            </div>
                            <input
                              type="range" min="0.01" max="20.0" step="0.01"
                              value={customSettings.bossHpCoeff}
                              onChange={(e) => updateCoeff('bossHpCoeff', parseFloat(e.target.value))}
                              className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-amber-400"
                            />
                          </div>
                          <div className="pt-2 text-[9px] text-gray-400 leading-relaxed border-t border-red-500/10">
                            💡 提示：降低首领血量或提高友方攻击可加速击杀；调高敌方攻击与首领血量将带来极限压迫感。
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Character Profile Banner */}
                <div className="flex items-center justify-between bg-[#1d1d36] border border-[#343454] p-4 rounded-xl">
                  <div className="flex items-center space-x-3">
                    <div
                      className="w-12 h-12 rounded-lg overflow-hidden border-2 border-[#444466] shadow-md flex-shrink-0"
                      dangerouslySetInnerHTML={{ __html: CLASS_PIXEL_AVATARS[selectedChar.classId] }}
                    />
                    <div>
                      <h3 className="text-xl font-bold text-white flex items-center space-x-2">
                        <span>{selectedChar.name}</span>
                        <span
                          className="text-xs px-2 py-0.5 rounded font-normal"
                          style={{
                            backgroundColor: `${CLASS_COLORS[selectedChar.classId]}25`,
                            color: CLASS_COLORS[selectedChar.classId],
                            border: `1px solid ${CLASS_COLORS[selectedChar.classId]}60`,
                          }}
                        >
                          {CLASS_NAMES[selectedChar.classId]}
                        </span>
                      </h3>
                      <p className="text-xs text-gray-400 mt-0.5">
                        创建时间：{new Date(selectedChar.createdAtIso).toLocaleDateString()} · 通关证明：
                        <span className="text-amber-400 font-bold ml-1">
                          {selectedChar.clearCertificates?.length || 0} 个
                        </span>
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={onStartAdventure}
                    className="px-6 py-2.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white font-extrabold rounded-lg shadow-lg hover:shadow-amber-500/20 transform active:scale-95 transition flex items-center space-x-2 text-base"
                  >
                    <span>⚔️</span>
                    <span>进入大厅</span>
                  </button>
                </div>

                {/* Talent Spec Switcher & Habit Keybindings */}
                <div className="bg-[#1a1a30] border border-[#2e2e4e] p-4 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-sm text-gray-200">当前专精天赋与独立快捷键习惯</h4>
                      <p className="text-xs text-gray-400">每个天赋独立记忆快捷键布局，战斗时自动加载</p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => setIsSkillBookOpen(true)}
                        className="text-xs px-2.5 py-1 bg-amber-700/60 hover:bg-amber-600 rounded text-amber-200 border border-amber-500/60 flex items-center space-x-1"
                        title="查看全部职业/专精技能与设定快捷键"
                      >
                        <span>📖</span>
                        <span>全技能书与快捷键</span>
                      </button>
                      <button
                        onClick={() => setEditingKeybinding(!editingKeybinding)}
                        className="text-xs px-2.5 py-1 bg-slate-700 hover:bg-slate-600 rounded text-amber-300 border border-slate-500"
                      >
                        {editingKeybinding ? '完成配置' : '⚙️ 自定义快捷键'}
                      </button>
                    </div>
                  </div>

                  {/* Spec Selector */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {CLASS_SPECS[selectedChar.classId].map(spec => {
                      const isActive = selectedChar.lastSpec === spec.id;
                      return (
                        <button
                          key={spec.id}
                          onClick={() => onChangeSpec(selectedChar.id, spec.id)}
                          className={`px-3 py-2 rounded-lg border text-xs font-bold transition flex items-center justify-between ${
                            isActive
                              ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                              : 'border-[#333355] bg-[#121222] text-gray-400 hover:border-gray-500'
                          }`}
                        >
                          <span>{spec.name}</span>
                          <span className="text-[10px] text-gray-400">
                            {spec.role === 'TANK' ? '🛡️ 坦' : spec.role === 'HEALER' ? '💚 奶' : '⚔️ DPS'}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* 3x12 Action Bars (Shared Layout with Combat) */}
                  <div className="bg-[#10101e] p-3 rounded-lg border border-[#25253d] space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-gray-400 font-semibold border-b border-[#25253d] pb-2">
                      <div className="flex flex-col space-y-0.5">
                        <div className="flex items-center space-x-2">
                          <span className="text-white font-bold">[{selectedChar.lastSpec}] 战斗动作条排布 (三栏36格 · 与战斗完全同步)：</span>
                          <span className="text-[10px] text-amber-300 font-bold">
                            {sniffingSlotIdx !== null
                              ? `⚡ 正在为 槽位 #${sniffingSlotIdx + 1} 录入按键：请在键盘上按下单键 (如 F2) 或组合键 (如 Shift+C)，按 ESC 取消`
                              : editingKeybinding
                              ? '👉 单击任意动作条格子即可选择并录入新按键，拖出格子外可移除技能'
                              : '可直接拖拽调整顺序，拖出格子外移除技能，修改即时自动保存'}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingKeybinding(!editingKeybinding);
                            setSniffingSlotIdx(null);
                          }}
                          className={`text-xs px-2.5 py-1 rounded font-bold transition border ${
                            editingKeybinding
                              ? 'bg-amber-500 text-black border-amber-400 shadow-md ring-2 ring-amber-400/50'
                              : 'bg-black/40 text-gray-300 hover:text-white border-gray-600'
                          }`}
                          title="点击后单击任意技能格子，直接按下键盘按键完成绑定"
                        >
                          {editingKeybinding ? '✓ 完成按键修改' : '⌨️ 修改按键习惯 (单击录入)'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsSkillBookOpen(true)}
                          className="text-xs px-2.5 py-1 bg-indigo-700 hover:bg-indigo-600 text-white rounded font-bold shadow flex items-center space-x-1"
                          title="打开法术书，可拖动全部技能填入三栏槽位"
                        >
                          <span>📖</span>
                          <span>法术书与快捷键配置</span>
                        </button>
                      </div>
                    </div>

                    {/* 3 Rows: Bar 3 (24..35), Bar 2 (12..23), Bar 1 (0..11) */}
                    <div className="flex flex-col space-y-2 pt-1">
                      {([
                        { rowName: '动作条 3 (F1~F12)', startIdx: 24 },
                        { rowName: '动作条 2 (Shift+1~=)', startIdx: 12 },
                        { rowName: '动作条 1 (主动作栏 1~=)', startIdx: 0 },
                      ] as const).map(({ rowName, startIdx }) => (
                        <div key={startIdx} className="flex items-center space-x-2">
                          <span className="text-[10px] font-mono text-gray-400 w-20 truncate flex-shrink-0 select-none font-bold">
                            {rowName.split(' ')[0]}
                          </span>
                          <div className="grid grid-cols-12 gap-0 flex-1 border border-[#3b3b5c] rounded-lg overflow-hidden bg-[#0c0c18] shadow-md">
                            {Array.from({ length: 12 }).map((_, col) => {
                              const idx = startIdx + col;
                              const currentKey = currentSpecKeybindings[idx] || DEFAULT_KEYBINDINGS[idx] || (idx + 1).toString();
                              const slot = activeSlots.find(s => s.slotIdx === idx);
                              const iconSvg = slot ? SPELL_ICONS[slot.spellId] : null;

                              return (
                                <div
                                  key={idx}
                                  draggable={!!slot}
                                  onDragStart={(e) => {
                                    if (!slot) return;
                                    setDraggedSlotIdx(idx);
                                    (window as any).__cata_dragged_slot = idx;
                                    (window as any).__cata_dragged_spell = null;
                                    (window as any).__cata_slot_drop_handled = false;
                                    (window as any).__cata_drag_start_coord = { x: e.clientX, y: e.clientY };
                                    e.dataTransfer.effectAllowed = 'copyMove';
                                    try {
                                      e.dataTransfer.setData('text/slotIdx', idx.toString());
                                      e.dataTransfer.setData('text/plain', `slot:${idx}`);
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
                                      onClearSlot(idx, selectedChar.id, selectedChar.lastSpec);
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
                                        if (cSpell) spellId = cSpell;
                                        else if (cSlot) srcSlot = parseInt(cSlot, 10);
                                        else if (plain.startsWith('spell:')) spellId = plain.replace('spell:', '');
                                        else if (plain.startsWith('slot:')) srcSlot = parseInt(plain.replace('slot:', ''), 10);
                                        else if (plain && isNaN(parseInt(plain, 10))) spellId = plain;
                                        else if (plain && !isNaN(parseInt(plain, 10))) srcSlot = parseInt(plain, 10);
                                      } catch {}
                                    }

                                    if (spellId && onAssignSlot) {
                                      onAssignSlot(idx, spellId, selectedChar.id, selectedChar.lastSpec);
                                    } else if (srcSlot !== null && !isNaN(srcSlot) && srcSlot !== idx && onSwapSlots) {
                                      onSwapSlots(srcSlot, idx, selectedChar.id, selectedChar.lastSpec);
                                    }

                                    setDraggedSlotIdx(null);
                                    (window as any).__cata_dragged_spell = null;
                                    (window as any).__cata_dragged_slot = null;
                                  }}
                                  onClick={() => {
                                    if (editingKeybinding) {
                                      setSniffingSlotIdx(idx);
                                    }
                                  }}
                                  onMouseEnter={(e) => {
                                    if (slot) {
                                      const rect = e.currentTarget.getBoundingClientRect();
                                      setTooltipPos({ x: rect.left, y: rect.top });
                                      setHoveredSlot(slot);
                                    }
                                  }}
                                  onMouseLeave={() => setHoveredSlot(null)}
                                  className={`aspect-square min-w-[44px] max-w-[64px] w-full min-h-[44px] md:min-h-[52px] border-r border-[#28283e] last:border-r-0 flex flex-col items-center justify-between relative overflow-hidden transition cursor-pointer select-none ${
                                    sniffingSlotIdx === idx
                                      ? 'border-amber-400 ring-2 ring-amber-400 bg-amber-500/20 shadow-[0_0_12px_rgba(251,191,36,0.6)] animate-pulse z-20'
                                      : draggedSlotIdx === idx
                                      ? 'opacity-50 ring-2 ring-amber-400 z-20'
                                      : slot
                                      ? 'bg-[#141424] hover:bg-[#1f1f35] hover:z-10'
                                      : 'bg-[#0c0c18] hover:bg-[#131322] hover:z-10'
                                  }`}
                                  title={slot ? `${slot.name} (${currentKey}) - 可拖拽互换位置或拖出格子外移除` : `槽位 #${idx + 1} (${currentKey}) - 空`}
                                >
                                  {/* Layer 1 (z-10): Authentic Spell Icon filling slot normally */}
                                  {slot ? (
                                    <div className="absolute inset-0 rounded flex items-center justify-center overflow-hidden z-10 pointer-events-none p-0.5">
                                      {iconSvg ? (
                                        <div
                                          className="w-full h-full flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:block"
                                          dangerouslySetInnerHTML={{ __html: iconSvg }}
                                        />
                                      ) : (
                                        <div
                                          className="w-full h-full flex items-center justify-center text-xs font-bold text-white shadow-sm rounded"
                                          style={{ backgroundColor: slot.colorHex || '#38BDF8' }}
                                        >
                                          {slot.iconText}
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-[11px] text-gray-600 m-auto select-none pointer-events-none z-10 font-bold">#{idx + 1}</span>
                                  )}

                                  {/* Layer 2 (z-20): Slot Number (Top Left) */}
                                  <span className="absolute top-0.5 left-0.5 text-[7.5px] font-mono text-gray-300 drop-shadow-[0_1px_2px_rgba(0,0,0,1)] bg-black/80 px-1 rounded z-20 pointer-events-none leading-none">
                                    #{idx + 1}
                                  </span>

                                  {/* Layer 2 (z-20): Hotkey Badge (Top Right) */}
                                  <span
                                    className={`absolute top-0.5 right-0.5 text-[8.5px] font-mono font-bold drop-shadow-[0_1px_2px_rgba(0,0,0,1)] px-1 rounded z-20 pointer-events-none leading-tight border ${
                                      sniffingSlotIdx === idx
                                        ? 'bg-amber-400 text-black border-amber-300 animate-pulse'
                                        : 'bg-black/85 text-amber-300 border-amber-500/50'
                                    }`}
                                  >
                                    {sniffingSlotIdx === idx ? '按键...' : (currentKey.startsWith('SHIFT+') ? `S${currentKey.replace('SHIFT+', '')}` : currentKey)}
                                  </span>

                                  {/* Layer 2 (z-20): Spell Name Label Banner (Bottom) */}
                                  {slot && (
                                    <span className="absolute bottom-0 inset-x-0 bg-black/85 text-[8px] text-gray-200 truncate text-center z-20 py-0.5 px-0.5 pointer-events-none leading-tight">
                                      {slot.name}
                                    </span>
                                  )}

                                  {/* Sniffing listening overlay */}
                                  {sniffingSlotIdx === idx && (
                                    <div className="absolute inset-0 bg-amber-500/25 ring-2 ring-amber-400 z-30 flex items-center justify-center pointer-events-none">
                                      <span className="text-[8px] font-black text-amber-200 bg-black/90 px-1 py-0.5 rounded shadow border border-amber-400">
                                        按下按键...
                                      </span>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Dungeon Clear Certificates (Rewards) */}
                <div className="bg-[#1a1a30] border border-[#2e2e4e] p-4 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-sm text-gray-200">
                        🏆 获得的副本通关证明（点击查看历史全战报）
                      </h4>
                      <p className="text-xs text-gray-400">
                        击败最终首领获得的最高荣耀凭据，可调阅伤害、有效治疗及逐Boss击杀细节
                      </p>
                    </div>
                  </div>

                  {selectedChar.clearCertificates && selectedChar.clearCertificates.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                      {selectedChar.clearCertificates.map(cert => (
                        <div
                          key={cert.id}
                          onClick={() => onViewCertificate(cert)}
                          className="bg-[#121222] border border-amber-500/40 hover:border-amber-400 p-2.5 rounded-lg cursor-pointer transition hover:bg-[#1a1a32] flex items-center justify-between shadow-sm"
                        >
                          <div>
                            <div className="text-xs font-bold text-amber-300 flex items-center space-x-1">
                              <span>📜</span>
                              <span>{cert.dungeonName}</span>
                            </div>
                            <div className="text-[10px] text-gray-400 mt-0.5">
                              {new Date(cert.clearedAtIso).toLocaleDateString()} · 耗时 {cert.totalDurationSec}s
                            </div>
                            <div className="text-[10px] text-emerald-400 font-mono mt-0.5">
                              DPS: {Math.max(0, cert.characterStats?.dps || 0)} | 有效HPS: {Math.max(0, cert.characterStats?.effectiveHps || 0)}
                            </div>
                          </div>
                          <span className="text-xs text-amber-400 font-bold bg-amber-500/10 px-2 py-1 rounded border border-amber-500/30">
                            查阅战报
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-6 border border-dashed border-[#2f2f4a] rounded-lg text-gray-500 text-xs">
                      暂无通关证明。率领你的冒险团击败影牙城堡尾王「高弗雷勋爵」获取首次通关荣耀！
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="text-center py-12 text-gray-500">
                请先在左侧选择或创建一个角色
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create Character Modal */}
      {isCreating && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a30] border border-amber-400/60 rounded-xl p-5 max-w-md w-full space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-amber-300">创建新冒险者</h3>
            <form onSubmit={handleCreateSubmit} className="space-y-3">
              <div>
                <label className="text-xs text-gray-300 block mb-1">角色名称</label>
                <input
                  type="text"
                  required
                  placeholder="例如：阿尔萨斯"
                  value={newCharName}
                  onChange={(e) => setNewCharName(e.target.value)}
                  className="w-full bg-[#10101e] border border-[#3b3b5c] rounded p-2 text-sm text-white focus:border-amber-400 outline-none"
                />
              </div>

              <div>
                <label className="text-xs text-gray-300 block mb-1">选择职业</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['DK', 'DRUID', 'SHAMAN', 'MAGE', 'ROGUE'] as ClassId[]).map(cls => (
                    <button
                      key={cls}
                      type="button"
                      onClick={() => handleClassChange(cls)}
                      className={`p-2 rounded border text-xs font-bold text-left flex items-center space-x-2 ${
                        newCharClass === cls
                          ? 'border-amber-400 bg-amber-500/20 text-white'
                          : 'border-[#2d2d48] bg-[#121222] text-gray-400'
                      }`}
                    >
                      <div
                        className="w-5 h-5 rounded overflow-hidden flex-shrink-0"
                        dangerouslySetInnerHTML={{ __html: CLASS_PIXEL_AVATARS[cls] }}
                      />
                      <span>{CLASS_NAMES[cls]}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-300 block mb-1">初始天赋</label>
                <select
                  value={newCharSpec}
                  onChange={(e) => setNewCharSpec(e.target.value)}
                  className="w-full bg-[#10101e] border border-[#3b3b5c] rounded p-2 text-sm text-white focus:border-amber-400 outline-none"
                >
                  {CLASS_SPECS[newCharClass].map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded text-gray-300"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded shadow"
                >
                  确认创建
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Switch Account / Login Modal */}
      {showLoginModal && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a30] border border-blue-400/60 rounded-xl p-5 max-w-sm w-full space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-blue-300">用户登录 / 切换账号</h3>
            <div>
              <label className="text-xs text-gray-300 block mb-1">账号用户名</label>
              <input
                type="text"
                placeholder="输入用户名（如：PlayerOne）"
                value={loginInput}
                onChange={(e) => setLoginInput(e.target.value)}
                className="w-full bg-[#10101e] border border-[#3b3b5c] rounded p-2 text-sm text-white focus:border-blue-400 outline-none"
              />
            </div>
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setShowLoginModal(false)}
                className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded text-gray-300"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  if (loginInput.trim()) {
                    onLogin(loginInput.trim());
                    setShowLoginModal(false);
                    setLoginInput('');
                  }
                }}
                className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white font-bold rounded shadow"
              >
                登录 / 注册
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Skill Book & Keybinding Modal */}
      {isSkillBookOpen && selectedChar && (
        <SkillBookModal
          isOpen={isSkillBookOpen}
          onClose={() => setIsSkillBookOpen(false)}
          classId={selectedChar.classId}
          specId={selectedChar.lastSpec}
          keybindings={selectedChar.specKeybindings?.[selectedChar.lastSpec] || {}}
          slots={activeSlots}
          onSaveKeybinding={(slotIndex, key) => {
            onSaveKeybinding(selectedChar.id, selectedChar.lastSpec, slotIndex, key);
          }}
          onChangeSpec={(specId) => {
            onChangeSpec(selectedChar.id, specId);
          }}
          onSwapSlots={onSwapSlots}
          onAssignSlot={onAssignSlot}
          onClearSlot={(slotIdx) => {
            if (onClearSlot) {
              onClearSlot(slotIdx, selectedChar.id, selectedChar.lastSpec);
            }
          }}
        />
      )}

      {/* Authentic WoW Cataclysm 4.3 Spell Tooltip on Hover */}
      {hoveredSlot && SPELL_TOOLTIPS[hoveredSlot.spellId] && (
        <div
          className="fixed z-[9999] pointer-events-none w-72 bg-[#0d0d1e]/98 border-2 border-[#5c4a28] rounded-md p-3 shadow-2xl backdrop-blur font-sans text-xs text-gray-200"
          style={{
            left: `${Math.min(window.innerWidth - 300, Math.max(10, tooltipPos.x - 100))}px`,
            bottom: tooltipPos.y > 220 ? `${window.innerHeight - tooltipPos.y + 12}px` : undefined,
            top: tooltipPos.y <= 220 ? `${tooltipPos.y + 48}px` : undefined,
          }}
        >
          {(() => {
            const tip = SPELL_TOOLTIPS[hoveredSlot.spellId];
            return (
              <div className="space-y-1.5">
                {/* Header: Name and Cost */}
                <div className="flex justify-between items-start border-b border-[#3e341f] pb-1">
                  <span className="font-extrabold text-amber-300 text-sm tracking-wide">
                    {tip.name}
                  </span>
                  <span className="text-gray-300 font-mono text-[11px]">{tip.cost}</span>
                </div>

                {/* Cast Time & Range */}
                <div className="flex justify-between text-[11px] text-gray-300">
                  <span>{tip.castTime}</span>
                  <span>{tip.range}</span>
                </div>

                {/* Cooldown & School */}
                <div className="flex justify-between text-[11px] text-gray-300">
                  <span>冷却时间：{tip.cooldown}</span>
                  <span className="text-amber-200">{tip.school}法术</span>
                </div>

                {/* Description in Golden Cream Text */}
                <div className="pt-1.5 border-t border-[#3e341f] text-[#ffd100] text-[11px] leading-relaxed">
                  {tip.description}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};
