import React, { useMemo, useState } from 'react';
import type { Buff, Unit } from '@cata-raid-sim/engine';
import {
  getHastedCastTimeMs,
  getSpellByAnyId,
  LEVEL_80_MAX_HASTE,
} from '@cata-raid-sim/engine';
import { SPELL_ICONS, SPELL_TOOLTIPS, type SpellTooltipInfo } from '../assets/pixelIcons.js';
import { DEBUFF_REGISTRY } from './RaidFrames.js';

export const AURA_DESCRIPTIONS: Record<string, string> = {
  // ── 增益 Buffs ──────────────────────────────────────────────
  rejuvenation: '每3秒为友方目标恢复生命值，持续12秒。德鲁伊核心瞬发治疗持续效果。',
  regrowth: '为友方目标恢复生命值，并在随后的6秒内持续恢复生命值。暴击几率极高。',
  lifebloom: '在15秒内每2秒为目标持续恢复生命值。最多可叠加3层，多层共用同一倒计时条且层数增加每跳治疗量；当倒计时自然结束或被驱散时产生巨额绽放治疗。同一释放者只能对单一目标维持生效，给其他人施放将没收其他人的生命绽放。可被治疗之触、愈合、滋养单体刷新持续时间。',
  wild_growth: '以选中单位为圆心，15码内血量百分比最低的最多5名友方在7秒内恢复生命值。治疗效果在开始时最高，随时间递减。',
  riptide: '激流涌动，立即为友方目标恢复生命值，并在18秒内持续恢复生命值。使下一个治疗法术急速提升。',
  bone_shield: '环绕旋转的坚固骨盾，使你受到的所有伤害降低20%，每次受到直接伤害消耗1枚骨片。',
  vampiric_blood: '暂时使最大生命值提高15%，并使你受到的所有治疗效果提高25%，持续10秒。',
  slice_and_dice: '终结技，消耗连击点数使近战攻击速度提高40%。',
  time_warp: '扭曲时间流，使所有小队和团队成员的急速提高30%，持续40秒。',
  horn_of_winter: '吹响严冬号角，使所有团队成员的力量和敏捷提高，持续2分钟。',
  mark_of_the_wild: '野性赐福：对 30 码内友方施放；若目标在队伍/团队中，全团所有属性+5% 并提高魔法抗性（1 小时）。',
  arcane_brilliance: '奥术光辉，使目标的法术强度提高10%，最大法力值大幅提升。',
  spirit_link: '灵魂链接图腾，图腾范围内所有盟友受到的伤害降低10%，且每1秒平分一次生命百分比。',
  tranquility: '德鲁伊引导宁静，每2秒为附近受伤最重的团队成员恢复巨额生命值。',
  natures_swiftness: '你的下一个基础施法时间小于10秒的自然法术变为瞬发法术，且治疗效果提高50%。',

  // ── 减益 Debuffs ────────────────────────────────────────────
  asphyxiate: '强力的暗影窒息，将目标悬浮于空中昏迷，每秒造成暗影伤害。必须由能够驱散魔法的治疗迅速驱散。',
  toxic_catalyst: '致命的剧毒催化剂，每秒对目标造成剧烈的自然毒素伤害。急需迅速驱散中毒。',
  potion_catalyst: '剧烈催化药剂，腐蚀目标的躯体并持续造成高额毒素伤害。可由解毒技能驱散。',
  toxic_coagulant: '凝血毒素，使受到的治疗效果大幅降低并持续造成自然伤害。可被中毒驱散。',
  cursed_veins: '暗影诅咒渗透血管，使目标承受的所有暗影与法术伤害大幅增加。可被诅咒驱散。',
  cursed_bullets: '诅咒弹幕附加的负面状态，周期性爆发暗影创伤。可由驱除诅咒技能驱散。',
  shadow_prison: '暗影之牢，移动时会不断叠加受到的暗影伤害。请静止不动或由治疗驱散魔法。',
  desecration: '亵渎之地，移动速度降低50%并持续受到暗影伤害。',
  ice_chains: '刺骨冰链，使移动速度急剧降低并持续受到冰霜伤害。可被魔法驱散。',
  living_bomb: '活动炸弹，在目标体内燃烧造成火焰伤害，到期后剧烈爆炸伤及周围队友。可被魔法驱散。',
  mortal_wound: '致死创伤，使目标受到的所有治疗效果降低25%，可随叠加加深。',
};

