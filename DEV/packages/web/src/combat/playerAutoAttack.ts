import type { CombatEngine, Unit } from '@cata-raid-sim/engine';
import { AUTO_ATTACK_RANGE_PX, RANGE_40YD_PX } from '@cata-raid-sim/engine';
import { publishCastLand } from './castLifecycleNet.js';

export const PLAYER_AUTO_ATTACK_INTERVAL_TICKS = 40; // 2.0s at 20Hz
export const PET_AUTO_ATTACK_INTERVAL_TICKS = 48; // 2.4s at 20Hz

const MELEE_AUTO_CLASSES = new Set(['DK', 'ROGUE', 'WARRIOR', 'PALADIN']);

export interface TickPlayerAutoAttackParams {
  engine: CombatEngine;
  playerUnit: Unit | undefined;
  boss: Unit | undefined;
  tickCount: number;
  isAsphyxiateChannel: boolean;
  isPlayerCasting: boolean;
  lastPlayerAttackTickRef: { current: number };
  lastPetAttackTickRef: { current: number };
}

/**
 * Tick player & pet auto-attacks on an independent swing timer.
 * - Active skill casts/channels interrupt & reset the player's swing timer so auto-attacks
 *   only land in skill gaps without ever delaying or interfering with skill casting.
 * - Only logs/reports when resolveAttackHit actually lands damage (MISS/DODGE/PARRY are not reported).
 */
export function tickPlayerAndPetAutoAttacks(params: TickPlayerAutoAttackParams): void {
  const {
    engine,
    playerUnit,
    boss,
    tickCount,
    isAsphyxiateChannel,
    isPlayerCasting,
    lastPlayerAttackTickRef,
    lastPetAttackTickRef,
  } = params;

  if (!playerUnit || !(playerUnit.isAlive ?? playerUnit.alive)) return;
  if (!boss || !(boss.isAlive || boss.alive) || boss.hp <= 0 || isAsphyxiateChannel) return;

  // Casting or channeling a skill interrupts the auto-attack swing timer;
  // instant skills (GCD only) leave isPlayerCasting=false so swings land in skill gaps.
  if (isPlayerCasting) {
    lastPlayerAttackTickRef.current = tickCount;
  } else if (tickCount - lastPlayerAttackTickRef.current >= PLAYER_AUTO_ATTACK_INTERVAL_TICKS) {
    lastPlayerAttackTickRef.current = tickCount;
    const pX = playerUnit.position?.x ?? 180;
    const pY = playerUnit.position?.y ?? 190;
    const bX = boss.position?.x ?? 540;
    const bY = boss.position?.y ?? 190;
    const distToBoss = Math.hypot(bX - pX, bY - pY);

    // 普攻不分近战/远程：超出 5 码直接打不出
    if (distToBoss <= AUTO_ATTACK_RANGE_PX) {
      const isMeleeClass = MELEE_AUTO_CLASSES.has(playerUnit.classId);
      const isCrit = Math.random() < (playerUnit.stats?.critChance || 0.2);
      const baseAuto = isMeleeClass ? (isCrit ? 9000 : 4500) : (isCrit ? 4000 : 2000);
      const hitRes = engine.resolveAttackHit(playerUnit, boss, baseAuto, 'PHYSICAL', isCrit, '普通攻击');
      if (hitRes.damage > 0) {
        engine.logCombatAction({
          actorId: playerUnit.id,
          spellId: 'auto_attack',
          spellName: '普通攻击',
          kind: 'INSTANT',
          targetId: boss.id,
        });
        publishCastLand({
          unitId: playerUnit.id,
          spellId: 'auto_attack',
          spellName: '普通攻击',
          targetId: boss.id,
          isHarmful: true,
        });
      }
    }
  }

  // Player Pets (permanent pet + timed summons like Feral Spirit / Gargoyle)
  const playerPets = engine.friendlyUnits.filter(
    (u) => u.isPet && u.ownerId === playerUnit.id && (u.isAlive ?? u.alive)
  );
  if (playerPets.length > 0 && tickCount - lastPetAttackTickRef.current >= PET_AUTO_ATTACK_INTERVAL_TICKS) {
    lastPetAttackTickRef.current = tickCount;
    const bX = boss.position?.x ?? 540;
    const bY = boss.position?.y ?? 190;
    const isPetSkill = tickCount % 96 === 0;

    for (const playerPet of playerPets) {
      const petX = playerPet.position?.x ?? playerUnit.position?.x ?? 180;
      const petY = playerPet.position?.y ?? playerUnit.position?.y ?? 190;
      const petDist = Math.hypot(bX - petX, bY - petY);
      const petCrit = Math.random() < 0.25;
      const summonId = playerPet.summonSpellId;

      let petSpell: string;
      let spellId: string;
      let school: 'FROST' | 'SHADOW' | 'PHYSICAL';
      let petMaxRange: number;

      if (summonId === 'summon_gargoyle') {
        petSpell = '石像鬼打击';
        spellId = 'gargoyle_strike';
        school = 'SHADOW';
        petMaxRange = RANGE_40YD_PX;
      } else if (summonId === 'feral_spirit') {
        petSpell = isPetSkill ? '幽魂狼撕咬' : '普通攻击';
        spellId = isPetSkill ? 'spirit_bite' : 'auto_attack';
        school = 'PHYSICAL';
        petMaxRange = AUTO_ATTACK_RANGE_PX;
      } else {
        petSpell = isPetSkill ? (playerUnit.classId === 'MAGE' ? '水箭' : '爪击') : '普通攻击';
        spellId = isPetSkill ? (playerUnit.classId === 'MAGE' ? 'water_bolt' : 'claw') : 'auto_attack';
        school = playerUnit.classId === 'MAGE' && isPetSkill ? 'FROST' : 'PHYSICAL';
        // 宠物普攻同样 ≤5 码；水箭等宠物技能仍可用稍远距离（40 码）
        petMaxRange = petSpell === '普通攻击' ? AUTO_ATTACK_RANGE_PX : RANGE_40YD_PX;
      }

      if (petDist <= petMaxRange) {
        const isSkillDmg = isPetSkill || summonId === 'summon_gargoyle';
        const petDmg = isSkillDmg ? (petCrit ? 6000 : 3000) : (petCrit ? 3600 : 1800);
        const hitRes = engine.resolveAttackHit(playerPet, boss, petDmg, school, petCrit, petSpell);
        if (hitRes.damage > 0) {
          engine.logCombatAction({
            actorId: playerPet.id,
            spellId,
            spellName: petSpell,
            kind: 'INSTANT',
            targetId: boss.id,
          });
          publishCastLand({
            unitId: playerPet.id,
            spellId,
            spellName: petSpell,
            targetId: boss.id,
            isHarmful: true,
          });
        }
      }
    }
  }
}
