import type { Unit } from '../../types.js';
import type { CombatEngine } from '../../engine/CombatEngine.js';
import type { BossSkill, BossEncounterModule } from './BossTypes.js';
import { BossRegistry } from './BossRegistry.js';
import {
  computeSkillMetrics,
  createAIPersonality,
  scoreSkillCandidate,
  PREDEFINED_SKILL_INPUTS,
  type SkillMetrics,
  type AIPersonality,
} from '../../ai/SkillMetricEvaluator.js';
import {
  deriveBossSkillDbmRule,
  type BossSkillDbmRule,
} from '../../engine/DbmManager.js';
import {
  BossTrashTalkDeck,
  isHighThreatBossSkill,
} from './BossTrashTalk.js';

/**
 * [BaseBossAI] 公共首领控制逻辑基类
 * 负责通用读条判定、CD流转、射程与视线判定、通用打断与安全治疗窗口
 * 具体技能与专属机制委托给按副本拆分的 BossEncounterModule
 */
export class BaseBossAI {
  public skills: BossSkill[] = [];
  public currentCasting: {
    skill: BossSkill;
    elapsedMs: number;
  } | null = null;

  /** 头顶铭牌：最近一次非普攻技能名（读条开始 / 瞬发释放时刷新） */
  public lastSkillName: string | null = null;
  public lastSkillAtMs = 0;

  /** 窒息术后安全治疗窗口期（首领行动锁定） */
  public asphyxiatePostDelay = 0;

  /** 当前加载的副本首领特性模块 */
  public encounterModule: BossEncounterModule | null = null;

  /** 首领个性画像与技能性能评估指标缓存 */
  public bossPersonality: AIPersonality | null = null;
  public skillMetricsMap = new Map<string, SkillMetrics>();
  /** 引擎初始化时自动推导/编译的 DBM 预警规则表 */
  public dbmRulesMap = new Map<string, BossSkillDbmRule>();
  private dbmPreWarnedCycle = new Map<string, number>();
  private dbmLastAnnouncedCastSkillId: string | null = null;
  private trashTalkDeck: BossTrashTalkDeck;
  private lastTrashTalkAtMs = -10_000;
  private dbmVoicedCastKey = '';

  constructor(public bossId: string, public dungeonId?: string) {
    this.trashTalkDeck = new BossTrashTalkDeck(bossId);
    this.initBossSkills();
  }

  protected initBossSkills() {
    const module = BossRegistry.get(this.bossId, this.dungeonId);
    if (module) {
      this.encounterModule = module;
      this.skills = module.createSkills(this);
    } else {
      // 容错回退机制：若未注册，使用通用首领技能模版
      this.skills = [
        {
          id: 'generic_strike',
          name: '首领重击',
          castTimeMs: 0,
          cooldownMs: 8000,
          lastCastMs: -3000,
          interruptible: false,
          school: 'PHYSICAL',
          range: 80,
          targetKind: 'MELEE_TARGET',
          description: '对主目标造成物理重击',
          execute: (boss, engine) => {
            const tank = engine.friendlyUnits.find(u => u.alive && u.role === 'TANK') || engine.friendlyUnits[0];
            if (tank) {
              engine.dealDamage(boss, tank, 25000, 'PHYSICAL', false, '首领重击');
            }
          },
        },
      ];
    }

    // 初始化首领所有技能的 DPS, HPS, CD密度, isAOE, 大小周期与性价比指标
    this.skillMetricsMap.clear();
    this.dbmRulesMap.clear();
    this.dbmPreWarnedCycle.clear();
    this.dbmLastAnnouncedCastSkillId = null;
    for (const skill of this.skills) {
      const predefined = PREDEFINED_SKILL_INPUTS['boss_' + skill.id] || PREDEFINED_SKILL_INPUTS[skill.id];
      if (predefined) {
        this.skillMetricsMap.set(skill.id, computeSkillMetrics(predefined));
      } else {
        const isHeal = skill.name.includes('愈') || skill.name.includes('治') || skill.description.includes('愈') || skill.description.includes('血');
        const isAOE = skill.targetKind === 'AOE' || skill.name.includes('全场') || skill.name.includes('弹幕') || skill.name.includes('灾厄');
        this.skillMetricsMap.set(
          skill.id,
          computeSkillMetrics({
            id: skill.id,
            name: skill.name,
            roleType: isHeal ? 'HEAL' : 'DAMAGE',
            castTimeMs: skill.castTimeMs,
            cooldownMs: skill.cooldownMs,
            resourceCost: 0,
            rawDamage: isHeal ? 0 : (skill.castTimeMs > 0 ? 35000 : 22000),
            rawHeal: isHeal ? 45000 : 0,
            isAOE,
            maxAoeTargets: isAOE ? 5 : 1,
            description: skill.description,
          })
        );
      }
      const computedMetrics = this.skillMetricsMap.get(skill.id);
      const dbmRule = deriveBossSkillDbmRule(skill, computedMetrics);
      if (dbmRule) {
        this.dbmRulesMap.set(skill.id, dbmRule);
      }
    }
  }

