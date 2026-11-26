import {
  BossAI,
  CombatEngine,
  LEVEL_80_MAX_HASTE,
  LEVEL_80_STATS,
  ReportManager,
  RunStateMachine,
  clampPosWithinTankRange,
  computeDungeonPriorityZone,
  createLevel80BaseStats,
  ensureDkRunes,
  evaluateGroundFormationPosition,
  findLooseAddForTank,
  getCombatFormationPos,
  getDungeonConfig,
  getOrCreateUnitAIPersonality,
  getRoleBySpec,
  getUnitHaste,
  getUnitMoveSpeedMultiplier,
  inferAiSpecForUnit,
  isAiCdReady,
  isTotemUnit,
  orderTanksByThreatPriority,
  resolveUnitFacingRad,
  spawnGmWildPack,
  tickEnemyAdds,
  markAiCdUsed,
  notifyOom,
  runFriendlyAiCombatTick,
  syncUnitResources,
  type AIPersonality,
  type AiActiveCast,
  type ClassId,
  type CombatBatch,
  type CombatEffect,
  type GmCommandPayload,
  type LobbyRoom,
  type NetworkCastTimeline,
  type NetworkCombatSnapshot,
  type NetworkCooldownTimeline,
  type NetworkGcdTimeline,
  type NetworkGroundEffectSnapshot,
  type NetworkUnitSnapshot,
  type OwnerSnapshot,
  type PlayerInputPayload,
  type RoomMember,
  type RunPhase,
  type Unit,
} from '@cata-raid-sim/engine';

const TICK_MS = 50;
const BROADCAST_EVERY_TICKS = 4; // ~200ms
const ACK_RING_MAX = 64;
const EFFECT_RING_MAX = 256;

export interface RoomCombatCallbacks {
  broadcastCombatState: (roomId: string, snap: NetworkCombatSnapshot) => void;
  broadcastCombatBatch: (roomId: string, batch: CombatBatch) => void;
  onEnterWipeVote: (roomId: string) => void;
  onEnterSummary: (roomId: string) => void;
  onRoomMetaUpdate: (roomId: string, snap: NetworkCombatSnapshot) => void;
}

export class RoomCombatSession {
  readonly roomId: string;
  readonly engine: CombatEngine;
  readonly reportManager: ReportManager;
  readonly rsm: RunStateMachine;

  private bossAi: BossAI | null = null;
  private approachedBossId: string | null = null;
  private aiCasts: Record<string, AiActiveCast> = {};
  private aiCurrentCasts: Record<string, any> = {};
  private aiCooldowns: Record<string, number> = {};
  private aiPersonalities = new Map<string, AIPersonality>();
  private addLastAttackMs = new Map<string, number>();
  private lastOomWarningMs: Record<string, number> = {};
  private srvEffectSeq = 0;
  private pendingDbmAlerts: any[] = [];

  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private tickCount = 0;
  private seq = 0;
  private lastBossAttackTick = 0;
  private prevPhase: RunPhase = 'LOBBY';
  private disposed = false;

  // Idempotent input & effect tracking
  private processedInputIds = new Set<string>();
  private processedInputOrder: string[] = [];
  private ackedInputRing: string[] = [];

  private appliedEffectIds = new Set<string>();
  private appliedEffectOrder: string[] = [];

  // Gather queues for COMBAT_BATCH (~200ms)
  private pendingEffects: CombatEffect[] = [];
  private pendingSnapshots = new Map<string, OwnerSnapshot>();

  constructor(
    room: LobbyRoom,
    private readonly callbacks: RoomCombatCallbacks,
    autoStartTimer = true
  ) {
    this.roomId = room.id;
    this.engine = new CombatEngine();
    this.installServerHumanEffectInterceptor();
    this.reportManager = new ReportManager();
    const cfg = getDungeonConfig(room.dungeonId, room.difficulty);
    this.rsm = new RunStateMachine(cfg, this.engine, this.reportManager);

    this.setupUnits(room);
    this.rsm.startRun();
    this.prevPhase = this.rsm.phase;

    if (autoStartTimer) {
      this.tickTimer = setInterval(() => this.tick(TICK_MS), TICK_MS);
      if (typeof (this.tickTimer as any).unref === 'function') {
        (this.tickTimer as any).unref();
      }
    }
  }

