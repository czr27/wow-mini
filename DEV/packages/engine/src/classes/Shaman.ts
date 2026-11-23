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
      resourceCostAmount: 950,
      targetType: 'SINGLE_ALLY',
      school: 'NATURE',
      spec: 'RESTO_HEAL',
      effects: [
        {
          type: 'HEAL',
          baseValue: 8800,
          description: '低耗省蓝常规单体治疗（2.5s基础读条，80级满急速1.67s）',
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
      resourceCostAmount: 2700,
      targetType: 'SINGLE_ALLY',
      school: 'NATURE',
      spec: 'RESTO_HEAL',
      effects: [
        {
          type: 'HEAL',
          baseValue: 20500,
          description: '重型单抬大治疗（2.5s基础读条，80级满急速1.67s），坦克危急核心技能',
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
      resourceCostAmount: 2400,
      targetType: 'SINGLE_ALLY',
      school: 'NATURE',
      spec: 'RESTO_HEAL',
      effects: [
        {
          type: 'HEAL',
          baseValue: 12400,
          description: '快速单抬急救治疗（1.5s基础读条，80级满急速1.0s），高HPS无CD',
        },
      ],
    },

    {
      id: 'shaman_chain_heal',
      name: '治疗链',
      castTimeMs: 2_500,
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
          baseValue: 23500,
          description: '2.5s基础读条（满急速1.67s），无CD；主目标治疗后智能弹跳最多4名低血量友方（每跳衰减30%）',
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
      range: 320, // 40 码点地放置（与治疗之雨一致）
      effects: [
        {
          type: 'GROUND_EFFECT',
          groundKind: 'TOTEM',
          groundColorHex: '#6FCF97',
          groundRadius: 10,
          durationMs: 6_000,
          description: '40码内点地插下灵魂链接图腾：持续6s，范围内队友血量均摊+10%减伤（图腾半径约10码）',
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
      id: 'shaman_healing_tide_totem',
      name: '治疗之潮图腾',
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
          groundColorHex: '#38BDF8',
          groundRadius: 40,
          durationMs: 10_000,
          tickIntervalMs: 2_000,
          baseValue: 5200,
          description: '治疗之潮图腾：持续10s，每2s为附近最多5名伤势最重的友方恢复约5200生命值（80级满级标定）',
        },
      ],
    },

    {
      id: 'shaman_earth_shield',
      name: '大地之盾',
      castTimeMs: 0,
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
          type: 'BUFF',
          auraId: 'earth_shield',
          baseValue: 6800,
          durationMs: 600_000,
          maxStacks: 9,
          description: '大地之盾：9层护盾，受击时消耗1层回复约6800生命（3s内置CD）；同时使该目标受到你的治疗效果提高20%',
        },
      ],
    },

    {
      id: 'shaman_unleash_life',
      name: '生命释放',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 15_000,
      resourceCost: 'MANA',
      resourceCostAmount: 1600,
      targetType: 'SINGLE_ALLY',
      school: 'NATURE',
      spec: 'RESTO_HEAL',
      effects: [
        {
          type: 'HEAL',
          baseValue: 8500,
          description: '瞬发治疗友方目标约8500点生命值',
        },
        {
          type: 'BUFF',
          auraId: 'unleash_life',
          durationMs: 10_000,
          description: '使你的下一次直接治疗或治疗之雨效果提高30%，持续10秒',
        },
      ],
    },

    {
      id: 'shaman_ascendance',
      name: '升腾',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 180_000,
      resourceCost: 'MANA',
      resourceCostAmount: 1000,
      targetType: 'SELF',
      school: 'NATURE',
      effects: [
        {
          type: 'BUFF',
          auraId: 'ascendance',
          durationMs: 15_000,
          description: '升腾15秒：造成的伤害提高35%；恢复专精额外将你的治疗量100%均摊复制给附近最多5名受伤友方',
        },
      ],
    },

    {
      id: 'shaman_ancestral_guidance',
      name: '先祖指引',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 120_000,
      resourceCost: 'NONE',
      resourceCostAmount: 0,
      targetType: 'SELF',
      school: 'NATURE',
      effects: [
        {
          type: 'BUFF',
          auraId: 'ancestral_guidance',
          durationMs: 10_000,
          description: '先祖指引10秒：造成直接伤害的40%、直接治疗的60%转化为智能群体治疗（最多3名伤员）',
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
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 300_000, // 5分钟
      resourceCost: 'MANA',
      resourceCostAmount: 1000,
      targetType: 'AOE_ALLY',
      school: 'NATURE',
      effects: [
        {
          type: 'BUFF',
          auraId: 'heroism',
          durationMs: 40_000,
          description: '全团30%急速，持续40s；之后施加"疲惫"（Exhaustion，10min内不可再嗜血），CD 5min；占GCD',
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
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 1000,
      targetType: 'SINGLE_ALLY',
      school: 'NATURE',
      spec: 'RESTO_HEAL',
      effects: [
        {
          type: 'DISPEL',
          description: '驱散友方目标身上的诅咒与魔法效果（恢复天赋强化）',
        },
      ],
    },

    {
      id: 'shaman_ancestral_spirit',
      name: '先祖之魂',
      castTimeMs: 3_000,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 2400,
      targetType: 'SINGLE_ALLY',
      school: 'NATURE',
      spec: 'RESTO_HEAL',
      travelOnly: true,
      effects: [
        {
          type: 'RESURRECT',
          description: '非战斗复活，读条3s（无CD），只能在脱战阶段使用',
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
          description: '自然系直伤法术；命中敌人时通过大地之流为施法者恢复法力值（元素萨主力输出与产能）',
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

    {
      id: 'shaman_chain_lightning',
      name: '闪电链',
      castTimeMs: 2_000,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 3_000,
      resourceCost: 'MANA',
      resourceCostAmount: 2200,
      targetType: 'AOE_ENEMY',
      school: 'NATURE',
      spec: 'ELEMENTAL_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 8600,
          description: '向主目标及周围最多4名敌人弹射自然闪电；命中敌人时通过大地之流为施法者恢复法力值',
        },
      ],
    },

    {
      id: 'shaman_earth_shock',
      name: '大地震击',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 6_000,
      resourceCost: 'MANA',
      resourceCostAmount: 1500,
      targetType: 'SINGLE_ENEMY',
      school: 'NATURE',
      spec: 'ELEMENTAL_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 7000,
          description: '瞬发自然直伤，与烈焰震击共享震荡CD（6s）',
        },
      ],
    },

    {
      id: 'shaman_thunderstorm',
      name: '雷霆风暴',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 45_000,
      resourceCost: 'NONE',
      resourceCostAmount: 0,
      targetType: 'AOE_ENEMY',
      school: 'NATURE',
      spec: 'ELEMENTAL_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 4500,
          description: '近身自然AOE，击退敌人并为施法者恢复约15%最大法力；占GCD',
        },
        {
          type: 'RESOURCE_RESTORE',
          baseValue: 6750,
          description: '恢复约15%最大法力值（80级元素萨满标定约6750）',
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

    {
      id: 'shaman_fire_nova',
      name: '火焰新星',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 4_000,
      resourceCost: 'MANA',
      resourceCostAmount: 1800,
      targetType: 'AOE_ENEMY',
      school: 'FIRE',
      spec: 'ENHANCEMENT_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 8200,
          description: '引爆烈焰震击目标周围所有敌人，造成群体火焰AOE伤害',
        },
      ],
    },
  ],
};
