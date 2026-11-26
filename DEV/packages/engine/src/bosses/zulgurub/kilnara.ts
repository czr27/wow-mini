import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import type { CombatEngine } from '../../engine/CombatEngine.js';
import type { Unit } from '../../types.js';
import { spawnCombatUnit } from '../../engine/UnitSpawn.js';

export const PANTHER_SUMMON = 'kilnara_panther';

export type KilnaraAiState = {
  kilnaraFightMs?: number;
  kilnaraPhase?: 'human' | 'beast';
  kilnaraEnraged?: boolean;
  skills?: BossSkill[];
};

function living(engine: CombatEngine): Unit[] {
  return engine.friendlyUnits.filter(u => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

function livingPanthers(engine: CombatEngine): Unit[] {
  return engine.enemyUnits.filter(
    e => e.summonSpellId === PANTHER_SUMMON && (e.alive ?? e.isAlive) && (e.hp ?? 0) > 0,
  );
}

export const KilnaraEncounter: BossEncounterModule = {
  id: 'kilnara',
  name: '高阶祭司基尔娜拉',
  dungeonId: 'zulgurub',
  tier: '5man',

  createSkills(bossAi: any): BossSkill[] {
    const ai = bossAi as KilnaraAiState;
    return [
      {
        id: 'tear_flesh',
        name: '撕扯血肉',
        castTimeMs: 0,
        cooldownMs: 10_000,
        lastCastMs: -3000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 80,
        targetKind: 'MELEE_TARGET',
        description: '坦打',
        execute: (boss, engine) => {
          const tank = living(engine).find(u => u.role === 'TANK');
          const mult = ai.kilnaraEnraged ? 2.5 : ai.kilnaraPhase === 'beast' ? 1.4 : 1;
          if (tank) engine.dealDamage(boss, tank, Math.round(28_000 * mult), 'PHYSICAL', false, '撕扯血肉');
        },
      },
      {
        id: 'wave_of_agony',
        name: '痛苦波',
        castTimeMs: 1800,
        cooldownMs: 14_000,
        lastCastMs: -5000,
        interruptible: false,
        school: 'SHADOW',
        range: 360,
        targetKind: 'AOE',
        description: '全团暗影波',
        execute: (boss, engine) => {
          const mult = ai.kilnaraEnraged ? 2.5 : 1;
          for (const u of living(engine)) {
            engine.dealDamage(boss, u, Math.round(12_000 * mult), 'SHADOW', false, '痛苦波');
          }
        },
      },
    ];
  },

  onTick(deltaMs, boss, engine, bossAiRaw) {
    const ai = bossAiRaw as KilnaraAiState;
    ai.kilnaraFightMs = (ai.kilnaraFightMs || 0) + deltaMs;

    // 开战刷两包豹（共 6 只）
    if (!ai.kilnaraPhase) {
      ai.kilnaraPhase = 'human';
      const bPos = boss.position || { x: 500, y: 200 };
      for (let pack = 0; pack < 2; pack++) {
        for (let i = 0; i < 3; i++) {
          spawnCombatUnit(engine, {
            id: `panther_${pack}_${i}_${Date.now()}`,
            name: '神殿豹',
            unitKind: 'ADD',
            role: 'ENEMY',
            classId: 'NPC',
            hp: 35_000,
            maxHp: 35_000,
            position: {
              x: bPos.x - 100 + pack * 120 + i * 25,
              y: bPos.y + 60 + pack * 20,
            },
            summonSpellId: PANTHER_SUMMON,
          });
        }
      }
      engine.effectsManager?.addFloatingText({
        targetId: boss.id,
        text: '🐆 先清豹群！半血前务必清完！',
        category: 'STATUS',
        isCrit: true,
      });
    }

    const panthers = livingPanthers(engine);

    // 豹存活时轻微打团
    if (panthers.length > 0 && Math.floor((ai.kilnaraFightMs || 0) / 2000) !== Math.floor(((ai.kilnaraFightMs || 0) - deltaMs) / 2000)) {
      for (const u of living(engine)) {
        engine.dealDamage(boss, u, 3000 * Math.min(3, panthers.length), 'PHYSICAL', false, '豹群撕咬');
      }
    }

    // 半血变身
    if (ai.kilnaraPhase === 'human' && boss.maxHp > 0 && boss.hp / boss.maxHp <= 0.5) {
      ai.kilnaraPhase = 'beast';
      if (panthers.length > 0) {
        ai.kilnaraEnraged = true;
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
          text: '💢 豹未清完！基尔娜拉狂暴！',
          category: 'CRIT',
          isCrit: true,
        });
      } else {
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
          text: '🐆 半血变身（豹已清）',
          category: 'STATUS',
          isCrit: true,
        });
      }
    }
  },
};
