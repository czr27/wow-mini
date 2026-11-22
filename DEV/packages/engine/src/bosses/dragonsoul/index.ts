import { BossRegistry } from '../core/BossRegistry.js';
import { MorchokEncounter } from './morchok.js';
import { UltraxionEncounter } from './ultraxion.js';
import { createDragonSoulGenericEncounter } from './generic.js';

export * from './morchok.js';
export * from './ultraxion.js';
export * from './generic.js';

export const DRAGON_SOUL_ENCOUNTERS = [
  MorchokEncounter,
  createDragonSoulGenericEncounter('zonozz', '督军佐诺兹'),
  createDragonSoulGenericEncounter('yorsahj', '不眠的约萨希'),
  createDragonSoulGenericEncounter('hagara', '缚风者哈甲拉'),
  UltraxionEncounter,
  createDragonSoulGenericEncounter('blackhorn', '战争领主黑角'),
  createDragonSoulGenericEncounter('spine', '死亡之翼的背脊'),
  createDragonSoulGenericEncounter('madness', '死亡之翼的疯狂'),
];

/** 自动注册巨龙之魂全部首领个体特性 */
export function registerDragonSoulBosses(): void {
  BossRegistry.registerAll(DRAGON_SOUL_ENCOUNTERS);
}
