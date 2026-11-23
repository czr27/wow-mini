import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import { spawnCombatUnit } from '../../engine/UnitSpawn.js';

type SpringvaleAiState = {
  unholyPower?: number;
  addSummonAcc?: number;
  skills: BossSkill[];
  currentCasting: { skill: BossSkill; elapsedMs: number } | null;
};

function countSpringvaleAdds(engine: { enemyUnits: { id: string; isAlive?: boolean; alive?: boolean; summonSpellId?: string }[] }) {
  return engine.enemyUnits.filter(
    e =>
      (e.isAlive ?? e.alive) &&
      (e.summonSpellId === 'wailing_guardsman' || e.summonSpellId === 'tormented_officer')
  ).length;
}

function spawnSpringvalePair(boss: { id: string; position?: { x: number; y: number } }, engine: any) {
  const base = boss.position || { x: 420, y: 220 };
  const t = engine.nowMs || Date.now();
  const guardsman = spawnCombatUnit(engine, {
    id: `sfk_guardsman_${t}`,
    name: '哀嚎卫兵',
    unitKind: 'ADD',
    role: 'ENEMY',
    classId: 'NPC',
    hp: 85_000,
    maxHp: 85_000,
    position: { x: base.x - 70, y: base.y + 40 },
    summonSpellId: 'wailing_guardsman',
    despawnAtElapsedMs: (engine.elapsed || 0) + 120_000,
  });
  const officer = spawnCombatUnit(engine, {
    id: `sfk_officer_${t + 1}`,
    name: '痛苦军官',
    unitKind: 'ADD',
    role: 'ENEMY',
    classId: 'NPC',
    hp: 70_000,
    maxHp: 70_000,
    position: { x: base.x + 70, y: base.y + 40 },
    summonSpellId: 'tormented_officer',
    despawnAtElapsedMs: (engine.elapsed || 0) + 120_000,
  });
  engine.effectsManager?.addFloatingText({
    targetId: boss.id,
    text: '⚔️ 斯普林瓦尔呼叫增援！',
    category: 'STATUS',
    isCrit: true,
  });
  return [guardsman, officer];
}

/**
 * 影牙城堡 3号：指挥官斯普林瓦尔 (Commander Springvale)
 * - 背信之盾：正面锥形
 * - 亵渎：脚下毒圈
 * - 增援：哀嚎卫兵 / 痛苦军官；未打断赋能则叠不洁能量
 * - 能量满：锥形或羞愧之语
 */
