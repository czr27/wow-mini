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

const PRIORITY_ADD_PREFIXES = [
  'jindo_brittle_barrier',
  'hagara_ice_tomb',
  'hagara_conductive_crystal',
  'madness_elementium_bolt',
  'madness_limb',
  'venoxis_bloodvenom',
  'ripsnarl_vapor',
  'kilnara_panther',
  'zonozz_void_tentacle',
  'yorsahj_blood_',
  'zanzil_zanzili_zombie',
  'zanzil_gurubashi_berserker',
  'helix_lumbering_oaf',
];

export function selectDpsPriorityEnemies(livingEnemies: Unit[], boss: Unit | undefined): Unit[] {
  if (livingEnemies.length <= 1) return livingEnemies;
  const priorityAdd = livingEnemies.find(
    (e) =>
      (!boss || e.id !== boss.id) &&
      !!e.summonSpellId &&
      PRIORITY_ADD_PREFIXES.some((p) => e.summonSpellId!.startsWith(p))
  );
  if (priorityAdd) {
    return [priorityAdd, ...livingEnemies.filter((e) => e.id !== priorityAdd.id)];
  }
  // If boss has immunity/deflection buff, switch to any living add
  const bossImmune = boss?.buffs?.some(
    (b) => b.spellId === 'arcane_bubble' || b.spellId === 'vanessa_deflection' || b.spellId === 'divine_shield' || b.spellId === 'ice_block'
  );
  if (bossImmune && boss) {
    const anyAdd = livingEnemies.find((e) => e.id !== boss.id);
    if (anyAdd) return [anyAdd, ...livingEnemies.filter((e) => e.id !== anyAdd.id)];
  }
  return livingEnemies;
}

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

    // 2. 法系 DPS 自回蓝大招判定（法师唤醒、暗牧消散、术士生命分流等）
    // 当蓝量低于 35% 时，优先释放自回蓝技能回复法力，保障长战斗输出续航
    const curMana = getUnitResourceAmount(unit, 'MANA');
    const maxMana = (unit.maxMp && unit.maxMp > 0) ? unit.maxMp : 0;
    if (maxMana > 0 && curMana / maxMana < 0.35) {
      const manaRestoreSpell = ownedSpells.find(
        s =>
          (s.isResourceRestore && !s.isDamage && !s.isHeal) ||
          s.id.includes('evocation') ||
          s.id.includes('dispersion') ||
          s.id.includes('life_tap')
      );
      if (manaRestoreSpell) {
        actions.push(act(manaRestoreSpell.id, unit.id, Priority.DEFENSIVE, true));
      }
    }

    // 3. 通用规则决策（优先判断目标 >= 3 放 AOE，其次性价比与输出）
    const personality = createAIPersonality(unit.name, unit.id);
    const candidates = buildUsableCandidatesForUnit(unit, specId, () => true, {
      roleFilter: 'DAMAGE',
      useShortId: false,
    });

    const orderedEnemies = selectDpsPriorityEnemies(livingEnemies, boss);

    const decision = evaluateUniversalAIDecision({
      caster: unit,
      personality,
      allies: livingAllies,
      enemies: orderedEnemies,
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
