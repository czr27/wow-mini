import { BossRegistry } from '../core/BossRegistry.js';
import { WilleyEncounter } from './willey.js';
import { BalnazzarEncounter } from './balnazzar.js';
import { RamsteinEncounter } from './ramstein.js';
import { RivendareEncounter } from './rivendare.js';

export * from './willey.js';
export * from './balnazzar.js';
export * from './ramstein.js';
export * from './rivendare.js';

export const STRATHOLME_ENCOUNTERS = [
  WilleyEncounter,
  BalnazzarEncounter,
  RamsteinEncounter,
  RivendareEncounter,
];

export function registerStratholmeBosses(): void {
  BossRegistry.registerAll(STRATHOLME_ENCOUNTERS);
}
