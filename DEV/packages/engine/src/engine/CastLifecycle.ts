/**
 * CastLifecycle — 瞬发 / 读条 / 引导三类技能生命周期单一事实源（纯 TS，零 DOM 依赖）
 *
 * 核心规则（WoW 大灾变标准契约）：
 * 1. INSTANT（瞬发）：起手扣资源 + 起手进 GCD + 起手进技能 CD + 立即结算。
 * 2. CASTED（读条，非引导）：起手仅校验资源并进 GCD，不扣资源、不进技能 CD；
 *    读条被打断 → 0 效果、0 消耗、0 冷却；
 *    读条完成   → 二次校验后扣资源 + 进技能 CD + 结算效果。
 * 3. CHANNELED（引导）：起手立即扣资源 + 起手立即进技能 CD + 进 GCD；
 *    引导被打断 → 已触发跳数保留，资源已消耗，技能保持冷却中；
 *    引导自然结束 → 结束状态，绝不重复触发冷却。
 */

export type SpellCastMode = 'INSTANT' | 'CASTED' | 'CHANNELED';

export interface SpellCastLifecyclePolicy {
  mode: SpellCastMode;
  deductResourceOnStart: boolean;
  triggerCooldownOnStart: boolean;
  deductResourceOnComplete: boolean;
  triggerCooldownOnComplete: boolean;
  triggerGcdOnStart: boolean;
}

export interface SpellResourceCostBundle {
  mana?: number;
  energy?: number;
  rage?: number;
  focus?: number;
  runicPower?: number;
  holyPower?: number;
}

/** 全 10 职业已知引导技能 ID 集合（同时覆盖短 ID 与引擎全名 ID） */
export const CHANNELED_SPELL_IDS = new Set<string>([
  // Druid
  'tranquility', 'druid_tranquility',
  'hurricane', 'druid_hurricane',
  // Mage
  'arcane_missiles', 'mage_arcane_missiles',
  'evocation', 'mage_evocation',
  'blizzard', 'mage_blizzard',
  // Priest
  'divine_hymn', 'priest_divine_hymn',
  'hymn_of_hope', 'priest_hymn_of_hope',
  'penance', 'priest_penance',
  'mind_flay', 'priest_mind_flay',
  'mind_sear', 'priest_mind_sear',
  // Warlock
  'drain_soul', 'warlock_drain_soul',
  'drain_life', 'warlock_drain_life',
  'rain_of_fire', 'warlock_rain_of_fire',
  'hellfire', 'warlock_hellfire',
  // Death Knight
  'army_of_the_dead', 'dk_army_of_the_dead',
]);

export interface CastClassificationInput {
  spellId?: string;
  castTimeMs?: number;
  channelDurationMs?: number;
  isChannel?: boolean;
  isInstantOverride?: boolean;
}

export function isChanneledSpell(input: CastClassificationInput): boolean {
  if (input.isInstantOverride) return false;
  if (input.isChannel) return true;
  if (input.castTimeMs === -1) return true;
  if ((input.channelDurationMs ?? 0) > 0) return true;
  if (input.spellId && CHANNELED_SPELL_IDS.has(input.spellId)) return true;
  return false;
}

export function classifySpellCastMode(input: CastClassificationInput): SpellCastMode {
  if (input.isInstantOverride) return 'INSTANT';
  if (isChanneledSpell(input)) return 'CHANNELED';
  if ((input.castTimeMs ?? 0) > 0) return 'CASTED';
  return 'INSTANT';
}

const POLICIES: Record<SpellCastMode, SpellCastLifecyclePolicy> = {
  INSTANT: {
    mode: 'INSTANT',
    deductResourceOnStart: true,
    triggerCooldownOnStart: true,
    deductResourceOnComplete: false,
    triggerCooldownOnComplete: false,
    triggerGcdOnStart: true,
  },
  CASTED: {
    mode: 'CASTED',
    deductResourceOnStart: false,
    triggerCooldownOnStart: false,
    deductResourceOnComplete: true,
    triggerCooldownOnComplete: true,
    triggerGcdOnStart: true,
  },
  CHANNELED: {
    mode: 'CHANNELED',
    deductResourceOnStart: true,
    triggerCooldownOnStart: true,
    deductResourceOnComplete: false,
    triggerCooldownOnComplete: false,
    triggerGcdOnStart: true,
  },
};

export function getCastLifecyclePolicy(mode: SpellCastMode): SpellCastLifecyclePolicy {
  return POLICIES[mode];
}