export const SpringvaleEncounter: BossEncounterModule = {
  id: 'springvale',
  name: '指挥官斯普林瓦尔',
  dungeonId: 'shadowfang_keep',
  tier: '5man',

  createSkills(bossAi: any): BossSkill[] {
    const ai = bossAi as SpringvaleAiState;
    ai.unholyPower = ai.unholyPower ?? 0;
    ai.addSummonAcc = ai.addSummonAcc ?? 0;

    return [
      {
        id: 'shield_of_perfidious',
        name: '背信之盾',
        castTimeMs: 1500,
        cooldownMs: 18000,
        lastCastMs: -8000,
        interruptible: false,
        school: 'SHADOW',
        range: 160,
        targetKind: 'AOE',
        description: '正面 60° 锥形高额暗影伤害；坦克需背对团队',
        execute: (boss, engine) => {
          const bPos = boss.position || { x: 420, y: 220 };
          const tank = engine.friendlyUnits.find(u => (u.alive ?? u.isAlive) && u.role === 'TANK');
          const tPos = tank?.position || { x: bPos.x - 80, y: bPos.y };
          const facing = Math.atan2(tPos.y - bPos.y, tPos.x - bPos.x);
          engine.effectsManager?.addGroundEffect({
            kind: 'CONE_WARNING',
            spellId: 'shield_of_perfidious',
            ownerId: boss.id,
            x: bPos.x,
            y: bPos.y,
            radius: 120,
            colorHex: '#7F1D1D',
            remainingMs: 1500,
            facingRad: facing,
            coneAngleRad: Math.PI / 3, // 60°
          });
          // Resolve cone after brief telegraph (engine clock — avoid setTimeout for sync)
          (bossAi as any)._perfidiousResolveAt = engine.nowMs + 1500;
          (bossAi as any)._perfidiousOwnerId = boss.id;
        },
      },
      {
        id: 'malefic_strike',
        name: '邪恶打击',
        castTimeMs: 0,
        cooldownMs: 8000,
        lastCastMs: -2000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 80,
        targetKind: 'MELEE_TARGET',
        description: '近战打击并积攒 1 点不洁能量',
        execute: (boss, engine) => {
          const tank = engine.friendlyUnits.find(u => u.alive && u.role === 'TANK');
          if (tank) {
            engine.dealDamage(boss, tank, 22000, 'PHYSICAL', false, '邪恶打击');
          }
          ai.unholyPower = Math.min(3, (ai.unholyPower || 0) + 1);
          if ((ai.unholyPower || 0) >= 3) {
            // Spend for Word of Shame on a random player
            ai.unholyPower = 0;
            const living = engine.friendlyUnits.filter(u => u.alive ?? u.isAlive);
            const target = living[Math.floor(Math.random() * living.length)];
            if (target) {
              engine.applyBuff(target, {
                id: `word_of_shame_${Date.now()}_${target.id}`,
                spellId: 'word_of_shame',
                name: '羞愧之语',
                kind: 'DEBUFF',
                tags: ['DOT', 'DEBUFF'],
                sourceUnitId: boss.id,
                targetUnitId: target.id,
                durationMs: 300000,
                remainingMs: 300000,
                stacks: 1,
                maxStacks: 1,
                school: 'SHADOW',
                tickIntervalMs: 3000,
                tickValue: Math.round(target.maxHp * 0.05),
              });
              engine.effectsManager?.addFloatingText({
                targetId: target.id,
                text: '😔 羞愧之语！',
                category: 'STATUS',
                isCrit: true,
              });
            }
          }
        },
      },
      {
        id: 'desecration',
        name: '暗绿亵渎',
        castTimeMs: 1000,
        cooldownMs: 20000,
        lastCastMs: -5000,
        interruptible: false,
        school: 'SHADOW',
        range: 320,
        targetKind: 'RANGED_TARGET',
        description: '在一名玩家脚下生成暗绿亵渎毒圈，必须迅速走出！',
        execute: (boss, engine) => {
          const living = engine.friendlyUnits.filter(u => u.alive);
          const target = living[Math.floor(Math.random() * living.length)] || engine.friendlyUnits[0];
          const targetPos = target ? target.position : { x: 420, y: 220 };
          engine.effectsManager?.addGroundEffect({
            kind: 'DAMAGE_ZONE',
            spellId: 'desecration',
            ownerId: boss.id,
            x: targetPos.x,
            y: targetPos.y,
            radius: 50,
            colorHex: '#006400',
            remainingMs: 12000,
            tickIntervalMs: 1000,
            tickValue: 4800,
          });
        },
      },
      {
        id: 'call_aids',
        name: '呼叫增援',
        castTimeMs: 2000,
        cooldownMs: 28000,
        lastCastMs: -1000,
        interruptible: false,
        school: 'SHADOW',
        range: 360,
        targetKind: 'AOE',
        description: '召唤哀嚎卫兵与痛苦军官；需打断其不洁赋能',
        execute: (boss, engine) => {
          if (countSpringvaleAdds(engine) >= 4) return;
          spawnSpringvalePair(boss, engine);
        },
      },
    ];
  },

  onTick(deltaMs, boss, engine, bossAiRaw) {
    const ai = bossAiRaw as SpringvaleAiState & {
      _perfidiousResolveAt?: number;
      _perfidiousOwnerId?: string;
      _addEmpowerAcc?: number;
    };

    // Resolve delayed cone damage on engine clock
    if (ai._perfidiousResolveAt != null && engine.nowMs >= ai._perfidiousResolveAt) {
      ai._perfidiousResolveAt = undefined;
      for (const u of engine.friendlyUnits) {
        if (!(u.alive && u.isAlive)) continue;
        const inCone = engine.effectsManager?.isPositionInHazard?.(u.position);
        if (inCone) {
          engine.dealDamage(boss, u, 35000, 'SHADOW', false, '背信之盾');
        }
      }
    }

    // Opening adds once
    if ((ai.addSummonAcc || 0) === 0 && countSpringvaleAdds(engine) === 0) {
      spawnSpringvalePair(boss, engine);
      ai.addSummonAcc = 1;
    }

    // Adds attempt Unholy Empowerment every ~8s if alive
    ai._addEmpowerAcc = (ai._addEmpowerAcc || 0) + deltaMs;
    if ((ai._addEmpowerAcc || 0) >= 8000) {
      ai._addEmpowerAcc = 0;
      const adds = engine.enemyUnits.filter(
        e =>
          (e.isAlive ?? e.alive) &&
          (e.summonSpellId === 'wailing_guardsman' || e.summonSpellId === 'tormented_officer')
      );
      for (const add of adds) {
        // 40% chance the "cast" succeeds if not killed; simplified: always empower unless add dead
        ai.unholyPower = Math.min(3, (ai.unholyPower || 0) + 1);
        engine.healUnit(add, boss, Math.round(boss.maxHp * 0.04), false, '不洁赋能');
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
          text: `💀 不洁赋能 (${ai.unholyPower}/3)`,
          category: 'STATUS',
          isCrit: false,
        });
      }
    }
  },
};
