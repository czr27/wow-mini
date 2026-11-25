import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import type { CombatEngine } from '../../engine/CombatEngine.js';
import type { Unit } from '../../types.js';

export type CookieAiState = {
  cookieFightMs?: number;
  cookieFoodAcc?: number;
  skills?: BossSkill[];
};

function living(engine: CombatEngine): Unit[] {
  return engine.friendlyUnits.filter(u => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

export const CookieEncounter: BossEncounterModule = {
  id: 'cookie',
  name: '曲奇',
  dungeonId: 'deadmines',
  tier: '5man',

  createSkills(): BossSkill[] {
    return [
      {
        id: 'cookie_cleave',
        name: '厨刀横扫',
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
          if (tank) engine.dealDamage(boss, tank, 26_000, 'PHYSICAL', false, '厨刀横扫');
        },
      },
      {
        id: 'throw_food',
        name: '抛掷食物',
        castTimeMs: 1200,
        cooldownMs: 8000,
        lastCastMs: -2000,
        interruptible: false,
        school: 'NATURE',
        range: 360,
        targetKind: 'AOE',
        description: '抛出好/坏食物落点；坏食物躲开，好食物可踩',
        dbm: {
          advice: '吃绿色好食物，避开腐烂食物',
          voiceText: '吃好食物',
          severity: 'INFO',
          preWarnMs: 0,
        },
        execute: (boss, engine) => {
          const fri = living(engine);
          for (let i = 0; i < 2; i++) {
            const t = fri[Math.floor(Math.random() * Math.max(1, fri.length))];
            const pos = t?.position || { x: 400 + i * 40, y: 220 };
            const isGood = Math.random() < 0.4;
            if (isGood) {
              engine.effectsManager?.addGroundEffect({
                kind: 'HEAL_ZONE',
                spellId: 'cookie_good_food',
                ownerId: boss.id,
                x: pos.x + (Math.random() - 0.5) * 60,
                y: pos.y + (Math.random() - 0.5) * 40,
                radius: 35,
                colorHex: '#4ADE80',
                remainingMs: 8000,
                tickIntervalMs: 1000,
                tickValue: 4000,
              });
            } else {
              engine.effectsManager?.addGroundEffect({
                kind: 'DAMAGE_ZONE',
                spellId: 'cookie_bad_food',
                ownerId: boss.id,
                x: pos.x + (Math.random() - 0.5) * 60,
                y: pos.y + (Math.random() - 0.5) * 40,
                radius: 35,
                colorHex: '#A855F7',
                remainingMs: 8000,
                tickIntervalMs: 1000,
                tickValue: 11_000,
              });
            }
          }
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '🍲 食物落地！绿好紫坏！',
            category: 'STATUS',
            isCrit: false,
          });
        },
      },
    ];
  },

  onTick(deltaMs, _boss, _engine, bossAiRaw) {
    const ai = bossAiRaw as CookieAiState;
    ai.cookieFightMs = (ai.cookieFightMs || 0) + deltaMs;
  },
};
