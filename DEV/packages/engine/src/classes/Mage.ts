/**
 * [C-04] Mage.ts
 * 法师 — 火焰 / 奥术 / 冰霜（远程 DPS）
 * 资源：法力值
 */

import type { ClassSpec, Spell } from './DeathKnight';

export type { ClassSpec, Spell };

// ─────────────────────────────────────────────
//  法师技能表
// ─────────────────────────────────────────────

export const MAGE: ClassSpec = {
  classId: 'MAGE',
  className: '法师',
  classColor: '#69CCF0',
  spells: [
    // ── 火焰DPS ──────────────────────────────

    {
      id: 'mage_fireball',
      name: '火球术',
      castTimeMs: 2_250,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 1600,
      targetType: 'SINGLE_ENEMY',
      school: 'FIRE',
      spec: 'FIRE_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 10000,
          description: '读条直伤（主力输出技能）；有几率触发热streak效果',
        },
      ],
    },

    {
      id: 'mage_living_bomb',
      name: '活动炸弹',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 1200,
      targetType: 'SINGLE_ENEMY',
      school: 'FIRE',
      spec: 'FIRE_DPS',
      effects: [
        {
          type: 'DOT',
          auraId: 'living_bomb_dot',
          baseValue: 2200,
          durationMs: 12_000,
          tickIntervalMs: 3_000,
          description: 'DoT，持续12s，每3s跳一次',
        },
        {
          type: 'SPELL_DAMAGE',
          baseValue: 9000,
          description: 'DoT到期爆炸产生额外火焰AOE伤害',
        },
      ],
    },

    {
      id: 'mage_pyroblast',
      name: '炎爆术',
      castTimeMs: 3_500,       // 正常读条3.5s；热streak时瞬发
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 2000,
      targetType: 'SINGLE_ENEMY',
      school: 'FIRE',
      spec: 'FIRE_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 20000,
          description: '长读条大伤技能（3.5s）；法术连击触发时瞬发',
        },
        {
          type: 'DOT',
          auraId: 'pyroblast_dot',
          baseValue: 1200,
          durationMs: 12_000,
          tickIntervalMs: 3_000,
          description: '附加火焰DoT',
        },
      ],
    },

    {
      id: 'mage_combustion',
      name: '燃烧',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 120_000,
      resourceCost: 'MANA',
      resourceCostAmount: 800,
      targetType: 'SINGLE_ENEMY',
      school: 'FIRE',
      spec: 'FIRE_DPS',
      effects: [
        {
          type: 'BUFF',
          auraId: 'combustion_window',
          durationMs: 2_000,
          description: '点燃DoT，2s爆发窗口：合并当前目标身上所有火焰DoT tick一次；重置热streak',
        },
        {
          type: 'DOT',
          auraId: 'combustion_dot',
          baseValue: 4000,
          durationMs: 10_000,
          tickIntervalMs: 1_000,
          description: '点燃DoT，每秒跳字',
        },
      ],
    },

    // ── 冰霜DPS ──────────────────────────────

    {
      id: 'mage_frostbolt',
      name: '寒冰箭',
      castTimeMs: 2_000,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 1200,
      targetType: 'SINGLE_ENEMY',
      school: 'FROST',
      spec: 'ICE_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 7500,
          description: '冰霜直伤',
        },
        {
          type: 'DEBUFF',
          auraId: 'frostbolt_slow',
          durationMs: 9_000,
          description: '使目标减速40%，持续9s',
        },
      ],
    },

    // ── 通用法师技能 ───────────────────────────

    {
      id: 'mage_counterspell',
      name: '法术反制',
      castTimeMs: 0,
      gcdType: 'off',
      gcdCategory: 'OFF_GCD',
      cooldownMs: 24_000,
      resourceCost: 'NONE',
      resourceCostAmount: 0,
      targetType: 'SINGLE_ENEMY',
      school: 'ARCANE',
      effects: [
        {
          type: 'INTERRUPT',
          description: '打断施法，并锁定该系法术6s，CD 24s',
        },
      ],
    },

    {
      id: 'mage_time_warp',
      name: '时间扭曲',
      castTimeMs: 0,
      gcdType: 'off',
      gcdCategory: 'OFF_GCD',
      cooldownMs: 300_000, // 5分钟
      resourceCost: 'MANA',
      resourceCostAmount: 1000,
      targetType: 'AOE_ALLY',
      school: 'ARCANE',
      effects: [
        {
          type: 'BUFF',
          auraId: 'time_warp',
          durationMs: 40_000,
          description: '全团30%急速，持续40s；之后施加"疲惫"（与嗜血共享，10min内不可再触发），CD 5min',
        },
      ],
    },

    {
      id: 'mage_arcane_brilliance',
      name: '奥术光辉',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 1000,
      targetType: 'AOE_ALLY',
      school: 'ARCANE',
      isRaidBuff: true,
      effects: [
        {
          type: 'BUFF',
          auraId: 'arcane_brilliance',
          durationMs: 3_600_000, // 1小时
          description: '全团暴击/攻击强度+5% Buff，持续1h（长效Buff，赶路阶段AI自动补充）',
        },
      ],
    },

    {
      id: 'mage_ice_block',
      name: '寒冰屏障',
      castTimeMs: 0,
      gcdType: 'off',
      gcdCategory: 'OFF_GCD',
      cooldownMs: 300_000,
      resourceCost: 'MANA',
      resourceCostAmount: 800,
      targetType: 'SELF',
      school: 'FROST',
      effects: [
        {
          type: 'SHIELD',
          auraId: 'ice_block',
          durationMs: 10_000,
          description: '10s完全免疫所有伤害与有害效果并清除减益，CD 5min（不进GCD）',
        },
      ],
    },

    {
      id: 'mage_ice_barrier',
      name: '寒冰护体',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 30_000,
      resourceCost: 'MANA',
      resourceCostAmount: 1100,
      targetType: 'SELF',
      school: 'FROST',
      effects: [
        {
          type: 'SHIELD',
          auraId: 'ice_barrier',
          baseValue: 10500,
          durationMs: 60_000,
          description: '吸收大量伤害的寒冰护盾，持续60s，CD 30s',
        },
      ],
    },

    {
      id: 'mage_flamestorm',
      name: '烈焰风暴',
      castTimeMs: 2_000,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 2400,
      targetType: 'AOE_ENEMY',
      school: 'FIRE',
      spec: 'FIRE_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 8800,
          description: '召唤烈焰柱轰击目标区域所有敌人并留存灼烧地面（火法核心AOE）',
        },
      ],
    },

    {
      id: 'mage_blizzard',
      name: '暴风雪',
      castTimeMs: 2_500,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 2500,
      targetType: 'AOE_ENEMY',
      school: 'FROST',
      spec: 'ICE_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 8400,
          description: '降下暴风雪持续打击区域内所有敌人并减速（冰法核心AOE）',
        },
      ],
    },

    {
      id: 'mage_arcane_explosion',
      name: '魔爆术',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 1900,
      targetType: 'AOE_ENEMY',
      school: 'ARCANE',
      spec: 'ARCANE_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 7800,
          description: '瞬发奥术冲击波打击周围所有敌人（奥法核心AOE）',
        },
      ],
    },

    {
      id: 'mage_evocation',
      name: '唤醒',
      castTimeMs: -1,            // 引导
      channelDurationMs: 6_000,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 240_000, // 4分钟
      resourceCost: 'NONE',
      resourceCostAmount: 0,
      targetType: 'SELF',
      school: 'ARCANE',
      effects: [
        {
          type: 'RESOURCE_RESTORE',
          baseValue: 0.6,         // 恢复最大法力量的60%（分6s引导）
          durationMs: 6_000,
          tickIntervalMs: 1_000,
          description: '引导6s，每秒回复最大法力10%，共恢复60%法力，CD 4min',
        },
      ],
    },

    // ── 奥术DPS ──────────────────────────────

    {
      id: 'mage_arcane_blast',
      name: '奥术冲击',
      castTimeMs: 2_000,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 1500,
      targetType: 'SINGLE_ENEMY',
      school: 'ARCANE',
      spec: 'ARCANE_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 9500,
          description: '奥术直伤主力；叠加奥术冲击效果提高伤害与法力消耗',
        },
        {
          type: 'BUFF',
          auraId: 'arcane_blast_buff',
          durationMs: 10_000,
          maxStacks: 4,
          description: '奥术冲击Buff：每层提升奥术伤害与法力消耗',
        },
      ],
    },

    {
      id: 'mage_arcane_missiles',
      name: '奥术飞弹',
      castTimeMs: -1,
      channelDurationMs: 2_500,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 1800,
      targetType: 'SINGLE_ENEMY',
      school: 'ARCANE',
      spec: 'ARCANE_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 3000,
          durationMs: 2_500,
          tickIntervalMs: 500,
          description: '引导2.5秒向目标发射5波奥术飞弹，每波造成3000点伤害，共计15000点',
        },
      ],
    },

    {
      id: 'mage_arcane_barrage',
      name: '奥术弹幕',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 3_000,
      resourceCost: 'MANA',
      resourceCostAmount: 1200,
      targetType: 'SINGLE_ENEMY',
      school: 'ARCANE',
      spec: 'ARCANE_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 8500,
          description: '瞬发奥术弹幕，消耗并清空奥术冲击层数，CD 3s',
        },
      ],
    },

    {
      id: 'mage_arcane_power',
      name: '奥术强化',
      castTimeMs: 0,
      gcdType: 'off',
      gcdCategory: 'OFF_GCD',
      cooldownMs: 120_000,
      resourceCost: 'NONE',
      resourceCostAmount: 0,
      targetType: 'SELF',
      school: 'ARCANE',
      spec: 'ARCANE_DPS',
      effects: [
        {
          type: 'BUFF',
          auraId: 'arcane_power',
          durationMs: 15_000,
          description: '使你造成的法术伤害提高20%，法力消耗提高10%，持续15s，脱离GCD，CD 2min',
        },
      ],
    },

    // ── 冰霜DPS (补充) ─────────────────────────

    {
      id: 'mage_ice_lance',
      name: '冰枪术',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 0,
      resourceCost: 'MANA',
      resourceCostAmount: 900,
      targetType: 'SINGLE_ENEMY',
      school: 'FROST',
      spec: 'ICE_DPS',
      effects: [
        {
          type: 'SPELL_DAMAGE',
          baseValue: 4500,
          description: '瞬发冰霜法术，对被冻结或寒冰指目标造成双倍至三倍伤害（基准4500）',
        },
      ],
    },

    {
      id: 'mage_deep_freeze',
      name: '深度冻结',
      castTimeMs: 0,
      gcdType: 'normal',
      gcdCategory: 'NORMAL',
      cooldownMs: 30_000,
      resourceCost: 'MANA',
      resourceCostAmount: 1200,
      targetType: 'SINGLE_ENEMY',
      school: 'FROST',
      spec: 'ICE_DPS',
      effects: [
        {
          type: 'DEBUFF',
          auraId: 'deep_freeze_stun',
          durationMs: 5_000,
          description: '使目标昏迷5秒；若目标免疫昏迷（如首领），则造成16000点巨额碎冰伤害，CD 30s',
        },
        {
          type: 'SPELL_DAMAGE',
          baseValue: 16000,
          description: '对免疫昏迷的首领直接造成16000点冰霜直伤',
        },
      ],
    },
  ],
};
