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
  /** 4字短语音播报词（如 "注意分散"、"注意打断"、"先杀小怪"） */
  voiceText?: string;
  /** 同 replaceKey 的新警报会直接顶替旧警报（如 即将施放 -> 正在施放） */
  replaceKey?: string;
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
  voiceText: string;
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
      voiceText: partial.voiceText || toShortVoiceText(partial.advice),
      replaceKey: partial.replaceKey,
      severity: partial.severity,
      ttlMs: partial.ttlMs ?? (partial.severity === 'CRITICAL' ? 4500 : 3500),
      roleHint: partial.roleHint ?? 'ALL',
      spellId: partial.spellId,
      bossId: partial.bossId,
      source: partial.source ?? 'AUTO',
    };

    if (alert.replaceKey) {
      const idx = this.alerts.findIndex((a) => a.replaceKey === alert.replaceKey);
      if (idx >= 0) {
        this.alerts[idx] = alert;
        return alert;
      }
    }

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

/** 从建议文本提取简短 4 字左右语音词 */
export function toShortVoiceText(advice: string): string {
  const cleaned = advice.replace(/[!！。，,\s]+/g, '');
  if (!cleaned) return '';
  return cleaned.length <= 5 ? cleaned : cleaned.slice(0, 4);
}

/**
 * 引擎加载/编译首领技能时生成 DBM 播报规则：
 * - 优先采用副本设计期显式声明的 `skill.dbm`（分散、分摊、躲柱子、转火等攻略核心机制）
 * - 未显式声明时，仅对 `interruptible === true` 自动生成「注意打断」提醒
 * - 常规掉血 / 减伤 / 治疗等玩家凭血条即可判断的技能不再自动刷屏报警
 */
export function deriveBossSkillDbmRule(
  skill: BossSkill,
  _metrics?: SkillMetrics
): BossSkillDbmRule | null {
  const explicit: BossSkillDbmMeta | undefined = skill.dbm;
  if (explicit) {
    const sev: DbmSeverity = explicit.severity ?? 'WARN';
    return {
      spellId: skill.id,
      spellName: skill.name,
      advice: explicit.advice,
      voiceText: explicit.voiceText || toShortVoiceText(explicit.advice),
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
      advice: '注意打断',
      voiceText: '注意打断',
      severity: 'CRITICAL',
      roleHint: 'DPS',
      preWarnMs: 0,
      ttlMs: 3800,
      announceOnCast: true,
      source: 'AUTO',
    };
  }

  return null;
}
