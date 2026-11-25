import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SFX_VOLUME,
  getSfxVolume,
  setSfxVolume,
  computeDistanceAttenuation,
  computeEffectiveGain,
  computeStereoPan,
  inferSpellSchool,
} from '../combatSfx.js';

describe('combatSfx', () => {
  it('defaults SFX volume to 30% and clamps updates to [0, 1]', () => {
    assert.equal(DEFAULT_SFX_VOLUME, 0.3);
    assert.equal(getSfxVolume(), 0.3);
    assert.equal(setSfxVolume(0.75), 0.75);
    assert.equal(getSfxVolume(), 0.75);
    assert.equal(setSfxVolume(2.5), 1);
    assert.equal(setSfxVolume(-0.4), 0);
    // Restore default
    setSfxVolume(DEFAULT_SFX_VOLUME);
  });

  it('attenuates gain by distance and weakens non-boss/non-self units', () => {
    const listener = { x: 100, y: 100 };
    assert.equal(computeDistanceAttenuation({ x: 140, y: 100 }, listener), 1.0);
    const mid = computeDistanceAttenuation({ x: 340, y: 100 }, listener);
    assert.ok(mid > 0.05 && mid < 1.0);
    assert.equal(computeDistanceAttenuation({ x: 800, y: 100 }, listener), 0);

    const selfGain = computeEffectiveGain('self', 0.3, { x: 800, y: 100 }, listener);
    const bossGain = computeEffectiveGain('boss', 0.3, { x: 120, y: 100 }, listener);
    const otherGain = computeEffectiveGain('other', 0.3, { x: 120, y: 100 }, listener);

    assert.equal(selfGain, 0.3);
    assert.ok(bossGain > otherGain * 2.5, 'boss SFX should be much louder than other players');
  });

  it('computes stereo pan clamped to [-0.75, 0.75]', () => {
    const listener = { x: 200, y: 200 };
    assert.equal(computeStereoPan({ x: 200, y: 200 }, listener), 0);
    assert.equal(computeStereoPan({ x: 800, y: 200 }, listener), 0.75);
    assert.equal(computeStereoPan({ x: -500, y: 200 }, listener), -0.75);
  });

  it('infers spell schools from spellId and spellName', () => {
    assert.equal(inferSpellSchool('fireball', '火球术'), 'fire');
    assert.equal(inferSpellSchool('frostbolt', '寒冰箭'), 'frost');
    assert.equal(inferSpellSchool('shadow_bolt', '暗影箭'), 'shadow');
    assert.equal(inferSpellSchool('flash_heal', '快速治疗'), 'holy');
    assert.equal(inferSpellSchool('auto_attack', '自动攻击'), 'physical');
  });
});
