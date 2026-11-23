// ============================================================
// Cata Raid Sim — Universal Rule-Driven DPS AI  [AI-04]
// Dynamically inspects owned available skills from ClassRegistry
// for ALL 10 Cataclysm classes (Warrior, Paladin, Hunter, Priest,
// Warlock, Mage, Rogue, DK, Druid, Shaman) with AoE-first &
// interrupt coordination.
// ============================================================

import { ClassId, Unit } from '../types.js';
import {
  GameState,
  Priority,
  PrioritisedAction,
  RoleAI,
  getBoss,
} from './AIController.js';
import { getSpellsForClassSpec } from '../classes/ClassRegistry.js';
import {
  buildUsableCandidatesForUnit,
  createAIPersonality,
  evaluateUniversalAIDecision,
  getUnitResourceAmount,
} from './SkillMetricEvaluator.js';

export class DpsAI implements RoleAI {
  constructor(private readonly interruptPriority: number = 0) {}

  decide(unit: Unit, gs: GameState): PrioritisedAction[] {
    const actions: PrioritisedAction[] = [];
    if (unit.classId === 'BOSS' || unit.classId === 'NPC') return actions;

    const livingEnemies = gs.units.filter(u => u.role === 'ENEMY' && u.isAlive && u.hp > 0);
    const boss = getBoss(gs.units, gs.bossId) ?? livingEnemies[0];
    if (!boss) return actions;

    const livingAllies = gs.units.filter(u => u.role !== 'ENEMY' && u.isAlive && u.hp > 0);
    const specId = (unit as any).spec as string | undefined;
    const ownedSpells = getSpellsForClassSpec(unit.classId as ClassId, specId);

    // 1. 通用打断协调：只要拥有任意打断技能且资源足够，按打断顺位出手
    if (this.shouldInterrupt(unit, gs)) {
      const interruptSpell = ownedSpells.find(
        s => s.isInterrupt && getUnitResourceAmount(unit, s.resourceKind) >= s.resourceCostAmount
      );
      if (interruptSpell) {
        actions.push(act(interruptSpell.id, boss.id, Priority.INTERRUPT, true));
      }
    }

    // 2. 通用规则决策（优先判断目标 >= 3 放 AOE，其次性价比与输出）
    const personality = createAIPersonality(unit.name, unit.id);
    const candidates = buildUsableCandidatesForUnit(unit, specId, () => true, {
      roleFilter: 'DAMAGE',
      useShortId: false,
    });

    const decision = evaluateUniversalAIDecision({
      caster: unit,
      personality,
      allies: livingAllies,
      enemies: livingEnemies,
      usableSkills: candidates,
      tickCount: Math.floor((gs.elapsedMs || 0) / 100),
    });

    if (decision.chosenCandidate) {
      actions.push(
        act(
          decision.chosenCandidate.spellId,
          (decision.targetUnit ?? boss).id,
          Priority.DPS,
          decision.chosenCandidate.castMs === 0
        )
      );
    }

    return actions;
  }

  private shouldInterrupt(_unit: Unit, gs: GameState): boolean {
    if (!gs.bossChannelSpellId) return false;
    if (!this.isInterruptible(gs.bossChannelSpellId)) return false;

    const totalDuration = this.getChannelDuration(gs.bossChannelSpellId);
    const elapsed = totalDuration - gs.bossChannelRemainingMs;

    if (this.interruptPriority === 0) return elapsed < 300;
    if (this.interruptPriority === 1) return elapsed >= 300 && elapsed < 600;
    return elapsed >= 600;
  }

  private isInterruptible(spellId: string): boolean {
    const INTERRUPTIBLE = new Set([
      'boss_choke',
      'boss_last_rites',
      'boss_mend_rotten_flesh',
      'boss_cursed_bullet',
    ]);
    return INTERRUPTIBLE.has(spellId);
  }

  private getChannelDuration(spellId: string): number {
    const DURATIONS: Record<string, number> = {
      boss_choke: 3000,
      boss_last_rites: 2500,
      boss_mend_rotten_flesh: 2000,
      boss_cursed_bullet: 1500,
    };
    return DURATIONS[spellId] ?? 3000;
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
