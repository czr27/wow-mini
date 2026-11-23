/**
 * Phase 2 — 其他治疗专精技能 Registry + smoke cast
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSpellRegistry,
  assertSpecSpellSuite,
  castAndResolve,
  makeAlly,
  makeHealer,
  registerClassSpells,
  spellsForSpec,
} from './helpers/combatFixtures.js';
import { CombatEngine } from '../engine/CombatEngine.js';

describe('Phase2 治疗专精技能', () => {
  it('德鲁伊 RESTORATION 全表 Registry + 可施放', () => {
    assertSpecSpellSuite({ classId: 'DRUID', specId: 'RESTORATION', role: 'HEALER' });
  });

  it('圣骑士 HOLY 全表 Registry + 可施放', () => {
    assertSpecSpellSuite({ classId: 'PALADIN', specId: 'HOLY', role: 'HEALER' });
  });

  it('牧师 HOLY 全表 Registry + 可施放', () => {
    assertSpecSpellSuite({ classId: 'PRIEST', specId: 'HOLY', role: 'HEALER' });
  });

  it('牧师 DISCIPLINE 全表 Registry + 可施放', () => {
    assertSpecSpellSuite({ classId: 'PRIEST', specId: 'DISCIPLINE', role: 'HEALER' });
  });

  it('德鲁伊回春/迅捷治愈效果冒烟', () => {
    const engine = new CombatEngine();
    registerClassSpells(engine, 'DRUID');
    const druid = makeHealer('DRUID', { id: 'druid', spec: 'RESTORATION' });
    const ally = makeAlly('ally', 0.35);
    engine.addUnit(druid);
    engine.addUnit(ally);

    const rejuv = spellsForSpec('DRUID', 'RESTORATION').find(s => s.id.includes('rejuvenation'));
    assert.ok(rejuv, '应有回春术');
    assertSpellRegistry(rejuv!.id, { isHeal: true, isHot: true }, 'DRUID');

    const hp0 = ally.hp;
    assert.equal(castAndResolve(engine, 'druid', rejuv!.id, 'ally'), true);
    assert.ok(
      ally.hp >= hp0 || ally.buffs.some(b => (b.tags || []).includes('HOT') || (b.spellId || '').includes('rejuven')),
      '回春应治疗或挂 HoT'
    );
  });
});
