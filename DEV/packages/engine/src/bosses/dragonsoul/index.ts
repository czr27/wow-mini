import { BossRegistry } from '../core/BossRegistry.js';
import { MorchokEncounter } from './morchok.js';
import { UltraxionEncounter } from './ultraxion.js';
import { HagaraEncounter } from './hagara.js';
import { ZonozzEncounter } from './zonozz.js';
import { YorsahjEncounter } from './yorsahj.js';
import { BlackhornEncounter } from './blackhorn.js';
import { SpineEncounter } from './spine.js';
import { MadnessEncounter } from './madness.js';
import { createDragonSoulGenericEncounter } from './generic.js';

export * from './morchok.js';
export * from './ultraxion.js';
export * from './hagara.js';
export * from './zonozz.js';
export * from './yorsahj.js';
export * from './blackhorn.js';
export * from './spine.js';
export * from './madness.js';
export * from './generic.js';

export const DRAGON_SOUL_ENCOUNTERS = [
  MorchokEncounter,
  ZonozzEncounter,
  YorsahjEncounter,
  HagaraEncounter,
  UltraxionEncounter,
  BlackhornEncounter,
  SpineEncounter,
  MadnessEncounter,
];

/** 自动注册巨龙之魂全部首领个体特性 */
export function registerDragonSoulBosses(): void {
  BossRegistry.registerAll(DRAGON_SOUL_ENCOUNTERS);
}

/** @deprecated generic 仅作后备；正式列表已全部专属 */
export { createDragonSoulGenericEncounter };
