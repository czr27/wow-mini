import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import type { CombatEngine } from '../../engine/CombatEngine.js';
import type { Unit } from '../../types.js';
import { spawnCombatUnit } from '../../engine/UnitSpawn.js';

export const BRITTLE_BARRIER_SUMMON = 'jindo_brittle_barrier';
export const SPIRIT_SUMMON = 'jindo_gurubashi_spirit';

export type JindoAiState = {
  jindoFightMs?: number;
  jindoPhase?: 'barrier' | 'exposed';
  jindoBarriersBroken?: number;
  jindoSpiritAcc?: number;
  skills?: BossSkill[];
};

function living(engine: CombatEngine): Unit[] {
  return engine.friendlyUnits.filter(u => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

function spawnBarrier(engine: CombatEngine, boss: Unit, index: number) {
  const bPos = boss.position || { x: 500, y: 200 };
  spawnCombatUnit(engine, {
    id: `barrier_${index}_${Date.now()}`,
    name: `脆弱屏障 ${index + 1}/3`,
    unitKind: 'ADD',
    role: 'ENEMY',
    classId: 'NPC',
    hp: 90_000,
    maxHp: 90_000,
    position: { x: bPos.x - 40 + index * 40, y: bPos.y + 70 },
    summonSpellId: BRITTLE_BARRIER_SUMMON,
  });
}

export const JindoEncounter: BossEncounterModule = {
  id: 'jindo',
  name: '碎神者金度',
  dungeonId: 'zulgurub',
  tier: '5man',

  createSkills(bossAi: any): BossSkill[] {
    const ai = bossAi as JindoAiState;
    return [
      {
        id: 'shadows_of_hakkar',
        name: '哈卡之影',
        castTimeMs: 2000,
        cooldownMs: 16_000,
        lastCastMs: -6000,
        interruptible: false,
        school: 'SHADOW',
        range: 360,
        targetKind: 'AOE',
        description: '全团暗影压',
        execute: (boss, engine) => {
          for (const u of living(engine)) {
            engine.dealDamage(boss, u, 14_000, 'SHADOW', false, '哈卡之影');
          }
        },
      },
      {
        id: 'body_slam',
        name: '躯体猛击',
        castTimeMs: 1800,
        cooldownMs: 14_000,
        lastCastMs: -4000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 200,
        targetKind: 'AOE',
        description: '屏障阶段砸向落点（也可伤屏障旁玩家）',
        execute: (boss, engine) => {
          const fri = living(engine);
          const t = fri[Math.floor(Math.random() * Math.max(1, fri.length))];
          const pos = t?.position || { x: 400, y: 220 };
          engine.effectsManager?.addGroundEffect({
            kind: 'DAMAGE_ZONE',
            spellId: 'jindo_body_slam',
            ownerId: boss.id,
            x: pos.x,
            y: pos.y,
            radius: 50,
            colorHex: '#A855F7',
            remainingMs: 2000,
            tickIntervalMs: 2000,
            tickValue: 24_000,
          });
          // 若落点靠近屏障，额外削屏障血
          for (const e of engine.enemyUnits) {
            if (e.summonSpellId !== BRITTLE_BARRIER_SUMMON) continue;
            if (!(e.alive ?? e.isAlive) || (e.hp ?? 0) <= 0) continue;
            const d = Math.hypot((e.position?.x || 0) - pos.x, (e.position?.y || 0) - pos.y);
            if (d < 80) {
              e.hp = Math.max(0, (e.hp || 0) - 45_000);
              if (e.hp <= 0) {
                e.alive = false;
                e.isAlive = false;
              }
            }
          }
        },
      },
      {
        id: 'jindo_strike',
        name: '碎神打击',
        castTimeMs: 0,
        cooldownMs: 10_000,
        lastCastMs: -100_000,
        interruptible: false,
        school: 'SHADOW',
        range: 80,
        targetKind: 'MELEE_TARGET',
        description: '暴露后坦打',
        execute: (boss, engine) => {
          if (ai.jindoPhase !== 'exposed') return;
          const tank = living(engine).find(u => u.role === 'TANK');
          if (tank) engine.dealDamage(boss, tank, 34_000, 'SHADOW', false, '碎神打击');
        },
      },
    ];
  },

  onTick(deltaMs, boss, engine, bossAiRaw) {
    const ai = bossAiRaw as JindoAiState;
    ai.jindoFightMs = (ai.jindoFightMs || 0) + deltaMs;

    if (!ai.jindoPhase) {
      ai.jindoPhase = 'barrier';
      ai.jindoBarriersBroken = 0;
      // 锁本体
      boss.hp = boss.maxHp;
      spawnBarrier(engine, boss, 0);
      engine.effectsManager?.addFloatingText({
        targetId: boss.id,
        text: '🛡️ 打破三层脆弱屏障！',
        category: 'CRIT',
        isCrit: true,
      });
    }

    if (ai.jindoPhase === 'barrier') {
      boss.hp = boss.maxHp; // 屏障期不可有效集火本体
      const barrier = engine.enemyUnits.find(
        e => e.summonSpellId === BRITTLE_BARRIER_SUMMON && (e.alive ?? e.isAlive) && (e.hp ?? 0) > 0,
      );
      if (!barrier) {
        ai.jindoBarriersBroken = (ai.jindoBarriersBroken || 0) + 1;
        if ((ai.jindoBarriersBroken || 0) >= 3) {
          ai.jindoPhase = 'exposed';
          for (const s of ai.skills || []) {
            if (s.id === 'jindo_strike') s.lastCastMs = -999_999;
          }
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '💥 屏障尽碎！集火金度！',
            category: 'CRIT',
            isCrit: true,
          });
        } else {
          spawnBarrier(engine, boss, ai.jindoBarriersBroken || 0);
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: `屏障破碎 ${ai.jindoBarriersBroken}/3`,
            category: 'STATUS',
            isCrit: false,
          });
        }
      }
    }

    if (ai.jindoPhase === 'exposed') {
      ai.jindoSpiritAcc = (ai.jindoSpiritAcc || 0) + deltaMs;
      if ((ai.jindoSpiritAcc || 0) >= 20_000) {
        ai.jindoSpiritAcc = 0;
        const bPos = boss.position || { x: 500, y: 200 };
        spawnCombatUnit(engine, {
          id: `spirit_${Date.now()}`,
          name: '古拉巴什之魂',
          unitKind: 'ADD',
          role: 'ENEMY',
          classId: 'NPC',
          hp: 55_000,
          maxHp: 55_000,
          position: { x: bPos.x - 70, y: bPos.y + 40 },
          summonSpellId: SPIRIT_SUMMON,
        });
      }
    }
  },

  isActionLocked(bossAi: any) {
    // 屏障期仍可放技能砸场；不锁
    return false;
  },
};
