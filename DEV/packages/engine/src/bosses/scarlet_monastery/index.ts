import { BossRegistry } from '../core/BossRegistry.js';
import { VishasEncounter } from './vishas.js';
import { ThalnorenEncounter } from './thalnoren.js';
import { LokseyEncounter } from './loksey.js';
import { DoanEncounter } from './doan.js';
import { HerodEncounter } from './herod.js';
import { MograineWhitemaneEncounter } from './mograineWhitemane.js';

export * from './vishas.js';
export * from './thalnoren.js';
export * from './loksey.js';
export * from './doan.js';
export * from './herod.js';
export * from './mograineWhitemane.js';

export const SCARLET_MONASTERY_ENCOUNTERS = [
  VishasEncounter,
  ThalnorenEncounter,
  LokseyEncounter,
  DoanEncounter,
  HerodEncounter,
  MograineWhitemaneEncounter,
];

export function registerScarletMonasteryBosses(): void {
  BossRegistry.registerAll(SCARLET_MONASTERY_ENCOUNTERS);
}