  public tick(deltaMs: number, boss: Unit, engine: CombatEngine) {
    if (!boss.alive || !boss.isAlive || boss.hp <= 0) {
      this.currentCasting = null;
      return;
    }

    // 懒加载生成首领专属个性画像 (基于首领名字与 ID 作为随机数种进行抖动)
    if (!this.bossPersonality) {
      this.bossPersonality = createAIPersonality(boss.name || this.bossId, boss.id || this.bossId);
    }

    // 1. 首领硬直与安全治疗窗口校验
    if (this.asphyxiatePostDelay > 0) {
      this.asphyxiatePostDelay = Math.max(0, this.asphyxiatePostDelay - deltaMs);
      return;
    }

    // 2. 触发特定首领的自定义 Tick 钩子
    if (this.encounterModule?.onTick) {
      this.encounterModule.onTick(deltaMs, boss, engine, this);
    }

    // 2.5 DBM 高威胁技能即将就绪预告（由 initBossSkills 自动推导的规则驱动）
    this.tickDbmPreWarnings(engine);

    // 3. 推进当前施法读条
    if (this.currentCasting) {
      // 兼容 encounter 直接塞 currentCasting 的路径，保证头顶能显示技能名
      if (this.lastSkillName !== this.currentCasting.skill.name) {
        this.lastSkillName = this.currentCasting.skill.name;
        this.lastSkillAtMs = engine.nowMs;
      }
      if (this.dbmLastAnnouncedCastSkillId !== this.currentCasting.skill.id) {
        this.dbmLastAnnouncedCastSkillId = this.currentCasting.skill.id;
        this.emitSkillDbmAlert(engine, this.currentCasting.skill, 'CAST_START');
      }
      this.currentCasting.elapsedMs += deltaMs;
      // 长读条：剩余 ≤2s 时补发语音（文字横幅沿用同 replaceKey 顶替）
      {
        const cs = this.currentCasting.skill;
        const rule = this.dbmRulesMap.get(cs.id);
        if (
          rule &&
          rule.announceOnCast &&
          cs.castTimeMs > 2500 &&
          this.dbmVoicedCastKey !== `${cs.id}_${cs.lastCastMs}` &&
          cs.castTimeMs - this.currentCasting.elapsedMs <= 2000 &&
          typeof engine.emitDbmAlert === 'function'
        ) {
          this.dbmVoicedCastKey = `${cs.id}_${cs.lastCastMs}`;
          engine.emitDbmAlert({
            title: `即将生效：${cs.name}`,
            advice: rule.advice,
            voiceText: rule.voiceText,
            replaceKey: `skill_${this.bossId}_${cs.id}`,
            severity: rule.severity,
            ttlMs: 2500,
            roleHint: rule.roleHint,
            spellId: cs.id,
            bossId: this.bossId,
            source: rule.source,
            dedupeKey: `voice_${this.bossId}_${cs.id}`,
            cooldownMs: 1800,
          });
        }
      }
      if (this.currentCasting.elapsedMs >= this.currentCasting.skill.castTimeMs) {
        // 施法完成！
        const finished = this.currentCasting.skill;
        finished.execute(boss, engine);
        finished.lastCastMs = engine.nowMs;
        this.lastSkillName = finished.name;
        this.lastSkillAtMs = engine.nowMs;
        this.emitSkillHitFx(boss, engine, finished, 'CAST_LAND');
        this.currentCasting = null;
        this.dbmLastAnnouncedCastSkillId = null;
      }
      return;
    }
    this.dbmLastAnnouncedCastSkillId = null;

    // 4. 智能技能评估与选择：遍历满足冷却与射程的候选技能，通过 DPS/HPS、大小周期与输出性价比多维评分择优释放
    const readyCandidates: { skill: BossSkill; metrics: SkillMetrics; score: number }[] = [];
    const targetId = engine.getBossTargetId();
    const primaryTarget =
      engine.friendlyUnits.find(u => u.id === targetId && (u.alive ?? u.isAlive)) ||
      engine.friendlyUnits.find(u => (u.alive ?? u.isAlive) && u.role === 'TANK' && !u.isPet && u.unitKind !== 'PET') ||
      engine.friendlyUnits.find(u => (u.alive ?? u.isAlive) && !u.isPet && u.unitKind !== 'PET') ||
      engine.friendlyUnits.find(u => (u.alive ?? u.isAlive));

    const bPos = boss.position || { x: 540, y: 190 };
    const tickCount = Math.floor(engine.nowMs / 50);
    const isEmergency = boss.maxHp > 0 && (boss.hp / boss.maxHp) < 0.35;

    for (const skill of this.skills) {
      if (engine.nowMs - skill.lastCastMs >= skill.cooldownMs) {
        // 射程与距离约束校验
        if (skill.targetKind === 'MELEE_TARGET') {
          if (!primaryTarget) continue;
          const tPos = primaryTarget.position || { x: 180, y: 190 };
          const dist = Math.hypot(bPos.x - tPos.x, bPos.y - tPos.y);
          if (dist > (skill.range ?? 80)) {
            // 超出近战攻击距离，暂不能施法
            continue;
          }
        } else if (skill.targetKind === 'RANGED_TARGET') {
          if (!primaryTarget) continue;
          const tPos = primaryTarget.position || { x: 180, y: 190 };
          const dist = Math.hypot(bPos.x - tPos.x, bPos.y - tPos.y);
          if (dist > (skill.range ?? 320)) {
            // 超出远程法术距离，暂不能施法
            continue;
          }
        } else if (skill.targetKind === 'AOE') {
          const maxAllowed = skill.range ?? 360;
          const hasTargetInRange = engine.friendlyUnits.some(u => {
            if (!(u.alive ?? u.isAlive)) return false;
            const uPos = u.position || { x: 180, y: 190 };
            return Math.hypot(bPos.x - uPos.x, bPos.y - uPos.y) <= maxAllowed;
          });
          if (!hasTargetInRange) {
            // 范围内无存活玩家
            continue;
          }
        }

        const metrics = this.skillMetricsMap.get(skill.id) || computeSkillMetrics({
          id: skill.id,
          name: skill.name,
          roleType: 'DAMAGE',
          castTimeMs: skill.castTimeMs,
          cooldownMs: skill.cooldownMs,
          resourceCost: 0,
        });

        const score = scoreSkillCandidate(metrics, {
          caster: boss,
          personality: this.bossPersonality,
          target: primaryTarget,
          allies: [boss],
          enemies: engine.friendlyUnits,
          tickCount,
          isEmergency,
        });

        readyCandidates.push({ skill, metrics, score });
      }
    }

    if (readyCandidates.length > 0) {
      // 按智能评分由高到低排序，择优施放
      readyCandidates.sort((a, b) => b.score - a.score);
      const chosen = readyCandidates[0].skill;

      if (chosen.castTimeMs > 0) {
        this.currentCasting = { skill: chosen, elapsedMs: 0 };
        this.lastSkillName = chosen.name;
        this.lastSkillAtMs = engine.nowMs;
        this.dbmLastAnnouncedCastSkillId = chosen.id;
        this.emitSkillDbmAlert(engine, chosen, 'CAST_START');
        this.maybeEmitTrashTalk(boss, engine, chosen);
      } else {
        chosen.execute(boss, engine);
        chosen.lastCastMs = engine.nowMs;
        this.lastSkillName = chosen.name;
        this.lastSkillAtMs = engine.nowMs;
        this.emitSkillHitFx(boss, engine, chosen, 'INSTANT');
        this.emitSkillDbmAlert(engine, chosen, 'INSTANT');
        this.maybeEmitTrashTalk(boss, engine, chosen);
      }
    }
  }

