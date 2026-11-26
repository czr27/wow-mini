import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import { spawnCombatUnit } from '../../engine/UnitSpawn.js';

export const HUNTING_HOUND_SUMMON = 'loksey_hunting_hound';

function living(engine: any) {
  return engine.friendlyUnits.filter((u: any) => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

export const LokseyEncounter: BossEncounterModule = {
  id: 'loksey',
  name: '驯犬者洛克希',
  dungeonId: 'scarlet_monastery',
  tier: '5man',
  createSkills(bossAi: any): BossSkill[] {
    return [
      {
        id: 'battle_shout',
        name: '战斗怒吼',
        castTimeMs: 0,
        cooldownMs: 20_000,
        lastCastMs: -15_000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 80,
        targetKind: 'SELF',
        description: '自身与猎犬增伤',
        execute: (boss, engine) => {
          engine.applyBuff(boss, {
            id: `bs_${Date.now()}`,
            spellId: 'loksey_battle_shout',
            name: '战斗怒吼',
            kind: 'BUFF',
            tags: ['STAT'],
            sourceUnitId: boss.id,
            targetUnitId: boss.id,
            durationMs: 15_000,
            remainingMs: 15_000,
            stacks: 1,
            maxStacks: 1,
          });
          bossAi._lokseyShout = true;
        },
      },
      {
        id: 'loksey_strike',
        name: '驯犬打击',
        castTimeMs: 0,
        cooldownMs: 9000,
        lastCastMs: -2000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 80,
        targetKind: 'MELEE_TARGET',
        description: '坦打',
        execute: (boss, engine) => {
          const tank = living(engine).find((u: any) => u.role === 'TANK');
          const mult = bossAi._lokseyShout ? 1.25 : 1;
          if (tank) engine.dealDamage(boss, tank, Math.round(26_000 * mult), 'PHYSICAL', false, '驯犬打击');
        },
      },
    ];
  },
  onTick(_deltaMs, boss, engine, bossAi: any) {
    if (bossAi._lokseyDogsSeeded) return;
    bossAi._lokseyDogsSeeded = true;
    const bPos = boss.position || { x: 500, y: 200 };
    for (let i = 0; i < 4; i++) {
      spawnCombatUnit(engine, {
        id: `hound_${Date.now()}_${i}`,
        name: '猎犬',
        unitKind: 'ADD',
        role: 'ENEMY',
        classId: 'NPC',
        hp: 28_000,
        maxHp: 28_000,
        position: { x: bPos.x - 50 + i * 30, y: bPos.y + 40 },
        summonSpellId: HUNTING_HOUND_SUMMON,
      });
    }
    engine.effectsManager?.addFloatingText({
      targetId: boss.id,
      text: '🐕 猎犬出击！可与 Boss 一并击杀',
      category: 'STATUS',
      isCrit: false,
    });
  },
};
