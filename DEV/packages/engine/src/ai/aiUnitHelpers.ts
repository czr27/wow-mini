import type { CombatEngine } from '../engine/CombatEngine.js';
import type { ClassId, Unit } from '../types.js';
import type { AIPersonality } from './SkillMetricEvaluator.js';
import { createAIPersonality } from './SkillMetricEvaluator.js';
import { ALL_CLASSES_NORMALIZED, getSpellByAnyId } from '../classes/ClassRegistry.js';

const HEAL_PREDICTIONS: Record<string, { base: number; coeff: number }> = {
  nourish: { base: 4200, coeff: 0.35 },
  regrowth: { base: 6500, coeff: 0.45 },
  healing_touch: { base: 11500, coeff: 0.85 },
  healing_wave: { base: 4200, coeff: 0.35 },
  healing_surge: { base: 8200, coeff: 0.55 },
  greater_healing_wave: { base: 12000, coeff: 0.85 },
  chain_heal: { base: 6200, coeff: 0.5 },
  holy_light: { base: 5200, coeff: 0.4 },
  flash_of_light: { base: 8200, coeff: 0.55 },
  divine_light: { base: 12500, coeff: 0.85 },
  heal: { base: 4600, coeff: 0.35 },
  flash_heal: { base: 8500, coeff: 0.55 },
  greater_heal: { base: 12500, coeff: 0.85 },
  prayer_of_healing: { base: 5800, coeff: 0.45 },
};

export function getPredictedHealAmount(spellId: string, caster?: Unit): number {
  const pred = HEAL_PREDICTIONS[spellId];
  const sp = caster?.stats?.spellPower || 3200;
  if (pred) return Math.round(pred.base + sp * pred.coeff);
  const norm = getSpellByAnyId(spellId, caster?.classId);
  if (norm && norm.isHeal && norm.directHeal > 0) {
    return Math.round(norm.directHeal + sp * 0.4);
  }
  return 0;
}

export function isAiCdReady(
  aiCooldowns: Record<string, number>,
  unitId: string,
  spellKey: string,
  cdMs: number
): boolean {
  if (cdMs <= 0) return true;
  const last = aiCooldowns[`${unitId}_${spellKey}`] || 0;
  return Date.now() - last >= cdMs;
}

export function markAiCdUsed(aiCooldowns: Record<string, number>, unitId: string, spellKey: string): void {
  aiCooldowns[`${unitId}_${spellKey}`] = Date.now();
}

export function inferAiSpecForUnit(u: Unit): string {
  const cls = ALL_CLASSES_NORMALIZED[u.classId as ClassId];
  if (!cls) return u.spec || 'BLOOD';
  if (u.spec) {
    const exact = cls.specs.find((s: { id: string }) => s.id.toUpperCase() === u.spec!.toUpperCase());
    if (exact) return exact.id;
  }
  const matching = cls.specs.find((s: { role: string }) => s.role === u.role);
  return matching?.id || cls.specs[0]?.id || 'BLOOD';
}

export function getOrCreateUnitAIPersonality(
  cache: Map<string, AIPersonality>,
  u: Unit
): AIPersonality {
  let p = cache.get(u.id);
  if (!p) {
    p = createAIPersonality(u.name || 'AI', u.id || 'unit');
    cache.set(u.id, p);
  }
  return p;
}

export function notifyOom(
  lastOomWarningMs: Record<string, number>,
  unit: Unit,
  engine: CombatEngine
): void {
  const now = Date.now();
  if (!lastOomWarningMs[unit.id] || now - lastOomWarningMs[unit.id] > 4000) {
    lastOomWarningMs[unit.id] = now;
    engine.effectsManager?.addFloatingText({
      targetId: unit.id,
      text: `⚠️ ${unit.name} 法力耗尽 (OOM)!`,
      category: 'STATUS',
      isCrit: false,
    });
  }
}
