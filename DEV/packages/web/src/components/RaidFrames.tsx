import React, { useState, useEffect, useRef } from 'react';
import type { Unit, ClassId, CombatDisplayPrefs } from '@cata-raid-sim/engine';
import {
  isRaidWideBuffSpellId,
  isCasterRadiusRaidBuffSpellId,
  resolveCombatDisplayPrefs,
} from '@cata-raid-sim/engine';
import { SPELL_ICONS } from '../assets/pixelIcons.js';
import { clampHudPosToViewport } from '../utils/hudLayout.js';

/** 全团/小队长效维护 buff 不进团队框小图标（野性印记、奥术智慧、坚韧、王者、号角等） */
function isRaidFrameHiddenRaidBuff(spellId: string): boolean {
  return isRaidWideBuffSpellId(spellId) || isCasterRadiusRaidBuffSpellId(spellId);
}

export type DispelType = 'MAGIC' | 'CURSE' | 'POISON' | 'DISEASE';

/**
 * World of Warcraft Cataclysm 4.3 Official Class Colors:
 */
export const CLASS_COLORS_CATA: Record<string, string> = {
  DK: '#C41E3A',       // Death Knight Blood Red
  WARRIOR: '#C79C6E',  // Warrior Tan / Brown
  DRUID: '#FF7D0A',    // Druid Orange
  ROGUE: '#FFF569',    // Rogue Yellow
  PALADIN: '#F58CBA',  // Paladin Pink
  PRIEST: '#FFFFFF',   // Priest Crisp White
  MAGE: '#69CCF0',     // Mage Sky Blue
  SHAMAN: '#0070DE',   // Shaman Deep Blue
  WARLOCK: '#9482C9',  // Warlock Shadow Purple
  HUNTER: '#ABD473',   // Hunter Pistachio Green
};

/**
 * Cataclysm 4.3 Official Dispel Matrix by Class & Spec:
 * - Restoration Druid: Magic, Curse, Poison (Nature's Cure)
 * - Balance Druid: Curse, Poison (Remove Corruption)
 * - Restoration Shaman: Magic, Curse (Cleanse Spirit + Cleansing Waters talent)
 * - Elemental Shaman: Curse (Cleanse Spirit base)
 * - Mage: Curse (Remove Curse)
 * - DK / Rogue: None
 */
export function getPlayerDispelCapabilities(classId?: string, specId?: string): DispelType[] {
  if (!classId) return [];
  const sp = (specId || '').toUpperCase();
  if (classId === 'DRUID') {
    return sp === 'RESTORATION' ? ['MAGIC', 'CURSE', 'POISON'] : ['CURSE', 'POISON'];
  }
  if (classId === 'SHAMAN') {
    return sp === 'RESTORATION' ? ['MAGIC', 'CURSE'] : ['CURSE'];
  }
  if (classId === 'PALADIN') {
    return sp === 'HOLY' ? ['MAGIC', 'POISON', 'DISEASE'] : ['POISON', 'DISEASE'];
  }
  if (classId === 'PRIEST') {
    return ['MAGIC', 'DISEASE'];
  }
  if (classId === 'MAGE') {
    return ['CURSE'];
  }
  if (classId === 'WARLOCK') {
    return ['MAGIC'];
  }
  return [];
}

export interface DebuffMeta {
  dispelType?: DispelType;
  priority: number; // 1 to 100, higher = higher priority
  label: string;
  color: string;
  border: string;
}

export const DEBUFF_REGISTRY: Record<string, DebuffMeta> = {
  // Boss Lethal CC & Catalysts (Priority 90-100)
  asphyxiate: { dispelType: 'MAGIC', priority: 100, label: '窒', color: '#60A5FA', border: 'border-blue-500' },
  toxic_catalyst: { dispelType: 'POISON', priority: 95, label: '毒', color: '#22C55E', border: 'border-green-500' },
  potion_catalyst: { dispelType: 'POISON', priority: 95, label: '药', color: '#22C55E', border: 'border-green-500' },
  toxic_coagulant: { dispelType: 'POISON', priority: 95, label: '凝', color: '#16A34A', border: 'border-green-600' },
  cursed_veins: { dispelType: 'CURSE', priority: 90, label: '诅', color: '#A855F7', border: 'border-purple-500' },
  cursed_bullets: { dispelType: 'CURSE', priority: 90, label: '弹', color: '#A855F7', border: 'border-purple-500' },
  shadow_prison: { dispelType: 'MAGIC', priority: 90, label: '牢', color: '#818CF8', border: 'border-indigo-500' },
  desecration: { dispelType: 'MAGIC', priority: 85, label: '秽', color: '#38BDF8', border: 'border-cyan-500' },
  ice_chains: { dispelType: 'MAGIC', priority: 80, label: '链', color: '#38BDF8', border: 'border-cyan-400' },
  living_bomb: { dispelType: 'MAGIC', priority: 80, label: '炸', color: '#F97316', border: 'border-orange-500' },
  mortal_wound: { priority: 70, label: '伤', color: '#EF4444', border: 'border-red-600' },
};

const BUFF_ICONS_CONFIG: Record<string, { label: string; color: string; border: string }> = {
  rejuvenation: { label: '春', color: '#FF7D0A', border: 'border-orange-500' },
  lifebloom: { label: '绽', color: '#6FCF97', border: 'border-emerald-400' },
  regrowth: { label: '愈', color: '#A7F3D0', border: 'border-emerald-300' },
  wild_growth: { label: '野', color: '#10B981', border: 'border-green-600' },
  riptide: { label: '激', color: '#0070DE', border: 'border-blue-500' },
  bone_shield: { label: '骨', color: '#FACC15', border: 'border-yellow-500' },
  vampiric_blood: { label: '血', color: '#EF4444', border: 'border-red-500' },
  slice_and_dice: { label: '切', color: '#FFF569', border: 'border-yellow-400' },
  time_warp: { label: '嗜', color: '#E0A3FF', border: 'border-purple-400' },
  horn_of_winter: { label: '号', color: '#67E8F9', border: 'border-cyan-400' },
  mark_of_the_wild: { label: '爪', color: '#F59E0B', border: 'border-amber-400' },
  arcane_brilliance: { label: '智', color: '#93C5FD', border: 'border-blue-400' },
  tranquility: { label: '宁', color: '#90EE90', border: 'border-emerald-400' },
  druid_tranquility: { label: '宁', color: '#90EE90', border: 'border-emerald-400' },
  natures_swiftness: { label: '捷', color: '#10B981', border: 'border-emerald-400' },
  power_word_shield: { label: '盾', color: '#FDE047', border: 'border-yellow-300' },
  beacon_of_light: { label: '道', color: '#F58CBA', border: 'border-pink-400' },
  blessing_of_kings: { label: '王', color: '#FACC15', border: 'border-amber-400' },
  power_word_fortitude: { label: '韧', color: '#E2E8F0', border: 'border-slate-300' },
  battle_shout: { label: '吼', color: '#C79C6E', border: 'border-amber-600' },
  avenging_wrath: { label: '翅', color: '#FDE047', border: 'border-yellow-400' },
  shield_wall: { label: '墙', color: '#94A3B8', border: 'border-slate-400' },
  pain_suppression: { label: '压', color: '#F8FAFC', border: 'border-white' },
  guardian_spirit: { label: '灵', color: '#FEF08A', border: 'border-yellow-200' },
  divine_shield: { label: '无', color: '#FDE047', border: 'border-yellow-300' },
};

