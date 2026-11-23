import type { BossEncounterModule, BossSkill } from './BossTypes.js';

/**
 * 五人本轻量专属壳：坦打 + 全团脉冲，供尚未细化机制的 Boss 进本可打。
 */
export function createFiveManShellEncounter(
  dungeonId: string,
  bossId: string,
  bossName: string,
  opts?: { pulseName?: string; pulseSchool?: BossSkill['school']; pulseDmg?: number; tankDmg?: number },
): BossEncounterModule {
  const pulseName = opts?.pulseName ?? `${bossName}威压`;
  const pulseSchool = opts?.pulseSchool ?? 'SHADOW';
  const pulseDmg = opts?.pulseDmg ?? 14_000;
  const tankDmg = opts?.tankDmg ?? 28_000;

  return {
    id: bossId,
    name: bossName,
    dungeonId,
    tier: '5man',
    createSkills(): BossSkill[] {
      return [
        {
          id: `${bossId}_pulse`,
          name: pulseName,
          castTimeMs: 1500,
          cooldownMs: 12_000,
          lastCastMs: -4000,
          interruptible: false,
          school: pulseSchool,
          range: 360,
          targetKind: 'AOE',
          description: `${pulseName}：全队脉冲伤害`,
          execute: (boss, engine) => {
            for (const u of engine.friendlyUnits) {
              if (!(u.alive ?? u.isAlive) || (u.hp ?? 0) <= 0) continue;
              engine.dealDamage(boss, u, pulseDmg, pulseSchool, false, pulseName);
            }
          },
        },
        {
          id: `${bossId}_strike`,
          name: `${bossName}重击`,
          castTimeMs: 0,
          cooldownMs: 10_000,
          lastCastMs: -3000,
          interruptible: false,
          school: 'PHYSICAL',
          range: 80,
          targetKind: 'MELEE_TARGET',
          description: '对主坦物理重击',
          execute: (boss, engine) => {
            const tank = engine.friendlyUnits.find(u => (u.alive ?? u.isAlive) && u.role === 'TANK');
            if (tank) engine.dealDamage(boss, tank, tankDmg, 'PHYSICAL', false, `${bossName}重击`);
          },
        },
      ];
    },
  };
}
