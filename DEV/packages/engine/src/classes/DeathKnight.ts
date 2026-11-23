/**
 * [C-01] DeathKnight.ts
 * 死亡骑士 — 鲜血（主坦） / 冰霜（近战 DPS）
 * 资源：6枚符文（2血/2冰/2邪，单枚基础CD 10s）+ 符文能量（上限100）
 */

import type { ClassId } from '../types.js';

export type SpellEffectType =
  | 'PHYSICAL_DAMAGE'
  | 'SPELL_DAMAGE'
  | 'HEAL'
  | 'HOT'           // Heal over Time
  | 'DOT'           // Damage over Time
  | 'SHIELD'        // Absorb shield
  | 'BUFF'
  | 'DEBUFF'
  | 'TAUNT'
  | 'INTERRUPT'
  | 'GROUND_EFFECT'
  | 'RESOURCE_RESTORE'
  | 'DISPEL'
  | 'RESURRECT';

export type ResourceCostType =
  | 'BLOOD_RUNE'    // 血符文
  | 'FROST_RUNE'    // 冰符文
  | 'UNHOLY_RUNE'   // 邪符文
  | 'DEATH_RUNE'    // 死亡符文（通用）
  | 'RUNIC_POWER'   // 符文能量
  | 'MANA'
  | 'ENERGY'
  | 'COMBO_POINT'   // 消耗连击点
  | 'RAGE'
  | 'FOCUS'
  | 'HOLY_POWER'
  | 'NONE';

export type TargetType =
  | 'SELF'
  | 'SINGLE_ENEMY'
  | 'SINGLE_ALLY'
  | 'AOE_ENEMY'
  | 'AOE_ALLY'
  | 'GROUND'        // 地面目标点
  | 'SMART_ALLY';   // 智能分配友方

export type SpellSchool =
  | 'PHYSICAL'
  | 'SHADOW'
  | 'FROST'
  | 'FIRE'
  | 'NATURE'
  | 'ARCANE'
  | 'HOLY';

export interface SpellEffect {
  type: SpellEffectType;
  /** 基础数值（伤害/治疗/吸收量等），实际值由Calculator缩放 */
  baseValue?: number;
  /** 持续时间（ms） */
  durationMs?: number;
  /** 触发间隔（ms），用于HoT/DoT */
  tickIntervalMs?: number;
  /** Buff/Debuff名称标识 */
  auraId?: string;
  /** 最大层数 */
  maxStacks?: number;
  /** 地面特效kind，当type=GROUND_EFFECT时有效 */
  groundKind?: 'TOTEM' | 'HEAL_ZONE' | 'DAMAGE_ZONE' | 'CONE_WARNING';
  /** 地面特效颜色 */
  groundColorHex?: string;
  /** 地面特效半径 */
  groundRadius?: number;
  /** 附加说明（给AI决策与UI tooltip用） */
  description?: string;
}

export interface Spell {
  id: string;
  name: string;
  /** 施法时间（ms），0=瞬发，-1=引导 */
  castTimeMs: number;
  /** 引导总时长（ms），castTimeMs=-1时有效 */
  channelDurationMs?: number;
  /** GCD类型：normal=1.5s，off=脱离GCD，rogue=1.0s */
  gcdType: 'normal' | 'off' | 'rogue';
  /** GCD标准分类（与types.ts对齐） */
  gcdCategory?: 'NORMAL' | 'ROGUE' | 'OFF_GCD';
  /** 独立冷却（ms） */
  cooldownMs: number;
  resourceCost: ResourceCostType;
  resourceCostAmount: number;
  targetType: TargetType;
  school: SpellSchool;
  effects: SpellEffect[];
  /** 专属天赋规格（null=通用） */
  spec?: 'BLOOD_TANK' | 'FROST_DPS' | 'UNHOLY_DPS' | 'RESTO_HEAL' | 'BALANCE_DPS' | 'ELEMENTAL_DPS' | 'ENHANCEMENT_DPS' | 'FIRE_DPS' | 'ARCANE_DPS' | 'ICE_DPS' | 'COMBAT_DPS' | 'ASSASSINATION_DPS' | 'SUBTLETY_DPS' | 'FERAL' | string;
  /** 是否长效团队Buff（赶路阶段AI自动补充） */
  isRaidBuff?: boolean;
  /** 只能在TRAVEL_RECOVERY阶段使用 */
  travelOnly?: boolean;
  /** 符文消耗（DK） */
  runesRequired?: Array<'BLOOD' | 'FROST' | 'UNHOLY'>;
  /** 最大施法距离（画布像素；约 80≈近战，320≈40码） */
  range?: number;
}

