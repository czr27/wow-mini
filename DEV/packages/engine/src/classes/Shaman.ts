/**
 * [C-03] Shaman.ts
 * 萨满祭司 — 恢复（团刷/辅助） / 元素（远程 DPS）
 * 资源：法力值
 */

import type { ClassSpec, Spell } from './DeathKnight';

export type { ClassSpec, Spell };

// ─────────────────────────────────────────────
//  萨满祭司技能表
// ─────────────────────────────────────────────

export const SHAMAN: ClassSpec = {
  classId: 'SHAMAN',
  className: '萨满祭司',
  classColor: '#0070DE',
  spells: [
    // ── 恢复治疗技能 ──────────────────────────

    {
      id: 'shaman_riptide',
      name: '激流',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 6_000,
      resourceCost: 'MANA',
      resourceCostAmount: 1600,
      targetType: 'SINGLE_ALLY',
      school: 'NATURE',
      spec: 'RESTO_HEAL',
      effects: [
        {
          type: 'HEAL',
          baseValue: 9000,
          description: '瞬发治疗',
        },
        {
          type: 'HOT',
          auraId: 'riptide_hot',
          baseValue: 1200,
          durationMs: 15_000,
          tickIntervalMs: 3_000,
          description: '附加15s HoT，每3s跳一次；CD 6s',
        },
      ],
    },

    {
      id: 'shaman_healing_wave',
      name: '治疗波',
      castTimeMs: 2_500,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 1800,
      targetType: 'SINGLE_ALLY',
      school: 'NATURE',
      spec: 'RESTO_HEAL',
      effects: [
        {
          type: 'HEAL',
          baseValue: 12000,
          description: '平稳高效读条单体治疗（2.5s）',
        },
      ],
    },

    {
      id: 'shaman_greater_healing_wave',
      name: '强效治疗波',
      castTimeMs: 2_500,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 3000,
      targetType: 'SINGLE_ALLY',
      school: 'NATURE',
      spec: 'RESTO_HEAL',
      effects: [
        {
          type: 'HEAL',
          baseValue: 22000,
          description: '慢速读条大量单体治疗（2.5s，量大）',
        },
      ],
    },

    {
      id: 'shaman_healing_surge',
      name: '治疗之涌',
      castTimeMs: 1_500,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 2500,
      targetType: 'SINGLE_ALLY',
      school: 'NATURE',
      spec: 'RESTO_HEAL',
      effects: [
        {
          type: 'HEAL',
          baseValue: 20000,
          description: '快速读条单体应急治疗（1.5s），无CD',
        },
      ],
    },

    {
      id: 'shaman_chain_heal',
      name: '治疗链',
      castTimeMs: 2_000,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 2200,
      targetType: 'SMART_ALLY',
      school: 'NATURE',
      spec: 'RESTO_HEAL',
      effects: [
        {
          type: 'HEAL',
          baseValue: 11000,
          description: '弹跳群疗：主目标治疗后智能弹跳最多5个友方目标（每次弹跳衰减30%）',
        },
      ],
    },

    {
      id: 'shaman_healing_rain',
      name: '治疗之雨',
      castTimeMs: 2_000,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 10_000,
      resourceCost: 'MANA',
      resourceCostAmount: 2800,
      targetType: 'GROUND',
      school: 'NATURE',
      spec: 'RESTO_HEAL',
      effects: [
        {
          type: 'GROUND_EFFECT',
          groundKind: 'HEAL_ZONE',
          groundColorHex: '#56CCF2',
          groundRadius: 8,
          durationMs: 10_000,
          tickIntervalMs: 2_000,
          baseValue: 3500,
          description: '在地面放置水蓝光阵（HEAL_ZONE，10s，每2s治疗范围内所有友方）',
        },
      ],
    },

    {
      id: 'shaman_spirit_link_totem',
      name: '灵魂链接图腾',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 180_000,
      resourceCost: 'MANA',
      resourceCostAmount: 1200,
      targetType: 'GROUND',
      school: 'NATURE',
      spec: 'RESTO_HEAL',
      effects: [
        {
          type: 'GROUND_EFFECT',
          groundKind: 'TOTEM',
          groundColorHex: '#6FCF97',
          groundRadius: 10,
          durationMs: 6_000,
          description: '灵魂链接图腾：持续6s，全团血量均摊（瞬间拉平血量差值）+10%减伤',
        },
      ],
    },

    {
      id: 'shaman_mana_tide_totem',
      name: '法力之潮图腾',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 180_000,
      resourceCost: 'MANA',
      resourceCostAmount: 800,
      targetType: 'GROUND',
      school: 'NATURE',
      spec: 'RESTO_HEAL',
      effects: [
        {
          type: 'GROUND_EFFECT',
          groundKind: 'TOTEM',
          groundColorHex: '#56CCF2',
          groundRadius: 15,
          durationMs: 12_000,
          tickIntervalMs: 5_000,
          description: '法力之潮图腾：持续12s，全团每5s回蓝（总回蓝约为施法者最大法力的25%）',
        },
      ],
    },

    {
      id: 'shaman_windfury_totem',
      name: '风怒图腾',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 500,
      targetType: 'GROUND',
      school: 'NATURE',
      isRaidBuff: true,
      effects: [
        {
          type: 'GROUND_EFFECT',
          groundKind: 'TOTEM',
          groundColorHex: '#E0E0E0',
          groundRadius: 20,
          durationMs: 120_000, // 2分钟
          description: '风怒图腾：持续2min，范围内近战攻速+16%（近战急速Buff）',
        },
      ],
    },

    {
      id: 'shaman_heroism',
      name: '嗜血',
      castTimeMs: 0,
      gcdType: 'off',
      gcdCategory: 'OFF_GCD',
      cooldownMs: 300_000, // 5分钟
      resourceCost: 'MANA',
      resourceCostAmount: 1000,
      targetType: 'AOE_ALLY',
      school: 'NATURE',
      spec: 'RESTO_HEAL',
      effects: [
        {
          type: 'BUFF',
          auraId: 'heroism',
          durationMs: 40_000,
          description: '全团30%急速，持续40s；之后施加"疲惫"（Exhaustion，10min内不可再嗜血），CD 10min',
        },
      ],
    },

    {
      id: 'shaman_wind_shear',
      name: '风剪',
      castTimeMs: 0,
      gcdType: 'off',
      gcdCategory: 'OFF_GCD',
      cooldownMs: 6_000,
      resourceCost: 'NONE',
      resourceCostAmount: 0,
      targetType: 'SINGLE_ENEMY',
      school: 'NATURE',
      effects: [
        {
          type: 'INTERRUPT',
          description: '远程打断施法，CD 6s',
        },
      ],
    },

    {
      id: 'shaman_cleanse_spirit',
      name: '净化灵魂',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 8_000,
      resourceCost: 'MANA',
      resourceCostAmount: 800,
      targetType: 'SINGLE_ALLY',
      school: 'NATURE',
      spec: 'RESTO_HEAL',
      effects: [
        {
          type: 'DISPEL',
          description: '驱散诅咒/疾病，CD 8s',
        },
      ],
    },

    {
      id: 'shaman_ancestral_spirit',
      name: '先祖之魂',
      castTimeMs: 3_000,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 600_000,
      resourceCost: 'MANA',
      resourceCostAmount: 2400,
      targetType: 'SINGLE_ALLY',
      school: 'NATURE',
      spec: 'RESTO_HEAL',
      travelOnly: true,
      effects: [
        {
          type: 'RESURRECT',
          description: '非战斗复活，读条3s，只能在TRAVEL_RECOVERY阶段使用',
        },
      ],
    },

    // ── 元素DPS技能 ──────────────────────────

    {
      id: 'shaman_lightning_bolt',
      name: '闪电箭',
      castTimeMs: 2_000,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 1400,
      targetType: 'SINGLE_ENEMY',
      school: 'NATURE',
      spec: 'ELEMENTAL_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 8500,
          description: '自然系直伤法术（主力输出技能）',
        },
      ],
    },

    {
      id: 'shaman_flame_shock',
      name: '烈焰震击',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 6_000,
      resourceCost: 'MANA',
      resourceCostAmount: 1200,
      targetType: 'SINGLE_ENEMY',
      school: 'FIRE',
      spec: 'ELEMENTAL_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 3000,
          description: '火焰直伤部分',
        },
        {
          type: 'DOT',
          auraId: 'flame_shock_dot',
          baseValue: 1800,
          durationMs: 18_000,
          tickIntervalMs: 3_000,
          description: '火焰DoT，持续18s，每3s跳一次',
        },
      ],
    },

    {
      id: 'shaman_lava_burst',
      name: '熔岩爆裂',
      castTimeMs: 2_000,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 8_000,
      resourceCost: 'MANA',
      resourceCostAmount: 1600,
      targetType: 'SINGLE_ENEMY',
      school: 'FIRE',
      spec: 'ELEMENTAL_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 14000,
          description: '火焰爆发直伤（有烈焰震击DoT时必然暴击），CD 8s',
        },
        {
          type: 'DOT',
          auraId: 'lava_burst_dot',
          baseValue: 600,
          durationMs: 4_000,
          tickIntervalMs: 2_000,
          description: '附加短暂火焰DoT（2次跳字）',
        },
      ],
    },

    // ── 增强DPS技能 ──────────────────────────

    {
      id: 'shaman_stormstrike',
      name: '风暴打击',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 8_000,
      resourceCost: 'MANA',
      resourceCostAmount: 1600,
      targetType: 'SINGLE_ENEMY',
      school: 'PHYSICAL',
      spec: 'ENHANCEMENT_DPS',
      effects: [
        {
          type: 'PHYSICAL_DAMAGE',
          baseValue: 10500,
          description: '双持双手武器强力打击，造成高额物理伤害',
        },
        {
          type: 'DEBUFF',
          auraId: 'stormstrike_debuff',
          durationMs: 15_000,
          description: '使目标受到施法者的自然法术爆击几率提高25%，持续15秒',
        },
      ],
    },

    {
      id: 'shaman_lava_lash',
      name: '熔岩猛击',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 10_000,
      resourceCost: 'MANA',
      resourceCostAmount: 1200,
      targetType: 'SINGLE_ENEMY',
      school: 'FIRE',
      spec: 'ENHANCEMENT_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 12000,
          description: '副手火舌附魔重击，造成巨额火焰伤害并扩散烈焰震击',
        },
      ],
    },

    {
      id: 'shaman_feral_spirit',
      name: '野性狼魂',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 120_000,
      resourceCost: 'MANA',
      resourceCostAmount: 1800,
      targetType: 'SELF',
      school: 'PHYSICAL',
      spec: 'ENHANCEMENT_DPS',
      effects: [
        {
          type: 'BUFF',
          auraId: 'feral_spirit',
          durationMs: 30_000,
          description: '召唤两只幽魂之狼协助作战，攻击敌人并为萨满祭司提供治疗，持续30秒',
        },
        {
          type: 'PHYSICAL_DAMAGE',
          baseValue: 18000,
          description: '幽魂狼扑咬爆发伤害',
        },
      ],
    },

    {
      id: 'shaman_shamanistic_rage',
      name: '萨满之怒',
      castTimeMs: 0,
      gcdType: 'off',            // 紧急脱离GCD减伤与回蓝
      gcdCategory: 'OFF_GCD',
      cooldownMs: 60_000,
      resourceCost: 'NONE',
      resourceCostAmount: 0,
      targetType: 'SELF',
      school: 'PHYSICAL',
      spec: 'ENHANCEMENT_DPS',
      effects: [
        {
          type: 'BUFF',
          auraId: 'shamanistic_rage',
          durationMs: 15_000,
          description: '受到的所有伤害降低30%，持续15秒，脱离GCD',
        },
        {
          type: 'RESOURCE_RESTORE',
          baseValue: 6000,
          description: '大幅恢复法力值',
        },
      ],
    },

    {
      id: 'shaman_unleash_elements',
      name: '元素释放',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 15_000,
      resourceCost: 'MANA',
      resourceCostAmount: 1400,
      targetType: 'SINGLE_ENEMY',
      school: 'FIRE',
      spec: 'ENHANCEMENT_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 6500,
          description: '释放风怒与火舌附魔之力，造成火焰伤害',
        },
        {
          type: 'BUFF',
          auraId: 'unleash_wind_flame',
          durationMs: 8_000,
          description: '近战攻速提升40%，下一个火焰法术伤害提高30%，持续8秒',
        },
      ],
    },
  ],
};