export const RAID_TARGET_MARKS = ['⭐', '🟡', '🔷', '🔺', '🌙', '🟩', '❌', '💀'];

export const ROLE_ICONS: Record<string, React.JSX.Element> = {
  TANK: (
    <svg viewBox="0 0 24 24" className="w-full h-full fill-current text-sky-400 drop-shadow">
      <path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3z" />
      <path d="M12 4.4L18 6.6v4.49c0 3.79-2.56 7.32-6 8.18V4.4z" fill="rgba(255,255,255,0.3)" />
    </svg>
  ),
  HEALER: (
    <svg viewBox="0 0 24 24" className="w-full h-full fill-current text-emerald-400 drop-shadow">
      <path d="M19 10.5h-5.5V5c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v5.5H5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5h5.5V19c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-5.5H19c.83 0 1.5-.67 1.5-1.5s-.67-1.5-1.5-1.5z" />
    </svg>
  ),
  DPS: (
    <svg viewBox="0 0 24 24" className="w-full h-full fill-current text-red-400 drop-shadow">
      <path d="M6.92 5L5 6.92l3.79 3.79-1.41 1.41L3.59 8.33 2.17 9.75l3.79 3.79-4.25 4.25c-.39.39-.39 1.02 0 1.41l.71.71c.39.39 1.02.39 1.41 0l4.25-4.25 3.79 3.79 1.41-1.41-3.79-3.79 1.41-1.41 3.79 3.79L19 17.08l-5.66-5.66 1.41-1.41 4.25 4.25c.39.39 1.02.39 1.41 0l.71-.71c.39-.39.39-1.02 0-1.41l-4.25-4.25 1.41-1.41 5.66 5.66L22 10.59 13.41 2 12 3.41l3.79 3.79-1.41 1.41-3.79-3.79-1.41 1.41 3.79 3.79L6.92 5z" />
    </svg>
  ),
};

export interface IncomingHealCast {
  casterId: string;
  casterName: string;
  spellName: string;
  amount: number;
  progress?: number;
  classId?: string;
}

export interface UnitExpectedHot {
  totalExpectedHeal: number;
  details: Array<{
    spellId: string;
    name: string;
    amount: number;
    ticksInWindow: number;
    timeToNextMs?: number;
  }>;
}

/**
 * 计算单位身上挂着的 HoT 在未来 1 秒内（1000ms）明确预期的治疗量
 */
export function calculateNextSecHotHeal(unit: Unit, windowMs = 1000): UnitExpectedHot {
  let total = 0;
  const details: UnitExpectedHot['details'] = [];

  if (!unit || (!unit.isAlive && !unit.alive) || unit.hp <= 0 || !unit.buffs) {
    return { totalExpectedHeal: 0, details };
  }

  for (const buff of unit.buffs) {
    if (buff.kind !== 'BUFF') continue;
    const isHot =
      buff.tags?.includes('HOT') ||
      ['rejuvenation', 'lifebloom', 'regrowth', 'wild_growth', 'riptide'].includes(buff.spellId);
    if (!isHot) continue;

    const interval = buff.tickIntervalMs || 1000;
    const elapsed = buff.tickElapsedMs || 0;
    const remaining = Math.max(0, buff.remainingMs);
    const stacks = buff.stacks || 1;

    let baseVal = buff.tickValue;
    if (!baseVal || baseVal <= 0) {
      if (buff.spellId === 'rejuvenation') baseVal = 4500;
      else if (buff.spellId === 'lifebloom') baseVal = 2400;
      else if (buff.spellId === 'regrowth') baseVal = 1600;
      else if (buff.spellId === 'wild_growth') baseVal = 1800;
      else if (buff.spellId === 'riptide') baseVal = 2500;
      else baseVal = 1000;
    }
    const tickVal = baseVal * stacks;

    // 距离下一次 tick 还需要等待的毫秒数
    let timeToNext = interval - (elapsed % interval);
    if (timeToNext <= 0) timeToNext = interval;

    let ticks = 0;
    if (timeToNext <= windowMs && timeToNext <= remaining) {
      const effectiveWindow = Math.min(windowMs, remaining);
      ticks = 1 + Math.floor((effectiveWindow - timeToNext) / interval);
    }

    let buffExpectedHeal = ticks * tickVal;

    // 生命绽放自然到期产生的 bloom 大绽放加血（多层共用同一倒计时条，层数增加爆发治疗量）
    if (buff.spellId === 'lifebloom' && remaining <= windowMs && remaining > 0) {
      buffExpectedHeal += (buff.tickValue ?? 2400) * 4 * stacks;
    }

    if (buffExpectedHeal > 0) {
      total += buffExpectedHeal;
      details.push({
        spellId: buff.spellId,
        name: buff.name,
        amount: buffExpectedHeal,
        ticksInWindow: ticks,
        timeToNextMs: Math.round(timeToNext),
      });
    }
  }

  return { totalExpectedHeal: total, details };
}

const STORAGE_KEY = 'cata_raid_frame_pos';
const FALLBACK_STORAGE_KEY = 'wow_raid_frame_pos';
const UI_STORAGE_KEY = 'cata_raid_frame_ui';
const DEFAULT_POS = { x: 24, y: 220 };

type RaidTierKey = '5man' | '20man';
type RaidFrameLayout = { x: number; y: number; width?: number; height?: number };
type RaidFrameTierStore = Partial<Record<RaidTierKey, RaidFrameLayout>>;

export function computeRaidGridLayout(tier: '5man' | '20man') {
  const memberWidth = 104;
  const memberHeight = 48;
  const columnGap = 8;
  const rowGap = 4;
  const headerHeight = 28;

  const columns = tier === '20man' ? 4 : 1;
  const rows = 5;
  const totalWidth = columns * memberWidth + (columns - 1) * columnGap + 16;
  const totalHeight = headerHeight + rows * memberHeight + (rows - 1) * rowGap + 16;
  return {
    columns,
    rows,
    totalWidth,
    totalHeight,
    hasVerticalScrollbar: false,
    hasHorizontalScrollbar: false,
  };
}

function getAccountUiKey(accountId?: string): string {
  return accountId ? `cata_raid_frame_ui_${accountId}` : UI_STORAGE_KEY;
}