  /**
   * 服务端 BossAI / AI 队友对真人权威单位产生伤害、治疗、复活或 Buff 时，
   * 自动生成 COMBAT_EFFECT 推入 COMBAT_BATCH 下发给对应真人权威客户端结算。
   */
  private installServerHumanEffectInterceptor() {
    const origDeal = this.engine.dealDamage.bind(this.engine);
    this.engine.dealDamage = (attacker, defender, amount, school, isCrit, spellName, isDot) => {
      if (defender && !this.isServerAuthorityUnit(defender.id) && amount > 0) {
        this.pendingEffects.push({
          effectId: `srv_eff_${++this.srvEffectSeq}`,
          sourceId: attacker?.id || 'server',
          targetId: defender.id,
          spellId: spellName || 'boss_attack',
          spellName: spellName || '攻击',
          kind: 'DAMAGE',
          amount: Math.round(amount),
          isCrit: !!isCrit,
          atMs: Date.now(),
        });
      }
      return origDeal(attacker, defender, amount, school, isCrit, spellName, isDot);
    };

    const origDrain = this.engine.drainHpTowardFloor.bind(this.engine);
    this.engine.drainHpTowardFloor = (target, amount, floorHp = 1, spellName = '窒息术') => {
      if (target && !this.isServerAuthorityUnit(target.id)) {
        const drained = Math.min(Math.max(0, Math.round(amount)), Math.max(0, target.hp - floorHp));
        if (drained > 0) {
          this.pendingEffects.push({
            effectId: `srv_eff_${++this.srvEffectSeq}`,
            sourceId: this.engine.bossUnit?.id || 'server',
            targetId: target.id,
            spellId: spellName === '窒息术' ? 'asphyxiate' : spellName || 'asphyxiate',
            spellName: spellName || '窒息术',
            kind: 'DAMAGE',
            amount: drained,
            isCrit: false,
            atMs: Date.now(),
          });
        }
        return drained;
      }
      return origDrain(target, amount, floorHp, spellName);
    };

    const origHeal = this.engine.healUnit.bind(this.engine);
    this.engine.healUnit = (healer, target, amount, isCrit, spellName, isHot) => {
      if (target && !this.isServerAuthorityUnit(target.id) && amount > 0) {
        this.pendingEffects.push({
          effectId: `srv_eff_${++this.srvEffectSeq}`,
          sourceId: healer?.id || 'server',
          targetId: target.id,
          spellId: spellName || 'ai_heal',
          spellName: spellName || '治疗',
          kind: 'HEAL',
          amount: Math.round(amount),
          isCrit: !!isCrit,
          atMs: Date.now(),
        });
      }
      return origHeal(healer, target, amount, isCrit, spellName, isHot);
    };

    const origRez = this.engine.resurrectUnit.bind(this.engine);
    this.engine.resurrectUnit = (unitId, hpFrac, mpFrac) => {
      const ok = origRez(unitId, hpFrac, mpFrac);
      if (ok && !this.isServerAuthorityUnit(unitId)) {
        this.pendingEffects.push({
          effectId: `srv_eff_${++this.srvEffectSeq}`,
          sourceId: 'server',
          targetId: unitId,
          spellId: 'ai_resurrect',
          kind: 'RESURRECT',
          atMs: Date.now(),
        });
      }
      return ok;
    };

    const origApplyBuff = this.engine.applyBuff.bind(this.engine);
    this.engine.applyBuff = (target, buff) => {
      if (target && !this.isServerAuthorityUnit(target.id) && buff) {
        this.pendingEffects.push({
          effectId: `srv_eff_${++this.srvEffectSeq}`,
          sourceId: buff.sourceUnitId || 'server',
          targetId: target.id,
          spellId: buff.spellId || buff.id,
          spellName: buff.name,
          kind: 'APPLY_BUFF',
          buff: {
            spellId: buff.spellId || buff.id,
            name: buff.name,
            kind: buff.kind,
            tags: buff.tags as string[] | undefined,
            stacks: buff.stacks,
            maxStacks: buff.maxStacks,
            durationMs: buff.durationMs,
            remainingMs: buff.remainingMs,
            school: buff.school,
            tickIntervalMs: buff.tickIntervalMs,
            tickValue: buff.tickValue,
            moveSpeedMod: buff.moveSpeedMod,
          },
          atMs: Date.now(),
        });
      }
      return origApplyBuff(target, buff);
    };

    const origRemoveBuff = this.engine.auraManager.removeBuff.bind(this.engine.auraManager);
    this.engine.auraManager.removeBuff = (unit, buffIdOrSpellId, sourceId) => {
      const removed = origRemoveBuff(unit, buffIdOrSpellId, sourceId);
      if (removed && unit && !this.isServerAuthorityUnit(unit.id) && buffIdOrSpellId) {
        this.pendingEffects.push({
          effectId: `srv_eff_${++this.srvEffectSeq}`,
          sourceId: sourceId || '',
          targetId: unit.id,
          spellId: buffIdOrSpellId,
          removeSpellId: buffIdOrSpellId,
          kind: 'REMOVE_BUFF',
          atMs: Date.now(),
        });
      }
      return removed;
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.pendingEffects = [];
    this.pendingSnapshots.clear();
  }

  private setupUnits(room: LobbyRoom) {
    this.engine.reset();
    this.engine.difficulty = room.difficulty;
    if (room.customDifficulty) {
      this.engine.customDifficulty = room.customDifficulty;
    }
    const isCustom = room.difficulty === 'CUSTOM';
    const playerHpMult = isCustom ? Math.max(0.1, room.customDifficulty?.playerHpCoeff ?? 1) : 1;
    const playerMpMult = isCustom ? Math.max(0.1, room.customDifficulty?.playerMpCoeff ?? 1) : 1;
    const aiHpMult = isCustom ? Math.max(0.1, room.customDifficulty?.aiHpCoeff ?? 1) : 1;
    const aiMpMult = isCustom ? Math.max(0.1, room.customDifficulty?.aiMpCoeff ?? 1) : 1;

    room.members.forEach((m, idx) => {
      const unit = this.buildUnitFromMember(m, idx, {
        playerHpMult,
        playerMpMult,
        aiHpMult,
        aiMpMult,
      });
      this.engine.addUnit(unit);
    });
  }

  private buildUnitFromMember(
    m: RoomMember,
    idx: number,
    mults?: { playerHpMult: number; playerMpMult: number; aiHpMult: number; aiMpMult: number }
  ): Unit {
    const role = (m.role || getRoleBySpec(m.classId, m.spec)) as 'TANK' | 'HEALER' | 'DPS';
    const base = createLevel80BaseStats(role);
    const hasMana =
      role === 'HEALER' ||
      m.classId === 'MAGE' ||
      m.classId === 'SHAMAN' ||
      m.classId === 'PRIEST' ||
      m.classId === 'WARLOCK' ||
      m.classId === 'PALADIN' ||
      (m.classId === 'DRUID' && role === 'DPS');
    const baseMp = hasMana
      ? role === 'HEALER'
        ? LEVEL_80_STATS.healerBaseMp
        : LEVEL_80_STATS.casterBaseMp
      : 0;

    const baseHp =
      role === 'TANK' ? LEVEL_80_STATS.tankBaseHp : LEVEL_80_STATS.dpsHealerBaseHp;
    const hpMult = m.isAi ? (mults?.aiHpMult ?? 1) : (mults?.playerHpMult ?? 1);
    const mpMult = m.isAi ? (mults?.aiMpMult ?? 1) : (mults?.playerMpMult ?? 1);
    const maxHp = Math.round(baseHp * hpMult);
    const maxMp = Math.round(baseMp * mpMult);

    const pos = {
      x: role === 'TANK' ? 440 : role === 'HEALER' ? 140 : 220,
      y: 160 + (idx % 5) * 20,
    };

    const unit = {
      id: m.id,
      name: m.name,
      classId: m.classId as ClassId,
      spec: m.spec,
      role,
      isPlayer: !m.isAi,
      isHumanControlled: !m.isAi,
      isAi: !!m.isAi,
      unitKind: m.isAi ? 'AI' : 'PLAYER',
      isAlive: true,
      alive: true,
      hp: maxHp,
      maxHp,
      mp: maxMp,
      maxMp,
      energy: m.classId === 'ROGUE' ? 100 : undefined,
      rage: m.classId === 'WARRIOR' || (m.classId === 'DRUID' && role === 'TANK') ? 40 : undefined,
      focus: m.classId === 'HUNTER' ? 100 : undefined,
      runicPower: m.classId === 'DK' ? 0 : undefined,
      holyPower: m.classId === 'PALADIN' ? 1 : undefined,
      absorb: 0,
      position: pos,
      buffs: [],
      threatTable: {},
      resources: maxMp > 0 ? [{ kind: 'MANA', current: maxMp, max: maxMp }] : [],
      stats: { ...base, haste: LEVEL_80_MAX_HASTE },
      combatStats: {
        damageDealt: 0,
        healingDone: 0,
        overhealDone: 0,
        damageTaken: 0,
        interruptCount: 0,
      },
    } as unknown as Unit;
    if (m.classId === 'DK') ensureDkRunes(unit);
    syncUnitResources(unit);
    return unit;
  }

  /** Server owns Boss, Enemies, AI teammates, and AI/Boss pets — never human players or their pets. */
  isServerAuthorityUnit(unitId: string): boolean {
    if (!unitId) return true;
    const u = this.engine.getUnit(unitId);
    if (!u) return true;
    if (u.isHumanControlled && !(u as any).isAi) return false;
    if (u.ownerId) {
      const owner = this.engine.getUnit(u.ownerId);
      if (owner && owner.isHumanControlled && !(owner as any).isAi) return false;
    }
    return true;
  }

  /** Idempotent player input dedupe + immediate ACK info (Host & Guest treated identically). */
  handlePlayerInput(
    playerId: string,
    input: PlayerInputPayload
  ): { shouldApply: boolean; ack?: { clientInputId: string; attempt: number } } {
    const applyMoveIfHuman = () => {
      if (
        input.kind === 'MOVE' &&
        typeof input.x === 'number' &&
        typeof input.y === 'number'
      ) {
        const uid = input.playerId || playerId;
        if (uid && !this.isServerAuthorityUnit(uid)) {
          const u = this.engine.getUnit(uid);
          if (u) {
            u.position = { x: input.x, y: input.y };
          }
        }
      }
    };

    const cid = input.clientInputId;
    if (!cid) {
      applyMoveIfHuman();
      return { shouldApply: true };
    }

    const ack = {
      clientInputId: cid,
      attempt: Math.max(1, input.clientInputAttempt || 1),
    };

    if (this.processedInputIds.has(cid)) {
      this.noteAck(cid);
      return { shouldApply: false, ack };
    }
    this.processedInputIds.add(cid);
    this.processedInputOrder.push(cid);
    while (this.processedInputOrder.length > ACK_RING_MAX) {
      const old = this.processedInputOrder.shift();
      if (old) this.processedInputIds.delete(old);
    }
    this.noteAck(cid);
    applyMoveIfHuman();
    return { shouldApply: true, ack };
  }

  private noteAck(clientInputId: string) {
    this.ackedInputRing.push(clientInputId);
    while (this.ackedInputRing.length > ACK_RING_MAX) {
      this.ackedInputRing.shift();
    }
  }

  /** Gather player CombatEffect for COMBAT_BATCH and apply to server-authority targets (Boss/AI/Enemies). */
  handleCombatEffect(effect: CombatEffect): { ack?: { clientInputId: string; attempt: number } } {
    if (!effect?.effectId) return {};
    this.pendingEffects.push(effect);

    if (this.isServerAuthorityUnit(effect.targetId) && !this.appliedEffectIds.has(effect.effectId)) {
      this.appliedEffectIds.add(effect.effectId);
      this.appliedEffectOrder.push(effect.effectId);
      while (this.appliedEffectOrder.length > EFFECT_RING_MAX) {
        const old = this.appliedEffectOrder.shift();
        if (old) this.appliedEffectIds.delete(old);
      }
      this.applyEffectToServerEngine(effect);
    }

    if (effect.clientInputId) {
      return {
        ack: {
          clientInputId: effect.clientInputId,
          attempt: Math.max(1, effect.clientInputAttempt || 1),
        },
      };
    }
    return {};
  }

  private applyEffectToServerEngine(effect: CombatEffect) {
    const src = this.engine.getUnit(effect.sourceId);
    const tgt = this.engine.getUnit(effect.targetId);
    if (!tgt) return;

    switch (effect.kind) {
      case 'DAMAGE':
        if (typeof effect.amount === 'number' && effect.amount > 0) {
          this.engine.dealDamage(
            src || tgt,
            tgt,
            effect.amount,
            'PHYSICAL',
            !!effect.isCrit,
            effect.spellName || effect.spellId
          );
        }
        break;
      case 'HEAL':
        if (typeof effect.amount === 'number' && effect.amount > 0) {
          this.engine.healUnit(
            src || tgt,
            tgt,
            effect.amount,
            !!effect.isCrit,
            effect.spellName || effect.spellId
          );
        }
        break;
      case 'RESURRECT':
        this.engine.resurrectUnit(tgt.id, 0.35, 0.35);
        break;
      case 'APPLY_BUFF':
        if (effect.buff) {
          this.engine.auraManager.applyAura(tgt.id, {
            id: effect.buff.spellId,
            spellId: effect.buff.spellId,
            name: effect.buff.name,
            kind: effect.buff.kind || 'BUFF',
            sourceUnitId: effect.sourceId,
            durationMs: effect.buff.durationMs ?? 10000,
            remainingMs: effect.buff.remainingMs ?? effect.buff.durationMs ?? 10000,
            stacks: effect.buff.stacks ?? 1,
            maxStacks: effect.buff.maxStacks ?? 1,
            tags: effect.buff.tags,
          } as any);
        }
        break;
      case 'REMOVE_BUFF':
        if (effect.removeSpellId || effect.spellId) {
          this.engine.auraManager.removeBuff(tgt, effect.removeSpellId || effect.spellId);
        }
        break;
      case 'TAUNT':
        if (src) {
          this.engine.threatManager.applyTaunt(tgt.id, src.id);
        }
        break;
      case 'RESOURCE': {
        const delta = effect.resourceDelta ?? effect.amount ?? 0;
        const kind = (effect.resourceKind || 'MANA').toUpperCase();
        if (kind === 'MANA' && tgt.maxMp != null) {
          tgt.mp = Math.max(0, Math.min(tgt.maxMp, (tgt.mp ?? 0) + delta));
        } else if (kind === 'ENERGY') {
          tgt.energy = Math.max(0, Math.min(100, (tgt.energy ?? 0) + delta));
        } else if (kind === 'RAGE') {
          tgt.rage = Math.max(0, Math.min(100, (tgt.rage ?? 0) + delta));
        } else if (kind === 'FOCUS') {
          tgt.focus = Math.max(0, Math.min(100, (tgt.focus ?? 0) + delta));
        }
        syncUnitResources(tgt);
        break;
      }
      case 'DISPEL':
        if (effect.removeSpellId) {
          this.engine.auraManager.removeBuff(tgt, effect.removeSpellId);
        }
        break;
      case 'GROUND_PLACE':
        if (effect.groundEffectId && this.engine.effectsManager) {
          this.engine.effectsManager.addGroundEffect({
            id: effect.groundEffectId,
            kind: effect.groundKind || 'HEAL_ZONE',
            spellId: effect.spellId,
            ownerId: effect.sourceId,
            x: effect.x ?? tgt.position.x,
            y: effect.y ?? tgt.position.y,
            radius: effect.radius ?? 80,
            colorHex: effect.colorHex || '#4ade80',
            remainingMs: effect.remainingMs ?? 8000,
            tickIntervalMs: effect.tickIntervalMs ?? 1000,
            tickValue: effect.tickValue ?? 0,
            facingRad: effect.facingRad,
            coneAngleRad: effect.coneAngleRad,
          } as any);
        }
        break;
      default:
        break;
    }
  }

  /** 服务端权威执行 GM 指令（影响 AI 队友、Boss/小怪、地面效果与副本进度） */
  handleGmCommand(cmd: GmCommandPayload): void {
    const activeEnemies = () => [
      ...(this.engine.bossUnit && (this.engine.bossUnit.alive ?? this.engine.bossUnit.isAlive) && this.engine.bossUnit.hp > 0
        ? [this.engine.bossUnit]
        : []),
      ...this.engine.enemyUnits.filter(
        (e) => e.id !== this.engine.bossUnit?.id && (e.alive ?? e.isAlive) && e.hp > 0
      ),
    ];

    const caster =
      this.engine.bossUnit ||
      this.engine.friendlyUnits.find((u) => this.isServerAuthorityUnit(u.id)) ||
      this.engine.friendlyUnits[0];

    switch (cmd.kind) {
      case 'FRIENDLY_HP_PCT': {
        const pct = cmd.deltaPct ?? 0;
        for (const u of this.engine.friendlyUnits) {
          if (!this.isServerAuthorityUnit(u.id)) continue;
          if (!(u.alive ?? u.isAlive) || u.hp <= 0) continue;
          const amt = Math.max(1, Math.round(u.maxHp * Math.abs(pct)));
          if (pct > 0) this.engine.healUnit(caster || u, u, amt, false, 'GM治疗');
          else if (pct < 0) this.engine.drainHpTowardFloor(u, amt, 1, 'GM扣血');
        }
        break;
      }
      case 'FRIENDLY_FULL_RESTORE': {
        for (const u of this.engine.friendlyUnits) {
          if (!this.isServerAuthorityUnit(u.id)) continue;
          if (!(u.alive ?? u.isAlive) || u.hp <= 0) {
            this.engine.resurrectUnit(u.id, 1);
          }
          this.engine.healUnit(caster || u, u, u.maxHp, false, 'GM满血');
          if (typeof u.maxMp === 'number' && u.maxMp > 0) u.mp = u.maxMp;
        }
        break;
      }
      case 'ENEMY_HP_PCT': {
        const pct = cmd.deltaPct ?? 0;
        for (const e of activeEnemies()) {
          const delta = Math.round(e.maxHp * pct);
          e.hp = Math.max(1, Math.min(e.maxHp, e.hp + delta));
        }
        break;
      }
      case 'ENEMY_SET_HP_ONE':
        for (const e of activeEnemies()) e.hp = 1;
        break;
      case 'ENEMY_KILL_ALL':
        for (const e of activeEnemies()) {
          e.hp = 0;
          e.alive = false;
          e.isAlive = false;
        }
        break;
      case 'ENEMY_DMG_MULT':
        this.engine.gmEnemyDamageMult =
          Math.round(Math.max(0.1, Math.min(5.0, cmd.mult ?? 1.0)) * 10) / 10;
        break;
      case 'TRIGGER_BOSS_SKILL': {
        const boss = this.engine.bossUnit;
        const skill = this.bossAi?.skills?.find((s) => s.id === cmd.skillId);
        if (boss && (boss.alive ?? boss.isAlive) && boss.hp > 0 && skill) {
          skill.execute(boss, this.engine);
          skill.lastCastMs = this.engine.nowMs;
          if (this.bossAi) {
            (this.bossAi as any).lastSkillName = skill.name;
            (this.bossAi as any).lastSkillAtMs = this.engine.nowMs;
            (this.bossAi as any).emitSkillDbmAlert?.(this.engine, skill, 'INSTANT');
          }
          this.engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: `🛠️ GM触发：${skill.name}`,
            category: 'STATUS',
            isCrit: true,
          });
        }
        break;
      }
      case 'RESET_COOLDOWNS':
        this.engine.cooldownManager?.reset?.();
        if (this.bossAi?.skills) {
          for (const s of this.bossAi.skills) s.lastCastMs = -999_999;
        }
        break;
      case 'CLEAR_GROUND_HAZARDS':
        if (this.engine.effectsManager?.groundEffects) {
          this.engine.effectsManager.groundEffects.length = 0;
        }
        break;
      case 'FAST_FORWARD_10S': {
        const boss = this.engine.bossUnit;
        if (boss && this.bossAi) {
          this.bossAi.tick(10_000, boss, this.engine);
        }
        break;
      }
      case 'SKIP_TRAVEL':
        this.rsm.fastForwardTravel();
        break;
      case 'SPAWN_WILD_PACK': {
        const spawned = spawnGmWildPack(this.engine, cmd.count);
        if (spawned.length > 0 && this.engine.bossUnit) {
          this.engine.effectsManager?.addFloatingText({
            targetId: this.engine.bossUnit.id,
            text: `🐺 GM 召唤 ${spawned.length} 只野怪！`,
            category: 'STATUS',
            isCrit: true,
          });
        }
        break;
      }
      case 'TOGGLE_FRIENDLY_INVINCIBLE':
        this.engine.gmFriendlyInvincible =
          cmd.enabled !== undefined ? !!cmd.enabled : !this.engine.gmFriendlyInvincible;
        break;
      case 'TOGGLE_ENEMY_INVINCIBLE':
        this.engine.gmEnemyInvincible =
          cmd.enabled !== undefined ? !!cmd.enabled : !this.engine.gmEnemyInvincible;
        break;
    }
  }

  /** Merge human OwnerSnapshot into server engine & enqueue for COMBAT_BATCH fan-out. */
  handleOwnerSnapshot(snap: OwnerSnapshot) {
    if (!snap?.ownerId) return;
    if (snap.purge) {
      this.pendingSnapshots.set(snap.ownerId, snap);
      return;
    }

    this.pendingSnapshots.set(snap.ownerId, snap);

    if (snap.units?.length) {
      const existing = this.engine.buildNetworkUnitSnapshots();
      const preserved = existing.filter(
        (u) => u.id !== snap.ownerId && u.ownerId !== snap.ownerId
      );
      const owned = snap.units.map((u) =>
        u.id === snap.ownerId
          ? { ...u, isHumanControlled: true, isAi: false }
          : u
      );
      this.engine.applyNetworkUnitSnapshots([...preserved, ...owned]);
      for (const u of this.engine.friendlyUnits) {
        if (u.id === snap.ownerId) {
          u.isHumanControlled = true;
          (u as any).isAi = false;
        }
      }
    }

    if (snap.groundEffects && this.engine.effectsManager) {
      const kept = (this.engine.effectsManager.groundEffects || []).filter(
        (g: any) => g.ownerId !== snap.ownerId
      );
      this.engine.effectsManager.groundEffects = [
        ...kept,
        ...snap.groundEffects.map((g) => ({
          ...g,
          tickIntervalMs: g.tickIntervalMs ?? 1000,
          tickElapsedMs: 0,
          tickValue: g.tickValue ?? 0,
        })),
      ] as any;
    }
  }

  hotSwapHuman(replacedAiId: string, member: RoomMember): NetworkUnitSnapshot | undefined {
    const existingAi = this.engine.getUnit(replacedAiId);
    const newUnit = this.buildUnitFromMember(member, 0);
    if (existingAi) {
      newUnit.hp = Math.min(newUnit.maxHp, Math.max(1, existingAi.hp));
      newUnit.position = { ...existingAi.position };
      newUnit.isAlive = existingAi.isAlive ?? true;
      newUnit.alive = existingAi.alive ?? true;
      this.engine.removeUnit(replacedAiId);
    }
    this.engine.addUnit(newUnit);
    return this.engine.buildNetworkUnitSnapshots().find((u) => u.id === member.id);
  }

  replaceHumanWithAi(playerId: string, aiMemberId: string, room: LobbyRoom) {
    const member = room.members.find((m) => m.id === aiMemberId);
    const prevUnit = this.engine.getUnit(playerId);
    this.engine.removeUnit(playerId);
    this.pendingSnapshots.delete(playerId);
    this.pendingEffects = this.pendingEffects.filter((e) => e.sourceId !== playerId);

    if (member) {
      const aiUnit = this.buildUnitFromMember(member, 0);
      if (prevUnit) {
        aiUnit.hp = Math.min(aiUnit.maxHp, Math.max(0, prevUnit.hp));
        aiUnit.isAlive = prevUnit.isAlive ?? prevUnit.hp > 0;
        aiUnit.alive = aiUnit.isAlive;
        aiUnit.position = { ...prevUnit.position };
      }
      this.engine.addUnit(aiUnit);
    }

    // Queue purge snapshot so all clients erase leaver traces
    this.pendingSnapshots.set(playerId, {
      ownerId: playerId,
      timeMs: Date.now(),
      units: [],
      purge: true,
    });
  }

  applyWipeVoteResult(result: 'RETRY' | 'FINISH') {
    if (result === 'RETRY') {
      this.rsm.handleWipeVoteChoice('RETRY');
      this.engine.resetCooldowns();
      this.engine.threatManager.resetAll();
      this.engine.effectsManager.clearAll();
      this.bossAi = null;
      this.approachedBossId = null;
      // Broadcast RESURRECT effects for human players so their local authority revives cleanly
      for (const u of this.engine.friendlyUnits) {
        if (u.isHumanControlled && !(u as any).isAi) {
          this.pendingEffects.push({
            effectId: `srv_rez_${u.id}_${Date.now()}`,
            sourceId: 'server',
            targetId: u.id,
            spellId: 'wipe_retry_resurrect',
            kind: 'RESURRECT',
            atMs: Date.now(),
          });
        }
      }
      this.broadcastSnapshotAndBatch();
    } else {
      this.rsm.handleWipeVoteChoice('FINISH');
      this.broadcastSnapshotAndBatch();
      this.callbacks.onEnterSummary(this.roomId);
    }
  }

  fastForwardTravel() {
    this.rsm.fastForwardTravel();
    this.broadcastSnapshotAndBatch();
  }

  /** Advance one 50ms simulation tick on the server. */
  tick(deltaMs = TICK_MS) {
    if (this.disposed) return;
    try {
      this.tickCount++;

    // Keep RSM wipeVoteTimer held while server vote tracker is authoritative
    if (this.rsm.phase === 'WIPE_VOTE') {
      this.rsm.wipeVoteTimerMs = Math.max(this.rsm.wipeVoteTimerMs, 1000);
    }

    this.rsm.tick(deltaMs);

    if (this.rsm.phase === 'BOSS_COMBAT') {
      const bossCfg = this.rsm.getCurrentBoss();
      const expectedBossId = bossCfg?.id || 'ashbury';
      if (!this.engine.bossUnit && bossCfg) {
        this.engine.spawnBoss(bossCfg.id, bossCfg.name, bossCfg.hp);
      }
      if (this.approachedBossId !== expectedBossId) {
        this.approachedBossId = expectedBossId;
        this.bossAi = new BossAI(expectedBossId, this.rsm.dungeon.id);
        this.lastBossAttackTick = this.tickCount;
      }

      const boss = this.engine.bossUnit;
      if (boss && (boss.isAlive || boss.alive) && boss.hp > 0) {
        this.bossAi?.tick(deltaMs, boss, this.engine);

        const isAsphyxiate = this.bossAi?.currentCasting?.skill?.id === 'asphyxiate';
        const isBossGrace = this.engine.isBossHealingGraceActive() || isAsphyxiate;
        const targetId = this.engine.getBossTargetId();
        const target =
          (targetId ? this.engine.getUnit(targetId) : undefined) ||
          this.engine.friendlyUnits.find((u) => (u.isAlive || u.alive) && u.hp > 0 && u.role === 'TANK') ||
          this.engine.friendlyUnits.find((u) => (u.isAlive || u.alive) && u.hp > 0);

        // Server-authoritative Boss pursuit toward top threat target (when not casting)
        if (!isBossGrace && !this.bossAi?.currentCasting && target?.position && boss.position) {
          const dx = target.position.x - boss.position.x;
          const dy = target.position.y - boss.position.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 60) {
            const step = Math.min((140 * deltaMs) / 1000, dist - 54);
            if (step > 0) {
              boss.position = {
                x: boss.position.x + (dx / dist) * step,
                y: boss.position.y + (dy / dist) * step,
              };
            }
          }
        }

        // Boss auto-attack (~2s) on top threat target; reset swing timer during Asphyxiate / healing grace
        if (isBossGrace) {
          this.lastBossAttackTick = this.tickCount;
        } else if (this.tickCount - this.lastBossAttackTick >= 40) {
          this.lastBossAttackTick = this.tickCount;
          if (target && (target.isAlive || target.alive) && target.hp > 0) {
            const distToTarget =
              boss.position && target.position
                ? Math.hypot(boss.position.x - target.position.x, boss.position.y - target.position.y)
                : 0;
            if (distToTarget <= 85) {
              const is20Man = this.engine.friendlyUnits.length > 5;
              const dmg = is20Man
                ? target.role === 'TANK'
                  ? 32_000
                  : 65_000
                : target.role === 'TANK'
                  ? 18_000
                  : 32_000;
              this.engine.dealDamage(boss, target, dmg, 'PHYSICAL', false, '近战攻击');
              if (!this.isServerAuthorityUnit(target.id)) {
                this.pendingEffects.push({
                  effectId: `srv_aa_${this.tickCount}_${target.id}`,
                  sourceId: boss.id,
                  targetId: target.id,
                  spellId: 'boss_melee',
                  spellName: '近战攻击',
                  kind: 'DAMAGE',
                  amount: dmg,
                  atMs: Date.now(),
                });
              }
            }
          }
        }

        // Tick server-owned AI teammates (lightweight role AI)
        this.tickServerAiTeammates(boss);
      }
    } else {
      this.approachedBossId = null;
      this.bossAi = null;
    }

    // Tick engine while preserving human-authority units' vitals/positions
    this.tickEnginePreservingHumans(deltaMs);

    const phaseChanged = this.rsm.phase !== this.prevPhase;
    this.prevPhase = this.rsm.phase;

    if (phaseChanged && this.rsm.phase === 'WIPE_VOTE') {
      this.callbacks.onEnterWipeVote(this.roomId);
    }

    if (phaseChanged || this.tickCount % BROADCAST_EVERY_TICKS === 0) {
      this.broadcastSnapshotAndBatch();
    }

    if (phaseChanged && this.rsm.phase === 'SUMMARY') {
      this.callbacks.onEnterSummary(this.roomId);
    }
    } catch (err) {
      console.error(`[RoomCombatSession] tick error in room ${this.roomId}:`, err);
    }
  }

  private tickServerAiTeammates(boss: Unit) {
    const deltaMs = TICK_MS;
    const baseStepPx = 7; // ~140px/s (2.4px/frame @60fps ≈ 144px/s)
    const groundEffects = this.engine.effectsManager?.groundEffects || [];
    const friendlies = this.engine.friendlyUnits;
    const livingAllies = friendlies.filter(
      (a) => (a.isAlive ?? a.alive) && a.hp > 0 && !isTotemUnit(a)
    );
    const friendlyUnitIds = new Set(friendlies.filter((x) => x.role !== 'ENEMY').map((x) => x.id));
    const bossPos = boss.position || { x: 500, y: 180 };
    const bossTargetId = this.engine.getBossTargetId() || null;
    const bossTargetUnit =
      (bossTargetId
        ? friendlies.find((t) => t.id === bossTargetId && (t.isAlive ?? t.alive) && t.hp > 0)
        : null) ?? null;
    const bossFacingRad = resolveUnitFacingRad({
      position: bossPos,
      isMoving: false,
      moveDx: 0,
      moveDy: 0,
      targetPos: bossTargetUnit?.position ?? null,
      fallbackFacingRad: (boss as { facingRad?: number }).facingRad,
    });
    const primaryTank =
      orderTanksByThreatPriority(friendlies.filter((t) => t.role === 'TANK'))[0] ??
      friendlies.find((t) => t.role === 'TANK' && (t.isAlive ?? t.alive) && t.hp > 0);
    const primaryTankPos = primaryTank?.position ? { ...primaryTank.position } : undefined;
    const aggroIsNonTank = !!(bossTargetUnit && bossTargetUnit.role !== 'TANK');

    let nearestHealerPos: { x: number; y: number } | undefined;
    let bestHealerDist = Infinity;
    for (const h of livingAllies) {
      if (h.role !== 'HEALER' || !h.position) continue;
      const d = Math.hypot(h.position.x - bossPos.x, h.position.y - bossPos.y);
      if (d < bestHealerDist) {
        bestHealerDist = d;
        nearestHealerPos = { x: h.position.x, y: h.position.y };
      }
    }

    const allyPositions = livingAllies.map((a) => ({
      id: a.id,
      role: a.role,
      x: a.position?.x ?? 200,
      y: a.position?.y ?? 180,
    }));

    // 1. 被动资源回复 & 完整智能 AI 走位（躲红圈、拉小怪、吃绿圈、机制集中/分散、离坦25码、控场移速为0）
    friendlies.forEach((u, idx) => {
      if (!(u as any).isAi || !(u.isAlive ?? u.alive) || u.hp <= 0) return;
      const pos = u.position || { x: 220, y: 180 };
      if (!u.position) u.position = pos;

      const moveSpeedMult = getUnitMoveSpeedMultiplier(u);
      if (moveSpeedMult <= 0) {
        (u as any).isMoving = false;
      } else {
        const hpPct = u.maxHp > 0 ? u.hp / u.maxHp : 1;
        const defaultTarget = getCombatFormationPos(u, idx, bossPos, hpPct);
        const looseAddForTank =
          u.role === 'TANK'
            ? findLooseAddForTank(u, this.engine.enemyUnits, boss, friendlies)
            : null;
        const attackTargetPos =
          looseAddForTank?.position
            ? { x: looseAddForTank.position.x, y: looseAddForTank.position.y }
            : bossPos;

        const dungeonPriorityZone = computeDungeonPriorityZone({
          unit: u,
          boss,
          bossPos,
          allies: allyPositions,
          groundEffects,
          bossCastingSpellName: this.bossAi?.currentCasting?.skill?.name,
        });
        const formationResult = evaluateGroundFormationPosition({
          currentPos: pos,
          unit: u,
          groundEffects,
          defaultTarget,
          bossPos,
          attackTargetPos,
          tankPos: primaryTank && primaryTank.id !== u.id ? primaryTankPos : undefined,
          bossFacingRad,
          bossTargetUnitId: bossTargetId,
          aggroIsNonTank,
          nearestHealerPos,
          isPrimaryTank: !!primaryTank && primaryTank.id === u.id,
          dungeonPriorityZone,
          friendlyUnitIds,
        });

        let targetX = formationResult.targetPos.x;
        let targetY = formationResult.targetPos.y;
        if (
          primaryTank &&
          primaryTank.id !== u.id &&
          primaryTankPos &&
          formationResult.reason !== 'DODGE_HAZARD' &&
          formationResult.tradeOffDecision !== 'SEEK_HEAL_ZONE' &&
          formationResult.tradeOffDecision !== 'STAY_IN_CURRENT_HEAL_ZONE'
        ) {
          const stacked = clampPosWithinTankRange({ x: targetX, y: targetY }, primaryTankPos);
          targetX = stacked.x;
          targetY = stacked.y;
        }
        targetX = Math.max(30, Math.min(750, targetX));
        targetY = Math.max(30, Math.min(330, targetY));

        const dx = targetX - pos.x;
        const dy = targetY - pos.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 2) {
          const step = Math.min(baseStepPx * moveSpeedMult, dist);
          pos.x = Math.max(30, Math.min(750, pos.x + (dx / dist) * step));
          pos.y = Math.max(30, Math.min(330, pos.y + (dy / dist) * step));
          (u as any).isMoving = dist > 5;
        } else {
          (u as any).isMoving = false;
        }
      }

      const haste = getUnitHaste(u, LEVEL_80_MAX_HASTE);
      if (u.maxMp && u.maxMp > 0) {
        const regenAmt = (u.maxMp * 0.015 * deltaMs) / 1000;
        u.mp = Math.min(u.maxMp, (u.mp ?? 0) + regenAmt);
      }
      if (u.classId === 'ROGUE') {
        u.energy = Math.min(100, (u.energy ?? 100) + (10 * (1 + haste) * deltaMs) / 1000);
      } else if (u.classId === 'WARRIOR' || (u.classId === 'DRUID' && u.role === 'TANK')) {
        u.rage = Math.min(100, (u.rage ?? 30) + (7 * deltaMs) / 1000);
      } else if (u.classId === 'HUNTER') {
        u.focus = Math.min(100, (u.focus ?? 100) + (6.5 * (1 + haste) * deltaMs) / 1000);
      }
      syncUnitResources(u);
    });

    // 2. 运行完整 10 职业 / 30 专精通用 AI 战斗决策循环
    const livingEnemies = this.engine.enemyUnits.filter((e) => (e.isAlive ?? e.alive) && e.hp > 0);
    const bossThreatTargetId = bossTargetId;

    tickEnemyAdds(this.engine, boss, deltaMs, this.addLastAttackMs);

    runFriendlyAiCombatTick({
      engine: this.engine,
      boss,
      livingEnemies,
      bossThreatTargetId,
      tickCount: this.tickCount,
      deltaMs,
      bossAi: this.bossAi,
      aiCasts: this.aiCasts,
      aiCooldowns: this.aiCooldowns,
      currentCasts: this.aiCurrentCasts,
      getUnitAIPersonality: (u) => getOrCreateUnitAIPersonality(this.aiPersonalities, u),
      inferAiSpecForUnit,
      isAiCdReady: (unitId, spellKey, cdMs) => isAiCdReady(this.aiCooldowns, unitId, spellKey, cdMs),
      markAiCdUsed: (unitId, spellKey) => markAiCdUsed(this.aiCooldowns, unitId, spellKey),
      notifyOom: (u, eng) => notifyOom(this.lastOomWarningMs, u, eng),
      addIncomingCast: () => {},
      hooks: {
        onCastStart: (ev) => {
          this.pendingEffects.push({
            effectId: `srv_eff_${++this.srvEffectSeq}`,
            sourceId: ev.unitId,
            targetId: ev.targetId,
            spellId: ev.spellId,
            spellName: ev.spellName,
            kind: 'CAST_START',
            totalMs: ev.totalMs,
            isChannel: ev.isChannel,
            atMs: Date.now(),
          });
        },
        onCastLand: (ev) => {
          this.pendingEffects.push({
            effectId: `srv_eff_${++this.srvEffectSeq}`,
            sourceId: ev.unitId,
            targetId: ev.targetId,
            spellId: ev.spellId,
            spellName: ev.spellName,
            kind: 'CAST_LAND',
            atMs: Date.now(),
          });
        },
        onCastInterrupt: (ev) => {
          this.pendingEffects.push({
            effectId: `srv_eff_${++this.srvEffectSeq}`,
            sourceId: ev.unitId,
            targetId: ev.targetId,
            spellId: ev.spellId,
            spellName: ev.spellName,
            kind: 'INTERRUPT',
            atMs: Date.now(),
          });
        },
      },
    });
  }

  private tickEnginePreservingHumans(deltaMs: number) {
    const humanSaved = new Map<
      string,
      { hp: number; mp?: number; isAlive: boolean; position: { x: number; y: number } }
    >();
    for (const u of this.engine.friendlyUnits) {
      if (!this.isServerAuthorityUnit(u.id)) {
        humanSaved.set(u.id, {
          hp: u.hp,
          mp: u.mp,
          isAlive: !!(u.isAlive ?? u.alive),
          position: { ...u.position },
        });
      }
    }

    this.engine.tick(deltaMs);

    for (const u of this.engine.friendlyUnits) {
      const saved = humanSaved.get(u.id);
      if (saved) {
        u.hp = saved.hp;
        if (saved.mp !== undefined) u.mp = saved.mp;
        u.isAlive = saved.isAlive;
        u.alive = saved.isAlive;
        u.position = saved.position;
      }
    }
  }

  private broadcastSnapshotAndBatch() {
    const now = Date.now();
    const seq = ++this.seq;
    const allUnits = this.engine.buildNetworkUnitSnapshots();
    const serverAuthUnits = allUnits.filter((u) => this.isServerAuthorityUnit(u.id));

    const casts: NetworkCastTimeline[] = this.engine.getPendingCasts().map((c) => ({
      unitId: c.casterId,
      spellId: c.spellId,
      spellName: c.spellName,
      startedAtMs: now - (c.totalMs - c.remainingMs),
      totalMs: c.totalMs,
      isChannel: c.mode === 'CHANNELED',
      targetId: c.targetId,
      interruptible: true,
    }));

    for (const [unitId, aiCast] of Object.entries(this.aiCasts)) {
      if (!aiCast || casts.some((c) => c.unitId === unitId)) continue;
      casts.push({
        unitId,
        spellId: aiCast.spellId,
        spellName: aiCast.spellName,
        startedAtMs: now - (aiCast.elapsedMs || 0),
        totalMs: aiCast.totalMs || 1500,
        isChannel: !!aiCast.isChannel,
        targetId: aiCast.targetId,
        interruptible: !aiCast.isChannel,
      });
    }

    const bossCast = this.bossAi?.currentCasting;
    if (bossCast && this.engine.bossUnit) {
      casts.push({
        unitId: this.engine.bossUnit.id,
        spellId: bossCast.skill.id || bossCast.skill.name,
        spellName: bossCast.skill.name,
        startedAtMs: now - (bossCast.elapsedMs || 0),
        totalMs: bossCast.skill.castTimeMs || 1,
        interruptible: !!bossCast.skill.interruptible,
      });
    }

    const cooldowns: NetworkCooldownTimeline[] = this.engine.cooldownManager
      .getAllActiveCooldowns()
      .map((e) => ({
        unitId: e.unitId,
        spellId: e.spellId,
        startedAtMs: now - (e.totalMs - e.remainingMs),
        totalMs: e.totalMs,
      }));

    const gcds: NetworkGcdTimeline[] = [];
    const groundEffects: NetworkGroundEffectSnapshot[] = (
      this.engine.effectsManager?.groundEffects || []
    ).map((g: any) => ({
      id: g.id,
      kind: g.kind,
      spellId: g.spellId,
      ownerId: g.ownerId,
      x: g.x,
      y: g.y,
      radius: g.radius,
      colorHex: g.colorHex,
      remainingMs: g.remainingMs,
      facingRad: g.facingRad,
      coneAngleRad: g.coneAngleRad,
      tickIntervalMs: g.tickIntervalMs,
      tickValue: g.tickValue,
    }));

    const freshDbm = this.engine.drainDbmAlerts();
    if (freshDbm.length > 0) this.pendingDbmAlerts.push(...freshDbm);

    const worldSnap: NetworkCombatSnapshot = {
      roomId: this.roomId,
      seq,
      timeMs: now,
      runPhase: this.rsm.phase,
      travelRemainingMs: this.rsm.travelRemainingMs,
      totalTravelMs: this.rsm.totalTravelMs,
      currentBossIndex: this.rsm.currentBossIndex,
      isCleared: this.rsm.isCleared,
      totalDurationSec: Math.round(this.rsm.totalRunDurationSec),
      encounterReports: this.rsm.encounterReports,
      bossTargetId: this.engine.bossUnit
        ? this.engine.threatManager.getCurrentTarget?.(this.engine.bossUnit.id) ?? null
        : null,
      units: serverAuthUnits,
      casts,
      cooldowns,
      gcds,
      groundEffects,
      floatingTexts: this.engine.effectsManager?.floatingTexts || [],
      recentActions: this.engine.drainRecentActions(),
      ...(this.pendingDbmAlerts.length > 0 ? { dbmAlerts: this.pendingDbmAlerts.splice(0) } : {}),
      ...(this.ackedInputRing.length ? { ackedInputIds: this.ackedInputRing.slice() } : {}),
    };

    this.callbacks.broadcastCombatState(this.roomId, worldSnap);
    this.callbacks.onRoomMetaUpdate(this.roomId, worldSnap);

    if (this.pendingEffects.length > 0 || this.pendingSnapshots.size > 0) {
      const batch: CombatBatch = {
        roomId: this.roomId,
        seq: ++this.seq,
        timeMs: now,
        effects: this.pendingEffects.splice(0, this.pendingEffects.length),
        snapshots: Array.from(this.pendingSnapshots.values()),
      };
      this.pendingSnapshots.clear();
      this.callbacks.broadcastCombatBatch(this.roomId, batch);
    }
  }
}
