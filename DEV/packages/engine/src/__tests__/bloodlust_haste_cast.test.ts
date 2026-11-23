import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createLevel80BaseStats,
  getHastedCastTimeMs,
  getUnitHaste,
  LEVEL_80_MAX_HASTE,
} from '../index.js';
import type { Unit } from '../types.js';

function makeCaster(withLust: boolean): Unit {
  const u = {
    id: 'caster',
    name: 'Caster',
    classId: 'MAGE',
    role: 'DPS',
    isAlive: true,
    alive: true,
    hp: 30000,
    maxHp: 30000,
    buffs: [] as Unit['buffs'],
    threatTable: [],
    position: { x: 0, y: 0 },
    stats: createLevel80BaseStats('DPS', 'MAGE', LEVEL_80_MAX_HASTE),
  } as Unit;
  if (withLust) {
    u.buffs = [
      {
        id: 'heroism_1',
        spellId: 'heroism',
        name: '嗜血',
        kind: 'BUFF',
        tags: ['BLOODLUST', 'STAT'],
        sourceUnitId: 'caster',
        targetUnitId: 'caster',
        stacks: 1,
        maxStacks: 1,
        durationMs: 40_000,
        remainingMs: 40_000,
        school: 'NATURE',
      },
    ];
  }
  return u;
}

describe('bloodlust haste → cast / channel shortening', () => {
  it('getUnitHaste adds +30% under BLOODLUST / heroism', () => {
    const base = getUnitHaste(makeCaster(false));
    const lust = getUnitHaste(makeCaster(true));
    assert.ok(Math.abs(base - LEVEL_80_MAX_HASTE) < 1e-6);
    assert.ok(Math.abs(lust - (LEVEL_80_MAX_HASTE + 0.3)) < 1e-6);
  });

  it('2.5s read-bar is faster with bloodlust than base haste alone', () => {
    const baseMs = getHastedCastTimeMs(2500, getUnitHaste(makeCaster(false)));
    const lustMs = getHastedCastTimeMs(2500, getUnitHaste(makeCaster(true)));
    assert.ok(baseMs < 2500, `base haste should shorten: ${baseMs}`);
    assert.ok(lustMs < baseMs, `bloodlust should further shorten: lust=${lustMs} base=${baseMs}`);
    // 2500 / 1.5 ≈ 1667; 2500 / 1.8 ≈ 1389
    assert.ok(Math.abs(baseMs - Math.round(2500 / 1.5)) <= 1);
    assert.ok(Math.abs(lustMs - Math.round(2500 / 1.8)) <= 1);
  });

  it('time_warp spellId also grants haste via getEffectiveUnitStats path', () => {
    const u = makeCaster(false);
    u.buffs = [
      {
        id: 'tw_1',
        spellId: 'time_warp',
        name: '时间扭曲',
        kind: 'BUFF',
        tags: ['STAT'],
        sourceUnitId: 'caster',
        targetUnitId: 'caster',
        stacks: 1,
        maxStacks: 1,
        durationMs: 40_000,
        remainingMs: 40_000,
        school: 'ARCANE',
      },
    ];
    assert.ok(getUnitHaste(u) >= LEVEL_80_MAX_HASTE + 0.29);
  });
});