  private tickDbmPreWarnings(engine: CombatEngine): void {
    if (typeof engine.emitDbmAlert !== 'function') return;
    for (const skill of this.skills) {
      const rule = this.dbmRulesMap.get(skill.id);
      if (!rule || rule.preWarnMs <= 0) continue;
      const elapsedSinceLast = engine.nowMs - skill.lastCastMs;
      const remaining = skill.cooldownMs - elapsedSinceLast;
      if (remaining > 0 && remaining <= rule.preWarnMs) {
        const lastWarnedCast = this.dbmPreWarnedCycle.get(skill.id);
        if (lastWarnedCast === skill.lastCastMs) continue;
        this.dbmPreWarnedCycle.set(skill.id, skill.lastCastMs);
        const sec = Math.max(1, Math.ceil(remaining / 1000));
        engine.emitDbmAlert({
          title: `即将施放：${skill.name} (${sec}s)`,
          advice: rule.advice,
          voiceText: rule.voiceText,
          silent: true,
          replaceKey: `skill_${this.bossId}_${skill.id}`,
          severity: rule.severity === 'CRITICAL' ? 'WARN' : rule.severity,
          ttlMs: Math.min(3500, Math.max(2000, remaining + 600)),
          roleHint: rule.roleHint,
          spellId: skill.id,
          bossId: this.bossId,
          source: rule.source,
          dedupeKey: `prewarn_${this.bossId}_${skill.id}`,
          cooldownMs: Math.max(2500, rule.preWarnMs),
        });
      }
    }
  }

