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
  /** true：仅显示文字横幅，不播放语音（语音留到技能即将生效时再喊） */
  silent?: boolean;
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
const SAME_NAME_DEDUPE_MS = 7000;

export class DbmAlertLog {
  private alerts: DbmAlert[] = [];
  private dedupeUntilMs = new Map<string, number>();
  private recentTitleAtMs = new Map<string, number>();
  private mergeStateByKey = new Map<
    string,
    { lastAtMs: number; count: number; baseNames: string[]; prefix: string }
  >();

  push(
    partial: Omit<DbmAlert, 'id' | 'atMs' | 'ttlMs'> & {
      id?: string;
      atMs?: number;
      ttlMs?: number;
      dedupeKey?: string;
      cooldownMs?: number;
      /** 同 replaceKey 在短时间窗内（如同时刷多只小怪）自动合并为一条数量/名称汇总提示 */
      mergeWindowMs?: number;
      mergeItemName?: string;
      mergeTitlePrefix?: string;
    }
  ): DbmAlert | null {
    const now = partial.atMs ?? Date.now();
    if (partial.dedupeKey) {
      const until = this.dedupeUntilMs.get(partial.dedupeKey) ?? 0;
      if (now < until) return null;
      this.dedupeUntilMs.set(partial.dedupeKey, now + Math.max(SAME_NAME_DEDUPE_MS, partial.cooldownMs ?? SAME_NAME_DEDUPE_MS));
    }

    let resolvedTitle = partial.title;
    let isMergedUpdate = false;
    if (partial.replaceKey && partial.mergeWindowMs && partial.mergeWindowMs > 0) {
      const prev = this.mergeStateByKey.get(partial.replaceKey);
      const itemName = (partial.mergeItemName || partial.title).trim();
      const prefix = partial.mergeTitlePrefix ?? '';
      if (prev && now - prev.lastAtMs <= partial.mergeWindowMs) {
        prev.lastAtMs = now;
        prev.count += 1;
        isMergedUpdate = true;
        if (itemName && !prev.baseNames.includes(itemName)) {
          prev.baseNames.push(itemName);
        }
        const namesText =
          prev.baseNames.length <= 2
            ? prev.baseNames.join('、')
            : `${prev.baseNames.slice(0, 2).join('、')} 等`;
        resolvedTitle = `${prefix}${namesText} ×${prev.count}`;
      } else {
        this.mergeStateByKey.set(partial.replaceKey, {
          lastAtMs: now,
          count: 1,
          baseNames: itemName ? [itemName] : [],
          prefix,
        });
      }
    }

    // 同名 DBM（剥离倒计时数字）7s 内不重复播报两遍（同波次合并更新除外）
    const normalizedTitle = resolvedTitle.replace(/\s*\(\d+s\)\s*$/, '').trim();
    if (!isMergedUpdate && normalizedTitle) {
      const lastSameAt = this.recentTitleAtMs.get(normalizedTitle);
      if (lastSameAt !== undefined && now - lastSameAt < SAME_NAME_DEDUPE_MS) {
        return null;
      }
      this.recentTitleAtMs.set(normalizedTitle, now);
    }

    const alert: DbmAlert = {
      id: partial.id || `dbm_${now}_${Math.random().toString(36).slice(2, 7)}`,
      atMs: now,
      title: resolvedTitle,
      advice: partial.advice,
      voiceText: partial.voiceText || toShortVoiceText(partial.advice),
      silent: partial.silent,
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
    this.recentTitleAtMs.clear();
    this.mergeStateByKey.clear();
  }
}

/** 从建议文本提取简短 4 字左右语音词 */
export function toShortVoiceText(advice: string): string {
  const cleaned = advice.replace(/[!！。，,\s]+/g, '');
  if (!cleaned) return '';
  return cleaned.length <= 5 ? cleaned : cleaned.slice(0, 4);
}

/** 判断可打断技能是否属于“巨量伤害 / 治疗复活 / 强负面效应”高威胁技能 */
function isHighThreatInterruptible(skill: BossSkill, metrics?: SkillMetrics): boolean {
  const text = `${skill.name} ${skill.description || ''}`;
  // 1. 明确必断 / 复活 / 首领自愈 / 全团治疗
  if (
    metrics?.roleType === 'HEAL' ||
    /必须打断|必断|复活|自愈|回血|治疗/.test(text)
  ) {
    return true;
  }
  // 2. 强负面效应：心控、变形、高额诅咒/减疗/重毒 DOT
  if (/心控|心灵控制|支配|变形|诅咒|降受疗|减疗|沉默|致死|重毒|剧毒|高额DOT/.test(text)) {
    return true;
  }
  // 3. 巨量伤害或高威胁长CD/长读条AOE，过滤 8~10s 常规填充箭/惩击
  if (/巨量|毁灭|重创|重伤|剧痛|致命|团灭/.test(text)) return true;
  if (skill.targetKind === 'AOE' && (skill.cooldownMs >= 15_000 || skill.castTimeMs >= 2500)) {
    return true;
  }
  return false;
}

/**
 * 引擎加载/编译首领技能时生成 DBM 播报规则：
 * - 优先采用副本设计期显式声明的 `skill.dbm`（分散、分摊、躲柱子、转火等攻略核心机制）
 * - 未显式声明时，仅对高威胁的可打断技能（巨量伤害、治疗/复活、强负面效应）生成「注意打断」
 * - 常规小技能、普通读条填充与常规掉血不再自动刷屏报警
 */
export function deriveBossSkillDbmRule(
  skill: BossSkill,
  metrics?: SkillMetrics
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
      preWarnMs: explicit.preWarnMs ?? 0,
      ttlMs: explicit.ttlMs ?? (sev === 'CRITICAL' ? 4500 : 3500),
      announceOnCast: explicit.announceOnCast ?? true,
      source: 'ENCOUNTER',
    };
  }

  if (skill.interruptible && isHighThreatInterruptible(skill, metrics)) {
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
