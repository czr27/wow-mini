import type {
  CombatEngine,
  Unit,
  NormalizedSpell,
  BossAI,
  AIPersonality,
} from '@cata-raid-sim/engine';
import {
  findOptimalGroundAuraCentroid,
  evaluateTankThreatDecision,
  getUnitPersonality,
  evaluateUniversalAIDecision,
  getSpellsForClassSpec,
  getSpellByAnyId,
  getClassPrimaryResource,
  getUnitResourceAmount,
  getEffectiveGcdMs,
  LEVEL_80_STATS,
  LEVEL_80_MAX_HASTE,
  rollAiDamage,
  rollAiHeal,
  buildUsableCandidatesForUnit,
} from '@cata-raid-sim/engine';
import type { IncomingHealCast } from '../components/RaidFrames.js';
import { syncUnitResources, deductAiResource } from './unitResources.js';

/** Active AI read-bar / channel state (per-unit). */
export type AiActiveCast = {
  targetId: string;
  spellId: string;
  spellName: string;
  amount: number;
  baseAmt: number;
  manaCost: number;
  resourceKind?: NormalizedSpell['resourceKind'];
  totalMs: number;
  elapsedMs: number;
  isHarmful: boolean;
  isAOE?: boolean;
  maxTargets?: number;
  school?: NormalizedSpell['school'];
  normalizedSpell?: NormalizedSpell;
};

/**
 * Execute any NormalizedSpell for an AI unit (data-driven; no per-class branches).
 */