export interface ClassSpec {
  classId: ClassId;
  className: string;
  classColor: string;
  spells: Spell[];
}

// ─────────────────────────────────────────────
//  死亡骑士技能表
// ─────────────────────────────────────────────

export const DEATH_KNIGHT: ClassSpec = {
  classId: 'DK',
  className: '死亡骑士',
  classColor: '#C41F3B',
  spells: [
    // ── 鲜血坦克技能 ──────────────────────────

    {
      id: 'dk_death_strike',
      name: '灵界打击',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'BLOOD_RUNE',
      resourceCostAmount: 1,
      runesRequired: ['FROST', 'UNHOLY'],
      targetType: 'SINGLE_ENEMY',
      school: 'SHADOW',
      spec: 'BLOOD_TANK',
      effects: [
        {
          type: 'PHYSICAL_DAMAGE',
          baseValue: 4200,
          description: '对目标造成物理伤害',
        },
        {
          type: 'HEAL',
          // 自疗量 = max_hp × 7%（由Calculator根据施法者max_hp计算）
          baseValue: 0.07,
          description: '自疗 max_hp×7%',
        },
        {
          type: 'SHIELD',
          // 鲜血护盾吸收量 = max_hp × 8%
          baseValue: 0.08,
          durationMs: 10_000,
          auraId: 'blood_shield',
          description: '生成鲜血护盾（吸收=max_hp×8%，持续10s）',
        },
      ],
    },

    {
      id: 'dk_heart_strike',
      name: '心脏打击',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'BLOOD_RUNE',
      resourceCostAmount: 1,
      runesRequired: ['BLOOD'],
      targetType: 'AOE_ENEMY',
      school: 'PHYSICAL',
      spec: 'BLOOD_TANK',
      effects: [
        {
          type: 'PHYSICAL_DAMAGE',
          baseValue: 5500,
          description: '高仇恨物理AOE顺劈（对主目标+周围敌人）',
        },
      ],
    },

    {
      id: 'dk_dnd',
      name: '枯萎凋零',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 30_000,
      resourceCost: 'BLOOD_RUNE',
      resourceCostAmount: 1,
      runesRequired: ['BLOOD'],
      targetType: 'GROUND',
      school: 'SHADOW',
      spec: 'BLOOD_TANK',
      effects: [
        {
          type: 'GROUND_EFFECT',
          groundKind: 'DAMAGE_ZONE',
          groundColorHex: '#8B0000',
          groundRadius: 8,
          durationMs: 10_000,
          tickIntervalMs: 2_000,
          baseValue: 1800,
          description: '在地面放置暗红法阵（DmgZone，10s，每2s造成暗影伤害）',
        },
      ],
    },

    {
      id: 'dk_rune_strike',
      name: '符文打击',
      castTimeMs: 0,
      gcdType: 'off',
      gcdCategory: 'OFF_GCD',
      cooldownMs: 0,
      resourceCost: 'RUNIC_POWER',
      resourceCostAmount: 20,
      targetType: 'SINGLE_ENEMY',
      school: 'PHYSICAL',
      spec: 'BLOOD_TANK',
      effects: [
        {
          type: 'PHYSICAL_DAMAGE',
          baseValue: 7200,
          description: '高仇恨物理单体（泄符文能量，脱离GCD）',
        },
      ],
    },

    {
      id: 'dk_outbreak',
      name: '爆发',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 60_000,
      resourceCost: 'UNHOLY_RUNE',
      resourceCostAmount: 1,
      runesRequired: ['UNHOLY'],
      targetType: 'SINGLE_ENEMY',
      school: 'SHADOW',
      spec: 'BLOOD_TANK',
      effects: [
        {
          type: 'DOT',
          auraId: 'blood_plague',
          baseValue: 2200,
          durationMs: 21_000,
          tickIntervalMs: 3_000,
          description: '血之疫病：暗影DoT，持续21s，每3s跳一次（80级满级标定）',
        },
        {
          type: 'DOT',
          auraId: 'frost_fever',
          baseValue: 2200,
          durationMs: 21_000,
          tickIntervalMs: 3_000,
          description: '冰霜疫病：冰霜DoT，持续21s，每3s跳一次（80级满级标定）',
        },
        {
          type: 'DEBUFF',
          auraId: 'outbreak_slow',
          durationMs: 30_000,
          description: '双疾病附带攻速降低10%，持续30s',
        },
      ],
    },

    {
      id: 'dk_bone_shield',
      name: '白骨之盾',
      castTimeMs: 0,
      gcdType: 'off',
      gcdCategory: 'OFF_GCD',
      cooldownMs: 60_000,
      resourceCost: 'NONE',
      resourceCostAmount: 0,
      targetType: 'SELF',
      school: 'SHADOW',
      spec: 'BLOOD_TANK',
      effects: [
        {
          type: 'BUFF',
          auraId: 'bone_shield',
          maxStacks: 6,
          description: '6层减伤20% buff（每层被击消耗一层）',
        },
      ],
    },

    {
      id: 'dk_vampiric_blood',
      name: '吸血鬼之血',
      castTimeMs: 0,
      gcdType: 'off',
      gcdCategory: 'OFF_GCD',
      cooldownMs: 60_000,
      resourceCost: 'NONE',
      resourceCostAmount: 0,
      targetType: 'SELF',
      school: 'SHADOW',
      spec: 'BLOOD_TANK',
      effects: [
        {
          type: 'BUFF',
          auraId: 'vampiric_blood',
          durationMs: 10_000,
          description: '+15%最大血量，+25%受疗效果，持续10s，CD 60s（不进GCD）',
        },
      ],
    },

    {
      id: 'dk_icebound_fortitude',
      name: '冰封之韧',
      castTimeMs: 0,
      gcdType: 'off',
      gcdCategory: 'OFF_GCD',
      cooldownMs: 180_000,
      resourceCost: 'NONE',
      resourceCostAmount: 0,
      targetType: 'SELF',
      school: 'FROST',
      spec: 'BLOOD_TANK',
      effects: [
        {
          type: 'BUFF',
          auraId: 'icebound_fortitude',
          durationMs: 12_000,
          description: '50%减伤并免疫昏迷，持续12s，CD 180s（不进GCD）',
        },
      ],
    },

    {
      id: 'dk_anti_magic_shell',
      name: '反魔法护罩',
      castTimeMs: 0,
      gcdType: 'off',
      gcdCategory: 'OFF_GCD',
      cooldownMs: 45_000,
      resourceCost: 'NONE',
      resourceCostAmount: 0,
      targetType: 'SELF',
      school: 'SHADOW',
      spec: 'BLOOD_TANK',
      effects: [
        {
          type: 'SHIELD',
          auraId: 'anti_magic_shell',
          durationMs: 5_000,
          description: '吸收75%魔法伤害持续5s并转化为符文能量，CD 45s（不进GCD）',
        },
      ],
    },

    {
      id: 'dk_blood_boil',
      name: '血液沸腾',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'BLOOD_RUNE',
      resourceCostAmount: 1,
      runesRequired: ['BLOOD'],
      targetType: 'AOE_ENEMY',
      school: 'SHADOW',
      spec: 'BLOOD_TANK',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 6400,
          description: '使周围所有敌人血液沸腾，造成高仇恨群体暗影伤害',
        },
      ],
    },

    {
      id: 'dk_dark_command',
      name: '黑暗命令',
      castTimeMs: 0,
      gcdType: 'off',
      gcdCategory: 'OFF_GCD',
      cooldownMs: 8_000,
      resourceCost: 'NONE',
      resourceCostAmount: 0,
      targetType: 'SINGLE_ENEMY',
      school: 'SHADOW',
      spec: 'BLOOD_TANK',
      effects: [
        {
          type: 'TAUNT',
          description: '嘲讽：仇恨成为首位×110%，CD 8s',
        },
      ],
    },

    {
      id: 'dk_mind_freeze',
      name: '心灵冰冻',
      castTimeMs: 0,
      gcdType: 'off',
      gcdCategory: 'OFF_GCD',
      cooldownMs: 10_000,
      resourceCost: 'NONE',
      resourceCostAmount: 0,
      targetType: 'SINGLE_ENEMY',
      school: 'FROST',
      effects: [
        {
          type: 'INTERRUPT',
          description: '打断施法，CD 10s',
        },
      ],
    },

    {
      id: 'dk_horn_of_winter',
      name: '寒冬号角',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 20_000,
      resourceCost: 'NONE',
      resourceCostAmount: 0,
      targetType: 'AOE_ALLY',
      school: 'PHYSICAL',
      isRaidBuff: true,
      effects: [
        {
          type: 'BUFF',
          auraId: 'horn_of_winter',
          durationMs: 3_600_000, // 1小时
          description: '全团力量+敏捷10% Buff，持续1h（长效Buff）',
        },
      ],
    },

    // ── 冰霜DPS技能 ──────────────────────────

    {
      id: 'dk_obliterate',
      name: '湮没',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'FROST_RUNE',
      resourceCostAmount: 1,
      runesRequired: ['FROST', 'UNHOLY'],
      targetType: 'SINGLE_ENEMY',
      school: 'PHYSICAL',
      spec: 'FROST_DPS',
      effects: [
        {
          type: 'PHYSICAL_DAMAGE',
          baseValue: 9500,
          description: '高伤害物理攻击，消耗1冰符文',
        },
      ],
    },

    {
      id: 'dk_frost_strike',
      name: '冰霜打击',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'RUNIC_POWER',
      resourceCostAmount: 40,
      targetType: 'SINGLE_ENEMY',
      school: 'FROST',
      spec: 'FROST_DPS',
      effects: [
        {
          type: 'PHYSICAL_DAMAGE',
          baseValue: 6800,
          description: '消耗符文能量的冰霜物理攻击',
        },
      ],
    },

    {
      id: 'dk_howling_blast',
      name: '凛风冲击',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'FROST_RUNE',
      resourceCostAmount: 1,
      runesRequired: ['FROST'],
      targetType: 'AOE_ENEMY',
      school: 'FROST',
      spec: 'FROST_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 8200,
          description: '冰霜AOE爆发，消耗1枚冰霜符文对周围所有敌人造成冰霜伤害',
        },
      ],
    },

    {
      id: 'dk_pillar_of_frost',
      name: '冰霜之柱',
      castTimeMs: 0,
      gcdType: 'off',
      gcdCategory: 'OFF_GCD',
      cooldownMs: 60_000,
      resourceCost: 'RUNIC_POWER',
      resourceCostAmount: 20,
      targetType: 'SELF',
      school: 'FROST',
      spec: 'FROST_DPS',
      effects: [
        {
          type: 'BUFF',
          auraId: 'pillar_of_frost',
          durationMs: 20_000,
          description: '提升力量20%，持续20s，CD 60s；本身也是高单体爆发窗口',
        },
        {
          type: 'PHYSICAL_DAMAGE',
          baseValue: 7500,
          description: '冰霜之柱激活时单体高伤',
        },
      ],
    },

    // ── 邪恶DPS技能 ──────────────────────────

    {
      id: 'dk_scourge_strike',
      name: '天灾打击',
      castTimeMs: 0,
      gcdType: 'rogue',
      gcdCategory: 'ROGUE',
      cooldownMs: 0,
      resourceCost: 'UNHOLY_RUNE',
      resourceCostAmount: 1,
      runesRequired: ['UNHOLY'],
      targetType: 'SINGLE_ENEMY',
      school: 'PHYSICAL',
      spec: 'UNHOLY_DPS',
      effects: [
        {
          type: 'PHYSICAL_DAMAGE',
          baseValue: 8800,
          description: '强力的邪恶打击（邪恶灵气1.0s GCD），造成物理与暗影双重伤害',
        },
        {
          type: 'SPELL_DAMAGE',
          baseValue: 4400,
          description: '附加暗影天灾打击伤害，受目标身上疾病数量加成',
        },
      ],
    },

    {
      id: 'dk_festering_strike',
      name: '脓疮打击',
      castTimeMs: 0,
      gcdType: 'rogue',
      gcdCategory: 'ROGUE',
      cooldownMs: 0,
      resourceCost: 'BLOOD_RUNE',
      resourceCostAmount: 1,
      runesRequired: ['BLOOD', 'FROST'],
      targetType: 'SINGLE_ENEMY',
      school: 'PHYSICAL',
      spec: 'UNHOLY_DPS',
      effects: [
        {
          type: 'PHYSICAL_DAMAGE',
          baseValue: 9200,
          description: '造成高额物理伤害并延长双病持续时间6秒',
        },
        {
          type: 'BUFF',
          auraId: 'festering_disease_extend',
          durationMs: 6_000,
          description: '使目标身上的冰霜疫病与血之疫病持续时间延长6秒',
        },
      ],
    },

    {
      id: 'dk_death_coil',
      name: '凋零缠绕',
      castTimeMs: 0,
      gcdType: 'rogue',
      gcdCategory: 'ROGUE',
      cooldownMs: 0,
      resourceCost: 'RUNIC_POWER',
      resourceCostAmount: 40,
      targetType: 'SINGLE_ENEMY',
      school: 'SHADOW',
      spec: 'UNHOLY_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 7600,
          description: '消耗符文能量发射暗影死亡之火，叠加暗影灌注',
        },
        {
          type: 'BUFF',
          auraId: 'shadow_infusion',
          maxStacks: 5,
          durationMs: 30_000,
          description: '为食尸鬼注入暗影力量叠加暗影灌注（最高5层）',
        },
      ],
    },

    {
      id: 'dk_dark_transformation',
      name: '黑暗突变',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'UNHOLY_RUNE',
      resourceCostAmount: 1,
      runesRequired: ['UNHOLY'],
      targetType: 'SELF',
      school: 'SHADOW',
      spec: 'UNHOLY_DPS',
      effects: [
        {
          type: 'BUFF',
          auraId: 'dark_transformation',
          durationMs: 30_000,
          description: '消耗5层暗影灌注，强化食尸鬼为狂暴巨怪，造成伤害提升100%，持续30s',
        },
      ],
    },

    {
      id: 'dk_summon_gargoyle',
      name: '召唤石像鬼',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 180_000,
      resourceCost: 'RUNIC_POWER',
      resourceCostAmount: 60,
      targetType: 'SINGLE_ENEMY',
      school: 'SHADOW',
      spec: 'UNHOLY_DPS',
      effects: [
        {
          type: 'BUFF',
          auraId: 'summon_gargoyle',
          durationMs: 30_000,
          description: '召唤一只黑锋石像鬼飞入战场轰炸目标，持续30秒',
        },
        {
          type: 'SPELL_DAMAGE',
          baseValue: 3500,
          tickIntervalMs: 2_000,
          durationMs: 30_000,
          description: '石像鬼连续俯冲轰炸（总伤害约52,500）',
        },
      ],
    },

    {
      id: 'dk_army_of_the_dead',
      name: '亡者大军',
      castTimeMs: -1,
      channelDurationMs: 4_000,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 600_000,
      resourceCost: 'UNHOLY_RUNE',
      resourceCostAmount: 1,
      runesRequired: ['BLOOD', 'FROST', 'UNHOLY'],
      targetType: 'AOE_ENEMY',
      school: 'SHADOW',
      spec: 'UNHOLY_DPS',
      effects: [
        {
          type: 'BUFF',
          auraId: 'army_of_the_dead_channel',
          durationMs: 4_000,
          description: '引导施法4秒，期间受到所有伤害降低30%',
        },
        {
          type: 'PHYSICAL_DAMAGE',
          baseValue: 12000,
          durationMs: 40_000,
          tickIntervalMs: 2_000,
          description: '召唤大量食尸鬼围攻敌人（总输出约80,000）',
        },
      ],
    },
  ],
};
