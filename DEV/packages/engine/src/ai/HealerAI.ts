// ============================================================
// Cata Raid Sim — Universal Rule-Driven Healer AI  [AI-03]
// Supports ALL healing classes/specs dynamically via ClassRegistry
// + SkillMetricEvaluator (Druid, Shaman, Paladin, Priest).
// ============================================================

import { ClassId, Unit } from '../types.js';
import {
  GameState,
  Priority,
  PrioritisedAction,
  RoleAI,
  getMainTank,
  hpFraction,
} from './AIController.js';
import { getSpellsForClassSpec } from '../classes/ClassRegistry.js';
import {
  buildUsableCandidatesForUnit,
  createAIPersonality,
  evaluateUniversalAIDecision,
  getUnitResourceAmount,
  getUnitResourceMax,
} from './SkillMetricEvaluator.js';

export class HealerAI implements RoleAI {
  decide(unit: Unit, gs: GameState): PrioritisedAction[] {
    const actions: PrioritisedAction[] = [];
    if (unit.classId === 'BOSS' || unit.classId === 'NPC') return actions;

    const allies = gs.units.filter(u => u.role !== 'ENEMY' && u.isAlive && u.hp > 0);
    const enemies = gs.units.filter(u => u.role === 'ENEMY' && u.isAlive && u.hp > 0);
    const specId = (unit as any).spec as string | undefined;
    const ownedSpells = getSpellsForClassSpec(unit.classId as ClassId, specId);

    // 1. 通用回蓝技能判定（蓝量低于35%时触发回蓝大招：激活、法力之潮、神圣祈求、希望赞美诗等）
    const curMana = getUnitResourceAmount(unit, 'MANA');
    const maxMana = getUnitResourceMax(unit, 'MANA');
    if (maxMana > 0 && curMana / maxMana < 0.35) {
      const manaRestoreSpell = ownedSpells.find(
        s =>
          (s.isResourceRestore && !s.isDamage) ||
          s.id.includes('innervate') ||
          s.id.includes('mana_tide') ||
          s.id.includes('divine_plea') ||
          s.id.includes('shadowfiend') ||
          s.id.includes('hymn_of_hope')
      );
      if (manaRestoreSpell) {
        if (manaRestoreSpell.targetType === 'GROUND') {
          const casterPos = unit.position || { x: 200, y: 200 };
          actions.push({
            priority: Priority.DEFENSIVE,
            action: {
              spellId: manaRestoreSpell.id,
              targetId: unit.id,
              immediate: true,
              targetX: casterPos.x,
              targetY: casterPos.y,
            },
          });
        } else {
          actions.push(act(manaRestoreSpell.id, unit.id, Priority.DEFENSIVE, true));
        }
      }
    }

    // 2. 通用规则决策（优先判断 AOE -> 紧急单抬 -> 性价比/输出平衡）
    const personality = createAIPersonality(unit.name, unit.id);
    const candidates = buildUsableCandidatesForUnit(unit, specId, () => true, {
      roleFilter: 'HEAL',
      useShortId: false,
    });

    const decision = evaluateUniversalAIDecision({
      caster: unit,
      personality,
      allies,
      enemies,
      usableSkills: candidates,
      tickCount: Math.floor((gs.elapsedMs || 0) / 100),
    });

    if (decision.chosenCandidate && decision.targetUnit) {
      const sp = decision.chosenCandidate.normalizedSpell;
      if (sp?.targetType === 'GROUND') {
        const bestPos = findOptimalGroundAuraCentroid(unit, allies, 55, 360);
        actions.push({
          priority: Priority.HEAL,
          action: {
            spellId: decision.chosenCandidate.spellId,
            targetId: decision.targetUnit.id,
            immediate: decision.chosenCandidate.castMs === 0,
            targetX: bestPos.x,
            targetY: bestPos.y,
          },
        });
      } else {
        actions.push(
          act(
            decision.chosenCandidate.spellId,
            decision.targetUnit.id,
            Priority.HEAL,
            decision.chosenCandidate.castMs === 0 || decision.decisionType === 'EMERGENCY_ST'
          )
        );
      }
    }

    // 3. 兜底：若坦克血线未满且仍有可用单抬技能，补充最低优先级维护
    const tank = getMainTank(gs.units);
    if (actions.length === 0 && tank && hpFraction(tank) < 0.90 && candidates.length > 0) {
      actions.push(act(candidates[0].spellId, tank.id, Priority.DPS));
    }

    return actions;
  }
}

function act(
  spellId: string,
  targetId: string,
  priority: Priority,
  immediate = false,
): PrioritisedAction {
  return { priority, action: { spellId, targetId, immediate } };
}

export interface Point2D {
  x: number;
  y: number;
}

export function findOptimalGroundAuraCentroid(
  caster: { position?: Point2D },
  allies: Array<{ id: string; hp: number; maxHp: number; alive?: boolean; isAlive?: boolean; position?: Point2D }>,
  radius: number = 55,
  maxRange: number = 360
): Point2D {
  const casterPos = caster.position || { x: 200, y: 200 };
  const living = allies.filter(u => (u.isAlive ?? u.alive ?? true) && u.hp > 0 && u.position);
  if (living.length === 0) return { ...casterPos };

  const reachable = living.filter(u => Math.hypot(u.position!.x - casterPos.x, u.position!.y - casterPos.y) <= maxRange);
  const pool = reachable.length > 0 ? reachable : living;

  const getWeight = (u: { hp: number; maxHp: number }) => {
    const hpPct = u.maxHp > 0 ? u.hp / u.maxHp : 1;
    if (hpPct < 0.50) return 3.0;
    if (hpPct < 0.85) return 2.0;
    if (hpPct < 1.00) return 1.5;
    return 1.0;
  };

  let bestCenter: Point2D = { ...casterPos };
  let maxScore = -1;

  for (const seed of pool) {
    const seedPos = seed.position!;
    const cluster = pool.filter(u => Math.hypot(u.position!.x - seedPos.x, u.position!.y - seedPos.y) <= radius);
    if (cluster.length === 0) continue;

    let totalW = 0, sumX = 0, sumY = 0;
    for (const m of cluster) {
      const w = getWeight(m);
      totalW += w;
      sumX += m.position!.x * w;
      sumY += m.position!.y * w;
    }

    let cx = Math.round(sumX / totalW);
    let cy = Math.round(sumY / totalW);
    const dCaster = Math.hypot(cx - casterPos.x, cy - casterPos.y);
    if (dCaster > maxRange) {
      const r = maxRange / dCaster;
      cx = Math.round(casterPos.x + (cx - casterPos.x) * r);
      cy = Math.round(casterPos.y + (cy - casterPos.y) * r);
    }

    let score = 0;
    for (const u of living) {
      if (Math.hypot(u.position!.x - cx, u.position!.y - cy) <= radius) {
        score += getWeight(u);
      }
    }

    if (score > maxScore) {
      maxScore = score;
      bestCenter = { x: cx, y: cy };
    }
  }

  return bestCenter;
}
