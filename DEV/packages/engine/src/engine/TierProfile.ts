import { InstanceTierProfile } from '../types.js';

export const CATA_5H_346_PROFILE: InstanceTierProfile = {
  tierId: 'cata_5h_346',
  playerHpMult: 1.0,
  playerOutputMult: 1.0,
  bossHpMult: 1.0,
  bossDamageMult: 1.0,
  difficultyPressure: 1.0,
  tankBaseHp: 145000,
  dpsHealerBaseHp: 105000,
  baseDps: 15000,
  baseHps: 13500,
};

export const CATA_DS_397_PROFILE: InstanceTierProfile = {
  tierId: 'cata_ds_397',
  playerHpMult: 1.48,       // ~225k tank hp
  playerOutputMult: 2.26,   // ~34k base dps
  bossHpMult: 12.5,         // raid bosses 45m-95m
  bossDamageMult: 2.1,
  difficultyPressure: 1.2,
  tankBaseHp: 225000,
  dpsHealerBaseHp: 155000,
  baseDps: 34000,
  baseHps: 28000,
};

export function getTierProfile(tier: '5man' | '20man'): InstanceTierProfile {
  return tier === '20man' ? CATA_DS_397_PROFILE : CATA_5H_346_PROFILE;
}
