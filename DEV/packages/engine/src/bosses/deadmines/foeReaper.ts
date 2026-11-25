import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import type { CombatEngine } from '../../engine/CombatEngine.js';
import type { Unit } from '../../types.js';
import { spawnCombatUnit } from '../../engine/UnitSpawn.js';

export const MOLTEN_SLAG_SUMMON = 'foe_reaper_molten_slag';

export type FoeReaperAiState = {
  foeFightMs?: number;
  foeEnraged?: boolean;
  foeOverdriveAcc?: number;
  foeSlagAcc?: number;
  foeHarvestAngle?: number;
  foeHarvestResolveAt?: number;
  foeOverdriveEffectId?: string;
  skills?: BossSkill[];
};

function living(engine: CombatEngine): Unit[] {
  return engine.friendlyUnits.filter(u => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

function inCone(
  bossPos: { x: number; y: number },
  targetPos: { x: number; y: number },
  facingRad: number,
  halfAngleRad: number,
  maxRange: number,
): boolean {
  const dx = targetPos.x - bossPos.x;
  const dy = targetPos.y - bossPos.y;
  const dist = Math.hypot(dx, dy);
  if (dist > maxRange || dist < 1) return dist < 1;
  const ang = Math.atan2(dy, dx);
  let diff = ang - facingRad;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return Math.abs(diff) <= halfAngleRad;
}

export const FoeReaperEncounter: BossEncounterModule = {
  id: 'foe_reaper',
  name: '死神 5000',
  dungeonId: 'deadmines',
  tier: '5man',

  createSkills(bossAi: any): BossSkill[] {
    const ai = bossAi as FoeReaperAiState;
    return [
      {
        id: 'harvest',
        name: '收割',
        castTimeMs: 2500,
        cooldownMs: 14_000,
        lastCastMs: -4000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 200,
        targetKind: 'AOE',
        description: '正面锥形收割；远离行进路线',
        dbm: {
          advice: '远离Boss旋风收割',
          voiceText: '远离boss',
          severity: 'WARN',
        },
        execute: (boss, engine) => {
          const bPos = boss.position || { x: 500, y: 200 };
          const tank = living(engine).find(u => u.role === 'TANK');
          const facing = tank
            ? Math.atan2((tank.position?.y || 0) - bPos.y, (tank.position?.x || 0) - bPos.x)
            : ai.foeHarvestAngle || 0;
          ai.foeHarvestAngle = facing;
          const coneAngle = (Math.PI / 180) * 70; // ±35°
          engine.effectsManager?.addGroundEffect({
            kind: 'CONE_WARNING',
            spellId: 'harvest',
            ownerId: boss.id,
            x: bPos.x,
            y: bPos.y,
            radius: 140,
            colorHex: '#EF4444',
            remainingMs: 800,
            facingRad: facing,
            coneAngleRad: coneAngle,
          });
          ai.foeHarvestResolveAt = engine.nowMs + 800;
        },
      },
      {
        id: 'overdrive',
        name: '过载',
        castTimeMs: 1500,
        cooldownMs: 28_000,
        lastCastMs: -12_000,
        interruptible: false,
        school: 'FIRE',
        range: 360,
        targetKind: 'AOE',
        description: '过载乱跑：靠近 Boss 持续受伤',
        dbm: {
          advice: '过载乱跑，远离Boss路径',
          voiceText: '远离boss',
          severity: 'WARN',
        },
        execute: (boss, engine) => {
          ai.foeOverdriveAcc = 6000;
          const bPos = boss.position || { x: 500, y: 200 };
          const ge = engine.effectsManager?.addGroundEffect({
            kind: 'DAMAGE_ZONE',
            spellId: 'overdrive',
            ownerId: boss.id,
            x: bPos.x,
            y: bPos.y,
            radius: 70,
            colorHex: '#F97316',
            remainingMs: 6000,
            tickIntervalMs: 1000,
            tickValue: 14_000,
          });
          ai.foeOverdriveEffectId = ge?.id;
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '⚙️ 过载！远离死神路径！',
            category: 'CRIT',
            isCrit: true,
          });
        },
      },
      {
        id: 'reaper_strike',
        name: '收割打击',
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
          const mult = ai.foeEnraged ? 2 : 1;
          if (tank) engine.dealDamage(boss, tank, Math.round(30_000 * mult), 'PHYSICAL', false, '收割打击');
        },
      },
    ];
  },

  onTick(deltaMs, boss, engine, bossAiRaw) {
    const ai = bossAiRaw as FoeReaperAiState;
    ai.foeFightMs = (ai.foeFightMs || 0) + deltaMs;

    if (!ai.foeEnraged && boss.maxHp > 0 && boss.hp / boss.maxHp <= 0.3) {
      ai.foeEnraged = true;
      engine.effectsManager?.addFloatingText({
        targetId: boss.id,
        text: '⚠️ 安全限制解除！伤害翻倍！',
        category: 'CRIT',
        isCrit: true,
      });
    }

    if (ai.foeHarvestResolveAt != null && engine.nowMs >= ai.foeHarvestResolveAt) {
      ai.foeHarvestResolveAt = undefined;
      const bPos = boss.position || { x: 500, y: 200 };
      const facing = ai.foeHarvestAngle || 0;
      const mult = ai.foeEnraged ? 2 : 1;
      for (const u of living(engine)) {
        const tPos = u.position || { x: 0, y: 0 };
        if (inCone(bPos, tPos, facing, (Math.PI / 180) * 35, 140)) {
          engine.dealDamage(boss, u, Math.round(32_000 * mult), 'PHYSICAL', true, '收割');
        }
      }
    }

    if ((ai.foeOverdriveAcc || 0) > 0) {
      ai.foeOverdriveAcc = Math.max(0, (ai.foeOverdriveAcc || 0) - deltaMs);
      const bPos = boss.position || { x: 500, y: 200 };
      // 轻微位移模拟乱跑
      boss.position = {
        x: bPos.x + Math.sin((ai.foeFightMs || 0) / 200) * 3,
        y: bPos.y + Math.cos((ai.foeFightMs || 0) / 180) * 3,
      };
      const zone = engine.effectsManager?.groundEffects?.find(e => e.id === ai.foeOverdriveEffectId);
      if (zone && boss.position) {
        zone.x = boss.position.x;
        zone.y = boss.position.y;
      }
    }

    ai.foeSlagAcc = (ai.foeSlagAcc || 0) + deltaMs;
    if ((ai.foeSlagAcc || 0) >= 20_000) {
      ai.foeSlagAcc = 0;
      const bPos = boss.position || { x: 500, y: 200 };
      spawnCombatUnit(engine, {
        id: `slag_${Date.now()}`,
        name: '熔渣',
        unitKind: 'ADD',
        role: 'ENEMY',
        classId: 'NPC',
        hp: 45_000,
        maxHp: 45_000,
        position: { x: bPos.x - 60, y: bPos.y + 40 },
        summonSpellId: MOLTEN_SLAG_SUMMON,
      });
      engine.effectsManager?.addFloatingText({
        targetId: boss.id,
        text: '🌋 熔渣出现！优先清理！',
        category: 'STATUS',
        isCrit: false,
      });
    }
  },
};
