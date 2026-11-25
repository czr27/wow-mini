import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import type { CombatEngine } from '../../engine/CombatEngine.js';
import type { Unit } from '../../types.js';
import { spawnCombatUnit } from '../../engine/UnitSpawn.js';

export const CORRUPTION_SUMMON = 'spine_corruption';
export const RESIDUE_SUMMON = 'spine_hideous_amalgamation';
export const GRIP_SPELL_ID = 'spine_grip';
export const SEARING_PLASMA_ID = 'searing_plasma';

export type SpineAiState = {
  spineFightMs?: number;
  spinePlatesRemoved?: number;
  spineResidueCount?: number;
  spineRollAt?: number;
  spineCorruptionAcc?: number;
  skills?: BossSkill[];
};

function living(engine: CombatEngine): Unit[] {
  return engine.friendlyUnits.filter(u => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

/** 抓稳：离开滚转窗口前给全员（AI 自动；玩家可测） */
export function applySpineGrip(engine: CombatEngine, u: Unit) {
  engine.applyBuff(u, {
    id: `grip_${Date.now()}_${u.id}`,
    spellId: GRIP_SPELL_ID,
    name: '抓稳',
    kind: 'BUFF',
    tags: ['STAT'],
    sourceUnitId: u.id,
    targetUnitId: u.id,
    durationMs: 6000,
    remainingMs: 6000,
    stacks: 1,
    maxStacks: 1,
  });
}

/**
 * 死亡之翼的背脊：腐蚀 → 残渣 → 滚转撕甲
 */
export const SpineEncounter: BossEncounterModule = {
  id: 'spine',
  name: '死亡之翼的背脊',
  dungeonId: 'dragon_soul',
  tier: '20man',

  createSkills(bossAi: any): BossSkill[] {
    const ai = bossAi as SpineAiState;
    return [
      {
        id: 'searing_plasma',
        name: '灼热血浆',
        castTimeMs: 0,
        cooldownMs: 14_000,
        lastCastMs: -4000,
        interruptible: false,
        school: 'FIRE',
        range: 320,
        targetKind: 'RANGED_TARGET',
        description: '点名吸收盾/持续灼烧（简化 DoT）',
        execute: (boss, engine) => {
          const pool = living(engine);
          const t = pool[Math.floor(Math.random() * Math.max(1, pool.length))];
          if (!t) return;
          engine.applyBuff(t, {
            id: `plasma_${Date.now()}_${t.id}`,
            spellId: SEARING_PLASMA_ID,
            name: '灼热血浆',
            kind: 'DEBUFF',
            tags: ['DOT', 'DEBUFF'],
            sourceUnitId: boss.id,
            targetUnitId: t.id,
            durationMs: 15_000,
            remainingMs: 15_000,
            stacks: 1,
            maxStacks: 1,
            school: 'FIRE',
            tickIntervalMs: 3000,
            tickValue: 7000,
          });
        },
      },
      {
        id: 'summon_corruption',
        name: '召唤腐蚀',
        castTimeMs: 1500,
        cooldownMs: 20_000,
        lastCastMs: -2000,
        interruptible: false,
        school: 'SHADOW',
        range: 400,
        targetKind: 'AOE',
        description: '平台腐蚀怪；击杀后生成残渣进度',
        execute: (boss, engine) => {
          const bPos = boss.position || { x: 500, y: 200 };
          const n = living(engine).length >= 15 ? 4 : 2;
          const hp = living(engine).length >= 15 ? 90_000 : 35_000;
          for (let i = 0; i < n; i++) {
            spawnCombatUnit(engine, {
              id: `corr_${Date.now()}_${i}`,
              name: `腐蚀 ${i + 1}`,
              unitKind: 'ADD',
              role: 'ENEMY',
              classId: 'NPC',
              hp,
              maxHp: hp,
              position: { x: bPos.x - 80 + i * 50, y: bPos.y + 60 },
              summonSpellId: CORRUPTION_SUMMON,
            });
          }
        },
      },
      {
        id: 'fiery_grip',
        name: '炽热抓握提示',
        castTimeMs: 1000,
        cooldownMs: 30_000,
        lastCastMs: -25_000,
        interruptible: false,
        school: 'FIRE',
        range: 400,
        targetKind: 'AOE',
        description: '预告滚转：全员需抓稳',
        dbm: {
          advice: '即将滚转，抓稳防翻',
          voiceText: '抓稳防翻',
          severity: 'CRITICAL',
          preWarnMs: 0,
        },
        execute: (boss, engine) => {
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '⚠️ 即将滚转！按住抓稳！',
            category: 'STATUS',
            isCrit: true,
          });
        },
      },
    ];
  },

  onTick(deltaMs, boss, engine, bossAiRaw) {
    const ai = bossAiRaw as SpineAiState;
    ai.spineFightMs = (ai.spineFightMs || 0) + deltaMs;
    if (ai.spinePlatesRemoved == null) ai.spinePlatesRemoved = 0;
    if (ai.spineResidueCount == null) ai.spineResidueCount = 0;

    // 腐蚀死亡 → 残渣
    for (const e of engine.enemyUnits) {
      if (e.summonSpellId !== CORRUPTION_SUMMON) continue;
      if ((e as any)._spineCounted) continue;
      if ((e.alive ?? e.isAlive) && (e.hp ?? 0) > 0) continue;
      (e as any)._spineCounted = true;
      ai.spineResidueCount = (ai.spineResidueCount || 0) + 1;
      const bPos = boss.position || { x: 500, y: 200 };
      spawnCombatUnit(engine, {
        id: `residue_${Date.now()}_${e.id}`,
        name: '丑陋的融合怪',
        unitKind: 'ADD',
        role: 'ENEMY',
        classId: 'NPC',
        hp: living(engine).length >= 15 ? 200_000 : 70_000,
        maxHp: living(engine).length >= 15 ? 200_000 : 70_000,
        position: { ...(e.position || bPos) },
        summonSpellId: RESIDUE_SUMMON,
      });
    }

    // 残渣死亡累积 → 触发滚转撕甲
    for (const e of engine.enemyUnits) {
      if (e.summonSpellId !== RESIDUE_SUMMON) continue;
      if ((e as any)._spineResCounted) continue;
      if ((e.alive ?? e.isAlive) && (e.hp ?? 0) > 0) continue;
      (e as any)._spineResCounted = true;
      // 每杀死 1 个残渣安排滚转
      if (ai.spineRollAt == null) {
        ai.spineRollAt = (ai.spineFightMs || 0) + 4000;
        // AI 自动抓稳；玩家需自行（测试可手动）
        for (const u of living(engine)) {
          if (!u.isPlayer) applySpineGrip(engine, u);
        }
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
          text: '🌀 残渣倒下 → 4 秒后滚转！',
          category: 'CRIT',
          isCrit: true,
        });
      }
    }

    if (ai.spineRollAt != null && (ai.spineFightMs || 0) >= ai.spineRollAt) {
      for (const u of living(engine)) {
        const gripped = u.buffs?.some(b => b.spellId === GRIP_SPELL_ID);
        if (!gripped) {
          engine.dealDamage(boss, u, 999_999, 'PHYSICAL', true, '滚落摔死');
        }
      }
      ai.spinePlatesRemoved = (ai.spinePlatesRemoved || 0) + 1;
      // 撕甲：对 Boss 造成真实进度伤害
      const plateDmg = Math.round(boss.maxHp * 0.08);
      boss.hp = Math.max(1, boss.hp - plateDmg);
      ai.spineRollAt = undefined;
      engine.effectsManager?.addFloatingText({
        targetId: boss.id,
        text: `🦴 撕开甲片！(${ai.spinePlatesRemoved}/3)`,
        category: 'CRIT',
        isCrit: true,
      });
      // 3 片后可斩杀（额外掉一大截）
      if ((ai.spinePlatesRemoved || 0) >= 3) {
        boss.hp = Math.min(boss.hp, Math.round(boss.maxHp * 0.15));
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
          text: '💀 甲片撕尽！爆发输出！',
          category: 'CRIT',
          isCrit: true,
        });
      }
    }
  },
};
