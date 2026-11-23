/**
 * Phase 5 — 远程 DPS 专精技能
 */
import { describe, it } from 'node:test';
import { assertSpecSpellSuite } from './helpers/combatFixtures.js';

describe('Phase5 远程 DPS 专精技能', () => {
  it('萨满 ELEMENTAL', () => {
    assertSpecSpellSuite({ classId: 'SHAMAN', specId: 'ELEMENTAL', role: 'DPS' });
  });

  it('德鲁伊 BALANCE', () => {
    assertSpecSpellSuite({ classId: 'DRUID', specId: 'BALANCE', role: 'DPS' });
  });

  it('法师 FIRE / FROST / ARCANE', () => {
    assertSpecSpellSuite({ classId: 'MAGE', specId: 'FIRE', role: 'DPS' });
    assertSpecSpellSuite({ classId: 'MAGE', specId: 'FROST', role: 'DPS' });
    assertSpecSpellSuite({ classId: 'MAGE', specId: 'ARCANE', role: 'DPS' });
  });

  it('术士 AFFLICTION / DEMONOLOGY / DESTRUCTION', () => {
    assertSpecSpellSuite({ classId: 'WARLOCK', specId: 'AFFLICTION', role: 'DPS' });
    assertSpecSpellSuite({ classId: 'WARLOCK', specId: 'DEMONOLOGY', role: 'DPS' });
    assertSpecSpellSuite({ classId: 'WARLOCK', specId: 'DESTRUCTION', role: 'DPS' });
  });

  it('猎人 BEAST_MASTERY / MARKSMANSHIP / SURVIVAL', () => {
    assertSpecSpellSuite({ classId: 'HUNTER', specId: 'BEAST_MASTERY', role: 'DPS' });
    assertSpecSpellSuite({ classId: 'HUNTER', specId: 'MARKSMANSHIP', role: 'DPS' });
    assertSpecSpellSuite({ classId: 'HUNTER', specId: 'SURVIVAL', role: 'DPS' });
  });

  it('牧师 SHADOW', () => {
    assertSpecSpellSuite({ classId: 'PRIEST', specId: 'SHADOW', role: 'DPS' });
  });
});