  private emitSkillDbmAlert(
    engine: CombatEngine,
    skill: BossSkill,
    phase: 'CAST_START' | 'INSTANT'
  ): void {
    if (typeof engine.emitDbmAlert !== 'function') return;
    const rule = this.dbmRulesMap.get(skill.id);
    if (!rule || !rule.announceOnCast) return;
    if (phase === 'INSTANT' && rule.severity === 'INFO') return;
    const prefix = phase === 'CAST_START' ? '正在施放' : '首领技能';
    // 长读条（>2.5s）开始时只出文字，语音推迟到读条剩余约 2s 再喊，避免提前 5~9 秒
    const deferVoice = phase === 'CAST_START' && skill.castTimeMs > 2500;
    engine.emitDbmAlert({
      title: `${prefix}：${skill.name}`,
      advice: rule.advice,
      voiceText: rule.voiceText,
      silent: deferVoice,
      replaceKey: `skill_${this.bossId}_${skill.id}`,
      severity: rule.severity,
      ttlMs: rule.ttlMs,
      roleHint: rule.roleHint,
      spellId: skill.id,
      bossId: this.bossId,
      source: rule.source,
      dedupeKey: `cast_${this.bossId}_${skill.id}`,
      cooldownMs: 1800,
    });
  }

  /** 高威胁大招触发时，按 Boss 个性洗牌袋输出不重复随机狠话 */
  private maybeEmitTrashTalk(
    boss: Unit,
    engine: CombatEngine,
    skill: BossSkill
  ): void {
    const rule = this.dbmRulesMap.get(skill.id);
    if (!isHighThreatBossSkill(skill, rule)) return;
    if (engine.nowMs - this.lastTrashTalkAtMs < 4000) return;
    this.lastTrashTalkAtMs = engine.nowMs;

    const line =
      skill.trashTalk && skill.trashTalk.length > 0
        ? skill.trashTalk[Math.floor(Math.random() * skill.trashTalk.length)]
        : this.trashTalkDeck.nextLine();

    engine.effectsManager?.addFloatingText({
      id: `tt_${boss.id}_${engine.nowMs}_${Math.random()}`,
      targetId: boss.id,
      sourceId: boss.id,
      text: `🗣️「${line}」`,
      category: 'STATUS',
      isCrit: true,
    });
  }

  /** 为头顶铭牌配套：记一条可同步的命中特效（投掷物 / 切割 / AoE 光环） */
  private emitSkillHitFx(
    boss: Unit,
    engine: CombatEngine,
    skill: BossSkill,
    kind: 'CAST_LAND' | 'INSTANT'
  ): void {
    const targetId =
      engine.getBossTargetId() ||
      engine.friendlyUnits.find(u => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0 && !u.isPet && u.unitKind !== 'PET')?.id ||
      engine.friendlyUnits.find(u => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0)?.id ||
      null;
    const isAoe =
      skill.targetKind === 'AOE' ||
      skill.name.includes('全场') ||
      skill.name.includes('弹幕') ||
      skill.name.includes('灾厄');
    if (isAoe && boss.position) {
      engine.logCombatAction({
        actorId: boss.id,
        spellId: skill.id || skill.name,
        spellName: skill.name,
        kind,
        targetId,
        x: boss.position.x,
        y: boss.position.y,
        radius: Math.max(40, skill.range || 120),
        aoePulse: true,
        visualTone: 'ENEMY',
      });
      return;
    }
    if (!targetId) return;
    engine.logCombatAction({
      actorId: boss.id,
      spellId: skill.id || skill.name,
      spellName: skill.name,
      kind,
      targetId,
      visualTone: 'ENEMY',
    });
  }

  public isActionLocked(): boolean {
    if (this.asphyxiatePostDelay > 0) return true;
    if (this.encounterModule?.isActionLocked?.(this)) return true;
    return false;
  }

  /** 窒息后技能锁定（含 1s 停手 + 5s 仅普攻），不等于禁伤窗 */
  public isHealingGracePeriod(): boolean {
    return this.asphyxiatePostDelay > 0;
  }

  public getPostAsphyxiateRemainingMs(): number {
    return this.asphyxiatePostDelay;
  }

  /** 窒息后仅普攻阶段：技能仍锁，但允许对仇恨目标普攻 */
  public isMeleeOnlyPeriod(): boolean {
    return this.asphyxiatePostDelay > 0;
  }

  public interruptCurrentCast(): boolean {
    if (this.currentCasting && this.currentCasting.skill.interruptible) {
      this.currentCasting.skill.lastCastMs = Date.now(); // 施法打断进入冷却
      this.currentCasting = null;
      return true;
    }
    return false;
  }
}

/** 保持命名兼容 */
export { BaseBossAI as BossAI };