export function getAuraCasterName(buff: Buff, allUnits: Unit[] = []): string {
  if (buff.sourceUnitId) {
    const caster = allUnits.find(u => u.id === buff.sourceUnitId);
    if (caster) return caster.name;
  }
  // Fallbacks
  if (['rejuvenation', 'regrowth', 'lifebloom', 'wild_growth', 'tranquility', 'mark_of_the_wild'].includes(buff.spellId)) {
    return '玛法里奥 (德鲁伊)';
  }
  if (['riptide', 'spirit_link'].includes(buff.spellId)) {
    return '萨尔 / 努波顿 (萨满)';
  }
  if (['bone_shield', 'vampiric_blood', 'horn_of_winter'].includes(buff.spellId)) {
    return '死亡骑士';
  }
  if (['slice_and_dice'].includes(buff.spellId)) {
    return '瓦莉拉 (潜行者)';
  }
  if (['asphyxiate', 'toxic_catalyst', 'potion_catalyst', 'toxic_coagulant', 'cursed_veins', 'cursed_bullets', 'shadow_prison'].includes(buff.spellId)) {
    return '首领 (Boss)';
  }
  return '自身 / 环境';
}

export function formatAuraRemaining(buff: Buff): string {
  if (!buff.durationMs || buff.durationMs <= 0 || buff.remainingMs >= 3600000) {
    return '永久 / 持续效果';
  }
  const sec = buff.remainingMs / 1000;
  if (sec >= 60) {
    return `剩余 ${Math.ceil(sec / 60)} 分钟`;
  }
  return `剩余 ${sec.toFixed(1)} 秒`;
}

export function getAuraDescription(buff: Buff): string {
  if (AURA_DESCRIPTIONS[buff.spellId]) {
    return AURA_DESCRIPTIONS[buff.spellId];
  }
  if (SPELL_TOOLTIPS[buff.spellId]?.description) {
    return SPELL_TOOLTIPS[buff.spellId].description;
  }
  return buff.kind === 'BUFF'
    ? `有益的法术效果，提升目标的作战状态或持续恢复生命。`
    : `有害的减益状态，削弱目标的战斗力或持续造成伤害。`;
}

export interface AuraHoverData {
  buff: Buff;
  x: number;
  y: number;
}

interface AuraIconListProps {
  buffs: Buff[];
  allUnits?: Unit[];
  iconSize?: string; // e.g. 'w-4 h-4'
  maxVisible?: number;
}

