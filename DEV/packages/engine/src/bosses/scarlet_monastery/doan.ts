import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import { pickWeightedBossTarget } from '../core/BossTargetPicker.js';

export type DoanAiState = {
  doanFightMs?: number;
  doanBubbleDone?: boolean;
  doanBubbleMs?: number;
  skills?: BossSkill[];
};

function living(engine: any) {
  return engine.friendlyUnits.filter((u: any) => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

export const DoanEncounter: BossEncounterModule = {
  id: 'doan',
  name: '奥法师杜安',
  dungeonId: 'scarlet_monastery',
  tier: '5man',

  createSkills(bossAi: any): BossSkill[] {
    const ai = bossAi as DoanAiState;
    return [
      {
        id: 'polymorph',
        name: '变形术',
        castTimeMs: 1500,
        cooldownMs: 16_000,
        lastCastMs: -6000,
        interruptible: true,
        school: 'SHADOW',
        range: 320,
        targetKind: 'RANGED_TARGET',
        description: '随机变形；附近可能被魔爆波及',
        execute: (boss, engine) => {
          if ((ai.doanBubbleMs || 0) > 0) return;
          const pool = living(engine).filter((u: any) => u.role !== 'TANK');
          const t = pickWeightedBossTarget(pool);
          if (!t) return;
          engine.applyBuff(t, {
            id: `poly_${Date.now()}`,
            spellId: 'doan_polymorph',
            name: '变形术',
            kind: 'DEBUFF',
            tags: ['STUN', 'DEBUFF'],
            sourceUnitId: boss.id,
            targetUnitId: t.id,
            durationMs: 4000,
            remainingMs: 4000,
            stacks: 1,
            maxStacks: 1,
            school: 'SHADOW',
          });
        },
      },
      {
        id: 'silence',
        name: '沉默',
        castTimeMs: 0,
        cooldownMs: 18_000,
        lastCastMs: -8000,
        interruptible: false,
        school: 'SHADOW',
        range: 200,
        targetKind: 'AOE',
        description: '范围沉默',
        execute: (boss, engine) => {
          if ((ai.doanBubbleMs || 0) > 0) return;
          for (const u of living(engine)) {
            engine.applyBuff(u, {
              id: `sil_${Date.now()}_${u.id}`,
              spellId: 'doan_silence',
              name: '沉默',
              kind: 'DEBUFF',
              tags: ['SILENCE', 'DEBUFF'],
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
        id: 'arcane_explosion',
        name: '奥术爆炸',
        castTimeMs: 0,
        cooldownMs: 8000,
        lastCastMs: -2000,
        interruptible: false,
        school: 'SHADOW',
        range: 100,
        targetKind: 'AOE',
        description: '近距奥爆',
        dbm: {
          advice: '奥术爆炸，注意远离',
          voiceText: '注意远离',
          severity: 'WARN',
        },
        execute: (boss, engine) => {
          if ((ai.doanBubbleMs || 0) > 0) return;
          const bPos = boss.position || { x: 500, y: 200 };
          for (const u of living(engine)) {
            const d = Math.hypot((u.position?.x || 0) - bPos.x, (u.position?.y || 0) - bPos.y);
            if (d <= 80) engine.dealDamage(boss, u, 14_000, 'SHADOW', false, '奥术爆炸');
          }
        },
      },
    ];
  },

  onTick(deltaMs, boss, engine, bossAiRaw) {
    const ai = bossAiRaw as DoanAiState;
    ai.doanFightMs = (ai.doanFightMs || 0) + deltaMs;

    if (!ai.doanBubbleDone && boss.maxHp > 0 && boss.hp / boss.maxHp <= 0.5) {
      ai.doanBubbleDone = true;
      ai.doanBubbleMs = 4000;
      engine.applyBuff(boss, {
        id: `bubble_${Date.now()}`,
        spellId: 'arcane_bubble',
        name: '奥术气泡',
        kind: 'BUFF',
        tags: ['STAT'],
        sourceUnitId: boss.id,
        targetUnitId: boss.id,
        durationMs: 4000,
        remainingMs: 4000,
        stacks: 1,
        maxStacks: 1,
      });
      const bPos = boss.position || { x: 500, y: 200 };
      // 预警圆：自爆半径 100；气泡期间不跳伤，仅光圈提示撤离
      engine.effectsManager?.addGroundEffect({
        kind: 'DAMAGE_ZONE',
        spellId: 'arcane_bubble',
        ownerId: boss.id,
        x: bPos.x,
        y: bPos.y,
        radius: 100,
        colorHex: '#A855F7',
        remainingMs: 4000,
        tickIntervalMs: 99_000,
        tickValue: 0,
      });
      engine.effectsManager?.addFloatingText({
        targetId: boss.id,
        text: '🫧 奥术气泡！立刻远离近战圈！',
        category: 'CRIT',
        isCrit: true,
      });
    }

    if ((ai.doanBubbleMs || 0) > 0) {
      ai.doanBubbleMs = Math.max(0, (ai.doanBubbleMs || 0) - deltaMs);
      if ((ai.doanBubbleMs || 0) <= 0) {
        const bPos = boss.position || { x: 500, y: 200 };
        for (const u of living(engine)) {
          const d = Math.hypot((u.position?.x || 0) - bPos.x, (u.position?.y || 0) - bPos.y);
          if (d <= 100) {
            engine.dealDamage(boss, u, 40_000, 'SHADOW', true, '奥术自爆');
          }
        }
        boss.buffs = (boss.buffs || []).filter(b => b.spellId !== 'arcane_bubble');
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
          text: '💥 奥术自爆！',
          category: 'CRIT',
          isCrit: true,
        });
      }
    }
  },

  isActionLocked(bossAi: any) {
    return ((bossAi as DoanAiState).doanBubbleMs || 0) > 0;
  },
};
