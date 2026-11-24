import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { CombatEngine, getSpellByAnyId } from '@cata-raid-sim/engine';
import type { Unit } from '@cata-raid-sim/engine';
import {
  createDefaultDkRunes,
  ensureDkRunes,
  spendDkResourcesForSpell,
  deductDkSpellResources,
  hasReadyDkRunes,
  DK_RP_PER_RUNE,
  DK_HORN_RP_GAIN,
} from '../dkResources.js';

function makeDk(engine: CombatEngine): Unit {
  const u: Unit = {
    id: 'dk1',
    name: 'DK',
    classId: 'DK',
    role: 'DPS',
    isPlayer: true,
    isAlive: true,
    hp: 100000,
    maxHp: 100000,
    runicPower: 0,
    resources: [{ kind: 'RUNIC_POWER', current: 0, max: 100 }],
    runes: createDefaultDkRunes(),
    buffs: [],
    threatTable: [],
    position: { x: 0, y: 0 },
    stats: {
      attackPower: 0,
      spellPower: 0,
      critChance: 0,
      haste: 0,
      armor: 0,
      spellResist: 0,
      block: 0,
      parry: 0,
      dodge: 0,
      mastery: 0,
      versatility: 0,
      speed: 0,
    },
  };
  engine.addUnit(u);
  return u;
}

describe('dkResources (Cata model)', () => {
  let engine: CombatEngine;

  beforeEach(() => {
    engine = new CombatEngine();
  });

  it('ensures 6 runes B/B/F/F/U/U ready', () => {
    const u = makeDk(engine);
    u.runes = undefined;
    ensureDkRunes(u);
    assert.equal(u.runes!.length, 6);
    assert.deepEqual(
      u.runes!.map((r) => r.runeType),
      ['BLOOD', 'BLOOD', 'FROST', 'FROST', 'UNHOLY', 'UNHOLY']
    );
    assert.ok(u.runes!.every((r) => r.cooldownMs === 0));
  });

  it('spending frost+unholy runes grants RP and starts 10s CD', () => {
    const u = makeDk(engine);
    const ok = spendDkResourcesForSpell(engine, u, 'obliterate', getSpellByAnyId('obliterate', 'DK'));
    assert.equal(ok, true);
    assert.equal(u.runicPower, 2 * DK_RP_PER_RUNE);
    const frostCd = u.runes!.filter((r) => r.runeType === 'FROST' && r.cooldownMs > 0);
    const unholyCd = u.runes!.filter((r) => r.runeType === 'UNHOLY' && r.cooldownMs > 0);
    assert.equal(frostCd.length, 1);
    assert.equal(unholyCd.length, 1);
    assert.equal(frostCd[0].cooldownMs, 10_000);
  });

  it('Horn of Winter grants +10 RP without runes', () => {
    const u = makeDk(engine);
    const before = u.runes!.map((r) => r.cooldownMs);
    const ok = spendDkResourcesForSpell(engine, u, 'horn_of_winter', getSpellByAnyId('horn_of_winter', 'DK'));
    assert.equal(ok, true);
    assert.equal(u.runicPower, DK_HORN_RP_GAIN);
    assert.deepEqual(
      u.runes!.map((r) => r.cooldownMs),
      before
    );
  });

  it('frost strike deducts RP only (no runes)', () => {
    const u = makeDk(engine);
    u.runicPower = 40;
    const ok = deductDkSpellResources(engine, u, 'frost_strike', getSpellByAnyId('frost_strike', 'DK'));
    assert.equal(ok, true);
    assert.equal(u.runicPower, 0);
    assert.ok(u.runes!.every((r) => r.cooldownMs === 0));
  });

  it('rejects cast when runes are on CD', () => {
    const u = makeDk(engine);
    spendDkResourcesForSpell(engine, u, 'howling_blast', getSpellByAnyId('howling_blast', 'DK'));
    spendDkResourcesForSpell(engine, u, 'howling_blast', getSpellByAnyId('howling_blast', 'DK'));
    assert.equal(hasReadyDkRunes(u, ['FROST']), false);
    assert.equal(
      spendDkResourcesForSpell(engine, u, 'howling_blast', getSpellByAnyId('howling_blast', 'DK')),
      false
    );
  });
});