export function executeAiNormalizedSpell(
  engine: CombatEngine,
  livingEnemies: Unit[],
  boss: Unit,
  u: Unit,
  sp: NormalizedSpell,
  targetUnit: Unit | null,
  individualMod: number,
  critMod: number,
  pauseThreat: boolean = false
): void {
  const isCrit = Math.random() < ((u.stats.critChance || 0.25) + critMod);
  const livingAllies = engine.friendlyUnits.filter(a => (a.alive || a.isAlive) && a.hp > 0);
  const activeEnemies = livingEnemies.length > 0 ? livingEnemies : [boss];

  // Resource builders (Paladin Holy Power / Warrior Rage / DK Runic Power)
  if (u.classId === 'PALADIN' && sp.resourceKind !== 'HOLY_POWER' && !sp.isDefensive && !sp.isTaunt && !sp.isInterrupt) {
    u.holyPower = Math.min(3, (u.holyPower ?? 0) + 1);
  } else if (u.classId === 'WARRIOR' && sp.resourceCostAmount === 0) {
    u.rage = Math.min(100, (u.rage ?? 0) + 15);
  } else if (u.classId === 'DK' && sp.resourceKind !== 'RUNIC_POWER') {
    u.runicPower = Math.min(100, (u.runicPower ?? 0) + 15);
  }
  syncUnitResources(u);

  // 通用 Buff / Buff+Heal（数据驱动：大地之盾、生命释放、升腾、先祖指引、圣光道标等）
  // 新技能只要在 ClassRegistry 标 isBuff/targetType/maxStacks/directHeal，即可自动执行，无需再写 spellId 分支
  if (sp.isBuff && !sp.isDamage) {
    const isSelfBuff = sp.targetType === 'SELF';
    const isEnemyBuff = sp.targetType === 'SINGLE_ENEMY' || sp.targetType === 'AOE_ENEMY';
    const allyTarget = targetUnit && (targetUnit.alive || targetUnit.isAlive) && targetUnit.hp > 0
      ? targetUnit
      : livingAllies.sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0] || u;
    const enemyTarget = targetUnit && engine.enemyUnits.some(e => e.id === targetUnit.id)
      ? targetUnit
      : activeEnemies[0] || boss;
    const buffTarget = isSelfBuff ? u : isEnemyBuff ? enemyTarget : allyTarget;
    const auraSpellId = sp.auraId || sp.shortId;
    const stacks = Math.max(1, sp.maxStacks || 1);
    const isStackedShield = stacks > 1 && (sp.targetType === 'SINGLE_ALLY' || sp.targetType === 'SMART_ALLY');

    // Buff+直疗（如生命释放）：先结算治疗
    if (sp.isHeal && sp.directHeal > 0 && !isSelfBuff && !isEnemyBuff) {
      const healAmt = rollAiHeal(u, sp.directHeal, isCrit);
      engine.healUnit(u, allyTarget, healAmt, isCrit, sp.name);
    }

    // 「友方直疗 + 自身下一口增效」类 Buff 挂在施法者；叠层护盾/道标挂在友方；自身大招挂自己
    const nextHealAmpOnCaster =
      sp.isHeal &&
      sp.directHeal > 0 &&
      !isSelfBuff &&
      !isEnemyBuff &&
      stacks === 1 &&
      Boolean(sp.auraId);
    const finalAuraTarget = nextHealAmpOnCaster ? u : buffTarget;

    engine.applyBuff(finalAuraTarget, {
      id: `${auraSpellId}_ai_${Date.now()}_${finalAuraTarget.id}`,
      spellId: auraSpellId,
      name: isStackedShield ? `${sp.name} (${stacks}层)` : sp.name,
      kind: isEnemyBuff ? 'DEBUFF' : 'BUFF',
      tags: isStackedShield ? ['SHIELD'] : ['STAT'],
      sourceUnitId: u.id,
      targetUnitId: finalAuraTarget.id,
      stacks,
      maxStacks: stacks,
      durationMs: Math.max(8000, sp.durationMs || 15000),
      remainingMs: Math.max(8000, sp.durationMs || 15000),
      school: sp.school,
    });
    return;
  }

  if (sp.isHeal || sp.isShield) {
    const primaryTarget = targetUnit && (targetUnit.alive || targetUnit.isAlive) && targetUnit.hp > 0
      ? targetUnit
      : livingAllies.sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0] || u;

    // Ground heal zone (Healing Rain / Healing Tide / Mana Tide / Spirit Link / PW:Barrier)
    if (
      sp.shortId === 'healing_rain' ||
      sp.shortId === 'spirit_link_totem' ||
      sp.shortId === 'spirit_link' ||
      sp.shortId === 'healing_tide' ||
      sp.shortId === 'healing_tide_totem' ||
      sp.shortId === 'mana_tide' ||
      sp.shortId === 'mana_tide_totem' ||
      sp.shortId === 'power_word_barrier'
    ) {
      const centroid = findOptimalGroundAuraCentroid(u, livingAllies, 55, 360);
      const isHealingTide = sp.shortId.includes('healing_tide');
      const isManaTide = sp.shortId.includes('mana_tide');
      const isSpiritLink = sp.shortId.includes('spirit_link') || sp.shortId === 'power_word_barrier';
      const isTotem = isHealingTide || isManaTide || isSpiritLink;
      engine.effectsManager?.addGroundEffect({
        id: `${sp.shortId}_ai_${Date.now()}_${u.id}`,
        kind: isHealingTide ? 'TOTEM' : isTotem ? 'TOTEM' : 'HEAL_ZONE',
        spellId: sp.shortId === 'spirit_link_totem' ? 'spirit_link' : (isHealingTide ? 'healing_tide' : sp.shortId),
        ownerId: u.id,
        x: centroid.x,
        y: centroid.y,
        radius: isTotem ? 70 : 58,
        colorHex: sp.shortId === 'power_word_barrier'
          ? '#FACC15'
          : isHealingTide
          ? '#0EA5E9'
          : isManaTide
          ? '#56CCF2'
          : isTotem
          ? '#00CED1'
          : '#4169E1',
        remainingMs: isHealingTide ? 10000 : isManaTide ? 12000 : isSpiritLink ? 6000 : 10000,
        tickIntervalMs: isHealingTide ? 2000 : isManaTide ? 5000 : 1000,
        tickElapsedMs: 0,
        tickValue: Math.round(
          (isHealingTide
            ? Math.max(5200, (sp.hotTotalHeal || 26000) / 5)
            : Math.max(1600, (sp.directHeal || sp.hotTotalHeal * 0.25) * 0.4)) * individualMod
        ),
      });
      if (isManaTide) {
        for (const a of livingAllies) {
          engine.applyBuff(a, {
            id: `mana_tide_ai_${Date.now()}_${a.id}`,
            spellId: 'mana_tide',
            name: '法力之潮',
            kind: 'BUFF',
            tags: ['STAT'],
            sourceUnitId: u.id,
            targetUnitId: a.id,
            stacks: 1,
            maxStacks: 1,
            durationMs: 12000,
            remainingMs: 12000,
            school: 'NATURE',
          });
        }
      }
      if (isSpiritLink && livingAllies.length > 1) {
        // Spirit Link / Barrier immediately stabilizes raid HP toward average + small heal
        const avgPct = livingAllies.reduce((sum, a) => sum + a.hp / a.maxHp, 0) / livingAllies.length;
        for (const a of livingAllies) {
          const desiredHp = Math.round(a.maxHp * Math.min(1, avgPct + 0.08));
          if (desiredHp > a.hp) {
            engine.healUnit(u, a, desiredHp - a.hp, false, sp.name);
          }
        }
      }
      return;
    }

    // AoE Heals (Chain Heal smart bounce, Wild Growth HoT, Circle/Prayer of Healing, Light of Dawn, Tranquility, Divine Hymn)
    if (sp.isAOE) {
      const maxTargets = Math.max(3, sp.maxAoeTargets || 4);
      const woundedAllies = [...livingAllies]
        .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))
        .slice(0, maxTargets);

      if (sp.shortId === 'chain_heal') {
        let jumpAmt = rollAiHeal(u, Math.max(4800, sp.directHeal), isCrit);
        woundedAllies.forEach((ally, idx) => {
          const bCrit = idx === 0 ? isCrit : Math.random() < ((u.stats.critChance || 0.22) + critMod);
          const amt = Math.round(jumpAmt * (idx === 0 ? 1 : (bCrit ? 1.5 : 1)));
          engine.healUnit(u, ally, amt, bCrit, idx === 0 ? sp.name : `${sp.name}(第${idx + 1}跳)`);
          jumpAmt *= 0.85;
        });
        return;
      }

      for (const ally of woundedAllies) {
        const allyCrit = Math.random() < ((u.stats.critChance || 0.22) + critMod);
        const perTargetBase = Math.max(2400, sp.directHeal || sp.hotTotalHeal * 0.45);
        const healAmt = rollAiHeal(u, perTargetBase, allyCrit);
        engine.healUnit(u, ally, healAmt, allyCrit, sp.name);
        if (sp.isHot && sp.hotTotalHeal > 0) {
          engine.applyBuff(ally, {
            id: `${sp.shortId}_ai_${Date.now()}_${ally.id}_${u.id}`,
            spellId: sp.shortId,
            name: `${sp.name} (HoT)`,
            kind: 'BUFF',
            tags: ['HOT'],
            sourceUnitId: u.id,
            targetUnitId: ally.id,
            stacks: 1,
            maxStacks: 1,
            durationMs: 8000,
            remainingMs: 8000,
            school: sp.school,
            tickIntervalMs: 2000,
            tickValue: Math.round((sp.hotTotalHeal / 4) * individualMod),
          });
        }
      }
      return;
    }

    // Shield spells (Power Word: Shield)
    if (sp.isShield) {
      const shieldAmt = Math.round(Math.max(6500, sp.shieldValue || sp.directHeal) * individualMod);
      primaryTarget.absorb = Math.min(primaryTarget.maxHp * 0.5, (primaryTarget.absorb || 0) + shieldAmt);
      engine.applyBuff(primaryTarget, {
        id: `${sp.shortId}_ai_${Date.now()}_${primaryTarget.id}`,
        spellId: sp.shortId,
        name: sp.name,
        kind: 'BUFF',
        tags: ['SHIELD'],
        sourceUnitId: u.id,
        targetUnitId: primaryTarget.id,
        stacks: 1,
        maxStacks: 1,
        durationMs: 15000,
        remainingMs: 15000,
        school: sp.school,
      });
      engine.effectsManager?.addFloatingText({
        targetId: primaryTarget.id,
        text: `🛡️ ${sp.name} (+${shieldAmt})`,
        category: 'HEAL',
        isCrit: false,
      });
      return;
    }

    // Single-target direct heal and/or HoT
    if (sp.directHeal > 0) {
      const healAmt = rollAiHeal(u, sp.directHeal, isCrit);
      engine.healUnit(u, primaryTarget, healAmt, isCrit, sp.name);
      if (u.classId === 'DRUID' && ['nourish', 'healing_touch', 'regrowth'].includes(sp.shortId)) {
        engine.refreshLifebloom(primaryTarget, u.id);
      }
    }
    if (sp.isHot && sp.hotTotalHeal > 0) {
      const existingLb = sp.shortId === 'lifebloom'
        ? primaryTarget.buffs.find(b => b.spellId === 'lifebloom' && b.sourceUnitId === u.id)
        : undefined;
      const stacks = sp.shortId === 'lifebloom' ? Math.min(3, (existingLb?.stacks || 0) + 1) : 1;
      engine.applyBuff(primaryTarget, {
        id: `${sp.shortId}_ai_${Date.now()}_${primaryTarget.id}_${u.id}`,
        spellId: sp.shortId,
        name: stacks > 1 ? `${sp.name} (${stacks}层)` : `${sp.name} (HoT)`,
        kind: 'BUFF',
        tags: ['HOT'],
        sourceUnitId: u.id,
        targetUnitId: primaryTarget.id,
        stacks,
        maxStacks: sp.shortId === 'lifebloom' ? 3 : 1,
        durationMs: 12000,
        remainingMs: 12000,
        school: sp.school,
        tickIntervalMs: 3000,
        tickValue: Math.round((sp.hotTotalHeal / 4) * individualMod),
      });
    }
    return;
  }

  // Damage / Tank attack spells (AoE or ST)
  if (sp.isAOE) {
    const targets = activeEnemies.slice(0, Math.max(3, sp.maxAoeTargets || 5));
    for (const enemy of targets) {
      const tCrit = Math.random() < ((u.stats.critChance || 0.25) + critMod);
      const baseD = Math.max(2600, sp.directDamage || sp.dotTotalDamage * 0.5);
      const dmg = rollAiDamage(u, baseD, sp.school, tCrit);
      engine.dealDamage(u, enemy, dmg, sp.school, tCrit, sp.name);
      if (u.role === 'TANK') {
        engine.threatManager.addThreat(enemy.id, u.id, pauseThreat ? 500 : Math.round(dmg * 3.5));
      }
    }
    return;
  }

  const enemyTarget = targetUnit && (targetUnit.alive || targetUnit.isAlive) && targetUnit.hp > 0 && engine.enemyUnits.some(e => e.id === targetUnit.id)
    ? targetUnit
    : boss;

  const baseD = Math.max(2800, sp.directDamage || sp.dotTotalDamage * 0.35);
  const dmg = rollAiDamage(u, baseD, sp.school, isCrit);
  engine.dealDamage(u, enemyTarget, dmg, sp.school, isCrit, sp.name);

  if (u.role === 'TANK') {
    engine.threatManager.addThreat(enemyTarget.id, u.id, pauseThreat ? 500 : Math.round(dmg * 3.8));
    // Self-sustain tank skills (e.g., Death Strike / Victory Rush / Word of Glory)
    if (sp.shortId === 'death_strike') {
      const selfHeal = Math.round(4200 * individualMod);
      engine.healUnit(u, u, selfHeal, false, sp.name);
      u.absorb = Math.min(u.maxHp * 0.35, (u.absorb || 0) + Math.round(selfHeal * 0.6));
    }
  }

  if (sp.isDot && sp.dotTotalDamage > 0) {
    engine.applyBuff(enemyTarget, {
      id: `${sp.shortId}_ai_${Date.now()}_${u.id}`,
      spellId: sp.shortId,
      name: `${sp.name} (DoT)`,
      kind: 'DEBUFF',
      tags: ['DOT'],
      sourceUnitId: u.id,
      targetUnitId: enemyTarget.id,
      stacks: 1,
      maxStacks: 1,
      durationMs: 15000,
      remainingMs: 15000,
      school: sp.school,
      tickIntervalMs: 3000,
      tickValue: Math.round((sp.dotTotalDamage / 5) * individualMod),
    });
  }
}