function clampLayout(
  layout: Partial<RaidFrameLayout> | null | undefined,
  is20Man: boolean
): { pos: { x: number; y: number }; size: { width: number; height: number } | null } {
  let size: { width: number; height: number } | null = null;
  if (typeof layout?.width === 'number' && typeof layout?.height === 'number') {
    size = {
      width: Math.max(is20Man ? 260 : 100, Math.min(1000, layout.width)),
      height: Math.max(140, Math.min(900, layout.height)),
    };
  }
  const panelW = size?.width ?? (is20Man ? 340 : 120);
  const panelH = size?.height ?? 260;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 1080;
  const raw =
    typeof layout?.x === 'number' && typeof layout?.y === 'number'
      ? { x: layout.x, y: layout.y }
      : DEFAULT_POS;
  const pos = clampHudPosToViewport(raw, vw, vh, panelW, panelH);
  return { pos, size };
}

/** Read per-tier store; migrate legacy flat {x,y,width,height} into both tiers. */
function readTierStore(accountId?: string): RaidFrameTierStore {
  try {
    const key = getAccountUiKey(accountId);
    const raw =
      localStorage.getItem(key) ||
      localStorage.getItem(UI_STORAGE_KEY) ||
      localStorage.getItem(STORAGE_KEY) ||
      localStorage.getItem(FALLBACK_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && (parsed['5man'] || parsed['20man'])) {
      return {
        '5man': parsed['5man'],
        '20man': parsed['20man'],
      };
    }
    // Legacy flat layout → seed both tiers so existing placement is not lost.
    if (parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      const flat: RaidFrameLayout = {
        x: parsed.x,
        y: parsed.y,
        ...(typeof parsed.width === 'number' ? { width: parsed.width } : {}),
        ...(typeof parsed.height === 'number' ? { height: parsed.height } : {}),
      };
      return { '5man': { ...flat }, '20man': { ...flat } };
    }
  } catch {}
  return {};
}

function writeTierStore(accountId: string | undefined, tier: RaidTierKey, layout: RaidFrameLayout) {
  try {
    const key = getAccountUiKey(accountId);
    const store = readTierStore(accountId);
    store[tier] = layout;
    localStorage.setItem(key, JSON.stringify(store));
    // Keep legacy key as a coarse fallback (current tier only).
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: layout.x, y: layout.y }));
  } catch {}
}

function loadSavedUiPrefs(
  accountId?: string,
  is20Man?: boolean
): { pos: { x: number; y: number }; size: { width: number; height: number } | null } {
  const tier: RaidTierKey = is20Man ? '20man' : '5man';
  const store = readTierStore(accountId);
  return clampLayout(store[tier], !!is20Man);
}

interface Props {
  units: Unit[];
  selectedUnitId: string | null;
  onSelectUnit: (unitId: string) => void;
  onHoverUnit?: (unitId: string | null) => void;
  onQuickDispel?: (unitId: string) => void;
  onSetFocus?: (unitId: string) => void;
  bossTargetId?: string | null;
  revivingUnitId?: string | null;
  reviveProgress?: number;
  is20Man?: boolean;
  /** Pre-assigned squads (20-man random / 5-man single). When set, used instead of role-chunk. */
  squads?: Unit[][];
  /** Currently selected squad for Alt+1~5 (0-based). Default 0 = 小队1. */
  selectedSquadIndex?: number;
  onSelectSquad?: (squadIndex: number) => void;
  unitCasts?: Record<string, { spellName: string; progress: number }>;
  playerClassId?: ClassId;
  playerSpecId?: string;
  playerPos?: { x: number; y: number };
  incomingHeals?: Record<string, number>;
  incomingCasts?: Record<string, IncomingHealCast[]>;
  accountId?: string;
  raidMarks?: Record<string, string>;
  onSetRaidMark?: (unitName: string, mark: string | null) => void;
  initialPos?: { x: number; y: number; width?: number; height?: number } | null;
  onSavePos?: (pos: { x: number; y: number; width?: number; height?: number }) => void;
  /** 团队框名称 / buff / debuff / 常驻团 buff 显示偏好 */
  combatDisplayPrefs?: CombatDisplayPrefs | null;
}

