import type { Unit } from '../../types.js';
import type { CombatEngine } from '../../engine/CombatEngine.js';

import type { DbmRoleHint, DbmSeverity } from '../../engine/DbmManager.js';

export type TargetKind = 'MELEE_TARGET' | 'RANGED_TARGET' | 'AOE' | 'SELF';

export interface BossSkillDbmMeta {
  /** 简短战术建议（如 "注意分散"、"近距分摊"、"躲柱子后"、"先杀小怪"） */
  advice: string;
  /** 4 字短语音播报词（默认取 advice 精简词） */
  voiceText?: string;
  severity?: DbmSeverity;
  roleHint?: DbmRoleHint;
  /** 技能冷却即将结束前多少毫秒发出高威胁预告（0 表示不提前预告） */
  preWarnMs?: number;
  ttlMs?: number;
  announceOnCast?: boolean;
}

export interface BossSkill {
  id: string;
  name: string;
  castTimeMs: number;
  cooldownMs: number;
  lastCastMs: number;
  interruptible: boolean;
  school: 'PHYSICAL' | 'SHADOW' | 'FIRE' | 'FROST' | 'NATURE';
  description: string;
  range?: number;
  targetKind?: TargetKind;
  /** 可选：副本设计期显式声明的 DBM 战术建议；未声明时引擎自动推导 */
  dbm?: BossSkillDbmMeta;
  execute: (boss: Unit, engine: CombatEngine) => void;
}

/**
 * 首领个体特性接口 (按副本进行拆分扩展)
 * 允许各副本首领实现自己专属的技能组、特殊状态、阶段转换与独立走位
 */
export interface BossEncounterModule {
  id: string;               // 首领唯一标识 (如 'ashbury', 'godfrey', 'morchok')
  name: string;             // 首领中文名称 (如 '亚什布里男爵')
  dungeonId: string;        // 所属副本标识 (如 'shadowfang_keep', 'dragon_soul')
  tier?: '5man' | '20man';  // 对应副本规模

  /** 创建并初始化该首领专属的技能列表与时间轴 */
  createSkills(bossAi: any): BossSkill[];

  /** 可选：每 Tick 触发的个体特性逻辑 (如阶段检测、特殊光环、环境交互等) */
  onTick?(deltaMs: number, boss: Unit, engine: CombatEngine, bossAi: any): void;

  /** 可选：首领是否正处于不可行动的硬直/治疗窗口期 */
  isActionLocked?(bossAi: any): boolean;
}
