import { BossRegistry } from '../core/BossRegistry.js';
import { GlubtokEncounter } from './glubtok.js';
import { HelixEncounter } from './helix.js';
import { FoeReaperEncounter } from './foeReaper.js';
import { RipsnarlEncounter } from './ripsnarl.js';
import { CookieEncounter } from './cookie.js';
import { VanessaEncounter } from './vanessa.js';

export * from './glubtok.js';
export * from './helix.js';
export * from './foeReaper.js';
export * from './ripsnarl.js';
export * from './cookie.js';
export * from './vanessa.js';

export const DEADMINES_ENCOUNTERS = [
  GlubtokEncounter,
  HelixEncounter,
  FoeReaperEncounter,
  RipsnarlEncounter,
  CookieEncounter,
  VanessaEncounter,
];

export function registerDeadminesBosses(): void {
  BossRegistry.registerAll(DEADMINES_ENCOUNTERS);
}
