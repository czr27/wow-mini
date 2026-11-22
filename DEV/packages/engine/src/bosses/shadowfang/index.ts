import { BossRegistry } from '../core/BossRegistry.js';
import { AshburyEncounter } from './ashbury.js';
import { SilverlaineEncounter } from './silverlaine.js';
import { SpringvaleEncounter } from './springvale.js';
import { WaldenEncounter } from './walden.js';
import { GodfreyEncounter } from './godfrey.js';

export * from './ashbury.js';
export * from './silverlaine.js';
export * from './springvale.js';
export * from './walden.js';
export * from './godfrey.js';

export const SHADOWFANG_ENCOUNTERS = [
  AshburyEncounter,
  SilverlaineEncounter,
  SpringvaleEncounter,
  WaldenEncounter,
  GodfreyEncounter,
];

/** 自动注册影牙城堡全部首领个体特性 */
export function registerShadowfangBosses(): void {
  BossRegistry.registerAll(SHADOWFANG_ENCOUNTERS);
}
