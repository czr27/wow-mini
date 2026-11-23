import type { BossAI, CombatEngine, NormalizedSpell, Unit } from '@cata-raid-sim/engine';
import {
  findOptimalGroundAuraCentroid,
  getHastedCastTimeMs,
  LEVEL_80_MAX_HASTE,
  isChanneledSpell,
} from '@cata-raid-sim/engine';
import { DEFAULT_SPELL_COOLDOWNS } from '../assets/defaultActionSlots.js';
import type { ActionSlot, PlayerCastState } from '../components/ActionBar.js';
import { syncUnitResources } from './unitResources.js';

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
  handleDispelUnit: (targetUnitId?: string | null) => void;
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

    // ── Dispel Spells ─────────────────────────────────────────────────
    if (
      slot.spellId === 'natures_cure' ||
      slot.spellId === 'cleanse_spirit' ||
      slot.spellId === 'remove_curse' ||
      slot.spellId === 'remove_corruption'
    ) {
      handleDispelUnit(effectiveFriendly.id);
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
      // 生命绽放唯一目标限制：同一释放者同时只能给一个人维持生命绽放；若给其他人施放，立即没收该释放者给其他人施加的生命绽放buff（包括所有层数）
      for (const u of engine.getAllUnits()) {
        if (u.id !== target.id) {
          while (engine.auraManager.removeBuff(u, 'lifebloom', player.id)) {}
        }
      }
      const existing = target.buffs.find(b => b.spellId === 'lifebloom' && b.sourceUnitId === player.id);
      if (existing) {
        // 多层生命绽放共用同一个倒计时条，不是每层独立计时；层数只加每跳治疗量，不单独有各自的时间
        // 基础持续 15 秒，每 2 秒一跳 HOT，最多叠 3 层；每次叠加或刷新时倒计时重置为 15 秒
        if (existing.stacks < 3) {
          existing.stacks += 1;
        }
        existing.remainingMs = 15000;
        existing.durationMs = 15000;
        delete existing.stackRemainingMs;
        existing.name = `生命绽放 (${existing.stacks}层)`;
      } else {
        engine.applyBuff(target, {
          id: `lb_${Date.now()}`,
          spellId: 'lifebloom',
          name: '生命绽放 (1层)',
          kind: 'BUFF',
          tags: ['HOT'],
          sourceUnitId: player.id,
          targetUnitId: target.id,
          stacks: 1,
          maxStacks: 3,
          durationMs: 15000,
          remainingMs: 15000,
          school: 'NATURE',
          tickIntervalMs: 2000,
          tickValue: 2400,
        });
      }
      onFriendlyUnitsChanged();
      engine.effectsManager?.addFloatingText({
        targetId: target.id,
        text: `生命绽放 (${existing ? existing.stacks : 1}层)`,
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
        colorHex: '#6FCF97',
        remainingMs: 7000,
        tickIntervalMs: 1000,
        tickElapsedMs: 0,
        tickValue: 3800,
      });
      triggerSlotCooldown();
      return true;
    } else if (slot.spellId === 'wild_growth') {
      const centerTarget = effectiveFriendly || player;
      const tX = centerTarget.position?.x ?? 180;
      const tY = centerTarget.position?.y ?? 190;
      const radius = 270; // 30码范围 (40码=360px -> 30码=270px)
      const maxTargets = 5; // 严格最多 5 个友方（包含自己作为候选目标之一）

      // 筛选目标身边30码范围内的存活友方单位（包含玩家自己，作为可选目标之一）
      const inRangeAllies = engine.friendlyUnits.filter(u => {
        const isAlive = (u.isAlive ?? u.alive) && u.hp > 0;
        if (!isAlive) return false;
        const uX = u.position?.x ?? tX;
        const uY = u.position?.y ?? tY;
        return Math.hypot(uX - tX, uY - tY) <= radius;
      });

      // 优先选择血量百分比最低的受伤队友（若百分比相同则缺血数值更多者优先；机制是在范围内挑选血量最低的友方，不保证必加到自己）
      inRangeAllies.sort((a, b) => {
        const pctA = a.hp / Math.max(1, a.maxHp);
        const pctB = b.hp / Math.max(1, b.maxHp);
        if (Math.abs(pctA - pctB) > 0.0001) {
          return pctA - pctB;
        }
        return (a.hp - a.maxHp) - (b.hp - b.maxHp);
      });

      // 最多对 5 个目标施加野性成长 HoT（无其他队友时至少作用于主目标）
      const chosen = inRangeAllies.slice(0, maxTargets);
      if (chosen.length === 0) {
        chosen.push(centerTarget);
      }

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
      if (boss && boss.alive) {
        engine.threatManager.applyTaunt(boss.id, player.id);
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
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
      player.absorb = (player.absorb || 0) + 18000;
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '白骨之盾 +18,000吸收盾',
        category: 'HEAL',
        isCrit: true,
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
    } else if (slot.spellId === 'death_and_decay') {
      const bossPos = engine.bossUnit?.position || { x: 520, y: 200 };
      engine.effectsManager?.addGroundEffect({
        id: `dnd_${Date.now()}`,
        kind: 'DAMAGE_ZONE',
        spellId: 'death_and_decay',
        ownerId: player.id,
        x: bossPos.x,
        y: bossPos.y,
        radius: 60,
        colorHex: '#8B0000',
        remainingMs: 10000,
        tickIntervalMs: 1000,
        tickElapsedMs: 0,
        tickValue: 3200,
      });
      if (boss && boss.alive) engine.threatManager.addThreat(boss.id, player.id, 15000);
      triggerSlotCooldown();
      return true;
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
      const hastedMs = getHastedCastTimeMs(2500, player.stats?.haste ?? LEVEL_80_MAX_HASTE);
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
        colorHex: '#4169E1',
        remainingMs: 10000,
        tickIntervalMs: 1000,
        tickElapsedMs: 0,
        tickValue: 3400,
      });
      triggerSlotCooldown();
      return true;
    } else if (slot.spellId === 'spirit_link') {
      const target = selectedTargetId
        ? engine.friendlyUnits.find(u => u.id === selectedTargetId) || player
        : player;
      engine.effectsManager?.addGroundEffect({
        id: `slt_${Date.now()}`,
        kind: 'TOTEM',
        spellId: 'spirit_link',
        ownerId: player.id,
        x: target.position.x || 200,
        y: target.position.y || 200,
        radius: 55,
        colorHex: '#00CED1',
        remainingMs: 6000,
        tickIntervalMs: 1000,
        tickElapsedMs: 0,
        tickValue: 2000,
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
      for (const u of engine.friendlyUnits) {
        if (u.alive) {
          engine.applyBuff(u, {
            id: `bl_${u.id}`,
            spellId: 'bloodlust',
            name: '嗜血 (+30%急速)',
            kind: 'BUFF',
            tags: ['BLOODLUST'],
            sourceUnitId: player.id,
            targetUnitId: u.id,
            stacks: 1,
            maxStacks: 1,
            durationMs: 40000,
            remainingMs: 40000,
            school: 'PHYSICAL',
          });
        }
      }
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '嗜血！全团急速+30%',
        category: 'CRIT',
        isCrit: true,
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
      for (const u of engine.friendlyUnits) {
        if (u.alive) {
          engine.applyBuff(u, {
            id: `tw_${u.id}`,
            spellId: 'time_warp',
            name: '时间扭曲 (+30%急速)',
            kind: 'BUFF',
            tags: ['BLOODLUST'],
            sourceUnitId: player.id,
            targetUnitId: u.id,
            stacks: 1,
            maxStacks: 1,
            durationMs: 40000,
            remainingMs: 40000,
            school: 'ARCANE',
          });
        }
      }
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
        colorHex: '#00BFFF',
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
        const hastedMs = getHastedCastTimeMs(baseDurMs, player.stats?.haste ?? LEVEL_80_MAX_HASTE);
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
      if (normSlotSpell.isTaunt && boss && boss.alive) {
        engine.threatManager.applyTaunt(boss.id, player.id);
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
          text: `🛡️ ${normSlotSpell.name} 嘲讽成功！`,
          category: 'CRIT',
          isCrit: true,
        });
        triggerSlotCooldown(normSlotSpell.cooldownMs);
      return true;
      }

      // Dispel
      if (normSlotSpell.isDispel) {
        handleDispelUnit(effectiveFriendly.id);
      return true;
      }

      // Buff-only / Buff+Heal skills (Earth Shield / Ascendance / Ancestral Guidance / Unleash Life)
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

        if (isUnleashLife || (normSlotSpell.isHeal && normSlotSpell.directHeal > 0 && !isSelfBuff)) {
          const healVal = Math.round((normSlotSpell.directHeal || 8500) + (player.stats.spellPower || 3200) * 0.35);
          engine.healUnit(player, effectiveFriendly, healVal, Math.random() < (player.stats.critChance || 0.25), normSlotSpell.name);
        }

        // Unleash Life next-heal buff resides on the caster
        const auraTarget = isUnleashLife ? player : buffTarget;
        engine.applyBuff(auraTarget, {
          id: `${auraSpellId}_${Date.now()}`,
          spellId: auraSpellId,
          name: isEarthShield ? `${normSlotSpell.name} (${stacks}层)` : normSlotSpell.name,
          kind: 'BUFF',
          tags: isEarthShield ? ['SHIELD'] : ['STAT'],
          sourceUnitId: player.id,
          targetUnitId: auraTarget.id,
          stacks,
          maxStacks: stacks,
          durationMs: Math.max(10000, normSlotSpell.durationMs || 15000),
          remainingMs: Math.max(10000, normSlotSpell.durationMs || 15000),
          school: normSlotSpell.school,
        });

        // Ascendance also enables resto heal-duplication via same buff id checked in CombatEngine
        if (shortId === 'ascendance' && (player.classId === 'SHAMAN')) {
          engine.effectsManager?.addFloatingText({
            targetId: player.id,
            text: '升腾！伤害+35% / 治疗复制',
            category: 'CRIT',
            isCrit: true,
          });
        } else {
          engine.effectsManager?.addFloatingText({
            targetId: auraTarget.id,
            text: `✨ ${normSlotSpell.name}`,
            category: 'HEAL',
            isCrit: false,
          });
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
          const maxT = Math.max(3, normSlotSpell.maxAoeTargets || 5);
          const wounded = engine.friendlyUnits
            .filter(u => (u.alive || u.isAlive) && u.hp > 0)
            .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))
            .slice(0, maxT);
          const perHeal = Math.round(Math.max(3800, normSlotSpell.directHeal || normSlotSpell.hotTotalHeal * 0.45) + spPower * 0.4);
          for (const ally of wounded) {
            engine.healUnit(player, ally, perHeal, Math.random() < (player.stats.critChance || 0.25), normSlotSpell.name);
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
        }
        triggerSlotCooldown(normSlotSpell.cooldownMs);
      return true;
      }

      // Instant Damage (AoE or ST / DoT)
      const power = normSlotSpell.school === 'PHYSICAL' ? (player.stats.attackPower || 3200) : (player.stats.spellPower || 3200);
      if (normSlotSpell.isAOE) {
        const livingEnemies = engine.enemyUnits.filter(e => (e.isAlive ?? e.alive) && e.hp > 0);
        const targets = livingEnemies.slice(0, Math.max(3, normSlotSpell.maxAoeTargets || 6));
        const perDmg = Math.round(Math.max(3200, normSlotSpell.directDamage || normSlotSpell.dotTotalDamage * 0.5) + power * 0.45);
        for (const enemy of targets) {
          engine.dealDamage(player, enemy, perDmg, normSlotSpell.school, Math.random() < (player.stats.critChance || 0.28), normSlotSpell.name);
          engine.threatManager.addThreat(enemy.id, player.id, player.role === 'TANK' ? perDmg * 3 : perDmg);
        }
        triggerSlotCooldown(normSlotSpell.cooldownMs);
      return true;
      } else if (boss && boss.alive) {
        const isCrit = Math.random() < (player.stats.critChance || 0.3);
        const dmgVal = Math.round(Math.max(4200, normSlotSpell.directDamage || normSlotSpell.dotTotalDamage * 0.35) + power * 0.55);
        if (isCrit) {
          onScreenShake(110);
        }
        engine.dealDamage(player, boss, dmgVal, normSlotSpell.school, isCrit, normSlotSpell.name);
        engine.threatManager.addThreat(boss.id, player.id, player.role === 'TANK' ? dmgVal * 3.5 : dmgVal);
        if (normSlotSpell.isDot && normSlotSpell.dotTotalDamage > 0) {
          engine.applyBuff(boss, {
            id: `${normSlotSpell.shortId}_${Date.now()}`,
            spellId: normSlotSpell.shortId,
            name: `${normSlotSpell.name} (DoT)`,
            kind: 'DEBUFF',
            tags: ['DOT'],
            sourceUnitId: player.id,
            targetUnitId: boss.id,
            stacks: 1,
            maxStacks: 1,
            durationMs: 15000,
            remainingMs: 15000,
            school: normSlotSpell.school,
            tickIntervalMs: 3000,
            tickValue: Math.round(normSlotSpell.dotTotalDamage / 5),
          });
        }
        triggerSlotCooldown(normSlotSpell.cooldownMs);
      return true;
      }
    }

    // Default Fallback
    if (boss && boss.alive) {
      const isCrit = Math.random() < 0.35;
      if (isCrit) {
        onScreenShake(120);
      }
      engine.dealDamage(player, boss, 6500, 'PHYSICAL', isCrit, slot.name || '攻击');
      engine.threatManager.addThreat(boss.id, player.id, 6500);
      triggerSlotCooldown();
    }
      return true;
}
