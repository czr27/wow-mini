/**
 * [C-02] Druid.ts
 * 德鲁伊 — 恢复（核心治疗） / 平衡（远程 DPS）
 * 资源：法力值（含脱战高速回蓝与战斗精神回蓝）
 */

import type { ClassSpec, Spell } from './DeathKnight';

export type { ClassSpec, Spell };

// ─────────────────────────────────────────────
//  德鲁伊技能表
// ─────────────────────────────────────────────

export const DRUID: ClassSpec = {
  classId: 'DRUID',
  className: '德鲁伊',
  classColor: '#FF7D0A',
  spells: [
    // ── 恢复治疗技能 ──────────────────────────

    {
      id: 'druid_lifebloom',
      name: '生命绽放',
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
          type: 'HOT',
          auraId: 'lifebloom',
          baseValue: 2400,       // 每2秒一跳治疗量
          durationMs: 15_000,    // 基础持续15秒
          tickIntervalMs: 2_000, // 每2秒一跳HOT
          maxStacks: 3,
          description: '基础持续15秒，每2秒一跳HOT；最多叠3层，多层共用同一个倒计时条，层数只加每跳治疗量；可被治疗之触、愈合、滋养单体刷新',
        },
      ],
    },

    {
      id: 'druid_rejuvenation',
      name: '回春术',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 1600,
      targetType: 'SINGLE_ALLY',
      school: 'NATURE',
      spec: 'RESTO_HEAL',
      effects: [
        {
          type: 'HOT',
          auraId: 'rejuvenation',
          baseValue: 2200,
          durationMs: 12_000,
          tickIntervalMs: 3_000,
          description: 'HoT，持续12s，每3s跳一次',
        },
      ],
    },

    {
      id: 'druid_regrowth',
      name: '愈合',
      castTimeMs: 1_500,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 2300,
      targetType: 'SINGLE_ALLY',
      school: 'NATURE',
      spec: 'RESTO_HEAL',
      effects: [
        {
          type: 'HEAL',
          baseValue: 11800,
          description: '1.5s快速急救治疗（80级满急速1.0s），附加6秒HoT并刷新生命绽放',
        },
        {
          type: 'HOT',
          auraId: 'regrowth',
          baseValue: 1600,
          durationMs: 6_000,
          tickIntervalMs: 2_000,
          description: '附加6s持续治疗HoT',
        },
      ],
    },

    {
      id: 'druid_healing_touch',
      name: '治疗之触',
      castTimeMs: 2_500,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 2600,
      targetType: 'SINGLE_ALLY',
      school: 'NATURE',
      spec: 'RESTO_HEAL',
      effects: [
        {
          type: 'HEAL',
          baseValue: 20500,
          description: '2.5s重型单抬大治疗（80级满急速1.67s），刷新目标生命绽放',
        },
      ],
    },

    {
      id: 'druid_nourish',
      name: '滋养',
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
          baseValue: 8500,
          description: '省蓝常规读条治疗（2.5s基础，满急速1.67s），刷新生命绽放',
        },
      ],
    },

    {
      id: 'druid_swiftmend',
      name: '迅捷治愈',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 15_000,
      resourceCost: 'MANA',
      resourceCostAmount: 1800,
      targetType: 'SINGLE_ALLY',
      school: 'NATURE',
      spec: 'RESTO_HEAL',
      effects: [
        {
          type: 'HEAL',
          baseValue: 28000,
          description: '必须消耗目标身上的回春术或愈合效果，立即造成巨额瞬发治疗',
        },
        {
          type: 'GROUND_EFFECT',
          groundKind: 'HEAL_ZONE',
          groundColorHex: '#10B981',
          groundRadius: 6,
          durationMs: 7_000,
          tickIntervalMs: 1_000,
          baseValue: 3800,
          description: '在目标脚下放置7s百花齐放治疗绿法阵（HEAL_ZONE，每秒治疗范围内友方）',
        },
      ],
    },

    {
      id: 'druid_wild_growth',
      name: '野性成长',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 8_000,
      resourceCost: 'MANA',
      resourceCostAmount: 2200,
      targetType: 'SMART_ALLY',
      school: 'NATURE',
      spec: 'RESTO_HEAL',
      effects: [
        {
          type: 'HOT',
          auraId: 'wild_growth',
          baseValue: 1800,
          durationMs: 7_000,
          tickIntervalMs: 1_000,
          description: '40码施放；以选中友方为圆心，15码内血量百分比最低的最多5名友方施加7s HoT',
        },
      ],
    },

    {
      id: 'druid_tranquility',
      name: '宁静',
      castTimeMs: -1,            // 引导
      channelDurationMs: 8_000,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 180_000,
      resourceCost: 'MANA',
      resourceCostAmount: 3000,
      targetType: 'AOE_ALLY',
      school: 'NATURE',
      spec: 'RESTO_HEAL',
      effects: [
        {
          type: 'HEAL',
          baseValue: 8000,
          tickIntervalMs: 2_000,
          description: '引导8s，每2s对全团治疗（大型团刷），CD 3min',
        },
      ],
    },

    // 全专精基础驱散（平衡/野德用；恢复用下方自然之愈升级版）
    {
      id: 'druid_remove_corruption',
      name: '清除腐蚀',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 8_000,
      resourceCost: 'MANA',
      resourceCostAmount: 800,
      targetType: 'SINGLE_ALLY',
      school: 'NATURE',
      // 无 spec → 全专精可用；恢复动作条改用自然之愈
      effects: [
        {
          type: 'DISPEL',
          dispelTypes: ['CURSE', 'POISON'],
          description: '驱散 1 个诅咒与 1 个中毒，CD 8s',
        },
      ],
    },

    // 恢复专精：自然之愈（可额外驱散魔法）
    {
      id: 'druid_natures_cure',
      name: '自然之愈',
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
          dispelTypes: ['MAGIC', 'CURSE', 'POISON'],
          description: '驱散魔法/诅咒/中毒各 1 个，CD 8s（恢复专精）',
        },
      ],
    },

    {
      id: 'druid_rebirth',
      name: '复生',
      castTimeMs: 2_000,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 600_000,
      resourceCost: 'MANA',
      resourceCostAmount: 2400,
      targetType: 'SINGLE_ALLY',
      school: 'NATURE',
      travelOnly: false,
      effects: [
        {
          type: 'RESURRECT',
          description: '战斗复活大招：在战斗中复活阵亡盟友，恢复60%生命值与法力值，CD 10min',
        },
      ],
    },

    {
      id: 'druid_revive',
      name: '起死回生',
      castTimeMs: 3_000,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 2400,
      targetType: 'SINGLE_ALLY',
      school: 'NATURE',
      travelOnly: true,
      effects: [
        {
          type: 'RESURRECT',
          description: '非战斗复活，脱离战斗后复活已阵亡的盟友（无CD）',
        },
      ],
    },

    {
      id: 'druid_barkskin',
      name: '树皮术',
      castTimeMs: 0,
      gcdType: 'off',
      gcdCategory: 'OFF_GCD',
      cooldownMs: 60_000,
      resourceCost: 'NONE',
      resourceCostAmount: 0,
      targetType: 'SELF',
      school: 'NATURE',
      effects: [
        {
          type: 'BUFF',
          auraId: 'barkskin',
          durationMs: 12_000,
          description: '20%减伤，12s，CD 60s；不打断施法',
        },
      ],
    },

    {
      id: 'druid_natures_swiftness',
      name: '自然迅捷',
      castTimeMs: 0,
      gcdType: 'off',
      gcdCategory: 'OFF_GCD',
      cooldownMs: 120_000,
      resourceCost: 'NONE',
      resourceCostAmount: 0,
      targetType: 'SELF',
      school: 'NATURE',
      spec: 'RESTO_HEAL',
      effects: [
        {
          type: 'BUFF',
          auraId: 'natures_swiftness',
          durationMs: 60_000,
          description: '激活后，使你的下一个基础施法时间小于10秒的自然法术变为瞬发法术，并且治疗效果提高50%。',
        },
      ],
    },

    {
      id: 'druid_innervate',
      name: '激活',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 180_000,
      resourceCost: 'NONE',
      resourceCostAmount: 0,
      targetType: 'SINGLE_ALLY',
      school: 'NATURE',
      spec: 'RESTO_HEAL',
      effects: [
        {
          type: 'BUFF',
          auraId: 'innervate',
          durationMs: 10_000,
          description: '回蓝大招：施放后目标下次施法法力消耗-100%（持续10s或耗尽法力），CD 3min',
        },
      ],
    },

    {
      id: 'druid_mark_of_the_wild',
      name: '野性印记',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 1000,
      targetType: 'AOE_ALLY',
      school: 'NATURE',
      isRaidBuff: true,
      range: 240, // Cata: 30 码施法距离；命中后全团队生效
      effects: [
        {
          type: 'BUFF',
          auraId: 'mark_of_the_wild',
          durationMs: 3_600_000, // 1小时
          description: '30码内对友方施放：若目标在队伍/团队中，全团所有属性+5%（含抗性），持续1h',
        },
      ],
    },

    // ── 平衡DPS技能 ──────────────────────────

    {
      id: 'druid_wrath',
      name: '愤怒',
      castTimeMs: 1_500,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 1400,
      targetType: 'SINGLE_ENEMY',
      school: 'NATURE',
      spec: 'BALANCE_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 7500,
          description: '自然系直伤法术（主力输出技能）',
        },
      ],
    },

    {
      id: 'druid_starfire',
      name: '星火术',
      castTimeMs: 2_500,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 1600,
      targetType: 'SINGLE_ENEMY',
      school: 'ARCANE',
      spec: 'BALANCE_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 9000,
          description: '奥术系直伤（大技能，读条长）',
        },
        {
          type: 'DOT',
          auraId: 'starfire_dot',
          baseValue: 800,
          durationMs: 8_000,
          tickIntervalMs: 2_000,
          description: '附加奥术DoT',
        },
      ],
    },

    {
      id: 'druid_starsurge',
      name: '星涌术',
      castTimeMs: 2_000,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 15_000,
      resourceCost: 'MANA',
      resourceCostAmount: 1200,
      targetType: 'SINGLE_ENEMY',
      school: 'ARCANE',
      spec: 'BALANCE_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 8000,
          description: '星界爆发直伤（2.0s读条），CD 15s',
        },
      ],
    },

    {
      id: 'druid_moonfire',
      name: '月火术',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 1000,
      targetType: 'SINGLE_ENEMY',
      school: 'ARCANE',
      spec: 'BALANCE_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 3500,
          description: '奥术系直伤部分',
        },
        {
          type: 'DOT',
          auraId: 'moonfire_dot',
          baseValue: 1200,
          durationMs: 12_000,
          tickIntervalMs: 3_000,
          description: '月火DoT，持续12s',
        },
      ],
    },

    {
      id: 'druid_sunfire',
      name: '日火术',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 1000,
      targetType: 'SINGLE_ENEMY',
      school: 'NATURE',
      spec: 'BALANCE_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 3500,
          description: '一道烈日灼烧敌人，造成瞬发自然伤害',
        },
        {
          type: 'DOT',
          auraId: 'sunfire_dot',
          baseValue: 1200,
          durationMs: 18_000,
          tickIntervalMs: 3_000,
          description: '日火DoT，持续18s，每3秒造成一次自然伤害',
        },
      ],
    },

    {
      id: 'druid_hurricane',
      name: '飓风',
      castTimeMs: 2_500,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 2400,
      targetType: 'AOE_ENEMY',
      school: 'NATURE',
      spec: 'BALANCE_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 8200,
          description: '召唤风暴席卷目标区域所有敌人（平衡德持续AOE）',
        },
      ],
    },

    {
      id: 'druid_starfall',
      name: '星辰坠落',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 90_000,
      resourceCost: 'MANA',
      resourceCostAmount: 2200,
      targetType: 'AOE_ENEMY',
      school: 'ARCANE',
      spec: 'BALANCE_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 11500,
          description: '召唤流星群轰击周围所有敌人（平衡德爆发AOE）',
        },
      ],
    },

    // ── 野性德鲁伊技能 (熊坦 & 猎豹DPS) ────────

    {
      id: 'druid_mangle',
      name: '裂伤',
      castTimeMs: 0,
      gcdType: 'rogue',          // 猎豹GCD 1.0s
      gcdCategory: 'ROGUE',
      cooldownMs: 0,
      resourceCost: 'ENERGY',
      resourceCostAmount: 35,
      targetType: 'SINGLE_ENEMY',
      school: 'PHYSICAL',
      spec: 'FERAL',
      effects: [
        {
          type: 'PHYSICAL_DAMAGE',
          baseValue: 7800,
          description: '裂伤目标，造成物理伤害并奖励1个连击点数',
        },
        {
          type: 'BUFF',
          auraId: 'combo_point_add_1',
          description: '生成1点连击点数',
        },
        {
          type: 'DEBUFF',
          auraId: 'mangle_bleed_debuff',
          durationMs: 60_000,
          description: '使目标受到的流血伤害提高30%，持续1分钟',
        },
      ],
    },

    {
      id: 'druid_lacerate',
      name: '割伤',
      castTimeMs: 0,
      gcdType: 'normal',         // 熊坦常规 1.5s
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'RAGE',
      resourceCostAmount: 15,
      targetType: 'SINGLE_ENEMY',
      school: 'PHYSICAL',
      spec: 'FERAL',
      effects: [
        {
          type: 'PHYSICAL_DAMAGE',
          baseValue: 3200,
          description: '熊形态撕扯目标造成物理伤害与大量仇恨',
        },
        {
          type: 'DOT',
          auraId: 'lacerate_dot',
          baseValue: 1800,
          durationMs: 15_000,
          tickIntervalMs: 3_000,
          maxStacks: 3,
          description: '割伤流血效果，最多叠3层（3层每跳5400）',
        },
      ],
    },

    {
      id: 'druid_shred',
      name: '撕碎',
      castTimeMs: 0,
      gcdType: 'rogue',          // 猎豹 1.0s
      gcdCategory: 'ROGUE',
      cooldownMs: 0,
      resourceCost: 'ENERGY',
      resourceCostAmount: 40,
      targetType: 'SINGLE_ENEMY',
      school: 'PHYSICAL',
      spec: 'FERAL',
      effects: [
        {
          type: 'PHYSICAL_DAMAGE',
          baseValue: 9800,
          description: '撕碎目标造成高额物理伤害（对流血目标伤害提升），奖励1点连击点数',
        },
        {
          type: 'BUFF',
          auraId: 'combo_point_add_1',
          description: '生成1点连击点数',
        },
      ],
    },

    {
      id: 'druid_rake',
      name: '斜掠',
      castTimeMs: 0,
      gcdType: 'rogue',
      gcdCategory: 'ROGUE',
      cooldownMs: 0,
      resourceCost: 'ENERGY',
      resourceCostAmount: 35,
      targetType: 'SINGLE_ENEMY',
      school: 'PHYSICAL',
      spec: 'FERAL',
      effects: [
        {
          type: 'PHYSICAL_DAMAGE',
          baseValue: 4200,
          description: '斜掠目标造成物理伤害并奖励1点连击点数',
        },
        {
          type: 'BUFF',
          auraId: 'combo_point_add_1',
          description: '生成1点连击点数',
        },
        {
          type: 'DOT',
          auraId: 'rake_dot',
          baseValue: 1800,
          durationMs: 15_000,
          tickIntervalMs: 3_000,
          description: '斜掠流血效果，持续15秒，每3秒造成一次物理流血伤害',
        },
      ],
    },

    {
      id: 'druid_rip',
      name: '割裂',
      castTimeMs: 0,
      gcdType: 'rogue',          // 猎豹 1.0s
      gcdCategory: 'ROGUE',
      cooldownMs: 0,
      resourceCost: 'COMBO_POINT',
      resourceCostAmount: 5,     // 消耗5星连击点终结技
      targetType: 'SINGLE_ENEMY',
      school: 'PHYSICAL',
      spec: 'FERAL',
      effects: [
        {
          type: 'DOT',
          auraId: 'rip_dot',
          baseValue: 2400,
          durationMs: 16_000,
          tickIntervalMs: 2_000,
          description: '5星终结技：在16秒内每2秒造成高额流血伤害（共8跳，总伤害约19,200）',
        },
      ],
    },

    {
      id: 'druid_ferocious_bite',
      name: '凶猛撕咬',
      castTimeMs: 0,
      gcdType: 'rogue',
      gcdCategory: 'ROGUE',
      cooldownMs: 0,
      resourceCost: 'COMBO_POINT',
      resourceCostAmount: 5,
      targetType: 'SINGLE_ENEMY',
      school: 'PHYSICAL',
      spec: 'FERAL',
      effects: [
        {
          type: 'PHYSICAL_DAMAGE',
          baseValue: 19500,
          description: '终结技：消耗连击点数对目标造成高额物理伤害（80级满级爆发终结技）',
        },
      ],
    },

    {
      id: 'druid_frenzied_regeneration',
      name: '狂暴回复',
      castTimeMs: 0,
      gcdType: 'off',            // 熊坦紧急脱离GCD自保
      gcdCategory: 'OFF_GCD',
      cooldownMs: 180_000,
      resourceCost: 'NONE',
      resourceCostAmount: 0,
      targetType: 'SELF',
      school: 'PHYSICAL',
      spec: 'FERAL',
      effects: [
        {
          type: 'BUFF',
          auraId: 'frenzied_regeneration',
          durationMs: 20_000,
          description: '使最大生命值提高30%，并将怒气转化为生命值，持续20秒',
        },
        {
          type: 'HOT',
          auraId: 'frenzied_regeneration_hot',
          baseValue: 3200,
          durationMs: 20_000,
          tickIntervalMs: 1_000,
          description: '每秒恢复3200生命值（总自愈约64,000）',
        },
      ],
    },

    {
      id: 'druid_growl',
      name: '低吼',
      castTimeMs: 0,
      gcdType: 'off',            // 嘲讽脱离GCD
      gcdCategory: 'OFF_GCD',
      cooldownMs: 8_000,
      resourceCost: 'NONE',
      resourceCostAmount: 0,
      targetType: 'SINGLE_ENEMY',
      school: 'PHYSICAL',
      spec: 'FERAL',
      effects: [
        {
          type: 'TAUNT',
          description: '嘲讽目标强制攻击德鲁伊，仇恨复制为最高仇恨×110%，CD 8s',
        },
      ],
    },

    {
      id: 'druid_swipe',
      name: '横扫',
      castTimeMs: 0,
      gcdType: 'rogue',
      gcdCategory: 'ROGUE',
      cooldownMs: 3_000,
      resourceCost: 'ENERGY',
      resourceCostAmount: 45,
      targetType: 'AOE_ENEMY',
      school: 'PHYSICAL',
      spec: 'FERAL',
      effects: [
        {
          type: 'PHYSICAL_DAMAGE',
          baseValue: 7800,
          description: '横扫面前所有敌人造成群体物理伤害（野性核心AOE）',
        },
      ],
    },

    {
      id: 'druid_skull_bash',
      name: '迎头痛击',
      castTimeMs: 0,
      gcdType: 'off',
      gcdCategory: 'OFF_GCD',
      cooldownMs: 10_000,
      resourceCost: 'NONE',
      resourceCostAmount: 0,
      targetType: 'SINGLE_ENEMY',
      school: 'PHYSICAL',
      spec: 'FERAL',
      effects: [
        {
          type: 'INTERRUPT',
          description: '冲向目标并打断施法，使该系法术封锁4秒，CD 10s（不进GCD）',
        },
      ],
    },

    {
      id: 'druid_berserk',
      name: '狂暴',
      castTimeMs: 0,
      gcdType: 'off',
      gcdCategory: 'OFF_GCD',
      cooldownMs: 180_000,
      resourceCost: 'NONE',
      resourceCostAmount: 0,
      targetType: 'SELF',
      school: 'PHYSICAL',
      spec: 'FERAL',
      effects: [
        {
          type: 'BUFF',
          auraId: 'berserk',
          durationMs: 15_000,
          description: '进入狂暴状态，持续15秒：使所有猎豹技能能量消耗降低50%，熊形态可打击最多3个目标（不进GCD）',
        },
      ],
    },
  ],
};
