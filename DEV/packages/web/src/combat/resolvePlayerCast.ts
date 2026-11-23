import type { CombatEngine } from '@cata-raid-sim/engine';
import { getSpellByAnyId } from '@cata-raid-sim/engine';
import { syncUnitResources } from './unitResources.js';

export type ResolvePlayerCastCtx = {
  engine: CombatEngine;
  castTargetId: string | null;
  selectedTargetId: string | null;
  onScreenShake: (durationMs: number) => void;
  onFriendlyUnitsChanged: () => void;
  onTriggerCooldown: (spellId: string, totalCdMs: number) => void;
};

/**
 * Resolve a completed player cast (read-bar finish / instant resolve path).
 * Returns false if target/range checks fail (caller must NOT enter CD).
 */
export function resolvePlayerCast(
  spellId: string,
  totalCdMs: number | undefined,
  ctx: ResolvePlayerCastCtx
): boolean {
  const {
    engine,
    castTargetId,
    selectedTargetId,
    onScreenShake,
    onFriendlyUnitsChanged,
    onTriggerCooldown,
  } = ctx;
  const player = engine.friendlyUnits.find(u => u.isPlayer);
    const boss = engine.bossUnit;
    if (!player || (!player.isAlive && !player.alive)) return false;

    const normSpell = getSpellByAnyId(spellId, player.classId);
    const isRevive =
      spellId === 'revive' ||
      spellId === 'ancestral_spirit' ||
      spellId === 'rebirth' ||
      spellId === 'redemption' ||
      spellId === 'resurrection' ||
      Boolean(normSpell?.isResurrect);
    const isHarmful =
      [
        'fireball', 'pyroblast', 'frostbolt', 'arcane_blast', 'wrath',
        'starfire', 'starsurge', 'lightning_bolt', 'lava_burst', 'chain_lightning',
      ].includes(spellId) ||
      Boolean(normSpell && !normSpell.isHeal && !normSpell.isShield && !normSpell.isResurrect && !normSpell.isDispel && !normSpell.isDefensive && !normSpell.isResourceRestore);

    // ── 目标存活与射程校验：若目标已死亡或超出范围，施法失败且绝对不进CD！──
    if (isHarmful) {
      if (!boss || (!boss.isAlive && !boss.alive) || boss.hp <= 0) {
        engine.effectsManager?.addFloatingText({
          targetId: player.id,
          text: '❌ 目标已死亡',
          category: 'STATUS',
          isCrit: false,
        });
        return false;
      }
      if (player.position && boss.position) {
        const dist = Math.hypot(player.position.x - boss.position.x, player.position.y - boss.position.y);
        if (dist > 360) {
          engine.effectsManager?.addFloatingText({
            targetId: player.id,
            text: '❌ 距离不足 (超出范围)',
            category: 'STATUS',
            isCrit: false,
          });
          return false;
        }
      }
    } else if (!isRevive) {
      const target = (castTargetId ? engine.friendlyUnits.find(u => u.id === castTargetId) : null)
        || (selectedTargetId ? engine.friendlyUnits.find(u => u.id === selectedTargetId) : null)
        || player;
      if (!target || (!target.isAlive && !target.alive) || target.hp <= 0) {
        engine.effectsManager?.addFloatingText({
          targetId: player.id,
          text: '❌ 目标已死亡',
          category: 'STATUS',
          isCrit: false,
        });
        return false;
      }
      if (player.position && target.position) {
        const dist = Math.hypot(player.position.x - target.position.x, player.position.y - target.position.y);
        if (dist > 360) {
          engine.effectsManager?.addFloatingText({
            targetId: player.id,
            text: '❌ 距离不足 (超出范围)',
            category: 'STATUS',
            isCrit: false,
          });
          return false;
        }
      }
    } else {
      // 复活类技能：必须有已阵亡的目标
      const deadTarget = engine.friendlyUnits.find(u => (!u.isAlive && !u.alive) || u.hp <= 0);
      if (!deadTarget) {
        engine.effectsManager?.addFloatingText({
          targetId: player.id,
          text: '❌ 没有需要复活的目标',
          category: 'STATUS',
          isCrit: false,
        });
        return false;
      }
    }

    // ── 目标合法且在射程内，执行法术效果 ──
    if (spellId === 'fireball') {
      if (boss && boss.alive) {
        const isCrit = Math.random() < 0.35;
        if (isCrit) {
          onScreenShake(120);
        }
        engine.dealDamage(player, boss, 14500, 'FIRE', isCrit, '火球术');
        engine.threatManager.addThreat(boss.id, player.id, 14500);
      }
    } else if (spellId === 'pyroblast') {
      if (boss && boss.alive) {
        onScreenShake(150);
        engine.dealDamage(player, boss, 21000, 'FIRE', true, '炎爆术');
        engine.threatManager.addThreat(boss.id, player.id, 21000);
      }
    } else if (spellId === 'frostbolt') {
      if (boss && boss.alive) {
        const isCrit = Math.random() < 0.3;
        engine.dealDamage(player, boss, 13800, 'FROST', isCrit, '寒冰箭');
        engine.threatManager.addThreat(boss.id, player.id, 13800);
      }
    } else if (spellId === 'arcane_blast') {
      if (boss && boss.alive) {
        const isCrit = Math.random() < 0.32;
        engine.dealDamage(player, boss, 18500, 'ARCANE', isCrit, '奥术冲击');
        engine.threatManager.addThreat(boss.id, player.id, 18500);
      }
    } else if (spellId === 'wrath') {
      if (boss && boss.alive) {
        const isCrit = Math.random() < 0.3;
        engine.dealDamage(player, boss, 13500, 'NATURE', isCrit, '愤怒');
        engine.threatManager.addThreat(boss.id, player.id, 13500);
      }
    } else if (spellId === 'starfire') {
      if (boss && boss.alive) {
        const isCrit = Math.random() < 0.35;
        if (isCrit) {
          onScreenShake(120);
        }
        engine.dealDamage(player, boss, 21500, 'ARCANE', isCrit, '星火术');
        engine.threatManager.addThreat(boss.id, player.id, 21500);
      }
    } else if (spellId === 'starsurge') {
      if (boss && boss.alive) {
        onScreenShake(150);
        engine.dealDamage(player, boss, 28000, 'ARCANE', true, '星涌术');
        engine.threatManager.addThreat(boss.id, player.id, 28000);
      }
    } else if (spellId === 'lightning_bolt') {
      if (boss && boss.alive) {
        const isCrit = Math.random() < 0.28;
        const sp = getSpellByAnyId('lightning_bolt', 'SHAMAN');
        const base = sp?.directDamage || 8500;
        const dmg = Math.round(base + (player.stats.spellPower || 3800) * 0.86);
        engine.dealDamage(player, boss, dmg, 'NATURE', isCrit, '闪电箭');
        engine.threatManager.addThreat(boss.id, player.id, dmg);
        // 大地之流回蓝后同步资源条
        syncUnitResources(player);
      }
    } else if (spellId === 'lava_burst') {
      if (boss && boss.alive) {
        onScreenShake(120);
        const sp = getSpellByAnyId('lava_burst', 'SHAMAN');
        const base = sp?.directDamage || 14000;
        // 熔岩爆裂：有烈焰震击时必然暴击；这里按技能描述保底暴击
        const dmg = Math.round((base + (player.stats.spellPower || 3800) * 0.86) * 2.0);
        engine.dealDamage(player, boss, dmg, 'FIRE', true, '熔岩爆裂');
        engine.threatManager.addThreat(boss.id, player.id, dmg);
      }
    } else if (spellId === 'chain_lightning') {
      const enemies = engine.enemyUnits.filter(e => (e.isAlive ?? e.alive) && e.hp > 0).slice(0, 4);
      const targets = enemies.length > 0 ? enemies : (boss && (boss.isAlive ?? boss.alive) && boss.hp > 0 ? [boss] : []);
      const sp = getSpellByAnyId('chain_lightning', 'SHAMAN');
      const base = sp?.directDamage || 8600;
      // 80 级满级标定：基础值 + 法强系数，弹跳衰减 30%
      let jumpAmt = Math.round(base + (player.stats.spellPower || 3800) * 0.86);
      targets.forEach((enemy, idx) => {
        const isCrit = Math.random() < 0.25;
        const hit = Math.round(jumpAmt * (isCrit ? 1.5 : 1));
        engine.dealDamage(player, enemy, hit, 'NATURE', isCrit, '闪电链');
        engine.threatManager.addThreat(enemy.id, player.id, hit);
        jumpAmt *= 0.7;
      });
      syncUnitResources(player);
    } else if (spellId === 'healing_wave') {
      const target = (castTargetId ? engine.friendlyUnits.find(u => u.id === castTargetId) : null)
        || (selectedTargetId ? engine.friendlyUnits.find(u => u.id === selectedTargetId) : null)
        || player;
      const sp = getSpellByAnyId('healing_wave', 'SHAMAN');
      const base = sp?.directHeal || 8800;
      const heal = Math.round(base + (player.stats.spellPower || 4000) * 0.8);
      engine.healUnit(player, target, heal, Math.random() < 0.3, '治疗波');
    } else if (spellId === 'nourish') {
      const target = (castTargetId ? engine.friendlyUnits.find(u => u.id === castTargetId) : null)
        || (selectedTargetId ? engine.friendlyUnits.find(u => u.id === selectedTargetId) : null)
        || player;
      const hasHot = target.buffs.some(b => ['rejuvenation', 'regrowth', 'lifebloom', 'wild_growth'].includes(b.spellId));
      const val = hasHot ? Math.round(9500 * 1.2) : 9500;
      engine.healUnit(player, target, val, Math.random() < 0.25, '滋养');
      const refreshed = engine.refreshLifebloom(target, player.id);
      if (refreshed) {
        onFriendlyUnitsChanged();
        engine.effectsManager?.addFloatingText({
          targetId: target.id,
          text: '✨ 生命绽放已刷新',
          category: 'HEAL',
          isCrit: false,
        });
      }
    } else if (spellId === 'healing_surge') {
      const target = (castTargetId ? engine.friendlyUnits.find(u => u.id === castTargetId) : null)
        || (selectedTargetId ? engine.friendlyUnits.find(u => u.id === selectedTargetId) : null)
        || player;
      const sp = getSpellByAnyId('healing_surge', 'SHAMAN');
      const heal = Math.round((sp?.directHeal || 12400) + (player.stats.spellPower || 4000) * 0.8);
      engine.healUnit(player, target, heal, Math.random() < 0.3, '治疗之涌');
    } else if (spellId === 'greater_healing_wave') {
      const target = (castTargetId ? engine.friendlyUnits.find(u => u.id === castTargetId) : null)
        || (selectedTargetId ? engine.friendlyUnits.find(u => u.id === selectedTargetId) : null)
        || player;
      const sp = getSpellByAnyId('greater_healing_wave', 'SHAMAN');
      const heal = Math.round((sp?.directHeal || 20500) + (player.stats.spellPower || 4000) * 0.8);
      engine.healUnit(player, target, heal, Math.random() < 0.35, '强效治疗波');
    } else if (spellId === 'healing_touch') {
      const target = (castTargetId ? engine.friendlyUnits.find(u => u.id === castTargetId) : null)
        || (selectedTargetId ? engine.friendlyUnits.find(u => u.id === selectedTargetId) : null)
        || player;
      const isCrit = Math.random() < 0.35;
      engine.healUnit(player, target, 34000, isCrit, '治疗之触');
      const refreshed = engine.refreshLifebloom(target, player.id);
      if (refreshed) {
        onFriendlyUnitsChanged();
        engine.effectsManager?.addFloatingText({
          targetId: target.id,
          text: '✨ 生命绽放已刷新',
          category: 'HEAL',
          isCrit: false,
        });
      }
    } else if (spellId === 'regrowth') {
      const target = (castTargetId ? engine.friendlyUnits.find(u => u.id === castTargetId) : null)
        || (selectedTargetId ? engine.friendlyUnits.find(u => u.id === selectedTargetId) : null)
        || player;
      // Direct heal + 6s HoT
      engine.healUnit(player, target, 16000, Math.random() < 0.3, '愈合');
      engine.applyBuff(target, {
        id: `regrowth_${Date.now()}`,
        spellId: 'regrowth',
        name: '愈合 (HoT)',
        kind: 'BUFF',
        tags: ['HOT'],
        sourceUnitId: player.id,
        targetUnitId: target.id,
        stacks: 1,
        maxStacks: 1,
        durationMs: 6000,
        remainingMs: 6000,
        school: 'NATURE',
        tickIntervalMs: 2000,
        tickValue: 1800,
      });
      const refreshed = engine.refreshLifebloom(target, player.id);
      if (refreshed) {
        onFriendlyUnitsChanged();
        engine.effectsManager?.addFloatingText({
          targetId: target.id,
          text: '✨ 生命绽放已刷新',
          category: 'HEAL',
          isCrit: false,
        });
      }
    } else if (spellId === 'rebirth') {
      const targetId = castTargetId || selectedTargetId;
      const deadTarget = targetId
        ? engine.friendlyUnits.find(u => u.id === targetId && ((!u.isAlive && !u.alive) || u.hp <= 0))
        : engine.friendlyUnits.find(u => (!u.isAlive && !u.alive) || u.hp <= 0);
      if (deadTarget) {
        engine.resurrectUnit(deadTarget.id, 0.6, 0.6);
        engine.effectsManager?.addFloatingText({
          targetId: deadTarget.id,
          text: '⚡ 复生！(战斗复活)',
          category: 'HEAL',
          isCrit: true,
        });
        onFriendlyUnitsChanged();
      } else {
        return false;
      }
    } else if (spellId === 'chain_heal') {
      const target = (castTargetId ? engine.friendlyUnits.find(u => u.id === castTargetId) : null)
        || (selectedTargetId ? engine.friendlyUnits.find(u => u.id === selectedTargetId) : null)
        || player;
      const isCrit = Math.random() < (player.stats.critChance || 0.25);
      const sp = getSpellByAnyId('chain_heal', 'SHAMAN');
      // 80 级满级：主目标按 ClassRegistry 直疗 + 法强系数，后续弹跳衰减 30%
      let healVal = Math.round((sp?.directHeal || 23500) + (player.stats.spellPower || 4000) * 0.55);
      engine.healUnit(player, target, healVal, isCrit, '治疗链');
      const otherAllies = engine.friendlyUnits
        .filter(u => u.id !== target.id && (u.alive || u.isAlive) && u.hp > 0 && u.hp < u.maxHp)
        .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
      for (let i = 0; i < Math.min(3, otherAllies.length); i++) {
        healVal = Math.round(healVal * 0.7);
        engine.healUnit(player, otherAllies[i], healVal, Math.random() < (player.stats.critChance || 0.25), `治疗链(第${i + 2}跳)`);
      }
    } else if (spellId === 'revive' || spellId === 'ancestral_spirit' || spellId === 'redemption' || spellId === 'resurrection') {
      const deadTarget = engine.friendlyUnits.find(u => (!u.isAlive && !u.alive) || u.hp <= 0);
      if (deadTarget) {
        engine.resurrectUnit(deadTarget.id, 0.4, 0.4);
        const rezName = normSpell?.name || (spellId === 'revive' ? '起死回生' : '先祖之魂');
        engine.healUnit(player, deadTarget, Math.round(deadTarget.maxHp * 0.4), false, rezName);
      }
    } else if (normSpell) {
      // Data-driven resolution for ALL 10 Cataclysm classes' cast-time spells
      const spPower = player.stats.spellPower || 3200;
      const apPower = player.stats.attackPower || 3200;
      const isCrit = Math.random() < (player.stats.critChance || 0.28);
      if (normSpell.isHeal || normSpell.isShield) {
        const target = (castTargetId ? engine.friendlyUnits.find(u => u.id === castTargetId) : null)
          || (selectedTargetId ? engine.friendlyUnits.find(u => u.id === selectedTargetId) : null)
          || player;
        if (normSpell.isAOE) {
          const maxT = Math.max(3, normSpell.maxAoeTargets || 5);
          const wounded = engine.friendlyUnits
            .filter(u => (u.alive || u.isAlive) && u.hp > 0)
            .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))
            .slice(0, maxT);
          const perHeal = Math.round(Math.max(3800, normSpell.directHeal || normSpell.hotTotalHeal * 0.45) + spPower * 0.4);
          for (const ally of wounded) {
            engine.healUnit(player, ally, perHeal, Math.random() < (player.stats.critChance || 0.25), normSpell.name);
          }
        } else {
          const healVal = Math.round(Math.max(4500, normSpell.directHeal) + spPower * 0.55);
          engine.healUnit(player, target, healVal, isCrit, normSpell.name);
        }
      } else if (normSpell.isAOE) {
        const livingEnemies = engine.enemyUnits.filter(e => (e.isAlive ?? e.alive) && e.hp > 0);
        const targets = livingEnemies.slice(0, Math.max(3, normSpell.maxAoeTargets || 6));
        const power = normSpell.school === 'PHYSICAL' ? apPower : spPower;
        const perDmg = Math.round(Math.max(3600, normSpell.directDamage || normSpell.dotTotalDamage * 0.5) + power * 0.45);
        for (const enemy of targets) {
          engine.dealDamage(player, enemy, perDmg, normSpell.school, Math.random() < (player.stats.critChance || 0.28), normSpell.name);
          engine.threatManager.addThreat(enemy.id, player.id, perDmg);
        }
      } else if (boss && boss.alive) {
        const power = normSpell.school === 'PHYSICAL' ? apPower : spPower;
        const dmgVal = Math.round(Math.max(5200, normSpell.directDamage || normSpell.dotTotalDamage * 0.35) + power * 0.65);
        if (isCrit) {
          onScreenShake(110);
        }
        engine.dealDamage(player, boss, dmgVal, normSpell.school, isCrit, normSpell.name);
        engine.threatManager.addThreat(boss.id, player.id, dmgVal);
        if (normSpell.isDot && normSpell.dotTotalDamage > 0) {
          engine.applyBuff(boss, {
            id: `${normSpell.shortId}_${Date.now()}`,
            spellId: normSpell.shortId,
            name: `${normSpell.name} (DoT)`,
            kind: 'DEBUFF',
            tags: ['DOT'],
            sourceUnitId: player.id,
            targetUnitId: boss.id,
            stacks: 1,
            maxStacks: 1,
            durationMs: 15000,
            remainingMs: 15000,
            school: normSpell.school,
            tickIntervalMs: 3000,
            tickValue: Math.round(normSpell.dotTotalDamage / 5),
          });
        }
      }
    }

    if (totalCdMs && totalCdMs > 0) {
      onTriggerCooldown(spellId, totalCdMs);
    }

    return true;
}
