/**
 * Phase 3 — 坦克专精技能
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSpellRegistry,
  assertSpecSpellSuite,
  spellsForSpec,
} from './helpers/combatFixtures.js';

describe('Phase3 坦克专精技能', () => {
  it('死亡骑士 BLOOD 全表', () => {
    assertSpecSpellSuite({ classId: 'DK', specId: 'BLOOD', role: 'TANK' });
    const spells = spellsForSpec('DK', 'BLOOD');
    const taunt = spells.find(s => s.isTaunt || s.id.includes('dark_command') || s.id.includes('death_grip'));
    // taunt may or may not be labeled; at least have defensive/major tools
    assert.ok(spells.some(s => s.isDefensive || s.isMajorCd || s.isTaunt), '血DK应有减伤或嘲讽类技能');
    if (taunt) assertSpellRegistry(taunt.id, { classId: 'DK' }, 'DK');
  });

  it('战士 PROTECTION 全表', () => {
    assertSpecSpellSuite({ classId: 'WARRIOR', specId: 'PROTECTION', role: 'TANK' });
    const spells = spellsForSpec('WARRIOR', 'PROTECTION');
    assert.ok(spells.some(s => s.isTaunt || s.id.includes('taunt') || s.id.includes('challenging')), '防战应有嘲讽');
    assert.ok(spells.some(s => s.isDefensive || s.isMajorCd), '防战应有减伤大招');
  });

  it('圣骑士 PROTECTION 全表', () => {
    assertSpecSpellSuite({ classId: 'PALADIN', specId: 'PROTECTION', role: 'TANK' });
  });

  it('德鲁伊 FERAL（熊坦相关若并入）或有 GUARDIAN 则测 GUARDIAN', () => {
    const guardian = spellsForSpec('DRUID', 'GUARDIAN');
    if (guardian.length > 0) {
      assertSpecSpellSuite({ classId: 'DRUID', specId: 'GUARDIAN', role: 'TANK' });
    } else {
      // Cata 本仓库用 FERAL 兼顾猫/熊时，至少确保 FERAL 表存在
      assertSpecSpellSuite({ classId: 'DRUID', specId: 'FERAL', role: 'DPS' });
    }
  });
});
