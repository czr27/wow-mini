/**
 * Phase 4 — 近战 DPS 专精技能
 */
import { describe, it } from 'node:test';
import { assertSpecSpellSuite } from './helpers/combatFixtures.js';

describe('Phase4 近战 DPS 专精技能', () => {
  it('萨满 ENHANCEMENT', () => {
    assertSpecSpellSuite({ classId: 'SHAMAN', specId: 'ENHANCEMENT', role: 'DPS' });
  });

  it('盗贼 COMBAT / ASSASSINATION / SUBTLETY', () => {
    assertSpecSpellSuite({ classId: 'ROGUE', specId: 'COMBAT', role: 'DPS' });
    assertSpecSpellSuite({ classId: 'ROGUE', specId: 'ASSASSINATION', role: 'DPS' });
    assertSpecSpellSuite({ classId: 'ROGUE', specId: 'SUBTLETY', role: 'DPS' });
  });

  it('战士 ARMS / FURY', () => {
    assertSpecSpellSuite({ classId: 'WARRIOR', specId: 'ARMS', role: 'DPS' });
    assertSpecSpellSuite({ classId: 'WARRIOR', specId: 'FURY', role: 'DPS' });
  });

  it('圣骑士 RETRIBUTION', () => {
    assertSpecSpellSuite({ classId: 'PALADIN', specId: 'RETRIBUTION', role: 'DPS' });
  });

  it('死亡骑士 FROST / UNHOLY', () => {
    assertSpecSpellSuite({ classId: 'DK', specId: 'FROST', role: 'DPS' });
    assertSpecSpellSuite({ classId: 'DK', specId: 'UNHOLY', role: 'DPS' });
  });

  it('德鲁伊 FERAL', () => {
    assertSpecSpellSuite({ classId: 'DRUID', specId: 'FERAL', role: 'DPS' });
  });
});