export const RaidFrames: React.FC<Props> = ({
  units,
  selectedUnitId,
  onSelectUnit,
  onHoverUnit,
  onQuickDispel,
  onSetFocus,
  bossTargetId = null,
  revivingUnitId = null,
  reviveProgress = 0,
  is20Man = false,
  squads: squadsProp,
  selectedSquadIndex = 0,
  onSelectSquad,
  unitCasts = {},
  playerClassId,
  playerSpecId,
  playerPos,
  incomingHeals = {},
  incomingCasts = {},
  accountId,
  combatDisplayPrefs = null,
  raidMarks,
  onSetRaidMark,
  initialPos = null,
  onSavePos,
}) => {
  const [localMarks, setLocalMarks] = useState<Record<string, string>>({});
  const effectiveMarks = raidMarks ?? localMarks;
  const [activeMarkMenu, setActiveMarkMenu] = useState<{
    unitId: string;
    unitName: string;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    const handleCloseMenu = () => setActiveMarkMenu(null);
    window.addEventListener('click', handleCloseMenu);
    return () => window.removeEventListener('click', handleCloseMenu);
  }, []);
  // Toggle: Only show dispellable debuffs for the player's current spec
  const [filterDispellableOnly, setFilterDispellableOnly] = useState(false);

  // Floating draggable & resizable state — 5man / 20man layouts stored separately
  const resolvePrefs = () => {
    if (initialPos && typeof initialPos.x === 'number' && typeof initialPos.y === 'number') {
      return clampLayout(initialPos, is20Man);
    }
    return loadSavedUiPrefs(accountId, is20Man);
  };
  const initialPrefs = resolvePrefs();
  const [pos, setPos] = useState<{ x: number; y: number }>(initialPrefs.pos);
  const [panelSize, setPanelSize] = useState<{ width: number; height: number } | null>(initialPrefs.size);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const tierKey: RaidTierKey = is20Man ? '20man' : '5man';

  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; latestX?: number; latestY?: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number; latestW?: number; latestH?: number } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Switch dungeon size → load that tier's saved position/size
  useEffect(() => {
    if (isDragging || isResizing) return;
    const prefs = resolvePrefs();
    setPos(prefs.pos);
    setPanelSize(prefs.size);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when tier / account / char layout changes
  }, [is20Man, accountId, initialPos?.x, initialPos?.y, initialPos?.width, initialPos?.height]);

  // 已出界（含标题区）自动拉回
  useEffect(() => {
    const pullIn = () => {
      const panelWidth = panelSize?.width || (is20Man ? 340 : 120);
      const panelHeight = panelSize?.height || 260;
      setPos((prev) =>
        clampHudPosToViewport(prev, window.innerWidth, window.innerHeight, panelWidth, panelHeight)
      );
    };
    pullIn();
    window.addEventListener('resize', pullIn);
    return () => window.removeEventListener('resize', pullIn);
  }, [panelSize, is20Man]);

  // Drag listeners with boundary clamping & account persistence
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const panelWidth = panelSize?.width || (is20Man ? 340 : 120);
      const panelHeight = panelSize?.height || 260;
      const next = clampHudPosToViewport(
        { x: dragRef.current.origX + dx, y: dragRef.current.origY + dy },
        window.innerWidth,
        window.innerHeight,
        panelWidth,
        panelHeight
      );
      dragRef.current.latestX = next.x;
      dragRef.current.latestY = next.y;
      setPos(next);
    };

    const handleMouseUp = () => {
      const latestX = dragRef.current?.latestX ?? pos.x;
      const latestY = dragRef.current?.latestY ?? pos.y;
      setIsDragging(false);
      dragRef.current = null;
      const layout: RaidFrameLayout = { x: latestX, y: latestY, ...(panelSize || {}) };
      writeTierStore(accountId, tierKey, layout);
      if (onSavePos) onSavePos(layout);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, pos, panelSize, is20Man, accountId, tierKey, onSavePos]);

  // Resizing listeners with boundary clamping & account persistence
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const dx = e.clientX - resizeRef.current.startX;
      const dy = e.clientY - resizeRef.current.startY;
      const minW = is20Man ? 260 : 100;
      const minH = 140;
      const maxW = Math.min(1000, window.innerWidth - pos.x - 10);
      const maxH = Math.min(900, window.innerHeight - pos.y - 10);
      const newW = Math.max(minW, Math.min(maxW, resizeRef.current.origW + dx));
      const newH = Math.max(minH, Math.min(maxH, resizeRef.current.origH + dy));
      resizeRef.current.latestW = newW;
      resizeRef.current.latestH = newH;
      setPanelSize({ width: newW, height: newH });
    };

    const handleMouseUp = () => {
      const latestW = resizeRef.current?.latestW;
      const latestH = resizeRef.current?.latestH;
      setIsResizing(false);
      resizeRef.current = null;
      const finalSize = latestW && latestH ? { width: latestW, height: latestH } : panelSize;
      const layout: RaidFrameLayout = { x: pos.x, y: pos.y, ...(finalSize || {}) };
      writeTierStore(accountId, tierKey, layout);
      if (onSavePos) onSavePos(layout);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, pos, panelSize, is20Man, accountId, tierKey, onSavePos]);

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

  const handleResizeStart = (e: React.MouseEvent) => {
    if (isLocked) return;
    e.preventDefault();
    e.stopPropagation();
    const curW = panelRef.current ? panelRef.current.offsetWidth : (is20Man ? 340 : 120);
    const curH = panelRef.current ? panelRef.current.offsetHeight : 260;
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origW: curW,
      origH: curH,
    };
    setIsResizing(true);
  };

  // Player's dispel capability matrix
  const playerDispelCapabilities = getPlayerDispelCapabilities(playerClassId, playerSpecId);
  const displayPrefs = resolveCombatDisplayPrefs(combatDisplayPrefs);

  // Current player unit ID for filtering player's own beneficial buffs on raid frames
  const playerUnit = units.find(u => u.isPlayer);
  const playerId = playerUnit?.id;

  // Prefer parent-assigned squads (20-man random / 5-man single); fallback: role-sort chunk
  let squads: Unit[][];
  if (squadsProp && squadsProp.length > 0) {
    squads = squadsProp;
  } else {
    const rolePriority: Record<string, number> = { TANK: 0, HEALER: 1, DPS: 2 };
    const sortedUnits = [...units]
      .filter((u) => !u.isPet && u.role !== 'ENEMY')
      .sort((a, b) => (rolePriority[a.role] ?? 99) - (rolePriority[b.role] ?? 99));
    squads = [];
    for (let i = 0; i < sortedUnits.length; i += 5) {
      squads.push(sortedUnits.slice(i, i + 5));
    }
    if (squads.length === 0) squads.push([]);
  }

  const frameUnitCount = squads.reduce((n, s) => n + s.length, 0);
  const isMultiSquad = is20Man || squads.length > 1;

  return (
    <div
      ref={panelRef}
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        width: `${panelSize ? panelSize.width : (isMultiSquad ? 340 : 120)}px`,
        height: `${panelSize ? panelSize.height : 260}px`,
      }}
      className={`fixed z-30 p-2 bg-[#08080f]/45 border-2 border-[#1c1c2e]/80 rounded-lg flex flex-col select-none shadow-2xl backdrop-blur-md overflow-hidden ${
        isDragging ? 'cursor-grabbing shadow-[0_0_24px_rgba(245,158,11,0.4)]' : ''
      }`}
    >
      {/* Top Header & Drag Handle: Raid Summary + Dispel Filter + Lock Toggle */}
      <div
        onMouseDown={handleMouseDown}
        className={`flex items-center justify-between pb-1 px-1 border-b border-[#1f1f33] mb-1.5 text-xs flex-shrink-0 ${
          isLocked ? 'cursor-default' : 'cursor-grab'
        }`}
      >
        <div className="flex items-center space-x-2">
          <span className="text-[#f3d178] font-bold tracking-wider font-serif drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">
            {isMultiSquad ? `团队框架 (${frameUnitCount}人)` : '小队 1'}
          </span>
          <span className="text-gray-400 text-[10px] font-mono">
            {isMultiSquad ? '2T · 4H · 14DPS' : '1T · 1H · 3DPS'}
          </span>
        </div>

        <div className="flex items-center space-x-1">
          {/* Lock / Unlock Toggle Button */}
          <button
            onClick={() => setIsLocked(!isLocked)}
            className="text-[10px] text-gray-400 hover:text-amber-300 px-1 py-0.5 rounded hover:bg-white/10 transition"
            title={isLocked ? '团队面板已锁定 (点击解锁)' : '团队面板未锁定 (按住把手拖拽)'}
          >
            {isLocked ? '🔒' : '🔓'}
          </button>
        </div>
      </div>

      {/* Grid / Columns of Blizzard Compact Raid Frame Squads (Groups 1-4) - STRICTLY 0 SCROLLBARS */}
      <div className={`w-full flex-1 min-h-0 flex ${isMultiSquad ? 'flex-row space-x-1.5' : 'flex-col space-y-1'} overflow-hidden`}>
        {squads.map((squad, squadIdx) => (
          <div
            key={squadIdx}
            className={`flex flex-col space-y-1 overflow-hidden h-full flex-1 min-h-0 ${
              isMultiSquad ? 'min-w-0' : 'w-full'
            }`}
          >
            {/* Squad Header: 20-man clickable; selected squad bold (default 小队1) */}
            <div className="flex items-center justify-center pb-0.5 border-b border-[#2d2d48]/40 flex-shrink-0">
              {isMultiSquad ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectSquad?.(squadIdx);
                  }}
                  className={`text-[10px] tracking-wider font-serif drop-shadow-[0_1px_2px_rgba(0,0,0,1)] px-1 rounded transition ${
                    selectedSquadIndex === squadIdx
                      ? 'text-[#f3d178] font-bold bg-amber-500/15'
                      : 'text-gray-400 font-normal hover:text-[#f3d178]/80'
                  }`}
                  title={`选择小队 ${squadIdx + 1}（Alt+1~5 对应该小队第1~5人）`}
                >
                  小队 {squadIdx + 1}
                </button>
              ) : (
                <span className="text-[#f3d178] font-bold text-[10px] tracking-wider font-serif drop-shadow-[0_1px_2px_rgba(0,0,0,1)]">
                  小队 {squadIdx + 1}
                </span>
              )}
            </div>

            {/* Squad Members Container: Exactly fills the squad column height */}
            <div className="flex-1 min-h-0 flex flex-col space-y-1 overflow-hidden w-full">
              {squad.map((unit) => {
              const isSelected = unit.id === selectedUnitId;
              const isAlive = (unit.isAlive ?? unit.alive) && unit.hp > 0;
              const hpPct = unit.maxHp > 0 ? Math.max(0, Math.min(100, (unit.hp / unit.maxHp) * 100)) : 0;
              const missingHp = Math.max(0, unit.maxHp - unit.hp);
              const classColor = CLASS_COLORS_CATA[unit.classId] || '#888888';
              const isTank = unit.role === 'TANK';
              const isBossTarget = unit.id === bossTargetId && isAlive;
              // Only non-tanks with boss threat get framed — MT holding aggro stays unframed
              const isOT = isBossTarget && !isTank;
              const isBeingRevived = !isAlive && revivingUnitId === unit.id;

              // Layer 2: Absorption Shield (骨盾/真言术:盾/屏障)
              let absorbAmount = 0;
              const boneShieldBuff = unit.buffs?.find(b => b.spellId === 'bone_shield');
              if (boneShieldBuff) {
                absorbAmount += (boneShieldBuff.stacks || 1) * 8000;
              }
              if (unit.absorb) {
                absorbAmount = Math.max(absorbAmount, unit.absorb);
              }
              const absorbPct = unit.maxHp > 0 ? Math.min(100 - hpPct, (absorbAmount / unit.maxHp) * 100) : 0;

              // 血线基准：当前生命值 + 吸收盾所在位置
              const basePct = Math.min(100, hpPct + absorbPct);
              const availablePct = Math.max(0, 100 - basePct);

              // Layer 3: 多人读条预治疗 (Incoming Cast Heals)
              const unitIncomingCasts = incomingCasts[unit.id] || [];
              const finalIncomingCasts: IncomingHealCast[] =
                unitIncomingCasts.length > 0
                  ? unitIncomingCasts
                  : incomingHeals[unit.id] && incomingHeals[unit.id] > 0
                  ? [{ casterId: 'direct_heal', casterName: '治疗施法', spellName: '治疗术', amount: incomingHeals[unit.id] }]
                  : [];
              const totalCastHealVal = finalIncomingCasts.reduce((acc, c) => acc + c.amount, 0);
              const incomingHealVal = totalCastHealVal;
              const incomingHealPct =
                unit.maxHp > 0 && availablePct > 0 ? Math.min(availablePct, (incomingHealVal / unit.maxHp) * 100) : 0;

              // Layer 4: HoT治疗下1秒明确预期的加血量 (Next 1s HoT Prediction)
              const nextSecHot = calculateNextSecHotHeal(unit, 1000);
              const hotExpectedVal = nextSecHot.totalExpectedHeal;
              const hotPct =
                unit.maxHp > 0 && availablePct > 0 ? Math.min(availablePct, (hotExpectedVal / unit.maxHp) * 100) : 0;

              const totalExpectedIncoming = totalCastHealVal + hotExpectedVal;

              // UnitInRange Distance Fade Check (> 340px dims to 40% alpha)
              let isOutOfRange = false;
              if (playerPos && unit.position) {
                const dx = (unit.position.x || 0) - playerPos.x;
                const dy = (unit.position.y || 0) - playerPos.y;
                const dist = Math.hypot(dx, dy);
                if (dist > 340) {
                  isOutOfRange = true;
                }
              }

              // Debuff / Dispel Queue
              const allAuras = unit.buffs || [];
              let unitDebuffs = allAuras.filter(b => b.kind === 'DEBUFF');

              let activeDispelType: DispelType | null = null;
              for (const d of unitDebuffs) {
                const meta = DEBUFF_REGISTRY[d.spellId];
                if (meta?.dispelType && (playerDispelCapabilities.length === 0 || playerDispelCapabilities.includes(meta.dispelType))) {
                  activeDispelType = meta.dispelType;
                  break;
                }
              }

              // 默认将可驱散的 Debuff 排在最前保证可见
              unitDebuffs.sort((a, b) => {
                const metaA = DEBUFF_REGISTRY[a.spellId];
                const metaB = DEBUFF_REGISTRY[b.spellId];
                const dispellableA = (metaA?.dispelType && (playerDispelCapabilities.length === 0 || playerDispelCapabilities.includes(metaA.dispelType))) ? 1 : 0;
                const dispellableB = (metaB?.dispelType && (playerDispelCapabilities.length === 0 || playerDispelCapabilities.includes(metaB.dispelType))) ? 1 : 0;
                if (dispellableA !== dispellableB) {
                  return dispellableB - dispellableA;
                }
                const prioA = metaA?.priority ?? 50;
                const prioB = metaB?.priority ?? 50;
                return prioB - prioA;
              });

              // 团队框架显示的 buff / debuff 数量不受限制；常驻团 buff 默认不占小图标
              const visibleDebuffs = displayPrefs.showRaidFrameDebuffs ? unitDebuffs : [];
              const regularBuffs = displayPrefs.showRaidFrameBuffs
                ? allAuras.filter(
                    (b) =>
                      b.kind === 'BUFF' &&
                      (!playerId || b.sourceUnitId === playerId) &&
                      !isRaidFrameHiddenRaidBuff(b.spellId || ''),
                  )
                : [];
              const standingBuffs = displayPrefs.showRaidFrameStandingBuffs
                ? allAuras.filter(
                    (b) => b.kind === 'BUFF' && isRaidFrameHiddenRaidBuff(b.spellId || ''),
                  )
                : [];
              const beneficialBuffs = [...regularBuffs, ...standingBuffs];

              // Dispel indicator pulsing border (黄色高亮外框)
              const dispelBorderColor = activeDispelType
                ? 'border-yellow-400 ring-2 ring-yellow-400/90 shadow-[0_0_12px_rgba(250,204,21,0.85)] animate-pulse'
                : '';

              // 人物标记默认是空白的，只有主动标记后才显示
              const raidMark = effectiveMarks[unit.name] || '';

              return (
                <div
                  key={unit.id}
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      if (onSetFocus) onSetFocus(unit.id);
                    } else {
                      onSelectUnit(unit.id);
                    }
                  }}
                  onMouseEnter={() => onHoverUnit && onHoverUnit(unit.id)}
                  onMouseLeave={() => onHoverUnit && onHoverUnit(null)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const clickX = e.clientX;
                    const clickY = e.clientY;
                    setActiveMarkMenu({
                      unitId: unit.id,
                      unitName: unit.name,
                      x: Math.min(window.innerWidth - 220, Math.max(10, clickX - 100)),
                      y: Math.min(window.innerHeight - 130, Math.max(10, clickY - 50)),
                    });
                  }}
                  className={`relative rounded flex-1 min-h-0 w-full border cursor-pointer ${
                    isResizing ? 'transition-none' : 'transition-all'
                  } overflow-hidden flex flex-col justify-between ${
                    isOT
                      ? 'border-red-600 ring-2 ring-red-500 shadow-[0_0_16px_rgba(239,68,68,0.95)] animate-pulse'
                      : isSelected
                      ? 'border-yellow-400 ring-2 ring-yellow-400/95 shadow-[0_0_12px_rgba(250,204,21,0.7)]'
                      : activeDispelType
                      ? dispelBorderColor
                      : 'border-[#1e1e2d] hover:border-gray-400'
                  } ${!isAlive ? 'opacity-50' : isOutOfRange ? 'opacity-40 grayscale-[30%]' : ''}`}
                  style={{ backgroundColor: 'rgba(19, 19, 24, 0.45)' }}
                >
                  {/* ── Layer 1: Base Health Bar (Class-Colored) ──────────────────────── */}
                  {isAlive && (
                    <div
                      className="absolute inset-y-0 left-0 pointer-events-none transition-all duration-150 z-0"
                      style={{
                        width: `${hpPct}%`,
                        backgroundColor: classColor,
                        backgroundImage: 'linear-gradient(to bottom, rgba(255,255,255,0.22), rgba(0,0,0,0.28))',
                      }}
                    />
                  )}

                  {/* ── Layer 2: Absorption Shield (浅色半透明填充，叠加在血条前方) ────── */}
                  {isAlive && absorbPct > 0 && (
                    <div
                      className="absolute inset-y-0 pointer-events-none transition-all duration-150 z-[1] border-l border-yellow-200/80"
                      style={{
                        left: `${hpPct}%`,
                        width: `${absorbPct}%`,
                        backgroundColor: 'rgba(254, 240, 138, 0.45)',
                        backgroundImage:
                          'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,0.2) 4px, rgba(255,255,255,0.2) 8px)',
                      }}
                      title={`吸收护盾: ${absorbAmount}`}
                    />
                  )}

                  {/* ── Layer 3: Multiple Teammates Incoming Cast Heals (多人读条从血线出发重叠，透明度叠加) ── */}
                  {isAlive && availablePct > 0 && finalIncomingCasts.map((cast, cIdx) => {
                    const castPct = unit.maxHp > 0 ? Math.min(availablePct, (cast.amount / unit.maxHp) * 100) : 0;
                    if (castPct <= 0) return null;
                    return (
                      <div
                        key={`cast_${cast.casterId}_${cIdx}`}
                        className="absolute inset-y-0 pointer-events-none transition-all duration-150 z-[2] border-r-2 border-emerald-300"
                        style={{
                          left: `${basePct}%`,
                          width: `${castPct}%`,
                          backgroundColor: 'rgba(52, 211, 153, 0.35)', // 半透明翡翠绿，重叠时多层透明度自然叠加
                          backgroundImage: 'linear-gradient(to right, rgba(110, 231, 183, 0.30), rgba(16, 185, 129, 0.25))',
                          boxShadow: '0 0 6px rgba(52, 211, 153, 0.4)',
                        }}
                        title={`[施法预治疗] ${cast.casterName} - ${cast.spellName}: +${Math.round(cast.amount)}`}
                      />
                    );
                  })}

                  {/* ── Layer 4: Next 1-Second Definite HoT Heal Prediction (HoT下1秒明确预期加血量，水天青色条叠加) ── */}
                  {isAlive && availablePct > 0 && hotPct > 0 && (
                    <div
                      className="absolute inset-y-0 pointer-events-none transition-all duration-150 z-[3] border-r border-cyan-300"
                      style={{
                        left: `${basePct}%`,
                        width: `${hotPct}%`,
                        backgroundColor: 'rgba(56, 189, 248, 0.38)', // 水青蓝，与读条绿条重叠混合产生清透蓝绿光
                        backgroundImage:
                          'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(255, 255, 255, 0.16) 3px, rgba(255, 255, 255, 0.16) 6px)',
                        boxShadow: '0 0 4px rgba(56, 189, 248, 0.5)',
                      }}
                      title={`[HoT 下1秒预期]: +${Math.round(hotExpectedVal)} (${nextSecHot.details.map(d => `${d.name}+${d.amount}`).join(', ')})`}
                    />
                  )}

                  {/* ── Top-Left: Role Icon（OT 仅用红框提示，无 OT 文字） ────────────────── */}
                  <div className="absolute top-0.5 left-1 z-30 flex items-center space-x-0.5 pointer-events-none">
                    {/* 分工图标（15px，无边框高清晰度；不挂悬停文案） */}
                    <div
                      className="w-[15px] h-[15px] flex items-center justify-center flex-shrink-0 drop-shadow select-none"
                    >
                      {unit.role === 'TANK' ? (
                        <svg viewBox="0 0 16 16" className="w-full h-full drop-shadow" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M8 1L2 3.5V7.5C2 11.5 4.5 14.5 8 15.5C11.5 14.5 14 11.5 14 7.5V3.5L8 1Z" fill="#1E3A5F" stroke="#60A5FA" strokeWidth="1.2"/>
                          <path d="M8 3L4 4.8V7.5C4 10.3 5.7 12.5 8 13.5C10.3 12.5 12 10.3 12 7.5V4.8L8 3Z" fill="#3B82F6"/>
                          <path d="M8 3.5V13C9.8 12.1 11.2 10.2 11.2 7.5V5.2L8 3.5Z" fill="#93C5FD"/>
                        </svg>
                      ) : unit.role === 'HEALER' ? (
                        <svg viewBox="0 0 16 16" className="w-full h-full drop-shadow" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <rect width="16" height="16" rx="2" fill="#064E3B"/>
                          <rect x="6" y="2" width="4" height="12" rx="0.5" fill="#22C55E"/>
                          <rect x="2" y="6" width="12" height="4" rx="0.5" fill="#22C55E"/>
                          <rect x="7" y="3" width="2" height="10" fill="#86EFAC"/>
                          <rect x="3" y="7" width="10" height="2" fill="#86EFAC"/>
                        </svg>
                      ) : (
                        <svg viewBox="0 0 16 16" className="w-full h-full drop-shadow" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <rect width="16" height="16" rx="2" fill="#450A0A"/>
                          <path d="M3 13L11 5M11 5L13 3M11 5L10 3M11 5L13 6M1 15L2.5 13.5" stroke="#F87171" strokeWidth="1.4" strokeLinecap="round"/>
                          <path d="M3 12L5 14" stroke="#FCA5A5" strokeWidth="1.4" strokeLinecap="round"/>
                          <path d="M13 13L5 5M5 5L3 3M5 5L6 3M5 5L3 6M15 15L13.5 13.5" stroke="#F87171" strokeWidth="1.4" strokeLinecap="round"/>
                          <path d="M13 12L11 14" stroke="#FCA5A5" strokeWidth="1.4" strokeLinecap="round"/>
                        </svg>
                      )}
                    </div>
                    {activeDispelType && isAlive && (
                      <span
                        className="text-[7.5px] bg-yellow-400 text-black px-1 rounded font-black border border-yellow-300 animate-pulse shadow flex items-center space-x-0.5 cursor-pointer hover:bg-yellow-300 pointer-events-auto"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onQuickDispel) onQuickDispel(unit.id);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (onQuickDispel) onQuickDispel(unit.id);
                        }}
                        title="[单击或右击] 快捷驱散减益"
                      >
                        <span>✨</span>
                        <span>驱散</span>
                      </span>
                    )}
                  </div>

                  {/* ── Top-Right: Health Deficit / Percentage / Incoming Heals ─────────── */}
                  <div className="absolute top-0.5 right-1 z-30 flex items-center space-x-0.5 font-mono text-[8px] pointer-events-none drop-shadow-[0_1px_2px_rgba(0,0,0,1)]">
                    {!isAlive ? (
                      <span className="text-red-400 font-bold text-[7.5px] bg-black/80 px-0.5 rounded border border-red-500/50">
                        💀 阵亡
                      </span>
                    ) : (
                      <>
                        {missingHp > 0 ? (
                          <span className="text-red-200 font-black bg-black/70 px-0.5 rounded text-[7.5px]">
                            -{Math.round(missingHp / 1000)}k
                          </span>
                        ) : (
                          <span className="text-white/80 font-black text-[7.5px]">
                            100%
                          </span>
                        )}
                        {totalExpectedIncoming > 0 && (
                          <span
                            className="text-emerald-300 font-extrabold bg-black/85 px-0.5 rounded text-[7px] border border-emerald-500/40"
                            title={`预期进血: +${Math.round(totalExpectedIncoming)} (施法: +${Math.round(totalCastHealVal)} / HoT下1秒: +${Math.round(hotExpectedVal)})`}
                          >
                            +{totalExpectedIncoming >= 1000 ? `${(totalExpectedIncoming / 1000).toFixed(totalExpectedIncoming >= 10000 ? 0 : 1)}k` : `${Math.round(totalExpectedIncoming)}`}
                          </span>
                        )}
                      </>
                    )}
                  </div>

                  {/* ── Center: Raid Mark + Character Name (Bold White with Dark Stroke) ─── */}
                  <div className="absolute inset-0 z-20 flex items-center justify-center px-1 pointer-events-none">
                    <div className="flex items-center space-x-0.5 max-w-full">
                      {/* Authentic Raid Target Mark: blank by default, shown only when actively marked */}
                      {raidMark ? (
                        <span className="text-[10px] select-none filter drop-shadow z-30 flex-shrink-0">
                          {raidMark}
                        </span>
                      ) : null}
                      {displayPrefs.showRaidFrameNames ? (
                        <>
                          <span
                            className="truncate text-[10.5px] font-extrabold tracking-wide text-white drop-shadow-[0_1px_2px_rgba(0,0,0,1)]"
                            style={{
                              textShadow:
                                '0 0 3px #000, 0 1px 2px #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000',
                            }}
                          >
                            {unit.name}
                          </span>
                          {unit.isPlayer && (
                            <span className="text-[6.5px] bg-amber-400 text-black px-0.5 rounded font-black shadow flex-shrink-0">
                              我
                            </span>
                          )}
                        </>
                      ) : null}
                    </div>
                  </div>

                  {/* ── Center Lower: Resurrect Progress (Notice: Teammate Cast Texts are REMOVED) ──── */}
                  {isBeingRevived && (
                    <div className="absolute inset-x-1 bottom-2.5 z-30 pointer-events-none flex justify-center">
                      <div className="bg-black/90 px-1 py-0.2 rounded border border-amber-400 text-[7px] font-bold text-amber-300 animate-pulse shadow">
                        ✨ 复活中 {Math.round(reviveProgress * 100)}%
                      </div>
                    </div>
                  )}

                  {/* ── [Bottom-Left] Harmful Debuffs (无数量限制，尺寸缩小30%至14px，无边框，顺时针阴影越来越大向着结束) ─── */}
                  <div className="absolute bottom-0.5 left-1 z-30 flex items-center space-x-0.5 flex-wrap max-w-[85%]">
                    {isAlive &&
                      visibleDebuffs.map((b) => {
                        const meta = DEBUFF_REGISTRY[b.spellId] || {
                          label: b.name.substring(0, 1),
                          color: '#EF4444',
                          border: 'border-red-600',
                          priority: 50,
                        };
                        const duration = b.durationMs || 10000;
                        const remaining = Math.max(0, b.remainingMs);
                        const elapsedRatio = Math.max(0, Math.min(1, (duration - remaining) / duration));
                        const shadowDeg = Math.round(elapsedRatio * 360);

                        const isDebuffDispellable = playerDispelCapabilities.length > 0
                          ? Boolean(meta.dispelType && playerDispelCapabilities.includes(meta.dispelType))
                          : Boolean(meta.dispelType);

                        const iconSvg = SPELL_ICONS[b.spellId];

                        return (
                          <div
                            key={b.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onQuickDispel) onQuickDispel(unit.id);
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (onQuickDispel) onQuickDispel(unit.id);
                            }}
                            className={`w-[14px] h-[14px] rounded relative overflow-hidden flex items-center justify-center bg-black/90 flex-shrink-0 shadow cursor-pointer hover:scale-110 transition ${
                              isDebuffDispellable
                                ? 'ring-2 ring-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.95)] animate-pulse'
                                : ''
                            }`}
                            title={`[减益] ${b.name} (${meta.dispelType ? `可驱散: ${meta.dispelType}` : '无法驱散'}) 剩余 ${Math.ceil(remaining / 1000)}s - 单击或右击快捷驱散`}
                          >
                            {iconSvg ? (
                              <div
                                className="w-full h-full pointer-events-none"
                                dangerouslySetInnerHTML={{ __html: iconSvg }}
                              />
                            ) : (
                              <span
                                className="text-[7.5px] font-black z-10 select-none drop-shadow pointer-events-none"
                                style={{ color: isDebuffDispellable ? '#FDE047' : meta.color }}
                              >
                                {meta.label}
                              </span>
                            )}
                            {/* Sector Shadow Overlay: 顺时针阴影越来越大，代表向着结束 */}
                            <div
                              className="absolute inset-0 pointer-events-none z-20 rounded"
                              style={{
                                background: `conic-gradient(rgba(0, 0, 0, 0.78) 0deg, rgba(0, 0, 0, 0.78) ${shadowDeg}deg, transparent ${shadowDeg}deg, transparent 360deg)`,
                              }}
                            />
                            {/* Dispellable Sparkle Indicator */}
                            {isDebuffDispellable && (
                              <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-yellow-400 rounded-full shadow pointer-events-none ring-1 ring-yellow-200 z-30" />
                            )}
                            {b.stacks > 1 && (
                              <span className="absolute bottom-0 right-0 bg-red-950/95 text-red-200 text-[9px] font-black font-mono px-0.5 rounded-tl leading-none z-30 pointer-events-none drop-shadow border-t border-l border-red-500/50 shadow-sm">
                                {b.stacks}
                              </span>
                            )}
                          </div>
                        );
                      })}
                  </div>

                  {/* ── [Bottom-Right] Beneficial HoTs / Buffs (无数量限制，尺寸缩小30%至14px，无边框，顺时针阴影越来越大向着结束) ─── */}
                  <div className="absolute bottom-0.5 right-1 z-30 flex items-center space-x-0.5 flex-wrap justify-end max-w-[85%]">
                    {isAlive &&
                      beneficialBuffs.map((b) => {
                        const conf = BUFF_ICONS_CONFIG[b.spellId] || {
                          label: b.name.substring(0, 1),
                          color: '#38BDF8',
                          border: 'border-cyan-500/80',
                        };
                        const duration = b.durationMs || 15000;
                        const remaining = Math.max(0, b.remainingMs);
                        const elapsedRatio = Math.max(0, Math.min(1, (duration - remaining) / duration));
                        const shadowDeg = Math.round(elapsedRatio * 360);
                        const isHotTickingSoon = nextSecHot.details.some(d => d.spellId === b.spellId);
                        const iconSvg = SPELL_ICONS[b.spellId];

                        return (
                          <div
                            key={b.id}
                            className={`w-[14px] h-[14px] rounded relative overflow-hidden flex items-center justify-center bg-black/90 flex-shrink-0 shadow transition-all ${
                              isHotTickingSoon ? 'ring-1 ring-cyan-400 shadow-[0_0_8px_rgba(56,189,248,0.85)]' : ''
                            }`}
                            title={`[增益] ${b.name} (剩余 ${Math.ceil(remaining / 1000)}s / 共${b.stacks}层)${
                              isHotTickingSoon ? ' - ⚡下1秒即将生效治疗' : ''
                            }`}
                          >
                            {iconSvg ? (
                              <div
                                className="w-full h-full pointer-events-none"
                                dangerouslySetInnerHTML={{ __html: iconSvg }}
                              />
                            ) : (
                              <span
                                className="text-[7.5px] font-black z-10 select-none drop-shadow pointer-events-none"
                                style={{ color: conf.color }}
                              >
                                {conf.label}
                              </span>
                            )}
                            {/* Sector Shadow Overlay: 顺时针阴影越来越大，代表向着结束 */}
                            <div
                              className="absolute inset-0 pointer-events-none z-20 rounded"
                              style={{
                                background: `conic-gradient(rgba(0, 0, 0, 0.78) 0deg, rgba(0, 0, 0, 0.78) ${shadowDeg}deg, transparent ${shadowDeg}deg, transparent 360deg)`,
                              }}
                            />
                            {b.stacks > 1 && (
                              <span className="absolute bottom-0 right-0 bg-black/95 text-amber-300 text-[9px] font-black font-mono px-0.5 rounded-tl leading-none z-30 pointer-events-none drop-shadow border-t border-l border-amber-400/50 shadow-sm">
                                {b.stacks}
                              </span>
                            )}
                          </div>
                        );
                      })}
                  </div>

                  {/* ── Mana & Energy Bar Strip (Height 2px, authentic WoW power line) ─────────── */}
                  {unit.maxMp && unit.maxMp > 0 && isAlive ? (
                    <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#071324] overflow-hidden z-20 pointer-events-none">
                      <div
                        className="h-full bg-blue-500 transition-all duration-150"
                        style={{
                          width: `${Math.min(100, Math.max(0, ((unit.mp || 0) / unit.maxMp) * 100))}%`,
                        }}
                      />
                    </div>
                  ) : unit.classId === 'ROGUE' && isAlive ? (
                    <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#241c07] overflow-hidden z-20 pointer-events-none">
                      <div
                        className="h-full bg-[#FFF569] transition-all duration-150"
                        style={{
                          width: `${Math.min(100, Math.max(0, ((unit.energy ?? 100) / 100) * 100))}%`,
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom-Right Corner Resize Grip Handle (Resizable & Account-persisted) */}
      <div
        onMouseDown={handleResizeStart}
        className="absolute bottom-0 right-0 w-3.5 h-3.5 cursor-se-resize flex items-end justify-end p-0.5 z-40 group select-none"
        title="拖拽右下角拉伸调整团队框架大小（按账号自动记忆）"
      >
        <svg className="w-2.5 h-2.5 text-gray-500 group-hover:text-amber-400 transition" viewBox="0 0 6 6" fill="currentColor">
          <circle cx="5" cy="5" r="0.75" />
          <circle cx="3" cy="5" r="0.75" />
          <circle cx="5" cy="3" r="0.75" />
          <circle cx="1" cy="5" r="0.75" />
          <circle cx="3" cy="3" r="0.75" />
          <circle cx="5" cy="1" r="0.75" />
        </svg>
      </div>

      {/* ── Context Menu: Raid Target Mark Picker (右键团队插件主动标记菜单) ── */}
      {activeMarkMenu && (
        <div
          className="fixed z-50 bg-[#14141e] border border-amber-500/80 rounded-lg shadow-2xl p-2 flex flex-col space-y-1.5 backdrop-blur-md animate-scale-in select-none"
          style={{ left: activeMarkMenu.x, top: activeMarkMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between text-[11px] text-gray-200 font-bold border-b border-gray-700/60 pb-1 px-1">
            <span>🎯 标记: {activeMarkMenu.unitName}</span>
            <button
              type="button"
              className="text-gray-400 hover:text-white text-xs px-1"
              onClick={() => setActiveMarkMenu(null)}
            >
              ✕
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1 py-0.5">
            {RAID_TARGET_MARKS.map((mark) => (
              <button
                key={mark}
                type="button"
                className="w-8 h-8 flex items-center justify-center text-base rounded bg-[#20202e] hover:bg-amber-600/40 hover:border-amber-400 border border-transparent transition shadow"
                onClick={() => {
                  if (onSetRaidMark) {
                    onSetRaidMark(activeMarkMenu.unitName, mark);
                  }
                  setLocalMarks(prev => ({ ...prev, [activeMarkMenu.unitName]: mark }));
                  setActiveMarkMenu(null);
                }}
                title={`标记为 ${mark}`}
              >
                {mark}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="w-full py-1 text-[11px] font-bold text-red-400 hover:text-red-300 hover:bg-red-950/40 rounded border border-red-900/60 transition"
            onClick={() => {
              if (onSetRaidMark) {
                onSetRaidMark(activeMarkMenu.unitName, null);
              }
              setLocalMarks(prev => {
                const next = { ...prev };
                delete next[activeMarkMenu.unitName];
                return next;
              });
              setActiveMarkMenu(null);
            }}
          >
            🚫 清除标记
          </button>
        </div>
      )}
    </div>
  );
};