export const AuraIconList: React.FC<AuraIconListProps> = ({
  buffs,
  allUnits = [],
  iconSize = 'w-4 h-4',
  maxVisible = 20,
}) => {
  const [hoveredAura, setHoveredAura] = useState<AuraHoverData | null>(null);

  if (!buffs || buffs.length === 0) return null;

  const displayList = buffs.slice(0, maxVisible);

  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        {displayList.map((b) => {
          const isDebuff = b.kind === 'DEBUFF';
          const debuffMeta = DEBUFF_REGISTRY[b.spellId];
          const svgIcon = SPELL_ICONS[b.spellId];

          // Border color by dispel type or buff kind
          const borderColor = isDebuff
            ? debuffMeta?.dispelType === 'MAGIC'
              ? 'border-blue-500 ring-1 ring-blue-500/50'
              : debuffMeta?.dispelType === 'CURSE'
              ? 'border-purple-500 ring-1 ring-purple-500/50'
              : debuffMeta?.dispelType === 'POISON'
              ? 'border-green-500 ring-1 ring-green-500/50'
              : 'border-red-500 ring-1 ring-red-500/50'
            : 'border-amber-400/80 hover:border-amber-300';

          const bgColor = isDebuff ? 'bg-red-950/90' : 'bg-[#0f0f18]';

          return (
            <div
              key={b.id}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setHoveredAura({
                  buff: b,
                  x: rect.left,
                  y: rect.bottom + 6,
                });
              }}
              onMouseLeave={() => setHoveredAura(null)}
              className={`${iconSize} rounded border ${borderColor} ${bgColor} relative overflow-hidden flex items-center justify-center flex-shrink-0 shadow cursor-pointer transition transform hover:scale-110`}
            >
              {svgIcon ? (
                <div
                  className="w-full h-full pointer-events-none"
                  dangerouslySetInnerHTML={{ __html: svgIcon }}
                />
              ) : (
                <span
                  className="text-[7.5px] font-black z-10 pointer-events-none"
                  style={{ color: isDebuff ? (debuffMeta?.color || '#EF4444') : '#FACC15' }}
                >
                  {debuffMeta?.label || b.name.substring(0, 1)}
                </span>
              )}

              {/* Stack counter badge */}
              {b.stacks > 1 && (
                <span className="absolute bottom-0 right-0 bg-black/95 text-amber-300 text-[9px] font-black font-mono px-0.5 rounded-tl leading-none z-20 border-t border-l border-amber-400/60 pointer-events-none shadow">
                  {b.stacks}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Floating Rich Tooltip */}
      {hoveredAura && (
        <div
          className="fixed z-50 pointer-events-none w-64 bg-[#0d0d1e]/98 border-2 border-[#5c4a28] rounded-md p-2.5 shadow-2xl backdrop-blur font-sans text-xs text-gray-200"
          style={{
            left: `${Math.min(window.innerWidth - 270, Math.max(10, hoveredAura.x))}px`,
            top: `${Math.min(window.innerHeight - 150, Math.max(10, hoveredAura.y))}px`,
          }}
        >
          {/* Header: Name and Kind */}
          <div className="flex justify-between items-center border-b border-[#3e341f] pb-1">
            <span className="font-extrabold text-amber-300 text-[12px] tracking-wide">
              {hoveredAura.buff.name}
            </span>
            <span
              className={`text-[9.5px] font-bold px-1 rounded ${
                hoveredAura.buff.kind === 'BUFF'
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                  : 'bg-red-950 text-red-300 border border-red-500/40'
              }`}
            >
              {DEBUFF_REGISTRY[hoveredAura.buff.spellId]?.dispelType
                ? `${DEBUFF_REGISTRY[hoveredAura.buff.spellId].dispelType} 减益`
                : hoveredAura.buff.kind === 'BUFF'
                ? '增益效果'
                : '减益状态'}
            </span>
          </div>

          {/* Metadata: Remaining Time & Caster */}
          <div className="flex justify-between text-[10.5px] text-gray-300 py-1 border-b border-[#2d2d44]/50">
            <span>{formatAuraRemaining(hoveredAura.buff)}</span>
            <span className="text-amber-200/90 truncate max-w-[125px]">
              施法者: {getAuraCasterName(hoveredAura.buff, allUnits)}
            </span>
          </div>

          {/* Description in Golden Cream Text */}
          <div className="pt-1.5 text-[#ffd100] text-[11px] leading-relaxed">
            {getAuraDescription(hoveredAura.buff)}
          </div>

          {(hoveredAura.buff.stacks > 1 || (hoveredAura.buff.maxStacks && hoveredAura.buff.maxStacks > 1)) && (
            <div className="text-[10px] text-cyan-300 font-mono pt-1">
              当前层数: {hoveredAura.buff.stacks} {hoveredAura.buff.maxStacks ? `/ ${hoveredAura.buff.maxStacks} ` : ''}层
            </div>
          )}
        </div>
      )}
    </>
  );
};

/** Resolve cast-bar tooltip from spellId / name / boss description. */
export function resolveCastSpellTooltip(opts: {
  spellId?: string | null;
  spellName?: string | null;
  description?: string | null;
  interruptible?: boolean;
  isChannel?: boolean;
  school?: string | null;
}): SpellTooltipInfo | null {
  const id = (opts.spellId || '').trim();
  const name = (opts.spellName || '').trim();

  if (id && SPELL_TOOLTIPS[id]) return SPELL_TOOLTIPS[id];

  const short = id.includes('_') ? id.replace(/^[^_]+_/, '') : id;
  if (short && SPELL_TOOLTIPS[short]) return SPELL_TOOLTIPS[short];

  if (name) {
    const byName = Object.values(SPELL_TOOLTIPS).find((t) => t.name === name);
    if (byName) return byName;
  }

  const norm = id ? getSpellByAnyId(id) : name ? getSpellByAnyId(name) : null;
  if (norm) {
    return {
      name: norm.name,
      cost:
        norm.resourceCostAmount > 0
          ? `${norm.resourceCostAmount} ${norm.resourceKind}`
          : '无消耗',
      castTime:
        norm.castTimeMs <= 0
          ? norm.gcdCategory === 'OFF_GCD'
            ? '瞬发（不占GCD）'
            : '瞬发'
          : `${(getHastedCastTimeMs(norm.castTimeMs, LEVEL_80_MAX_HASTE) / 1000).toFixed(2)} 秒施法`,
      cooldown: norm.cooldownMs > 0 ? `${(norm.cooldownMs / 1000).toFixed(0)} 秒` : '无冷却',
      range: norm.school === 'PHYSICAL' && norm.classId !== 'HUNTER' ? '近战范围' : '40 码',
      school: String(norm.school || opts.school || ''),
      description: norm.description || AURA_DESCRIPTIONS[norm.shortId] || AURA_DESCRIPTIONS[short] || '',
    };
  }

  if (opts.description || name) {
    return {
      name: name || id || '未知技能',
      cost: '—',
      castTime: opts.isChannel ? '引导' : '施法中',
      cooldown: '—',
      range: '—',
      school: String(opts.school || ''),
      description:
        opts.description ||
        AURA_DESCRIPTIONS[id] ||
        AURA_DESCRIPTIONS[short] ||
        '正在施放中的技能。',
    };
  }
  return null;
}

export type UnitFrameCastState = {
  spellName: string;
  spellId?: string;
  spellIcon?: string;
  progress: number;
  interruptible?: boolean;
  isChannel?: boolean;
  description?: string;
  school?: string;
};

/** Hover panel for target / focus cast bars. */
export const CastBarSpellHover: React.FC<{
  castState: UnitFrameCastState;
  children: React.ReactNode;
  className?: string;
}> = ({ castState, children, className }) => {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const tip = useMemo(
    () =>
      resolveCastSpellTooltip({
        spellId: castState.spellId || castState.spellIcon,
        spellName: castState.spellName,
        description: castState.description,
        interruptible: castState.interruptible,
        isChannel: castState.isChannel,
        school: castState.school,
      }),
    [castState]
  );

  return (
    <div
      className={className}
      onMouseEnter={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setPos({ x: rect.left, y: rect.bottom + 6 });
      }}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && tip && (
        <div
          className="fixed z-[60] pointer-events-none w-72 bg-[#0d0d1e]/98 border-2 border-[#5c4a28] rounded-md p-3 shadow-2xl backdrop-blur font-sans text-xs text-gray-200"
          style={{
            left: `${Math.min(window.innerWidth - 300, Math.max(10, pos.x))}px`,
            top: `${Math.min(window.innerHeight - 180, Math.max(10, pos.y))}px`,
          }}
        >
          <div className="space-y-1.5">
            <div className="flex justify-between items-start border-b border-[#3e341f] pb-1 gap-2">
              <span className="font-extrabold text-amber-300 text-sm tracking-wide">
                {tip.name}
              </span>
              <span className="text-gray-300 font-mono text-[11px] flex-shrink-0">{tip.cost}</span>
            </div>
            <div className="flex justify-between text-[11px] text-gray-300">
              <span>{castState.isChannel ? `引导 · ${tip.castTime}` : tip.castTime}</span>
              <span>{tip.range}</span>
            </div>
            <div className="flex justify-between text-[11px] text-gray-300">
              <span>冷却时间：{tip.cooldown}</span>
              <span className="text-amber-200">
                {tip.school ? `${tip.school}法术` : castState.interruptible === false ? '不可打断' : '可打断'}
              </span>
            </div>
            {tip.description ? (
              <div className="pt-1.5 border-t border-[#3e341f] text-[#ffd100] text-[11px] leading-relaxed">
                {tip.description}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};
