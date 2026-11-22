/**
 * [C-05] Rogue.ts
 * 潜行者 — 战斗 / 刺杀（近战 DPS）
 * 资源：能量（100上限，每秒回10点，受急速加成）+ 5星连击点
 */

import type { ClassSpec, Spell } from './DeathKnight';

export type { ClassSpec, Spell };

// ─────────────────────────────────────────────
//  潜行者技能表
// ─────────────────────────────────────────────

export const ROGUE: ClassSpec = {
  classId: 'ROGUE',
  className: '潜行者',
  classColor: '#FFF569',
  spells: [
    // ── 核心输出技能 ──────────────────────────

    {
      id: 'rogue_sinister_strike',
      name: '影袭',
      castTimeMs: 0,
      gcdType: 'rogue',          // 盗贼GCD 1.0s
      gcdCategory: 'ROGUE',
      cooldownMs: 0,
      resourceCost: 'ENERGY',
      resourceCostAmount: 40,
      targetType: 'SINGLE_ENEMY',
      school: 'PHYSICAL',
      spec: 'COMBAT_DPS',
      effects: [
        {
          type: 'PHYSICAL_DAMAGE',
          baseValue: 5500,
          description: '消耗40能量，直伤+生成1连击点',
        },
        {
          type: 'BUFF',
          auraId: 'combo_point_add_1',
          description: '生成1连击点（由ResourceManager处理）',
        },
      ],
    },

    {
      id: 'rogue_slice_and_dice',
      name: '切割',
      castTimeMs: 0,
      gcdType: 'rogue',
      gcdCategory: 'ROGUE',
      cooldownMs: 0,
      resourceCost: 'COMBO_POINT',
      resourceCostAmount: 3,     // 消耗3+连击点（实际消耗全部）
      targetType: 'SELF',
      school: 'PHYSICAL',
      effects: [
        {
          type: 'BUFF',
          auraId: 'slice_and_dice',
          durationMs: 20_000,
          description: '终结技：消耗3+连击点，附加40%攻速buff持续20s（连击点越多持续越久）',
        },
      ],
    },

    {
      id: 'rogue_eviscerate',
      name: '刺骨',
      castTimeMs: 0,
      gcdType: 'rogue',
      gcdCategory: 'ROGUE',
      cooldownMs: 0,
      resourceCost: 'COMBO_POINT',
      resourceCostAmount: 3,     // 消耗3+连击点
      targetType: 'SINGLE_ENEMY',
      school: 'PHYSICAL',
      effects: [
        {
          type: 'PHYSICAL_DAMAGE',
          baseValue: 18000,
          description: '终结技：消耗3+连击点，高爆发直伤（连击点越多伤害越高）',
        },
      ],
    },

    {
      id: 'rogue_kidney_shot',
      name: '脚踢',
      castTimeMs: 0,
      gcdType: 'off',            // 打断脱离GCD
      gcdCategory: 'OFF_GCD',
      cooldownMs: 10_000,
      resourceCost: 'ENERGY',
      resourceCostAmount: 25,
      targetType: 'SINGLE_ENEMY',
      school: 'PHYSICAL',
      effects: [
        {
          type: 'INTERRUPT',
          description: '打断施法，消耗25能量，CD 10s',
        },
      ],
    },

    {
      id: 'rogue_adrenaline_rush',
      name: '冲动',
      castTimeMs: 0,
      gcdType: 'off',
      gcdCategory: 'OFF_GCD',
      cooldownMs: 120_000,       // 2分钟
      resourceCost: 'NONE',
      resourceCostAmount: 0,
      targetType: 'SELF',
      school: 'PHYSICAL',
      spec: 'COMBAT_DPS',
      effects: [
        {
          type: 'BUFF',
          auraId: 'adrenaline_rush',
          durationMs: 15_000,
          description: '能量回复速率翻倍（+10/s变为+20/s），持续15s，CD 2min',
        },
      ],
    },

    {
      id: 'rogue_blade_flurry',
      name: '剑刃乱舞',
      castTimeMs: 0,
      gcdType: 'rogue',
      gcdCategory: 'ROGUE',
      cooldownMs: 10_000,
      resourceCost: 'ENERGY',
      resourceCostAmount: 25,
      targetType: 'AOE_ENEMY',
      school: 'PHYSICAL',
      spec: 'COMBAT_DPS',
      effects: [
        {
          type: 'PHYSICAL_DAMAGE',
          baseValue: 4000,
          description: 'AOE顺劈：消耗25能量，对周围所有敌人造成物理伤害，CD 10s',
        },
      ],
    },

    {
      id: 'rogue_evasion',
      name: '佯攻',
      castTimeMs: 0,
      gcdType: 'off',
      gcdCategory: 'OFF_GCD',
      cooldownMs: 0,
      resourceCost: 'ENERGY',
      resourceCostAmount: 20,
      targetType: 'SELF',
      school: 'PHYSICAL',
      effects: [
        {
          type: 'BUFF',
          auraId: 'evasion',
          durationMs: 5_000,
          description: '自身AOE减伤50%，持续5s，消耗20能量，无冷却（应对首领高额AOE核心减伤）',
        },
      ],
    },

    {
      id: 'rogue_cloak_of_shadows',
      name: '暗影斗篷',
      castTimeMs: 0,
      gcdType: 'off',
      gcdCategory: 'OFF_GCD',
      cooldownMs: 120_000,
      resourceCost: 'NONE',
      resourceCostAmount: 0,
      targetType: 'SELF',
      school: 'SHADOW',
      effects: [
        {
          type: 'BUFF',
          auraId: 'cloak_of_shadows',
          durationMs: 5_000,
          description: '5s魔法免疫（清除所有有害魔法效果），CD 2min',
        },
      ],
    },

    // ── 刺杀DPS ──────────────────────────────

    {
      id: 'rogue_mutilate',
      name: '毁伤',
      castTimeMs: 0,
      gcdType: 'rogue',
      gcdCategory: 'ROGUE',
      cooldownMs: 0,
      resourceCost: 'ENERGY',
      resourceCostAmount: 60,
      targetType: 'SINGLE_ENEMY',
      school: 'PHYSICAL',
      spec: 'ASSASSINATION_DPS',
      effects: [
        {
          type: 'PHYSICAL_DAMAGE',
          baseValue: 9000,
          description: '同时用双持武器攻击目标，造成物理伤害并奖励2个连击点数，消耗60点能量',
        },
        {
          type: 'BUFF',
          auraId: 'combo_point_add_2',
          description: '生成2连击点（由ResourceManager处理）',
        },
      ],
    },

    {
      id: 'rogue_envenom',
      name: '毒化',
      castTimeMs: 0,
      gcdType: 'rogue',
      gcdCategory: 'ROGUE',
      cooldownMs: 0,
      resourceCost: 'COMBO_POINT',
      resourceCostAmount: 3,
      targetType: 'SINGLE_ENEMY',
      school: 'NATURE',
      spec: 'ASSASSINATION_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 16000,
          description: '终结技：消耗连击点数对目标造成直接自然伤害，并使毒药生效几率提高15%，重置切割持续时间',
        },
        {
          type: 'BUFF',
          auraId: 'envenom_buff',
          durationMs: 6_000,
          description: '提升毒药施加几率15%，持续6s',
        },
      ],
    },

    {
      id: 'rogue_rupture',
      name: '割裂',
      castTimeMs: 0,
      gcdType: 'rogue',
      gcdCategory: 'ROGUE',
      cooldownMs: 0,
      resourceCost: 'COMBO_POINT',
      resourceCostAmount: 3,
      targetType: 'SINGLE_ENEMY',
      school: 'PHYSICAL',
      spec: 'ASSASSINATION_DPS',
      effects: [
        {
          type: 'DOT',
          auraId: 'rupture_dot',
          baseValue: 2200,
          durationMs: 16_000,
          tickIntervalMs: 2_000,
          description: '终结技：给目标施加流血伤害，持续16秒，每2秒造成一次物理流血伤害',
        },
      ],
    },

    {
      id: 'rogue_vendetta',
      name: '宿敌',
      castTimeMs: 0,
      gcdType: 'off',
      gcdCategory: 'OFF_GCD',
      cooldownMs: 120_000,
      resourceCost: 'NONE',
      resourceCostAmount: 0,
      targetType: 'SINGLE_ENEMY',
      school: 'PHYSICAL',
      spec: 'ASSASSINATION_DPS',
      effects: [
        {
          type: 'DEBUFF',
          auraId: 'vendetta_debuff',
          durationMs: 30_000,
          description: '将目标标记为仇敌，使你对其造成的伤害提高20%，持续30秒，脱离GCD，CD 2min',
        },
      ],
    },

    // ── 敏锐DPS ──────────────────────────────

    {
      id: 'rogue_shadow_dance',
      name: '暗影之舞',
      castTimeMs: 0,
      gcdType: 'off',
      gcdCategory: 'OFF_GCD',
      cooldownMs: 60_000,
      resourceCost: 'NONE',
      resourceCostAmount: 0,
      targetType: 'SELF',
      school: 'SHADOW',
      spec: 'SUBTLETY_DPS',
      effects: [
        {
          type: 'BUFF',
          auraId: 'shadow_dance',
          durationMs: 8_000,
          description: '激活暗影之舞，持续8秒，期间可直接施放伏击等潜行限定技能，脱离GCD，CD 60s',
        },
      ],
    },

    {
      id: 'rogue_backstab',
      name: '背刺',
      castTimeMs: 0,
      gcdType: 'rogue',
      gcdCategory: 'ROGUE',
      cooldownMs: 0,
      resourceCost: 'ENERGY',
      resourceCostAmount: 40,
      targetType: 'SINGLE_ENEMY',
      school: 'PHYSICAL',
      spec: 'SUBTLETY_DPS',
      effects: [
        {
          type: 'PHYSICAL_DAMAGE',
          baseValue: 8500,
          description: '背刺目标，造成高额物理伤害并奖励1个连击点数，消耗40点能量',
        },
        {
          type: 'BUFF',
          auraId: 'combo_point_add_1',
          description: '生成1连击点',
        },
      ],
    },

    {
      id: 'rogue_ambush',
      name: '伏击',
      castTimeMs: 0,
      gcdType: 'rogue',
      gcdCategory: 'ROGUE',
      cooldownMs: 0,
      resourceCost: 'ENERGY',
      resourceCostAmount: 60,
      targetType: 'SINGLE_ENEMY',
      school: 'PHYSICAL',
      spec: 'SUBTLETY_DPS',
      effects: [
        {
          type: 'PHYSICAL_DAMAGE',
          baseValue: 15000,
          description: '伏击目标，造成巨额物理伤害并奖励2个连击点数，潜行或暗影之舞期间可用，消耗60点能量',
        },
        {
          type: 'BUFF',
          auraId: 'combo_point_add_2',
          description: '生成2连击点',
        },
      ],
    },

    {
      id: 'rogue_premeditation',
      name: '预谋',
      castTimeMs: 0,
      gcdType: 'off',
      gcdCategory: 'OFF_GCD',
      cooldownMs: 20_000,
      resourceCost: 'NONE',
      resourceCostAmount: 0,
      targetType: 'SINGLE_ENEMY',
      school: 'SHADOW',
      spec: 'SUBTLETY_DPS',
      effects: [
        {
          type: 'BUFF',
          auraId: 'combo_point_add_2',
          description: '立即为目标增加2个连击点数，潜行或暗影之舞时可用，脱离GCD，CD 20s',
        },
      ],
    },

    {
      id: 'rogue_shadowstep',
      name: '暗影步',
      castTimeMs: 0,
      gcdType: 'off',
      gcdCategory: 'OFF_GCD',
      cooldownMs: 24_000,
      resourceCost: 'NONE',
      resourceCostAmount: 0,
      targetType: 'SINGLE_ENEMY',
      school: 'SHADOW',
      spec: 'SUBTLETY_DPS',
      effects: [
        {
          type: 'BUFF',
          auraId: 'shadowstep_buff',
          durationMs: 10_000,
          description: '踏入暗影瞬移至目标背后，使你下一次技能伤害提高25%，脱离GCD，CD 24s',
        },
      ],
    },

    {
      id: 'rogue_preparation',
      name: '伺机待发',
      castTimeMs: 0,
      gcdType: 'off',
      gcdCategory: 'OFF_GCD',
      cooldownMs: 300_000,
      resourceCost: 'NONE',
      resourceCostAmount: 0,
      targetType: 'SELF',
      school: 'PHYSICAL',
      spec: 'SUBTLETY_DPS',
      effects: [
        {
          type: 'BUFF',
          auraId: 'preparation_reset',
          description: '立即重置疾跑、消失、暗影步等技能的冷却时间，脱离GCD，CD 5min',
        },
      ],
    },
  ],
};
