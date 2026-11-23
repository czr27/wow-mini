import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import type { CombatEngine } from '../../engine/CombatEngine.js';
import type { Unit } from '../../types.js';
import { spawnCombatUnit } from '../../engine/UnitSpawn.js';

export type BloodColor = 'red' | 'green' | 'yellow' | 'blue' | 'purple' | 'black';

export const BLOOD_SUMMON_PREFIX = 'yorsahj_blood_';

export type YorsahjAiState = {
  yorsahjFightMs?: number;
  yorsahjFuseAt?: number;
  yorsahjPendingColors?: BloodColor[];
  yorsahjSoftEnrage?: number;
  skills?: BossSkill[];
};

const COLOR_META: Record<
  BloodColor,
  { name: string; hex: string }
> = {
  red: { name: '血红', hex: '#EF4444' },
  green: { name: '酸绿', hex: '#22C55E' },
  yellow: { name: '暗黄', hex: '#EAB308' },
  blue: { name: '钴蓝', hex: '#3B82F6' },
  purple: { name: '暗紫', hex: '#A855F7' },
  black: { name: '深黑', hex: '#1F2937' },
};

const ALL_COLORS: BloodColor[] = ['red', 'green', 'yellow', 'blue', 'purple', 'black'];

function living(engine: CombatEngine): Unit[] {
  return engine.friendlyUnits.filter(u => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

function pickColors(count: number): BloodColor[] {
  const shuffled = [...ALL_COLORS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function applyFuseEffects(boss: Unit, engine: CombatEngine, colors: BloodColor[], ai: YorsahjAiState) {
  const fri = living(engine);
  for (const c of colors) {
    switch (c) {
      case 'red':
        for (const u of fri) engine.dealDamage(boss, u, 22_000, 'FIRE', false, '血红融合');
        break;
      case 'green':
        engine.healUnit(boss, boss, Math.round(boss.maxHp * 0.03), false, '酸绿融合');
        break;
      case 'yellow':
        for (const u of fri) {
          if (u.maxMp && u.mp != null) u.mp = Math.max(0, u.mp - Math.round(u.maxMp * 0.15));
          engine.dealDamage(boss, u, 10_000, 'NATURE', false, '暗黄融合');
        }
        break;
      case 'blue':
        for (const u of fri) {
          if (u.maxMp && u.mp != null) u.mp = Math.max(0, u.mp - Math.round(u.maxMp * 0.2));
        }
        break;
      case 'purple':
        for (const u of fri.filter(x => x.role !== 'TANK').slice(0, 2)) {
          engine.applyBuff(u, {
            id: `mind_${Date.now()}_${u.id}`,
            spellId: 'yorsahj_mind_control',
            name: '精神控制(简化)',
            kind: 'DEBUFF',
            tags: ['STUN', 'DEBUFF'],
            sourceUnitId: boss.id,
            targetUnitId: u.id,
            durationMs: 4000,
            remainingMs: 4000,
            stacks: 1,
            maxStacks: 1,
            school: 'SHADOW',
          });
        }
        break;
      case 'black':
        ai.yorsahjSoftEnrage = (ai.yorsahjSoftEnrage || 0) + 1;
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
          text: `🖤 深黑融合！软狂暴 ${(ai.yorsahjSoftEnrage || 0)}`,
          category: 'CRIT',
          isCrit: true,
        });
        break;
    }
  }
  engine.effectsManager?.addFloatingText({
    targetId: boss.id,
    text: `🩸 血滴融合：${colors.map(c => COLOR_META[c].name).join('+')}`,
    category: 'STATUS',
    isCrit: true,
  });
}

/**
 * 不眠的约萨希：多色血滴；存活者抵达后融合触发机制
 */
export const YorsahjEncounter: BossEncounterModule = {
  id: 'yorsahj',
  name: '不眠的约萨希',
  dungeonId: 'dragon_soul',
  tier: '20man',

  createSkills(bossAi: any): BossSkill[] {
    const ai = bossAi as YorsahjAiState;
    return [
      {
        id: 'digestive_acid',
        name: '消化酸液',
        castTimeMs: 1500,
        cooldownMs: 12_000,
        lastCastMs: -4000,
        interruptible: false,
        school: 'NATURE',
        range: 360,
        targetKind: 'AOE',
        description: '基础全团酸液伤害（受软狂暴加成）',
        execute: (boss, engine) => {
          const mult = 1 + 0.15 * (ai.yorsahjSoftEnrage || 0);
          for (const u of living(engine)) {
            engine.dealDamage(boss, u, Math.round(12_000 * mult), 'NATURE', false, '消化酸液');
          }
        },
      },
      {
        id: 'call_blood',
        name: '召唤血滴',
        castTimeMs: 2000,
        cooldownMs: 40_000,
        lastCastMs: -5_000,
        interruptible: false,
        school: 'SHADOW',
        range: 400,
        targetKind: 'AOE',
        description: '召唤多色血滴；未击杀者将融合触发对应机制',
        execute: (boss, engine) => {
          // 清理上一波残留
          for (const e of engine.enemyUnits) {
            if (e.summonSpellId?.startsWith(BLOOD_SUMMON_PREFIX)) {
              e.hp = 0;
              e.alive = false;
              e.isAlive = false;
            }
          }
          const count = living(engine).length >= 15 ? 4 : 3;
          const colors = pickColors(count);
          ai.yorsahjPendingColors = colors;
          ai.yorsahjFuseAt = (ai.yorsahjFightMs || 0) + 12_000;
          const bPos = boss.position || { x: 500, y: 200 };
          const hp = living(engine).length >= 15 ? 140_000 : 45_000;
          colors.forEach((c, i) => {
            const meta = COLOR_META[c];
            spawnCombatUnit(engine, {
              id: `blood_${c}_${Date.now()}_${i}`,
              name: `${meta.name}血滴`,
              unitKind: 'ADD',
              role: 'ENEMY',
              classId: 'NPC',
              hp,
              maxHp: hp,
              position: {
                x: bPos.x + Math.cos((i / colors.length) * Math.PI * 2) * 140,
                y: bPos.y + Math.sin((i / colors.length) * Math.PI * 2) * 90,
              },
              summonSpellId: `${BLOOD_SUMMON_PREFIX}${c}`,
            });
            engine.effectsManager?.addFloatingText({
              targetId: boss.id,
              text: `🩸 ${meta.name}`,
              category: 'STATUS',
              isCrit: false,
            });
          });
        },
      },
      {
        id: 'searing_blood',
        name: '灼热之血',
        castTimeMs: 0,
        cooldownMs: 16_000,
        lastCastMs: -6000,
        interruptible: false,
        school: 'FIRE',
        range: 80,
        targetKind: 'MELEE_TARGET',
        description: '坦打',
        execute: (boss, engine) => {
          const tank = living(engine).find(u => u.role === 'TANK');
          if (tank) {
            const mult = 1 + 0.1 * (ai.yorsahjSoftEnrage || 0);
            engine.dealDamage(boss, tank, Math.round(34_000 * mult), 'FIRE', false, '灼热之血');
          }
        },
      },
    ];
  },

  onTick(deltaMs, boss, engine, bossAiRaw) {
    const ai = bossAiRaw as YorsahjAiState;
    ai.yorsahjFightMs = (ai.yorsahjFightMs || 0) + deltaMs;

    if (ai.yorsahjFuseAt != null && (ai.yorsahjFightMs || 0) >= ai.yorsahjFuseAt) {
      const aliveColors: BloodColor[] = [];
      for (const e of engine.enemyUnits) {
        if (!(e.alive ?? e.isAlive) || (e.hp ?? 0) <= 0) continue;
        if (!e.summonSpellId?.startsWith(BLOOD_SUMMON_PREFIX)) continue;
        const c = e.summonSpellId.slice(BLOOD_SUMMON_PREFIX.length) as BloodColor;
        if (COLOR_META[c]) aliveColors.push(c);
        e.hp = 0;
        e.alive = false;
        e.isAlive = false;
      }
      if (aliveColors.length > 0) {
        applyFuseEffects(boss, engine, aliveColors, ai);
      } else {
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
          text: '✅ 血滴已全部击杀，无融合',
          category: 'STATUS',
          isCrit: false,
        });
      }
      ai.yorsahjFuseAt = undefined;
      ai.yorsahjPendingColors = undefined;
    }
  },
};
