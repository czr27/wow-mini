import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import { pickWeightedBossTarget } from '../core/BossTargetPicker.js';

export type BalnazzarAiState = {
  balFightMs?: number;
  balPhase?: 'human' | 'demon';
  skills?: BossSkill[];
};

function living(engine: any) {
  return engine.friendlyUnits.filter((u: any) => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

export const BalnazzarEncounter: BossEncounterModule = {
  id: 'balnazzar',
  name: '巴纳扎尔',
  dungeonId: 'stratholme',
  tier: '5man',

  createSkills(bossAi: any): BossSkill[] {
    const ai = bossAi as BalnazzarAiState;
    return [
      {
        id: 'mind_control',
        name: '心灵控制',
        castTimeMs: 1500,
        cooldownMs: 22_000,
        lastCastMs: -10_000,
        interruptible: true,
        school: 'SHADOW',
        range: 320,
        targetKind: 'RANGED_TARGET',
        description: '支配队友（可驱散/控场）',
        execute: (boss, engine) => {
          const pool = living(engine).filter((u: any) => u.role !== 'TANK');
          const t = pickWeightedBossTarget(pool);
          if (!t) return;
          engine.applyBuff(t, {
            id: `mc_${Date.now()}`,
            spellId: 'balnazzar_mind_control',
            name: '心灵控制',
            kind: 'DEBUFF',
            tags: ['STUN', 'DEBUFF'],
            sourceUnitId: boss.id,
            targetUnitId: t.id,
            durationMs: 6000,
            remainingMs: 6000,
            stacks: 1,
            maxStacks: 1,
            school: 'SHADOW',
          });
          engine.effectsManager?.addFloatingText({
            targetId: t.id,
            text: '🧠 被支配！驱散/控制！',
            category: 'CRIT',
            isCrit: true,
          });
        },
      },
      {
        id: 'fear',
        name: '恐惧',
        castTimeMs: 0,
        cooldownMs: 18_000,
        lastCastMs: -8000,
        interruptible: false,
        school: 'SHADOW',
        range: 200,
        targetKind: 'AOE',
        description: '范围恐惧',
        execute: (boss, engine) => {
          for (const u of living(engine).slice(0, 2)) {
            engine.applyBuff(u, {
              id: `fear_${Date.now()}_${u.id}`,
              spellId: 'balnazzar_fear',
              name: '恐惧',
              kind: 'DEBUFF',
              tags: ['STUN', 'DEBUFF'],
              sourceUnitId: boss.id,
              targetUnitId: u.id,
              durationMs: 3000,
              remainingMs: 3000,
              stacks: 1,
              maxStacks: 1,
              school: 'SHADOW',
            });
          }
        },
      },
      {
        id: 'shadow_bolt',
        name: '暗影箭',
        castTimeMs: 2000,
        cooldownMs: 8000,
        lastCastMs: -2000,
        interruptible: true,
        school: 'SHADOW',
        range: 320,
        targetKind: 'MELEE_TARGET',
        description: '对主坦暗影箭',
        execute: (boss, engine) => {
          const tank = living(engine).find((u: any) => u.role === 'TANK');
          const mult = ai.balPhase === 'demon' ? 1.4 : 1;
          if (tank) engine.dealDamage(boss, tank, Math.round(24_000 * mult), 'SHADOW', false, '暗影箭');
        },
      },
    ];
  },

  onTick(deltaMs, boss, engine, bossAiRaw) {
    const ai = bossAiRaw as BalnazzarAiState;
    ai.balFightMs = (ai.balFightMs || 0) + deltaMs;
    if (!ai.balPhase) ai.balPhase = 'human';

    if (ai.balPhase === 'human' && boss.maxHp > 0 && boss.hp / boss.maxHp <= 0.5) {
      ai.balPhase = 'demon';
      engine.effectsManager?.addFloatingText({
        targetId: boss.id,
        text: '😈 达索汉变身巴纳扎尔！',
        category: 'CRIT',
        isCrit: true,
      });
    }
  },
};