export type FriendlyAiCombatTickCtx = {
  engine: CombatEngine;
  boss: Unit;
  livingEnemies: Unit[];
  bossThreatTargetId: string | null;
  tickCount: number;
  deltaMs: number;
  bossAi: BossAI | null;
  aiCasts: Record<string, AiActiveCast>;
  aiCooldowns: Record<string, number>;
  currentCasts: Record<string, { spellName: string; progress: number }>;
  getUnitAIPersonality: (u: Unit) => AIPersonality;
  inferAiSpecForUnit: (u: Unit) => string;
  isAiCdReady: (unitId: string, spellId: string, cdMs: number) => boolean;
  markAiCdUsed: (unitId: string, spellId: string) => void;
  notifyOom: (u: Unit, engine: CombatEngine) => void;
  addIncomingCast: (targetId: string, cast: IncomingHealCast) => void;
};

/**
 * Universal friendly-AI combat tick (interrupt / restore / battle-rez / tank /
 * read-bar advance / GCD / candidate pick). Mutates ctx.aiCasts & ctx.aiCooldowns.
 */
export function runFriendlyAiCombatTick(ctx: FriendlyAiCombatTickCtx): void {
  const engine = ctx.engine;
  const boss = ctx.boss;
  // ── Universal AI Loop across ALL Friendly AI Units (All 10 Classes & 30 Specs) ──
  const nowMs = Date.now();
  for (const u of engine.friendlyUnits) {
    // Skip local player, remote humans, and pets — only bot AI companions
    if ((!u.isAlive && !u.alive) || u.isPlayer || u.isHumanControlled || u.isPet) continue;

    const { tickOffset, individualMod, critMod } = getUnitPersonality(u);
    const aiPersonality = ctx.getUnitAIPersonality(u);
    const specId = ctx.inferAiSpecForUnit(u);
    const ownedSpells = getSpellsForClassSpec(u.classId, specId);

    // 1. CC / Stun / Movement cast-interruption check
    const isCcOrInterrupted = u.buffs?.some(b =>
      b.tags?.includes('CC') || (b.tags as any)?.includes('STUN') || (b.tags as any)?.includes('SILENCE')
    );
    if (isCcOrInterrupted || (u as any).isMoving) {
      if (ctx.aiCasts[u.id]) {
        delete ctx.aiCasts[u.id];
        engine.effectsManager?.addFloatingText({
          targetId: u.id,
          text: (u as any).isMoving ? `${u.name} 移动打断施法` : `${u.name} 施法被中断`,
          category: 'STATUS',
          isCrit: false,
        });
      }
      continue;
    }

    // 2. Universal Interrupt Check (any AI owning an off-CD interrupt stops Boss interruptible casts)
    const bossCasting = ctx.bossAi?.currentCasting;
    const shouldInterruptBoss = bossCasting?.skill.interruptible && (
      bossCasting.skill.id !== 'stay_of_execution' || bossCasting.elapsedMs >= 3000
    );
    if (shouldInterruptBoss && (ctx.tickCount + tickOffset) % 16 === 0) {
      const interruptSp = ownedSpells.find(
        sp => sp.isInterrupt && ctx.isAiCdReady(u.id, sp.shortId, sp.cooldownMs || 10000)
      );
      if (interruptSp && deductAiResource(u, interruptSp.resourceKind, interruptSp.resourceCostAmount)) {
        const success = ctx.bossAi!.interruptCurrentCast();
        if (success) {
          ctx.markAiCdUsed(u.id, interruptSp.shortId);
          if (u.combatStats) u.combatStats.interruptCount++;
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: `${u.name} ${interruptSp.name}打断！`,
            category: 'INTERRUPT',
            isCrit: true,
          });
        }
      }
    }

    // 3. Universal Resource Restore CD Check (Innervate, Mana Tide, Divine Plea, Shadowfiend, Evocation, Life Tap, Adrenaline Rush)
    if ((ctx.tickCount + tickOffset) % 20 === 0) {
      const primaryRes = getClassPrimaryResource(u.classId, specId);
      const curRes = getUnitResourceAmount(u, primaryRes);
      const maxRes = primaryRes === 'MANA' ? (u.maxMp || LEVEL_80_STATS.casterBaseMp) : 100;
      const resRatio = maxRes > 0 ? curRes / maxRes : 1;
      const threshold = primaryRes === 'ENERGY' ? (aiPersonality.energyReserveThreshold / 100) : aiPersonality.resourceHealthyThreshold;
      if (resRatio < threshold) {
        const restoreSp = ownedSpells.find(
          sp => sp.isResourceRestore && ctx.isAiCdReady(u.id, sp.shortId, sp.cooldownMs || 60000)
        );
        if (restoreSp) {
          ctx.markAiCdUsed(u.id, restoreSp.shortId);
          if (primaryRes === 'MANA' && u.maxMp) {
            const instantRestore = Math.round(u.maxMp * 0.25);
            u.mp = Math.min(u.maxMp, (u.mp ?? 0) + instantRestore);
            syncUnitResources(u);
            const buffTargets = restoreSp.isAOE ? engine.friendlyUnits.filter(a => a.alive || a.isAlive) : [u];
            for (const bt of buffTargets) {
              engine.applyBuff(bt, {
                id: `${restoreSp.shortId}_ai_${Date.now()}_${bt.id}`,
                spellId: restoreSp.shortId,
                name: `${restoreSp.name} (+回蓝)`,
                kind: 'BUFF',
                tags: ['STAT'],
                sourceUnitId: u.id,
                targetUnitId: bt.id,
                stacks: 1,
                maxStacks: 1,
                durationMs: 10000,
                remainingMs: 10000,
                school: restoreSp.school,
              });
            }
          } else if (primaryRes === 'ENERGY') {
            engine.applyBuff(u, {
              id: `${restoreSp.shortId}_ai_${Date.now()}_${u.id}`,
              spellId: restoreSp.shortId,
              name: `${restoreSp.name} (回能+100%)`,
              kind: 'BUFF',
              tags: ['STAT'],
              sourceUnitId: u.id,
              targetUnitId: u.id,
              stacks: 1,
              maxStacks: 1,
              durationMs: 15000,
              remainingMs: 15000,
              school: restoreSp.school,
            });
          }
          engine.effectsManager?.addFloatingText({
            targetId: u.id,
            text: `${u.name} 施放【${restoreSp.name}】恢复资源！`,
            category: 'HEAL',
            isCrit: true,
          });
        }
      }
    }

    // 4. Universal Battle-Rez Check (any AI owning an off-CD combat rez revives fallen allies)
    const deadAlly = engine.friendlyUnits.find(a => (!a.alive || !a.isAlive) || a.hp <= 0);
    if (deadAlly && (ctx.tickCount + tickOffset) % 30 === 0) {
      const bRezSp = ownedSpells.find(
        sp => sp.isResurrect && !sp.isOutOfCombatOnly && ctx.isAiCdReady(u.id, sp.shortId, sp.cooldownMs || 600000)
      );
      if (bRezSp && deductAiResource(u, bRezSp.resourceKind, bRezSp.resourceCostAmount)) {
        ctx.markAiCdUsed(u.id, bRezSp.shortId);
        engine.resurrectUnit(deadAlly.id, 0.6, 0.6);
        engine.effectsManager?.addFloatingText({
          targetId: deadAlly.id,
          text: `⚡ ${u.name} 施放【${bRezSp.name}】战复了 ${deadAlly.name}！`,
          category: 'HEAL',
          isCrit: true,
        });
      }
    }

    // 5. Tank Threat, Taunt & Defensive Cooldown Checks (Universal across Warrior/Paladin/DK/Druid Tanks)
    let tankPauseThreat = false;
    if (u.role === 'TANK') {
      const allTanks = engine.friendlyUnits.filter(t => t.role === 'TANK' && (t.isAlive ?? t.alive));
      const threatDecision = evaluateTankThreatDecision(u, allTanks, ctx.bossThreatTargetId, ctx.bossThreatTargetId === u.id);
      tankPauseThreat = threatDecision.pauseThreat;

      if (threatDecision.shouldTaunt && (ctx.tickCount + tickOffset) % 12 === 0) {
        const tauntSp = ownedSpells.find(sp => sp.isTaunt && ctx.isAiCdReady(u.id, sp.shortId, sp.cooldownMs || 8000));
        if (tauntSp) {
          ctx.markAiCdUsed(u.id, tauntSp.shortId);
          engine.threatManager.applyTaunt(boss.id, u.id);
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: `${u.name} ${tauntSp.name}嘲讽接怪！`,
            category: 'CRIT',
            isCrit: true,
          });
        }
      }

      if (u.hp / u.maxHp < 0.52 && (ctx.tickCount + tickOffset) % 15 === 0) {
        const defSp = ownedSpells.find(
          sp => sp.isDefensive && ctx.isAiCdReady(u.id, sp.shortId, sp.cooldownMs || 60000)
        );
        if (defSp) {
          ctx.markAiCdUsed(u.id, defSp.shortId);
          u.absorb = Math.min(u.maxHp * 0.4, (u.absorb || 0) + Math.round(u.maxHp * 0.14));
          engine.applyBuff(u, {
            id: `${defSp.shortId}_ai_${Date.now()}_${u.id}`,
            spellId: defSp.shortId,
            name: `${defSp.name} (减伤)`,
            kind: 'BUFF',
            tags: ['SHIELD'],
            sourceUnitId: u.id,
            targetUnitId: u.id,
            stacks: 1,
            maxStacks: 1,
            durationMs: 10000,
            remainingMs: 10000,
            school: defSp.school,
          });
          engine.effectsManager?.addFloatingText({
            targetId: u.id,
            text: `🛡️ ${u.name} 开启【${defSp.name}】！`,
            category: 'HEAL',
            isCrit: true,
          });
        }
      }
    }

    // 6. Advance Ongoing Read-Bar Cast (for BOTH Healer AND Caster DPS)
    let activeAiCast = ctx.aiCasts[u.id];
    if (activeAiCast) {
      const targetUnit = activeAiCast.isHarmful
        ? engine.enemyUnits.find(e => e.id === activeAiCast.targetId) || boss
        : engine.friendlyUnits.find(a => a.id === activeAiCast.targetId);
      if (!targetUnit || (!targetUnit.alive && !targetUnit.isAlive) || targetUnit.hp <= 0) {
        delete ctx.aiCasts[u.id];
        activeAiCast = undefined as any;
      }
    }

    if (activeAiCast) {
      activeAiCast.elapsedMs += ctx.deltaMs;
      const progress = Math.min(1, activeAiCast.elapsedMs / Math.max(100, activeAiCast.totalMs));
      if (progress >= 1) {
        delete ctx.aiCasts[u.id];
        const sp = activeAiCast.normalizedSpell || getSpellByAnyId(activeAiCast.spellId, u.classId);
        const targetUnit = activeAiCast.isHarmful
          ? engine.enemyUnits.find(e => e.id === activeAiCast.targetId) || boss
          : engine.friendlyUnits.find(a => a.id === activeAiCast.targetId);
        if (sp && targetUnit && (targetUnit.alive || targetUnit.isAlive) && targetUnit.hp > 0) {
          if (deductAiResource(u, activeAiCast.resourceKind || sp.resourceKind, activeAiCast.manaCost)) {
            if (sp.cooldownMs > 0) ctx.markAiCdUsed(u.id, sp.shortId);
            executeAiNormalizedSpell(engine, ctx.livingEnemies, boss, u, sp, targetUnit, individualMod, critMod, tankPauseThreat);
          }
        }
      } else {
        ctx.currentCasts[u.id] = { spellName: activeAiCast.spellName, progress };
        if (!activeAiCast.isHarmful) {
          ctx.addIncomingCast(activeAiCast.targetId, {
            casterId: u.id,
            casterName: u.name,
            spellName: activeAiCast.spellName,
            amount: activeAiCast.amount,
            progress,
            classId: u.classId,
          });
        }
      }
      continue;
    }

    // 7. Per-Unit Effective GCD Check (Lv.80 max haste: >= 1000ms NORMAL / 1000ms ROGUE)
    const unitGcdMs = getEffectiveGcdMs(u.classId === 'ROGUE' || u.classId === 'HUNTER' ? 'ROGUE' : 'NORMAL', u.stats.haste ?? LEVEL_80_MAX_HASTE);
    const lastGcdTime = ctx.aiCooldowns[`${u.id}_gcd`] || 0;
    if (nowMs - lastGcdTime < unitGcdMs) continue;

    // 8. Build Usable Candidates Dynamically from Unit's Owned Available Skills & Evaluate Universal Rules
    const roleFilter: 'HEAL' | 'DAMAGE' = u.role === 'HEALER' ? 'HEAL' : 'DAMAGE';
    const usableCandidates = buildUsableCandidatesForUnit(
      u,
      specId,
      (sp) => ctx.isAiCdReady(u.id, sp.shortId, sp.cooldownMs),
      { roleFilter, useShortId: true }
    );

    const decision = evaluateUniversalAIDecision({
      caster: u,
      personality: aiPersonality,
      allies: engine.friendlyUnits,
      enemies: ctx.livingEnemies.length > 0 ? ctx.livingEnemies : [boss],
      usableSkills: usableCandidates,
      tickCount: ctx.tickCount,
    });

    if (decision.chosenCandidate) {
      const chosen = decision.chosenCandidate;
      const normSp = getSpellByAnyId(chosen.spellId, u.classId);
      if (!normSp) continue;

      const targetUnit = decision.targetUnit || (roleFilter === 'HEAL'
        ? [...engine.friendlyUnits].filter(a => (a.alive || a.isAlive) && a.hp > 0).sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0] || u
        : boss);

      const hastedCastMs = chosen.castMs > 0 ? chosen.castMs : 0;

      // Commit AI GCD start timestamp
      ctx.aiCooldowns[`${u.id}_gcd`] = nowMs;

      if (hastedCastMs <= 0) {
        if (deductAiResource(u, normSp.resourceKind, chosen.cost)) {
          if (normSp.cooldownMs > 0) ctx.markAiCdUsed(u.id, normSp.shortId);
          executeAiNormalizedSpell(engine, ctx.livingEnemies, boss, u, normSp, targetUnit, individualMod, critMod, tankPauseThreat);
        }
      } else {
        const preVal = Math.round(chosen.baseAmt * individualMod);
        const isHarmful = !normSp.isHeal && !normSp.isShield;
        ctx.aiCasts[u.id] = {
          targetId: targetUnit.id,
          spellId: chosen.spellId,
          spellName: chosen.spellName,
          amount: preVal,
          baseAmt: chosen.baseAmt,
          manaCost: chosen.cost,
          resourceKind: normSp.resourceKind,
          totalMs: hastedCastMs,
          elapsedMs: 0,
          isHarmful,
          isAOE: chosen.isAOE,
          maxTargets: chosen.maxTargets,
          school: normSp.school,
          normalizedSpell: normSp,
        };
        ctx.currentCasts[u.id] = { spellName: chosen.spellName, progress: 0 };
        if (!isHarmful) {
          ctx.addIncomingCast(targetUnit.id, {
            casterId: u.id,
            casterName: u.name,
            spellName: chosen.spellName,
            amount: preVal,
            progress: 0,
            classId: u.classId,
          });
        }
      }
    } else if ((ctx.tickCount + tickOffset) % 60 === 0 && u.maxMp && u.maxMp > 0 && (u.mp ?? 0) < 1200) {
      ctx.notifyOom(u, engine);
    }
  }
}
