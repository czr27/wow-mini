import type { SkillMetrics } from '../ai/SkillMetricEvaluator.js';
import type { BossSkill, BossSkillDbmMeta } from '../bosses/core/BossTypes.js';

export type DbmSeverity = 'INFO' | 'WARN' | 'CRITICAL';
export type DbmRoleHint = 'ALL' | 'TANK' | 'HEALER' | 'DPS';
export type DbmSource = 'AUTO' | 'ENCOUNTER' | 'RUNTIME';

export interface DbmAlert {
  id: string;
  atMs: number;
  title: string;
  advice: string;
  severity: DbmSeverity;
  ttlMs: number;
  roleHint?: DbmRoleHint;
  spellId?: string;
  bossId?: string;
  source?: DbmSource;
}

export interface BossSkillDbmRule {
  spellId: string;
  spellName: string;
  advice: string;
  severity: DbmSeverity;
  roleHint: DbmRoleHint;
  preWarnMs: number;
  ttlMs: number;
  announceOnCast: boolean;
  source: 'AUTO' | 'ENCOUNTER';
}

const MAX_DBM_ALERTS = 32;

export class DbmAlertLog {
  private alerts: DbmAlert[] = [];
  private dedupeUntilMs = new Map<string, number>();

  push(
    partial: Omit<DbmAlert, 'id' | 'atMs' | 'ttlMs'> & {
      id?: string;
      atMs?: number;
      ttlMs?: number;
      dedupeKey?: string;
      cooldownMs?: number;
    }
  ): DbmAlert | null {
    const now = partial.atMs ?? Date.now();
    if (partial.dedupeKey) {
      const until = this.dedupeUntilMs.get(partial.dedupeKey) ?? 0;
      if (now < until) return null;
      this.dedupeUntilMs.set(partial.dedupeKey, now + (partial.cooldownMs ?? 3000));
    }

    const alert: DbmAlert = {
      id: partial.id || `dbm_${now}_${Math.random().toString(36).slice(2, 7)}`,
      atMs: now,
      title: partial.title,
      advice: partial.advice,
      severity: partial.severity,
      ttlMs: partial.ttlMs ?? (partial.severity === 'CRITICAL' ? 4500 : 3500),
      roleHint: partial.roleHint ?? 'ALL',
      spellId: partial.spellId,
      bossId: partial.bossId,
      source: partial.source ?? 'AUTO',
    };

    this.alerts.push(alert);
    if (this.alerts.length > MAX_DBM_ALERTS) {
      this.alerts.splice(0, this.alerts.length - MAX_DBM_ALERTS);
    }
    return alert;
  }

  drain(): DbmAlert[] {
    const out = this.alerts;
    this.alerts = [];
    return out;
  }

  snapshot(): DbmAlert[] {
    return this.alerts.map((a) => ({ ...a }));
  }

  clear(): void {
    this.alerts = [];
    this.dedupeUntilMs.clear();
  }
}

/**
 * 引擎加载/编译首领技能时自动推导 DBM 播报规则：
 * - 优先采用副本设计期显式声明的 `skill.dbm`
 * - 未声明时，根据 `interruptible`、`targetKind`、`SkillMetrics`（AOE/DPS/HPS/CD）自动推算高威胁时期与短建议
 */
export function deriveBossSkillDbmRule(
  skill: BossSkill,
  metrics?: SkillMetrics
): BossSkillDbmRule {
  const explicit: BossSkillDbmMeta | undefined = skill.dbm;
  if (explicit) {
    const sev: DbmSeverity = explicit.severity ?? 'WARN';
    return {
      spellId: skill.id,
      spellName: skill.name,
      advice: explicit.advice,
      severity: sev,
      roleHint: explicit.roleHint ?? 'ALL',
      preWarnMs: explicit.preWarnMs ?? (skill.cooldownMs >= 12000 ? 3000 : 0),
      ttlMs: explicit.ttlMs ?? (sev === 'CRITICAL' ? 4500 : 3500),
      announceOnCast: explicit.announceOnCast ?? true,
      source: 'ENCOUNTER',
    };
  }

  if (skill.interruptible) {
    return {
      spellId: skill.id,
      spellName: skill.name,
      advice: '可打断读条，注意打断！',
      severity: 'CRITICAL',
      roleHint: 'DPS',
      preWarnMs: 0,
      ttlMs: 4200,
      announceOnCast: true,
      source: 'AUTO',
    };
  }

  const isHeal = metrics?.roleType === 'HEAL';
  if (isHeal) {
    return {
      spellId: skill.id,
      spellName: skill.name,
      advice: '首领准备治疗，注意压制或转火',
      severity: 'WARN',
      roleHint: 'DPS',
      preWarnMs: skill.cooldownMs >= 15000 ? 2500 : 0,
      ttlMs: 3500,
      announceOnCast: true,
      source: 'AUTO',
    };
  }

  const isAoe =
    skill.targetKind === 'AOE' ||
    Boolean(metrics?.isAOE) ||
    skill.name.includes('全场') ||
    skill.name.includes('弹幕') ||
    skill.name.includes('灾厄') ||
    skill.name.includes('践踏');

  if (isAoe) {
    return {
      spellId: skill.id,
      spellName: skill.name,
      advice: '全团高威胁 AOE，注意治疗与分散减伤',
      severity: 'WARN',
      roleHint: 'HEALER',
      preWarnMs: skill.cooldownMs >= 10000 ? 3000 : 0,
      ttlMs: 3800,
      announceOnCast: true,
      source: 'AUTO',
    };
  }

  const isHighThreatCast =
    skill.castTimeMs > 0 ||
    skill.cooldownMs >= 12000 ||
    (metrics?.dps ?? 0) >= 4000;

  if (isHighThreatCast) {
    return {
      spellId: skill.id,
      spellName: skill.name,
      advice: '高威胁技能，坦克开减伤，注意治疗',
      severity: 'WARN',
      roleHint: 'TANK',
      preWarnMs: skill.cooldownMs >= 14000 ? 2500 : 0,
      ttlMs: 3500,
      announceOnCast: true,
      source: 'AUTO',
    };
  }

  return {
    spellId: skill.id,
    spellName: skill.name,
    advice: '注意站位与治疗',
    severity: 'INFO',
    roleHint: 'ALL',
    preWarnMs: 0,
    ttlMs: 3000,
    announceOnCast: false,
    source: 'AUTO',
  };
}
