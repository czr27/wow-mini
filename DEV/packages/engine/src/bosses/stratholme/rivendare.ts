import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import { spawnCombatUnit } from '../../engine/UnitSpawn.js';

export const SKELETON_SUMMON = 'rivendare_skeleton';

export type RivendareAiState = {
  rivFightMs?: number;
  rivSkelAcc?: number;
  skills?: BossSkill[];
};

function living(engine: any) {
  return engine.friendlyUnits.filter((u: any) => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

export const RivendareEncounter: BossEncounterModule = {
  id: 'rivendare',
  name: '瑞文戴尔男爵',
  dungeonId: 'stratholme',
  tier: '5man',

  createSkills(): BossSkill[] {
    return [
      {
        id: 'shadow_strike',
        name: '暗影打击',
        castTimeMs: 0,
        cooldownMs: 10_000,
        lastCastMs: -3000,
        interruptible: false,
        school: 'SHADOW',
        range: 80,
        targetKind: 'MELEE_TARGET',
        description: '坦打；T 背对队伍',
        execute: (boss, engine) => {
          const tank = living(engine).find((u: any) => u.role === 'TANK');
          if (!tank) return;
          engine.dealDamage(boss, tank, 34_000, 'SHADOW', false, '暗影打击');
          // 锥形溅射：坦克身后的人
          const bPos = boss.position || { x: 500, y: 200 };
          const tPos = tank.position || { x: 480, y: 200 };
          const facing = Math.atan2(tPos.y - bPos.y, tPos.x - bPos.x);
          for (const u of living(engine)) {
            if (u.id === tank.id) continue;
            const dx = (u.position?.x || 0) - bPos.x;
            const dy = (u.position?.y || 0) - bPos.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 100 || dist < 1) continue;
            let diff = Math.atan2(dy, dx) - facing;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            if (Math.abs(diff) < (Math.PI / 180) * 30) {
              engine.dealDamage(boss, u, 18_000, 'SHADOW', false, '暗影打击溅射');
            }
          }
        },
      },
      {
        id: 'cleave',
        name: '顺劈斩',
        castTimeMs: 0,
        cooldownMs: 12_000,
        lastCastMs: -5000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 80,
        targetKind: 'MELEE_TARGET',
        description: '近战顺劈',
        execute: (boss, engine) => {
          const bPos = boss.position || { x: 500, y: 200 };
          for (const u of living(engine)) {
            const d = Math.hypot((u.position?.x || 0) - bPos.x, (u.position?.y || 0) - bPos.y);
            if (d <= 70) engine.dealDamage(boss, u, 16_000, 'PHYSICAL', false, '顺劈斩');
          }
        },
      },
      {
        id: 'summon_skeletons',
        name: '召唤骷髅',
        castTimeMs: 1500,
        cooldownMs: 25_000,
        lastCastMs: -10_000,
        interruptible: false,
        school: 'SHADOW',
        range: 400,
        targetKind: 'AOE',
        description: '召唤骷髅增援',
        execute: (boss, engine) => {
          const bPos = boss.position || { x: 500, y: 200 };
          for (let i = 0; i < 4; i++) {
            spawnCombatUnit(engine, {
              id: `skel_${Date.now()}_${i}`,
              name: `骷髅战士 ${i + 1}`,
              unitKind: 'ADD',
              role: 'ENEMY',
              classId: 'NPC',
              hp: 30_000,
              maxHp: 30_000,
              position: { x: bPos.x - 70 + i * 40, y: bPos.y + 55 },
              summonSpellId: SKELETON_SUMMON,
            });
          }
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '💀 骷髅增援！',
            category: 'STATUS',
            isCrit: true,
          });
        },
      },
    ];
  },

  onTick(deltaMs, _boss, _engine, bossAiRaw) {
    const ai = bossAiRaw as RivendareAiState;
    ai.rivFightMs = (ai.rivFightMs || 0) + deltaMs;
  },
};
