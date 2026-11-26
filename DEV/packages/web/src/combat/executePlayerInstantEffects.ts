import type { BossAI, CombatEngine, NormalizedSpell, Unit } from '@cata-raid-sim/engine';
import {
  findOptimalGroundAuraCentroid,
  getHastedCastTimeMs,
  getUnitHaste,
  LEVEL_80_MAX_HASTE,
  isChanneledSpell,
  selectAoeHealTargets,
  selectAoeEnemyTargets,
  selectRaidBuffTargets,
  RANGE_15YD_PX,
  RANGE_30YD_PX,
  resolveAoePulsePose,
  isTimedSummonSpellId,
  spawnTimedSummons,
  isValidLifebloomTarget,
} from '@cata-raid-sim/engine';
import { DEFAULT_SPELL_COOLDOWNS } from '../assets/defaultActionSlots.js';
import type { ActionSlot, PlayerCastState } from '../components/ActionBar.js';
import { syncUnitResources } from './unitResources.js';
import { emitLocalAoePulse } from './emitLocalAoePulse.js';
import { applyRaidLustBuff } from './raidLustBuff.js';
import { reportUnitSummon } from './summonReport.js';

export type InstantEffectsCtx = {
  engine: CombatEngine;
  player: Unit;
  boss: Unit | undefined;
  slot: ActionSlot;
  normSlotSpell: NormalizedSpell | undefined | null;
  effectiveFriendly: Unit;
  effectiveTarget: Unit;
  isFriendlySpell: boolean;
  selectedTargetId: string | null;
  bossAi: BossAI | null;
  triggerSlotCooldown: (overrideMs?: number) => void;
  startPlayerCast: (state: PlayerCastState) => void;
  handleDispelUnit: (targetUnitId?: string | null, skipResourceCost?: boolean) => void;
  onScreenShake: (ms: number) => void;
  onFriendlyUnitsChanged: () => void;
};

/**
 * Instant / HoT / DoT / data-driven player spell effects after cast-start gates.
 * Returns true if the branch handled the spell (caller should stop).
 * Cast-bar / channel starters inside the data-driven block also count as handled.
 */
