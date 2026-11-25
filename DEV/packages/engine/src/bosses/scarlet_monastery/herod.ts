import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import { spawnCombatUnit } from '../../engine/UnitSpawn.js';

export const SCARLET_TRAINEE_SUMMON = 'herod_scarlet_trainee';

export type HerodAiState = {
  herodFightMs?: number;
  herodWhirlwindMs?: number;
  herodWhirlwindEffectId?: string;
  herodDeadApprentices?: boolean;
  skills?: BossSkill[];
};

function living(engine: any) {
  return engine.friendlyUnits.filter((u: any) => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

export const HerodEncounter: BossEncounterModule = {
  id: 'herod',
  name: '赫洛德',
  dungeonId: 'scarlet_monastery',
  tier: '5man',

  createSkills(bossAi: any): BossSkill[] {
    const ai = bossAi as HerodAiState;
    return [
      {
        id: 'whirlwind',
        name: '旋风斩',
        castTimeMs: 0,
        cooldownMs: 16_000,
        lastCastMs: -6000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 100,
        targetKind: 'AOE',
        description: '旋风：近战离开',
        execute: (boss, engine) => {
          ai.herodWhirlwindMs = 4000;
          const bPos = boss.position || { x: 500, y: 200 };
          const ge = engine.effectsManager?.addGroundEffect({
            kind: 'DAMAGE_ZONE',
            spellId: 'whirlwind',
            ownerId: boss.id,
            x: bPos.x,
            y: bPos.y,
            radius: 70,
            colorHex: '#EF4444',
            remainingMs: 4000,
            tickIntervalMs: 500,
            tickValue: 9000,
          });
          ai.herodWhirlwindEffectId = ge?.id;
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '🌀 旋风斩！近战退出！',
            category: 'CRIT',
            isCrit: true,
          });
        },
      },
      {
        id: 'herod_charge',
        name: '冲锋',
        castTimeMs: 0,
        cooldownMs: 12_000,
        lastCastMs: -4000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 320,
        targetKind: 'RANGED_TARGET',
        description: '冲锋后排',
        execute: (boss, engine) => {
          if ((ai.herodWhirlwindMs || 0) > 0) return;
          const pool = living(engine).filter((u: any) => u.role !== 'TANK');
          const t = pool[Math.floor(Math.random() * Math.max(1, pool.length))];
          if (t) engine.dealDamage(boss, t, 16_000, 'PHYSICAL', false, '冲锋');
        },
      },
      {
        id: 'herod_strike',
        name: '十字军打击',
        castTimeMs: 0,
        cooldownMs: 8000,
        lastCastMs: -2000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 80,
        targetKind: 'MELEE_TARGET',
        description: '坦打',
        execute: (boss, engine) => {
          if ((ai.herodWhirlwindMs || 0) > 0) return;
          const tank = living(engine).find((u: any) => u.role === 'TANK');
          if (tank) engine.dealDamage(boss, tank, 28_000, 'PHYSICAL', false, '十字军打击');
        },
      },
    ];
  },

  onTick(deltaMs, boss, engine, bossAiRaw) {
    const ai = bossAiRaw as HerodAiState;
    ai.herodFightMs = (ai.herodFightMs || 0) + deltaMs;

    if ((ai.herodWhirlwindMs || 0) > 0) {
      ai.herodWhirlwindMs = Math.max(0, (ai.herodWhirlwindMs || 0) - deltaMs);
      const zone = engine.effectsManager?.groundEffects?.find(e => e.id === ai.herodWhirlwindEffectId);
      if (zone && boss.position) {
        zone.x = boss.position.x;
        zone.y = boss.position.y;
      }
    }

    // 低血量时刷学徒潮（25% 血量触发，让坦克与团队真正交战清场）
    if (
      !ai.herodDeadApprentices &&
      boss.maxHp > 0 &&
      boss.hp / boss.maxHp <= 0.25 &&
      (boss.alive ?? boss.isAlive)
    ) {
      ai.herodDeadApprentices = true;
      const bPos = boss.position || { x: 500, y: 200 };
      for (let i = 0; i < 8; i++) {
        spawnCombatUnit(engine, {
          id: `trainee_${Date.now()}_${i}`,
          name: `血色学徒 ${i + 1}`,
          unitKind: 'ADD',
          role: 'ENEMY',
          classId: 'NPC',
          hp: 18_000,
          maxHp: 18_000,
          position: {
            x: bPos.x + Math.cos((i / 8) * Math.PI * 2) * 80,
            y: bPos.y + Math.sin((i / 8) * Math.PI * 2) * 60,
          },
          summonSpellId: SCARLET_TRAINEE_SUMMON,
        });
      }
      engine.effectsManager?.addFloatingText({
        targetId: boss.id,
        text: '⚔️ 血色学徒潮！群攻清场！',
        category: 'CRIT',
        isCrit: true,
      });
    }
  },
};
