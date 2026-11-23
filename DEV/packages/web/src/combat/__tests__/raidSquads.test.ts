import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClassId, Unit } from '@cata-raid-sim/engine';
import {
  assignRaidSquads,
  getAltSquadTarget,
  getRaidFrameUnits,
  isMeleeDps,
  resolveRaidSquads,
} from '../raidSquads.js';

function fakeUnit(
  id: string,
  role: Unit['role'],
  opts?: { isPet?: boolean; classId?: ClassId; spec?: string }
): Unit {
  return {
    id,
    name: id,
    role,
    classId: opts?.classId ?? 'WARRIOR',
    spec: opts?.spec,
    hp: 100,
    maxHp: 100,
    isAlive: true,
    alive: true,
    isPet: opts?.isPet,
  } as Unit;
}

describe('raidSquads', () => {
  it('excludes pets from raid-frame units', () => {
    const units = [
      fakeUnit('p1', 'TANK'),
      fakeUnit('pet', 'DPS', { isPet: true }),
      fakeUnit('p2', 'HEALER', { classId: 'PRIEST', spec: 'HOLY' }),
    ];
    assert.deepEqual(
      getRaidFrameUnits(units).map((u) => u.id),
      ['p1', 'p2']
    );
  });

  it('5-man: single role-sorted squad of five', () => {
    const units = [
      fakeUnit('d1', 'DPS', { classId: 'MAGE', spec: 'FIRE' }),
      fakeUnit('h1', 'HEALER', { classId: 'PRIEST', spec: 'HOLY' }),
      fakeUnit('t1', 'TANK', { classId: 'DK', spec: 'BLOOD' }),
      fakeUnit('d2', 'DPS', { classId: 'ROGUE', spec: 'ASSASSINATION' }),
      fakeUnit('d3', 'DPS', { classId: 'HUNTER', spec: 'MARKSMANSHIP' }),
      fakeUnit('pet', 'DPS', { isPet: true }),
    ];
    const squads = assignRaidSquads(units, false);
    assert.equal(squads.length, 1);
    assert.deepEqual(
      squads[0]!.map((u) => u.id),
      ['t1', 'h1', 'd1', 'd2', 'd3']
    );
  });

  it('isMeleeDps classifies enh/feral/rogue as melee, mage as not', () => {
    assert.equal(
      isMeleeDps(fakeUnit('r', 'DPS', { classId: 'ROGUE', spec: 'COMBAT' })),
      true
    );
    assert.equal(
      isMeleeDps(fakeUnit('e', 'DPS', { classId: 'SHAMAN', spec: 'ENHANCEMENT' })),
      true
    );
    assert.equal(
      isMeleeDps(fakeUnit('f', 'DPS', { classId: 'DRUID', spec: 'FERAL' })),
      true
    );
    assert.equal(
      isMeleeDps(fakeUnit('m', 'DPS', { classId: 'MAGE', spec: 'FIRE' })),
      false
    );
    assert.equal(
      isMeleeDps(fakeUnit('t', 'TANK', { classId: 'DK', spec: 'BLOOD' })),
      false
    );
  });

  it('20-man: T+melee / healers+ranged / rest fill 3-4', () => {
    const units = [
      fakeUnit('t1', 'TANK', { classId: 'DK', spec: 'BLOOD' }),
      fakeUnit('t2', 'TANK', { classId: 'WARRIOR', spec: 'PROTECTION' }),
      fakeUnit('h1', 'HEALER', { classId: 'PRIEST', spec: 'HOLY' }),
      fakeUnit('h2', 'HEALER', { classId: 'PRIEST', spec: 'DISCIPLINE' }),
      fakeUnit('h3', 'HEALER', { classId: 'SHAMAN', spec: 'RESTORATION' }),
      fakeUnit('h4', 'HEALER', { classId: 'DRUID', spec: 'RESTORATION' }),
      fakeUnit('m1', 'DPS', { classId: 'ROGUE', spec: 'COMBAT' }),
      fakeUnit('m2', 'DPS', { classId: 'ROGUE', spec: 'ASSASSINATION' }),
      fakeUnit('m3', 'DPS', { classId: 'WARRIOR', spec: 'ARMS' }),
      fakeUnit('m4', 'DPS', { classId: 'DK', spec: 'FROST' }),
      fakeUnit('m5', 'DPS', { classId: 'PALADIN', spec: 'RETRIBUTION' }),
      fakeUnit('m6', 'DPS', { classId: 'SHAMAN', spec: 'ENHANCEMENT' }),
      fakeUnit('r1', 'DPS', { classId: 'MAGE', spec: 'FIRE' }),
      fakeUnit('r2', 'DPS', { classId: 'MAGE', spec: 'FROST' }),
      fakeUnit('r3', 'DPS', { classId: 'WARLOCK', spec: 'AFFLICTION' }),
      fakeUnit('r4', 'DPS', { classId: 'HUNTER', spec: 'MARKSMANSHIP' }),
      fakeUnit('r5', 'DPS', { classId: 'PRIEST', spec: 'SHADOW' }),
      fakeUnit('r6', 'DPS', { classId: 'DRUID', spec: 'BALANCE' }),
      fakeUnit('r7', 'DPS', { classId: 'SHAMAN', spec: 'ELEMENTAL' }),
      fakeUnit('r8', 'DPS', { classId: 'MAGE', spec: 'ARCANE' }),
    ];
    const squads = assignRaidSquads(units, true);
    assert.equal(squads.length, 4);
    assert.equal(squads.reduce((s, g) => s + g.length, 0), 20);
    for (const g of squads) assert.equal(g.length, 5);

    // 小队1: both tanks + 3 melee
    assert.deepEqual(
      squads[0]!.map((u) => u.id),
      ['t1', 't2', 'm1', 'm2', 'm3']
    );
    assert.ok(squads[0]!.every((u) => u.role === 'TANK' || isMeleeDps(u)));

    // 小队2: all 4 healers + 1 ranged
    assert.deepEqual(
      squads[1]!.map((u) => u.id),
      ['h1', 'h2', 'h3', 'h4', 'r1']
    );
    assert.equal(squads[1]!.filter((u) => u.role === 'HEALER').length, 4);
    assert.equal(isMeleeDps(squads[1]![4]!), false);

    // 小队3: remaining melee first, then ranged
    assert.deepEqual(
      squads[2]!.map((u) => u.id),
      ['m4', 'm5', 'm6', 'r2', 'r3']
    );

    // 小队4: leftover ranged
    assert.deepEqual(
      squads[3]!.map((u) => u.id),
      ['r4', 'r5', 'r6', 'r7', 'r8']
    );
  });

  it('Alt+1~5 targets selected squad member slots', () => {
    const squads = [
      [fakeUnit('a1', 'TANK'), fakeUnit('a2', 'HEALER')],
      [fakeUnit('b1', 'DPS'), fakeUnit('b2', 'DPS'), fakeUnit('b3', 'DPS')],
    ];
    assert.equal(getAltSquadTarget(squads, 0, 1)?.id, 'a1');
    assert.equal(getAltSquadTarget(squads, 0, 2)?.id, 'a2');
    assert.equal(getAltSquadTarget(squads, 0, 3), null);
    assert.equal(getAltSquadTarget(squads, 1, 3)?.id, 'b3');
    assert.equal(getAltSquadTarget(squads, 1, 6), null);
  });

  it('resolveRaidSquads keeps live unit references by id', () => {
    const ids = [['u1', 'u2']];
    const live = [fakeUnit('u1', 'TANK'), fakeUnit('u2', 'HEALER')];
    live[0]!.hp = 42;
    const resolved = resolveRaidSquads(ids, live);
    assert.equal(resolved[0]![0]!.hp, 42);
  });
});