export function executePlayerInstantEffects(ctx: InstantEffectsCtx): boolean {
  const {
    engine,
    player,
    boss,
    slot,
    normSlotSpell,
    effectiveFriendly,
    effectiveTarget,
    isFriendlySpell,
    selectedTargetId,
    bossAi,
    triggerSlotCooldown,
    startPlayerCast,
    handleDispelUnit,
    onScreenShake,
    onFriendlyUnitsChanged,
  } = ctx;

  const hostileTarget =
    !isFriendlySpell &&
    effectiveTarget &&
    (effectiveTarget.isAlive ?? effectiveTarget.alive) &&
    effectiveTarget.hp > 0
      ? effectiveTarget
      : boss && (boss.isAlive ?? boss.alive) && boss.hp > 0
        ? boss
        : undefined;

    // ── Dispel Spells ─────────────────────────────────────────────────
    if (
      slot.spellId === 'natures_cure' ||
      slot.spellId === 'cleanse_spirit' ||
      slot.spellId === 'remove_curse' ||
      slot.spellId === 'remove_corruption' ||
      slot.spellId === 'cleanse' ||
      slot.spellId === 'dispel_magic'
    ) {
      handleDispelUnit(effectiveFriendly.id, true);
      return true;
    }

    // ── Instant Spells & HoTs/DoTs ─────────────────────────────────────
    // Druid HoTs
    if (slot.spellId === 'rejuvenation') {
      const target = effectiveFriendly;
      engine.applyBuff(target, {
        id: `rejuv_${Date.now()}`,
        spellId: 'rejuvenation',
        name: '回春术 (HoT)',
        kind: 'BUFF',
        tags: ['HOT'],
        sourceUnitId: player.id,
        targetUnitId: target.id,
        stacks: 1,
        maxStacks: 1,
        durationMs: 12000,
        remainingMs: 12000,
        school: 'NATURE',
        tickIntervalMs: 3000,
        tickValue: 4500,
      });
      engine.effectsManager?.addFloatingText({
        targetId: target.id,
        text: '回春术',
        category: 'HEAL',
        isCrit: false,
      });
      triggerSlotCooldown();
      return true;
    } else if (slot.spellId === 'lifebloom') {
      const target = effectiveFriendly;
      // 友方有效；图腾不可作为生命绽放目标
      if (!isValidLifebloomTarget(target, engine)) {
        engine.effectsManager?.addFloatingText({
          targetId: player.id,
          text: '❌ 无法对图腾施放生命绽放',
          category: 'STATUS',
          isCrit: false,
        });
        return true;
      }
      // 生命绽放唯一目标限制：同一释放者同时只能给一个人维持生命绽放；若给其他人施放，立即没收该释放者给其他人施加的生命绽放buff（包括所有层数）
      for (const u of engine.getAllUnits()) {
        if (u.id !== target.id) {
          while (engine.auraManager.removeBuff(u, 'lifebloom', player.id)) {}
        }
      }
      // Always go through applyBuff so withNetworkVitals publishes ABSOLUTE stacks
      // (in-place mutate used to leave remotes stuck at 1 layer).
      const existing = target.buffs.find(b => b.spellId === 'lifebloom' && b.sourceUnitId === player.id);
      const nextStacks = Math.min(3, (existing?.stacks || 0) + 1);
      engine.applyBuff(target, {
        id: `lb_${Date.now()}`,
        spellId: 'lifebloom',
        name: `生命绽放 (${nextStacks}层)`,
        kind: 'BUFF',
        tags: ['HOT'],
        sourceUnitId: player.id,
        targetUnitId: target.id,
        stacks: nextStacks,
        maxStacks: 3,
        durationMs: 15000,
        remainingMs: 15000,
        school: 'NATURE',
        tickIntervalMs: 2000,
        tickValue: 2400,
      });
      const after = target.buffs.find(b => b.spellId === 'lifebloom' && b.sourceUnitId === player.id);
      onFriendlyUnitsChanged();
      engine.effectsManager?.addFloatingText({
        targetId: target.id,
        text: `生命绽放 (${after?.stacks ?? nextStacks}层)`,
        category: 'HEAL',
        isCrit: false,
      });
      triggerSlotCooldown();
      return true;
    } else if (slot.spellId === 'swiftmend') {
      const target = effectiveFriendly;
      const hotIdx = target.buffs.findIndex(b => b.spellId === 'rejuvenation' || b.spellId === 'regrowth');
      if (hotIdx === -1) {
        engine.effectsManager?.addFloatingText({
          targetId: player.id,
          text: '❌ 目标身上没有回春术或愈合！无法施放迅捷治愈',
          category: 'STATUS',
          isCrit: false,
        });
      return true;
      }
      const consumedBuff = target.buffs.splice(hotIdx, 1)[0];
      onFriendlyUnitsChanged();
      engine.effectsManager?.addFloatingText({
        targetId: target.id,
        text: `迅捷治愈 (消耗${consumedBuff.name.split(' ')[0]})`,
        category: 'HEAL',
        isCrit: true,
      });
      engine.healUnit(player, target, 28000, Math.random() < 0.3, '迅捷治愈');
      // Summons Efflorescence (百花齐放) healing circle zone on ground
      engine.effectsManager?.addGroundEffect({
        id: `efflor_${Date.now()}`,
        kind: 'HEAL_ZONE',
        spellId: 'swiftmend',
        ownerId: player.id,
        x: target.position.x || 160,
        y: target.position.y || 220,
        radius: 50,
        colorHex: '#10B981',
        remainingMs: 7000,
        tickIntervalMs: 1000,
        tickElapsedMs: 0,
        tickValue: 3800,
      });
      triggerSlotCooldown();
      return true;
    } else if (slot.spellId === 'wild_growth') {
      // 40yd cast → splash 15yd around selected ally (center), up to 5 lowest HP%
      const centerTarget = effectiveFriendly || player;
      const wgRadius = normSlotSpell?.aoeRadiusPx || RANGE_15YD_PX;
      const chosen = selectAoeHealTargets({
        spellId: 'wild_growth',
        allies: engine.friendlyUnits,
        caster: player,
        primaryTarget: centerTarget,
        maxAoeTargets: 5,
        targetType: 'SMART_ALLY',
      });

      for (const u of chosen) {
        engine.applyBuff(u, {
          id: `wg_${Date.now()}_${u.id}`,
          spellId: 'wild_growth',
          name: '野性成长',
          kind: 'BUFF',
          tags: ['HOT'],
          sourceUnitId: player.id,
          targetUnitId: u.id,
          stacks: 1,
          maxStacks: 1,
          durationMs: 7000,
          remainingMs: 7000,
          school: 'NATURE',
          tickIntervalMs: 1000,
          tickValue: 2400,
        });
        engine.effectsManager?.addFloatingText({
          targetId: u.id,
          text: '野性成长',
          category: 'HEAL',
          isCrit: false,
        });
      }
      if (centerTarget.position) {
        emitLocalAoePulse(engine, {
          actor: player,
          spellId: 'wild_growth',
          spellName: '野性成长',
          targetId: centerTarget.id,
          x: centerTarget.position.x,
          y: centerTarget.position.y,
          radius: wgRadius,
          isHeal: true,
        });
      }
      triggerSlotCooldown();
      return true;
    } else if (slot.spellId === 'moonfire') {
      if (boss && boss.alive) {
        engine.dealDamage(player, boss, 4800, 'ARCANE', false, '月火术');
        engine.applyBuff(boss, {
          id: `mf_${Date.now()}`,
          spellId: 'moonfire',
          name: '月火术 (DoT)',
          kind: 'DEBUFF',
          tags: ['DOT'],
          sourceUnitId: player.id,
          targetUnitId: boss.id,
          stacks: 1,
          maxStacks: 1,
          durationMs: 14000,
          remainingMs: 14000,
          school: 'ARCANE',
          tickIntervalMs: 2000,
          tickValue: 2800,
        });
        triggerSlotCooldown();
      }
      return true;
    } else if (slot.spellId === 'sunfire') {
      if (boss && boss.alive) {
        engine.dealDamage(player, boss, 4800, 'NATURE', false, '日火术');
        engine.applyBuff(boss, {
          id: `sf_${Date.now()}`,
          spellId: 'sunfire',
          name: '日火术 (DoT)',
          kind: 'DEBUFF',
          tags: ['DOT'],
          sourceUnitId: player.id,
          targetUnitId: boss.id,
          stacks: 1,
          maxStacks: 1,
          durationMs: 14000,
          remainingMs: 14000,
          school: 'NATURE',
          tickIntervalMs: 2000,
          tickValue: 2800,
        });
        triggerSlotCooldown();
      }
      return true;
    } else if (slot.spellId === 'innervate') {
      const target = effectiveFriendly;
      engine.applyBuff(target, {
        id: `inn_${Date.now()}`,
        spellId: 'innervate',
        name: '激活 (法力回复)',
        kind: 'BUFF',
        tags: ['STAT'],
        sourceUnitId: player.id,
        targetUnitId: target.id,
        stacks: 1,
        maxStacks: 1,
        durationMs: 10000,
        remainingMs: 10000,
        school: 'NATURE',
      });
      engine.effectsManager?.addFloatingText({
        targetId: target.id,
        text: '激活 (每秒回复5%法力)',
        category: 'HEAL',
        isCrit: false,
      });
      triggerSlotCooldown(180000);
      return true;
    }

    // Death Knight Abilities
    if (slot.spellId === 'death_strike') {
      if (boss && boss.alive) {
        engine.dealDamage(player, boss, 9800, 'PHYSICAL', Math.random() < 0.3, '灵界打击');
        engine.healUnit(player, player, 12000, false, '灵界打击');
        engine.threatManager.addThreat(boss.id, player.id, 25000);
        triggerSlotCooldown();
      }
      return true;
    } else if (slot.spellId === 'heart_strike' || slot.spellId === 'rune_strike') {
      if (boss && boss.alive) {
        const sName = slot.spellId === 'rune_strike' ? '符文打击' : '心脏打击';
        engine.dealDamage(player, boss, 7500, 'PHYSICAL', Math.random() < 0.25, sName);
        engine.threatManager.addThreat(boss.id, player.id, 18000);
        triggerSlotCooldown();
      }
      return true;
    } else if (slot.spellId === 'dark_command') {
      const tauntTarget =
        effectiveTarget && effectiveTarget.role === 'ENEMY' && (effectiveTarget.alive ?? effectiveTarget.isAlive)
          ? effectiveTarget
          : boss;
      if (tauntTarget && (tauntTarget.alive ?? tauntTarget.isAlive)) {
        engine.threatManager.applyTaunt(tauntTarget.id, player.id);
        engine.effectsManager?.addFloatingText({
          targetId: tauntTarget.id,
          text: '黑暗命令 (嘲讽！)',
          category: 'CRIT',
          isCrit: true,
        });
        triggerSlotCooldown();
      }
      return true;
    } else if (slot.spellId === 'bone_shield') {
      engine.applyBuff(player, {
        id: `bone_shield_${Date.now()}`,
        spellId: 'bone_shield',
        name: '白骨之盾 (6层)',
        kind: 'BUFF',
        tags: ['SHIELD'],
        sourceUnitId: player.id,
        targetUnitId: player.id,
        stacks: 6,
        maxStacks: 6,
        durationMs: 300000,
        remainingMs: 300000,
        school: 'SHADOW',
      });
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '💀 白骨之盾 (6层 20%减伤)',
        category: 'STATUS',
        isCrit: false,
      });
      triggerSlotCooldown();
      return true;
    } else if (slot.spellId === 'vampiric_blood') {
      engine.applyBuff(player, {
        id: `vb_${Date.now()}`,
        spellId: 'vampiric_blood',
        name: '吸血鬼之血',
        kind: 'BUFF',
        tags: ['STAT'],
        sourceUnitId: player.id,
        targetUnitId: player.id,
        stacks: 1,
        maxStacks: 1,
        durationMs: 10000,
        remainingMs: 10000,
        school: 'PHYSICAL',
      });
      player.hp = Math.min(player.maxHp + 25000, player.hp + 25000);
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '吸血鬼之血 +25,000临时生命',
        category: 'HEAL',
        isCrit: true,
      });
      triggerSlotCooldown();
      return true;
    } else if (
      slot.spellId === 'death_and_decay' ||
      slot.spellId === 'dnd' ||
      slot.spellId === 'dk_dnd'
    ) {
      // 枯萎凋零必须点地（与治疗之雨相同）；此处不应自动落到首领脚下
      return false;
    } else if (slot.spellId === 'howling_blast') {
      if (boss && boss.alive) {
        engine.dealDamage(player, boss, 14200, 'FROST', Math.random() < 0.3, '凛风冲击');
        engine.threatManager.addThreat(boss.id, player.id, 14200);
        triggerSlotCooldown();
      }
      return true;
    } else if (slot.spellId === 'frost_strike') {
      if (boss && boss.alive) {
        engine.dealDamage(player, boss, 18500, 'FROST', Math.random() < 0.4, '冰霜打击');
        engine.threatManager.addThreat(boss.id, player.id, 18500);
        triggerSlotCooldown();
      }
      return true;
    } else if (slot.spellId === 'obliterate') {
      if (boss && boss.alive) {
        onScreenShake(120);
        engine.dealDamage(player, boss, 27500, 'PHYSICAL', Math.random() < 0.35, '湮灭');
        engine.threatManager.addThreat(boss.id, player.id, 27500);
        triggerSlotCooldown();
      }
      return true;
    } else if (slot.spellId === 'pillar_of_frost') {
      engine.applyBuff(player, {
        id: `pof_${Date.now()}`,
        spellId: 'pillar_of_frost',
        name: '冰霜之柱 (+20%力量)',
        kind: 'BUFF',
        tags: ['STAT'],
        sourceUnitId: player.id,
        targetUnitId: player.id,
        stacks: 1,
        maxStacks: 1,
        durationMs: 20000,
        remainingMs: 20000,
        school: 'FROST',
      });
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '冰霜之柱 +20%力量',
        category: 'HEAL',
        isCrit: true,
      });
      triggerSlotCooldown();
      return true;
    } else if (slot.spellId === 'horn_of_winter') {
      for (const u of engine.friendlyUnits) {
        if (u.alive) {
          engine.applyBuff(u, {
            id: `how_${u.id}`,
            spellId: 'horn_of_winter',
            name: '寒冬号角 (+属性)',
            kind: 'BUFF',
            tags: ['STAT'],
            sourceUnitId: player.id,
            targetUnitId: u.id,
            stacks: 1,
            maxStacks: 1,
            durationMs: 120000,
            remainingMs: 120000,
            school: 'PHYSICAL',
          });
        }
      }
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '寒冬号角 (全团力量/敏捷提高)',
        category: 'HEAL',
        isCrit: false,
      });
      triggerSlotCooldown();
      return true;
    }

    // Interrupts (Mind Freeze, Wind Shear, Counterspell, Kick)
    if (slot.spellId === 'mind_freeze' || slot.spellId === 'wind_shear' || slot.spellId === 'counterspell' || slot.spellId === 'kick') {
      if (boss && (boss.alive || boss.isAlive) && boss.hp > 0 && bossAi) {
        const success = bossAi.interruptCurrentCast();
        if (success) {
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '打断成功！',
            category: 'INTERRUPT',
            isCrit: true,
          });
          if (player.combatStats) player.combatStats.interruptCount++;
        } else {
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '未在施法 / 无法打断',
            category: 'STATUS',
            isCrit: false,
          });
        }
        triggerSlotCooldown();
      }
      return true;
    }

    // Shaman Abilities
    if (slot.spellId === 'riptide') {
      const target = effectiveFriendly;
      engine.healUnit(player, target, 12000, Math.random() < 0.25, '激流');
      engine.applyBuff(target, {
        id: `rip_${Date.now()}`,
        spellId: 'riptide',
        name: '激流 (HoT)',
        kind: 'BUFF',
        tags: ['HOT'],
        sourceUnitId: player.id,
        targetUnitId: target.id,
        stacks: 1,
        maxStacks: 1,
        durationMs: 15000,
        remainingMs: 15000,
        school: 'NATURE',
        tickIntervalMs: 3000,
        tickValue: 2500,
      });
      triggerSlotCooldown();
      return true;
    } else if (slot.spellId === 'chain_heal') {
      // Cataclysm Resto Shaman Chain Heal: 2.5s base cast (1.67s at Lv.80 max haste), 0s CD!
      const hastedMs = getHastedCastTimeMs(2500, getUnitHaste(player, LEVEL_80_MAX_HASTE));
      startPlayerCast({
        spellId: 'chain_heal',
        spellName: '治疗链',
        elapsedMs: 0,
        totalMs: hastedMs,
        progress: 0,
        isChannel: false,
        isHarmful: false,
        targetId: effectiveFriendly.id,
        totalCdMs: 0,
      });
      return true;
    } else if (slot.spellId === 'healing_rain') {
      const rainPos = findOptimalGroundAuraCentroid(player, engine.friendlyUnits, 60, 360);
      engine.effectsManager?.addGroundEffect({
        id: `hrain_${Date.now()}`,
        kind: 'HEAL_ZONE',
        spellId: 'healing_rain',
        ownerId: player.id,
        x: rainPos.x,
        y: rainPos.y,
        radius: 60,
        colorHex: '#10B981',
        remainingMs: 10000,
        tickIntervalMs: 1000,
        tickElapsedMs: 0,
        tickValue: 3400,
      });
      triggerSlotCooldown();
      return true;
    } else if (slot.spellId === 'spirit_link' || slot.spellId === 'spirit_link_totem') {
      // Player casts go through ground-target reticle (40yd like Healing Rain).
      // This branch is fallback/AI-style: place near injured allies centroid, never force at feet.
      const linkPos = findOptimalGroundAuraCentroid(player, engine.friendlyUnits, 80, 320);
      engine.effectsManager?.addGroundEffect({
        id: `slt_${Date.now()}`,
        kind: 'TOTEM',
        spellId: 'spirit_link',
        ownerId: player.id,
        x: linkPos.x,
        y: linkPos.y,
        radius: 80,
        colorHex: '#EAB308',
        remainingMs: 6000,
        tickIntervalMs: 1000,
        tickElapsedMs: 0,
        tickValue: 0,
      });
      triggerSlotCooldown();
      return true;
    } else if (slot.spellId === 'flame_shock') {
      if (boss && boss.alive) {
        engine.dealDamage(player, boss, 5200, 'FIRE', false, '烈焰震击');
        engine.applyBuff(boss, {
          id: `fs_${Date.now()}`,
          spellId: 'flame_shock',
          name: '烈焰震击 (DoT)',
          kind: 'DEBUFF',
          tags: ['DOT'],
          sourceUnitId: player.id,
          targetUnitId: boss.id,
          stacks: 1,
          maxStacks: 1,
          durationMs: 18000,
          remainingMs: 18000,
          school: 'FIRE',
          tickIntervalMs: 3000,
          tickValue: 3200,
        });
        triggerSlotCooldown();
      }
      return true;
    } else if (slot.spellId === 'earth_shock') {
      if (boss && boss.alive) {
        engine.dealDamage(player, boss, 15500, 'NATURE', Math.random() < 0.3, '大地震击');
        engine.threatManager.addThreat(boss.id, player.id, 15500);
        triggerSlotCooldown();
      }
      return true;
    } else if (slot.spellId === 'bloodlust') {
      const n = applyRaidLustBuff(engine, player, 'bloodlust');
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: n > 0 ? '嗜血！全团急速+30%' : '全员已疲惫，嗜血无效',
        category: n > 0 ? 'CRIT' : 'STATUS',
        isCrit: n > 0,
      });
      triggerSlotCooldown();
      return true;
    }

    // Mage Abilities
    if (slot.spellId === 'living_bomb') {
      if (boss && boss.alive) {
        engine.dealDamage(player, boss, 5000, 'FIRE', false, '活动炸弹');
        engine.applyBuff(boss, {
          id: `lb_${Date.now()}`,
          spellId: 'living_bomb',
          name: '活动炸弹',
          kind: 'DEBUFF',
          tags: ['DOT'],
          sourceUnitId: player.id,
          targetUnitId: boss.id,
          stacks: 1,
          maxStacks: 1,
          durationMs: 12000,
          remainingMs: 12000,
          school: 'FIRE',
          tickIntervalMs: 3000,
          tickValue: 3500,
        });
        triggerSlotCooldown();
      }
      return true;
    } else if (slot.spellId === 'combustion') {
      if (boss && boss.alive) {
        const hasLb = boss.buffs.some(b => b.spellId === 'living_bomb');
        const dmg = hasLb ? 38000 : 16000;
        engine.dealDamage(player, boss, dmg, 'FIRE', true, '燃烧');
        engine.threatManager.addThreat(boss.id, player.id, dmg);
        triggerSlotCooldown();
      }
      return true;
    } else if (slot.spellId === 'time_warp') {
      const n = applyRaidLustBuff(engine, player, 'time_warp');
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: n > 0 ? '时间扭曲！全团急速+30%' : '全员已疲惫，时间扭曲无效',
        category: n > 0 ? 'CRIT' : 'STATUS',
        isCrit: n > 0,
      });
      triggerSlotCooldown();
      return true;
    } else if (slot.spellId === 'ice_lance') {
      if (boss && boss.alive) {
        engine.dealDamage(player, boss, 9200, 'FROST', Math.random() < 0.4, '冰枪术');
        engine.threatManager.addThreat(boss.id, player.id, 9200);
        triggerSlotCooldown();
      }
      return true;
    } else if (slot.spellId === 'deep_freeze') {
      if (boss && boss.alive) {
        onScreenShake(120);
        engine.dealDamage(player, boss, 34000, 'FROST', true, '深度冻结');
        engine.threatManager.addThreat(boss.id, player.id, 34000);
        triggerSlotCooldown();
      }
      return true;
    } else if (slot.spellId === 'frozen_orb') {
      const bossPos = engine.bossUnit?.position || { x: 520, y: 200 };
      engine.effectsManager?.addGroundEffect({
        id: `forb_${Date.now()}`,
        kind: 'DAMAGE_ZONE',
        spellId: 'frozen_orb',
        ownerId: player.id,
        x: bossPos.x,
        y: bossPos.y,
        radius: 65,
        colorHex: '#EF4444',
        remainingMs: 10000,
        tickIntervalMs: 1000,
        tickElapsedMs: 0,
        tickValue: 4200,
      });
      triggerSlotCooldown();
      return true;
    } else if (slot.spellId === 'arcane_barrage') {
      if (boss && boss.alive) {
        engine.dealDamage(player, boss, 19000, 'ARCANE', Math.random() < 0.35, '奥术弹幕');
        engine.threatManager.addThreat(boss.id, player.id, 19000);
        triggerSlotCooldown();
      }
      return true;
    } else if (slot.spellId === 'arcane_power') {
      engine.applyBuff(player, {
        id: `ap_${Date.now()}`,
        spellId: 'arcane_power',
        name: '奥术强化 (+20%法伤)',
        kind: 'BUFF',
        tags: ['STAT'],
        sourceUnitId: player.id,
        targetUnitId: player.id,
        stacks: 1,
        maxStacks: 1,
        durationMs: 15000,
        remainingMs: 15000,
        school: 'ARCANE',
      });
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '奥术强化 +20%法伤',
        category: 'CRIT',
        isCrit: true,
      });
      triggerSlotCooldown();
      return true;
    }

    // Rogue Abilities
    if (slot.spellId === 'slice_and_dice') {
      engine.applyBuff(player, {
        id: `snd_${Date.now()}`,
        spellId: 'slice_and_dice',
        name: '切割 (+40%攻速)',
        kind: 'BUFF',
        tags: ['STAT'],
        sourceUnitId: player.id,
        targetUnitId: player.id,
        stacks: 1,
        maxStacks: 1,
        durationMs: 24000,
        remainingMs: 24000,
        school: 'PHYSICAL',
      });
      triggerSlotCooldown();
      return true;
    } else if (slot.spellId === 'feint') {
      engine.applyBuff(player, {
        id: `feint_${Date.now()}`,
        spellId: 'feint',
        name: '佯攻 (AOE减伤50%)',
        kind: 'BUFF',
        tags: ['STAT'],
        sourceUnitId: player.id,
        targetUnitId: player.id,
        stacks: 1,
        maxStacks: 1,
        durationMs: 5000,
        remainingMs: 5000,
        school: 'PHYSICAL',
      });
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '佯攻 (AOE减伤50%)',
        category: 'HEAL',
        isCrit: false,
      });
      triggerSlotCooldown();
      return true;
    } else if (slot.spellId === 'eviscerate') {
      if (boss && boss.alive) {
        engine.dealDamage(player, boss, 22000, 'PHYSICAL', true, '剔骨');
        engine.threatManager.addThreat(boss.id, player.id, 22000);
        triggerSlotCooldown();
      }
      return true;
    } else if (slot.spellId === 'adrenaline_rush') {
      engine.applyBuff(player, {
        id: `ar_${Date.now()}`,
        spellId: 'adrenaline_rush',
        name: '冲动 (能量回复+100%)',
        kind: 'BUFF',
        tags: ['STAT'],
        sourceUnitId: player.id,
        targetUnitId: player.id,
        stacks: 1,
        maxStacks: 1,
        durationMs: 15000,
        remainingMs: 15000,
        school: 'PHYSICAL',
      });
      triggerSlotCooldown();
      return true;
    } else if (slot.spellId === 'mutilate') {
      if (boss && boss.alive) {
        engine.dealDamage(player, boss, 16800, 'PHYSICAL', Math.random() < 0.35, '毁伤');
        engine.threatManager.addThreat(boss.id, player.id, 16800);
        triggerSlotCooldown();
      }
      return true;
    } else if (slot.spellId === 'envenom') {
      if (boss && boss.alive) {
        onScreenShake(100);
        engine.dealDamage(player, boss, 24500, 'NATURE', Math.random() < 0.4, '毒化');
        engine.threatManager.addThreat(boss.id, player.id, 24500);
        triggerSlotCooldown();
      }
      return true;
    } else if (slot.spellId === 'rupture') {
      if (boss && boss.alive) {
        engine.applyBuff(boss, {
          id: `rup_${Date.now()}`,
          spellId: 'rupture',
          name: '割裂 (DoT)',
          kind: 'DEBUFF',
          tags: ['DOT'],
          sourceUnitId: player.id,
          targetUnitId: boss.id,
          stacks: 1,
          maxStacks: 1,
          durationMs: 16000,
          remainingMs: 16000,
          school: 'PHYSICAL',
          tickIntervalMs: 2000,
          tickValue: 3100,
        });
        triggerSlotCooldown();
      }
      return true;
    } else if (slot.spellId === 'vendetta') {
      if (boss && boss.alive) {
        engine.applyBuff(boss, {
          id: `ven_${Date.now()}`,
          spellId: 'vendetta',
          name: '宿敌 (+20%易伤)',
          kind: 'DEBUFF',
          tags: ['DEBUFF'],
          sourceUnitId: player.id,
          targetUnitId: boss.id,
          stacks: 1,
          maxStacks: 1,
          durationMs: 20000,
          remainingMs: 20000,
          school: 'PHYSICAL',
        });
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
          text: '宿敌 (受伤害+20%)',
          category: 'CRIT',
          isCrit: true,
        });
        triggerSlotCooldown();
      }
      return true;
    }

    // ── Data-Driven Universal Player Spell Executor (Warrior / Paladin / Hunter / Priest / Warlock & All New Spells) ──
    if (normSlotSpell) {
      // Cast-time & Channeled spells start hasted player cast/channel bar
      const normIsChannel = isChanneledSpell({
        spellId: slot.spellId,
        castTimeMs: normSlotSpell.castTimeMs,
        channelDurationMs: normSlotSpell.channelDurationMs,
      });
      if (normIsChannel || normSlotSpell.castTimeMs > 0) {
        const baseDurMs = normIsChannel
          ? (normSlotSpell.channelDurationMs > 0 ? normSlotSpell.channelDurationMs : Math.max(2000, normSlotSpell.castTimeMs))
          : normSlotSpell.castTimeMs;
        const hastedMs = getHastedCastTimeMs(baseDurMs, getUnitHaste(player, LEVEL_80_MAX_HASTE));
        const defaultCd = DEFAULT_SPELL_COOLDOWNS[slot.spellId] ?? normSlotSpell.cooldownMs ?? 0;
        startPlayerCast({
          spellId: slot.spellId,
          spellName: normIsChannel ? `${normSlotSpell.name} (引导施法中...)` : normSlotSpell.name,
          elapsedMs: 0,
          totalMs: hastedMs,
          progress: 0,
          isChannel: normIsChannel,
          isHarmful: !isFriendlySpell,
          targetId: effectiveTarget.id,
          totalCdMs: defaultCd,
        });
      return true;
      }

      // Resource generation for builders (Paladin Holy Power / Warrior Rage / DK Runic Power)
      if (player.classId === 'PALADIN' && normSlotSpell.resourceKind !== 'HOLY_POWER' && !normSlotSpell.isDefensive && !normSlotSpell.isTaunt && !normSlotSpell.isInterrupt) {
        player.holyPower = Math.min(3, (player.holyPower ?? 0) + 1);
      } else if (player.classId === 'WARRIOR' && normSlotSpell.resourceCostAmount === 0) {
        player.rage = Math.min(100, (player.rage ?? 0) + 15);
      }
      syncUnitResources(player);

      // Interrupt
      if (normSlotSpell.isInterrupt) {
        const success = bossAi?.interruptCurrentCast?.() ?? false;
        if (success) {
          if (player.combatStats) player.combatStats.interruptCount++;
          engine.effectsManager?.addFloatingText({
            targetId: boss?.id || player.id,
            text: `⚡ ${normSlotSpell.name} 打断成功！`,
            category: 'INTERRUPT',
            isCrit: true,
          });
        } else {
          engine.effectsManager?.addFloatingText({
            targetId: player.id,
            text: `${normSlotSpell.name} (目标未在读条)`,
            category: 'STATUS',
            isCrit: false,
          });
        }
        triggerSlotCooldown(normSlotSpell.cooldownMs);
      return true;
      }

      // Taunt
      if (normSlotSpell.isTaunt) {
        const tauntTarget =
          effectiveTarget && effectiveTarget.role === 'ENEMY' && (effectiveTarget.alive ?? effectiveTarget.isAlive)
            ? effectiveTarget
            : boss;
        if (tauntTarget && (tauntTarget.alive ?? tauntTarget.isAlive)) {
          engine.threatManager.applyTaunt(tauntTarget.id, player.id);
          engine.effectsManager?.addFloatingText({
            targetId: tauntTarget.id,
            text: `🛡️ ${normSlotSpell.name} 嘲讽成功！`,
            category: 'CRIT',
            isCrit: true,
          });
          triggerSlotCooldown(normSlotSpell.cooldownMs);
          return true;
        }
      }

      // Dispel
      if (normSlotSpell.isDispel) {
        handleDispelUnit(effectiveFriendly.id);
      return true;
      }

      // Buff-only / Buff+Heal skills (Earth Shield / Ascendance / MotW raid buff / …)
      if (normSlotSpell.isBuff && !normSlotSpell.isDefensive && !normSlotSpell.isShield) {
        const shortId = normSlotSpell.shortId;
        const isUnleashLife = shortId === 'unleash_life';
        const isEarthShield = shortId === 'earth_shield';
        const isSelfBuff =
          normSlotSpell.targetType === 'SELF' ||
          shortId === 'ascendance' ||
          shortId === 'ancestral_guidance';
        const buffTarget = isSelfBuff ? player : effectiveFriendly;
        const auraSpellId = normSlotSpell.auraId || shortId;
        const stacks = isEarthShield ? 9 : 1;
        const isLust =
          auraSpellId === 'heroism' ||
          auraSpellId === 'bloodlust' ||
          auraSpellId === 'time_warp' ||
          shortId === 'heroism' ||
          shortId === 'bloodlust' ||
          shortId === 'time_warp' ||
          normSlotSpell.id.includes('heroism') ||
          normSlotSpell.id.includes('time_warp');

        if (isUnleashLife || (normSlotSpell.isHeal && normSlotSpell.directHeal > 0 && !isSelfBuff)) {
          const healVal = Math.round((normSlotSpell.directHeal || 8500) + (player.stats.spellPower || 3200) * 0.35);
          engine.healUnit(player, effectiveFriendly, healVal, Math.random() < (player.stats.critChance || 0.25), normSlotSpell.name);
        }

        // 嗜血/时间扭曲：跳过疲惫单位并上疲惫
        if (isLust) {
          applyRaidLustBuff(
            engine,
            player,
            shortId || auraSpellId || normSlotSpell.id,
            Math.max(1_000, normSlotSpell.durationMs || 40_000)
          );
          const floatTarget = player;
          engine.effectsManager?.addFloatingText({
            targetId: floatTarget.id,
            text: normSlotSpell.name,
            category: 'STATUS',
            isCrit: false,
          });
          triggerSlotCooldown();
          return true;
        }

        const durationMs = Math.max(
          normSlotSpell.isRaidBuff ? 3_600_000 : 10000,
          normSlotSpell.durationMs || 15000
        );

        // Raid buffs (MotW / Arcane Brilliance …): apply to whole raid (or caster 30yd for shouts)
        const auraTargets =
          normSlotSpell.isRaidBuff || normSlotSpell.aoeCenterMode === 'RAID'
            ? selectRaidBuffTargets({
                spellId: normSlotSpell.id,
                allies: engine.friendlyUnits,
                caster: player,
                isRaidBuff: true,
              })
            : [isUnleashLife ? player : buffTarget];

        for (const auraTarget of auraTargets) {
          engine.applyBuff(auraTarget, {
            id: `${auraSpellId}_${Date.now()}_${auraTarget.id}`,
            spellId: auraSpellId,
            name: isEarthShield ? `${normSlotSpell.name} (${stacks}层)` : normSlotSpell.name,
            kind: 'BUFF',
            tags: isEarthShield ? ['SHIELD'] : ['STAT'],
            sourceUnitId: player.id,
            targetUnitId: auraTarget.id,
            stacks,
            maxStacks: stacks,
            durationMs,
            remainingMs: durationMs,
            school: normSlotSpell.school,
          });
        }

        const floatTarget = auraTargets[0] || buffTarget;
        if (shortId === 'ascendance' && player.classId === 'SHAMAN') {
          const spec = String((player as { spec?: string }).spec || '').toUpperCase();
          const isResto =
            spec === 'RESTORATION' ||
            spec === 'RESTO' ||
            spec === 'RESTO_HEAL' ||
            (!spec && player.role === 'HEALER');
          engine.effectsManager?.addFloatingText({
            targetId: player.id,
            text: isResto ? '升腾！伤害+35% / 治疗复制' : '升腾！伤害+35%',
            category: 'CRIT',
            isCrit: true,
          });
        } else {
          engine.effectsManager?.addFloatingText({
            targetId: floatTarget.id,
            text:
              auraTargets.length > 1
                ? `✨ ${normSlotSpell.name}（全团 ${auraTargets.length}）`
                : `✨ ${normSlotSpell.name}`,
            category: 'HEAL',
            isCrit: false,
          });
        }

        // Timed summons (wolves / gargoyle): report as SUMMON_SPAWN + owner snapshot
        if (isTimedSummonSpellId(shortId) || isTimedSummonSpellId(normSlotSpell.id)) {
          const pets = spawnTimedSummons(engine, player, shortId || normSlotSpell.id);
          for (const pet of pets) {
            engine.logCombatAction({
              actorId: player.id,
              spellId: shortId || normSlotSpell.id,
              spellName: normSlotSpell.name,
              kind: 'SUMMON',
              spawnedUnitId: pet.id,
              x: pet.position?.x,
              y: pet.position?.y,
              targetId: effectiveTarget?.id ?? null,
            });
            reportUnitSummon({
              engine,
              owner: player,
              pet,
              spellId: shortId || normSlotSpell.id,
              spellName: normSlotSpell.name,
            });
          }
          if (pets.length > 0) onFriendlyUnitsChanged();
        }

        triggerSlotCooldown(normSlotSpell.cooldownMs);
      return true;
      }

      // Resource Restore
      if (normSlotSpell.isResourceRestore) {
        if (player.maxMp && player.maxMp > 0) {
          player.mp = Math.min(player.maxMp, (player.mp ?? 0) + Math.round(player.maxMp * 0.25));
          syncUnitResources(player);
        }
        engine.applyBuff(player, {
          id: `${normSlotSpell.shortId}_${Date.now()}`,
          spellId: normSlotSpell.shortId,
          name: `${normSlotSpell.name} (+回蓝)`,
          kind: 'BUFF',
          tags: ['STAT'],
          sourceUnitId: player.id,
          targetUnitId: player.id,
          stacks: 1,
          maxStacks: 1,
          durationMs: 10000,
          remainingMs: 10000,
          school: normSlotSpell.school,
        });
        engine.effectsManager?.addFloatingText({
          targetId: player.id,
          text: `✨ ${normSlotSpell.name} 资源恢复！`,
          category: 'HEAL',
          isCrit: true,
        });
        triggerSlotCooldown(normSlotSpell.cooldownMs);
      return true;
      }

      // Defensive / Shield
      if (normSlotSpell.isDefensive || normSlotSpell.isShield) {
        const target = normSlotSpell.isShield ? effectiveFriendly : player;
        const shieldVal = Math.round(normSlotSpell.shieldValue || target.maxHp * 0.2);
        target.absorb = Math.min(target.maxHp * 0.5, (target.absorb || 0) + shieldVal);
        engine.applyBuff(target, {
          id: `${normSlotSpell.shortId}_${Date.now()}`,
          spellId: normSlotSpell.shortId,
          name: normSlotSpell.name,
          kind: 'BUFF',
          tags: ['SHIELD'],
          sourceUnitId: player.id,
          targetUnitId: target.id,
          stacks: 1,
          maxStacks: 1,
          durationMs: 12000,
          remainingMs: 12000,
          school: normSlotSpell.school,
        });
        engine.effectsManager?.addFloatingText({
          targetId: target.id,
          text: `🛡️ ${normSlotSpell.name} (+${shieldVal}吸收)`,
          category: 'HEAL',
          isCrit: true,
        });
        triggerSlotCooldown(normSlotSpell.cooldownMs);
      return true;
      }

      // Instant Heals (AoE or ST or HoT)
      if (normSlotSpell.isHeal) {
        const spPower = player.stats.spellPower || 3200;
        const isCrit = Math.random() < (player.stats.critChance || 0.25);
        if (normSlotSpell.isAOE) {
          const wounded = selectAoeHealTargets({
            spellId: normSlotSpell.id,
            allies: engine.friendlyUnits,
            caster: player,
            primaryTarget: effectiveFriendly || player,
            maxAoeTargets: Math.max(3, normSlotSpell.maxAoeTargets || 5),
            targetType: normSlotSpell.targetType,
          });
          const perHeal = Math.round(Math.max(3800, normSlotSpell.directHeal || normSlotSpell.hotTotalHeal * 0.45) + spPower * 0.4);
          for (const ally of wounded) {
            engine.healUnit(player, ally, perHeal, Math.random() < (player.stats.critChance || 0.25), normSlotSpell.name);
          }
          const pose = resolveAoePulsePose({
            caster: player,
            primaryTarget: effectiveFriendly || player,
            radiusPx: normSlotSpell.aoeRadiusPx || RANGE_30YD_PX,
            centerMode: normSlotSpell.aoeCenterMode,
          });
          if (pose) {
            emitLocalAoePulse(engine, {
              actor: player,
              spellId: normSlotSpell.shortId || normSlotSpell.id,
              spellName: normSlotSpell.name,
              targetId: (effectiveFriendly || player).id,
              x: pose.x,
              y: pose.y,
              radius: pose.radius,
              isHeal: true,
            });
          }
        } else {
          if (normSlotSpell.directHeal > 0) {
            const healVal = Math.round(normSlotSpell.directHeal + spPower * 0.5);
            engine.healUnit(player, effectiveFriendly, healVal, isCrit, normSlotSpell.name);
          }
          if (normSlotSpell.isHot && normSlotSpell.hotTotalHeal > 0) {
            engine.applyBuff(effectiveFriendly, {
              id: `${normSlotSpell.shortId}_${Date.now()}`,
              spellId: normSlotSpell.shortId,
              name: `${normSlotSpell.name} (HoT)`,
              kind: 'BUFF',
              tags: ['HOT'],
              sourceUnitId: player.id,
              targetUnitId: effectiveFriendly.id,
              stacks: 1,
              maxStacks: 1,
              durationMs: 12000,
              remainingMs: 12000,
              school: normSlotSpell.school,
              tickIntervalMs: 3000,
              tickValue: Math.round(normSlotSpell.hotTotalHeal / 4),
            });
          }
          engine.logCombatAction({
            actorId: player.id,
            spellId: normSlotSpell.shortId || normSlotSpell.id,
            spellName: normSlotSpell.name,
            kind: 'INSTANT',
            targetId: effectiveFriendly.id,
            visualTone: 'HEAL',
          });
        }
        triggerSlotCooldown(normSlotSpell.cooldownMs);
      return true;
      }

      // Instant Damage (AoE or ST / DoT)
      const power = normSlotSpell.school === 'PHYSICAL' ? (player.stats.attackPower || 3200) : (player.stats.spellPower || 3200);
      if (normSlotSpell.isAOE) {
        const targets = selectAoeEnemyTargets({
          spellId: normSlotSpell.id,
          enemies: engine.enemyUnits,
          caster: player,
          maxAoeTargets: Math.max(3, normSlotSpell.maxAoeTargets || 6),
          school: normSlotSpell.school,
          targetType: normSlotSpell.targetType,
        });
        const perDmg = Math.round(Math.max(3200, normSlotSpell.directDamage || normSlotSpell.dotTotalDamage * 0.5) + power * 0.45);
        for (const enemy of targets) {
          engine.dealDamage(player, enemy, perDmg, normSlotSpell.school, Math.random() < (player.stats.critChance || 0.28), normSlotSpell.name);
          engine.threatManager.addThreat(enemy.id, player.id, player.role === 'TANK' ? perDmg * 3 : perDmg);
        }
        {
          const pose = resolveAoePulsePose({
            caster: player,
            primaryTarget: targets[0] || boss,
            radiusPx: normSlotSpell.aoeRadiusPx || RANGE_30YD_PX,
            centerMode: normSlotSpell.aoeCenterMode || 'CASTER',
          });
          if (pose) {
            emitLocalAoePulse(engine, {
              actor: player,
              spellId: normSlotSpell.shortId || normSlotSpell.id,
              spellName: normSlotSpell.name,
              targetId: (targets[0] || boss)?.id ?? null,
              x: pose.x,
              y: pose.y,
              radius: pose.radius,
            });
          }
        }
        triggerSlotCooldown(normSlotSpell.cooldownMs);
      return true;
      } else if (hostileTarget && (hostileTarget.alive ?? hostileTarget.isAlive)) {
        const isCrit = Math.random() < (player.stats.critChance || 0.3);
        const dmgVal = Math.round(Math.max(4200, normSlotSpell.directDamage || normSlotSpell.dotTotalDamage * 0.35) + power * 0.55);
        if (isCrit) {
          onScreenShake(110);
        }
        engine.dealDamage(player, hostileTarget, dmgVal, normSlotSpell.school, isCrit, normSlotSpell.name);
        engine.threatManager.addThreat(hostileTarget.id, player.id, player.role === 'TANK' ? dmgVal * 3.5 : dmgVal);
        if (normSlotSpell.isDot && normSlotSpell.dotTotalDamage > 0) {
          engine.applyBuff(hostileTarget, {
            id: `${normSlotSpell.shortId}_${Date.now()}`,
            spellId: normSlotSpell.shortId,
            name: `${normSlotSpell.name} (DoT)`,
            kind: 'DEBUFF',
            tags: ['DOT'],
            sourceUnitId: player.id,
            targetUnitId: hostileTarget.id,
            stacks: 1,
            maxStacks: 1,
            durationMs: 15000,
            remainingMs: 15000,
            school: normSlotSpell.school,
            tickIntervalMs: 3000,
            tickValue: Math.round(normSlotSpell.dotTotalDamage / 5),
          });
        }
        engine.logCombatAction({
          actorId: player.id,
          spellId: normSlotSpell.shortId || normSlotSpell.id,
          spellName: normSlotSpell.name,
          kind: 'INSTANT',
          targetId: hostileTarget.id,
        });
        triggerSlotCooldown(normSlotSpell.cooldownMs);
      return true;
      }
    }

    // Default Fallback
    if (hostileTarget && (hostileTarget.alive ?? hostileTarget.isAlive)) {
      const isCrit = Math.random() < 0.35;
      if (isCrit) {
        onScreenShake(120);
      }
      engine.dealDamage(player, hostileTarget, 6500, 'PHYSICAL', isCrit, slot.name || '攻击');
      engine.threatManager.addThreat(hostileTarget.id, player.id, 6500);
      engine.logCombatAction({
        actorId: player.id,
        spellId: slot.spellId || 'attack',
        spellName: slot.name || '攻击',
        kind: 'INSTANT',
        targetId: hostileTarget.id,
      });
      triggerSlotCooldown();
    }
      return true;
}
