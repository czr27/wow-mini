import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import type { CombatEngine } from '../../engine/CombatEngine.js';
import type { Unit } from '../../types.js';
import { spawnCombatUnit } from '../../engine/UnitSpawn.js';
import { pickWeightedBossTarget } from '../core/BossTargetPicker.js';

export const OHGAN_SUMMON = 'mandokir_ohgan';
export const SOUL_REVIVE_MAX = 8;

export type MandokirAiState = {
  mandoFightMs?: number;
  mandoSoulsLeft?: number;
  mandoLevelUp?: number;
  mandoOhganAcc?: number;
  mandoOhganSeeded?: boolean;
  skills?: BossSkill[];
};

function living(engine: CombatEngine): Unit[] {
  return engine.friendlyUnits.filter(u => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

function spawnOhgan(engine: CombatEngine, boss: Unit) {
  // 清旧奥根
  for (const e of engine.enemyUnits) {
    if (e.summonSpellId === OHGAN_SUMMON) {
      e.hp = 0;
      e.alive = false;
      e.isAlive = false;
    }
  }
  const bPos = boss.position || { x: 500, y: 200 };
  spawnCombatUnit(engine, {
    id: `ohgan_${Date.now()}`,
    name: '奥根',
    unitKind: 'ADD',
    role: 'ENEMY',
    classId: 'NPC',
    hp: 120_000,
    maxHp: 120_000,
    position: { x: bPos.x + 50, y: bPos.y - 20 },
    summonSpellId: OHGAN_SUMMON,
  });
}

export const MandokirEncounter: BossEncounterModule = {
  id: 'mandokir',
  name: '血领主曼多基尔',
  dungeonId: 'zulgurub',
  tier: '5man',

  createSkills(bossAi: any): BossSkill[] {
    const ai = bossAi as MandokirAiState;
    return [
      {
        id: 'decapitate',
        name: '斩首',
        castTimeMs: 1500,
        cooldownMs: 22_000,
        lastCastMs: -8_000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 400,
        targetKind: 'RANGED_TARGET',
        description: '秒杀随机玩家；灵魂链复活（次数有限）',
        execute: (boss, engine) => {
          if (ai.mandoSoulsLeft == null) ai.mandoSoulsLeft = SOUL_REVIVE_MAX;
          const pool = living(engine).filter(u => u.role !== 'TANK');
          const t = pickWeightedBossTarget(pool) || pickWeightedBossTarget(living(engine));
          if (!t) return;
          // 秒杀
          engine.dealDamage(boss, t, 999_999, 'PHYSICAL', true, '斩首');
          ai.mandoLevelUp = (ai.mandoLevelUp || 0) + 1;
          if ((ai.mandoSoulsLeft || 0) > 0) {
            ai.mandoSoulsLeft! -= 1;
            // 灵魂复活
            t.hp = Math.round(t.maxHp * 0.5);
            t.alive = true;
            t.isAlive = true;
            engine.effectsManager?.addFloatingText({
              targetId: t.id,
              text: `👻 灵魂复活（剩 ${ai.mandoSoulsLeft}）`,
              category: 'STATUS',
              isCrit: true,
            });
          } else {
            engine.effectsManager?.addFloatingText({
              targetId: boss.id,
              text: '💀 灵魂耗尽！无法复活！',
              category: 'CRIT',
              isCrit: true,
            });
          }
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: `⬆️ Level Up ${ai.mandoLevelUp}`,
            category: 'STATUS',
            isCrit: false,
          });
        },
      },
      {
        id: 'devastating_slam',
        name: '毁灭猛击',
        castTimeMs: 2000,
        cooldownMs: 16_000,
        lastCastMs: -6000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 200,
        targetKind: 'AOE',
        description: '地面冲击：落点附近重伤',
        execute: (boss, engine) => {
          const fri = living(engine);
          const t = pickWeightedBossTarget(fri);
          const pos = t?.position || { x: 400, y: 220 };
          const mult = 1 + 0.08 * (ai.mandoLevelUp || 0);
          engine.effectsManager?.addGroundEffect({
            kind: 'DAMAGE_ZONE',
            spellId: 'devastating_slam',
            ownerId: boss.id,
            x: pos.x,
            y: pos.y,
            radius: 55,
            colorHex: '#EF4444',
            remainingMs: 2500,
            tickIntervalMs: 2500,
            tickValue: Math.round(28_000 * mult),
          });
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '💥 毁灭猛击落点！躲开！',
            category: 'STATUS',
            isCrit: true,
          });
        },
      },
      {
        id: 'bloodletting',
        name: '放血',
        castTimeMs: 0,
        cooldownMs: 14_000,
        lastCastMs: -4000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 80,
        targetKind: 'MELEE_TARGET',
        description: '坦打 + 降疗 debuff',
        execute: (boss, engine) => {
          const tank = living(engine).find(u => u.role === 'TANK');
          if (!tank) return;
          const mult = 1 + 0.08 * (ai.mandoLevelUp || 0);
          engine.dealDamage(boss, tank, Math.round(32_000 * mult), 'PHYSICAL', false, '放血');
          engine.applyBuff(tank, {
            id: `bl_${Date.now()}`,
            spellId: 'bloodletting',
            name: '放血',
            kind: 'DEBUFF',
            tags: ['DEBUFF'],
            sourceUnitId: boss.id,
            targetUnitId: tank.id,
            durationMs: 8000,
            remainingMs: 8000,
            stacks: 1,
            maxStacks: 1,
            school: 'PHYSICAL',
            healingReceivedMod: 0.5,
          });
        },
      },
    ];
  },

  onTick(deltaMs, boss, engine, bossAiRaw) {
    const ai = bossAiRaw as MandokirAiState;
    ai.mandoFightMs = (ai.mandoFightMs || 0) + deltaMs;
    if (ai.mandoSoulsLeft == null) ai.mandoSoulsLeft = SOUL_REVIVE_MAX;
    if (ai.mandoLevelUp == null) ai.mandoLevelUp = 0;

    // 开战刷奥根
    if (!ai.mandoOhganSeeded) {
      ai.mandoOhganSeeded = true;
      spawnOhgan(engine, boss);
      engine.effectsManager?.addFloatingText({
        targetId: boss.id,
        text: '🐕 奥根登场！优先击杀！',
        category: 'STATUS',
        isCrit: true,
      });
    }

    // 奥根存活时周期性「杀灵魂」——扣灵魂次数
    const ohgan = engine.enemyUnits.find(
      e => e.summonSpellId === OHGAN_SUMMON && (e.alive ?? e.isAlive) && (e.hp ?? 0) > 0,
    );
    if (ohgan && Math.floor((ai.mandoFightMs || 0) / 8000) !== Math.floor(((ai.mandoFightMs || 0) - deltaMs) / 8000)) {
      if ((ai.mandoSoulsLeft || 0) > 0) {
        ai.mandoSoulsLeft! -= 1;
        engine.effectsManager?.addFloatingText({
          targetId: ohgan.id,
          text: `奥根吞噬灵魂（剩 ${ai.mandoSoulsLeft}）`,
          category: 'CRIT',
          isCrit: true,
        });
      }
    }

    // 奥根死后定期复活
    if (!ohgan) {
      ai.mandoOhganAcc = (ai.mandoOhganAcc || 0) + deltaMs;
      if ((ai.mandoOhganAcc || 0) >= 25_000) {
        ai.mandoOhganAcc = 0;
        spawnOhgan(engine, boss);
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
          text: '🐕 奥根再次复活！',
          category: 'STATUS',
          isCrit: true,
        });
      }
    } else {
      ai.mandoOhganAcc = 0;
    }
  },
};
