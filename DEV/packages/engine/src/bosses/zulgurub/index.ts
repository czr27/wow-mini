import { BossRegistry } from '../core/BossRegistry.js';
import { VenoxisEncounter } from './venoxis.js';
import { MandokirEncounter } from './mandokir.js';
import { KilnaraEncounter } from './kilnara.js';
import { ZanzilEncounter } from './zanzil.js';
import { JindoEncounter } from './jindo.js';

export * from './venoxis.js';
export * from './mandokir.js';
export * from './kilnara.js';
export * from './zanzil.js';
export * from './jindo.js';

export const ZULGURUB_ENCOUNTERS = [
  VenoxisEncounter,
  MandokirEncounter,
  KilnaraEncounter,
  ZanzilEncounter,
  JindoEncounter,
];

export function registerZulgurubBosses(): void {
  BossRegistry.registerAll(ZULGURUB_ENCOUNTERS);
}
