/**
 * Class-color feathered AoE pulse ingest / color.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BOSS_AOE_PULSE_COLOR,
  CLASS_AOE_PULSE_HALF_WIDTH_PX,
  CLASS_AOE_PULSE_PEAK_ALPHA,
  createClassAoePulseState,
  ingestCombatActionsAsClassAoePulses,
  pruneClassAoePulses,
  resolveClassAoePulseColor,
  resolveClassAoePulseRadius,
} from '../combatClassAoePulse.js';
import { BOSS_HIT_FX_COLOR } from '../combatHitFx.js';
import type { NetworkCombatAction, Unit } from '@cata-raid-sim/engine';

function unit(partial: Partial<Unit> & Pick<Unit, 'id' | 'name' | 'classId' | 'role'>): Unit {
  return {
    isPlayer: false,
    isAlive: true,
    alive: true,
    hp: 10000,
    maxHp: 10000,
    absorb: 0,
    resources: [],
    buffs: [],
    threatTable: [],
    position: { x: 100, y: 100 },
    stats: {
      attackPower: 500,
      spellPower: 500,
      critChance: 0.1,
      haste: 0.1,
      armor: 100,
      spellResist: 0,
      block: 0,
      parry: 0,
      dodge: 0.05,
      mastery: 0.1,
      versatility: 0,
      speed: 0,
    },
    ...partial,
  } as Unit;
}

describe('combatClassAoePulse', () => {
  it('玩家用职业色；boss 用亮红；与 hitFx boss 色一致；不透明度提高', () => {
    const druid = unit({ id: 'd1', name: '德', classId: 'DRUID', role: 'DPS' });
    const boss = unit({
      id: 'b1',
      name: 'Boss',
      classId: 'BOSS',
      role: 'ENEMY',
      unitKind: 'BOSS',
    });
    assert.equal(resolveClassAoePulseColor(druid), '#FF7D0A');
    assert.equal(resolveClassAoePulseColor(boss), BOSS_AOE_PULSE_COLOR);
    assert.equal(BOSS_AOE_PULSE_COLOR, '#EF4444');
    assert.equal(BOSS_HIT_FX_COLOR, '#EF4444');
    assert.ok(CLASS_AOE_PULSE_PEAK_ALPHA >= 0.6);
    assert.equal(resolveClassAoePulseRadius(druid), CLASS_AOE_PULSE_HALF_WIDTH_PX);
  });

  it('aoePulse 光环用释放者半宽，忽略技能码数；同 id 不重复；prune 清理', () => {
    const mage = unit({ id: 'm1', name: '法', classId: 'MAGE', role: 'DPS' });
    const map = new Map<string, Unit>([[mage.id, mage]]);
    const state = createClassAoePulseState();
    const seen = new Set<string>();
    const now = 1000;
    const action: NetworkCombatAction = {
      id: 'aoe1',
      atMs: now,
      actorId: mage.id,
      spellId: 'blizzard',
      spellName: '暴风雪',
      kind: 'INSTANT',
      x: 120,
      y: 80,
      radius: 240,
      aoePulse: true,
    };
    ingestCombatActionsAsClassAoePulses(state, { actions: [action], unitsById: map, seenIds: seen, now });
    assert.equal(state.pulses.length, 1);
    assert.equal(state.pulses[0].color, '#69CCF0');
    assert.equal(state.pulses[0].x, 120);
    assert.equal(state.pulses[0].radius, CLASS_AOE_PULSE_HALF_WIDTH_PX);
    assert.ok(state.pulses[0].radius < 40, '不得用技能码数半径');
    ingestCombatActionsAsClassAoePulses(state, { actions: [action], unitsById: map, seenIds: seen, now });
    assert.equal(state.pulses.length, 1);
    pruneClassAoePulses(state, now + 2000);
    assert.equal(state.pulses.length, 0);
  });
});
