import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GroundEffect, Unit } from '@cata-raid-sim/engine';
import { resolveBossLinkBeams } from '../bossLinkFx.js';

function makeUnit(partial: Partial<Unit> & Pick<Unit, 'id' | 'name' | 'classId' | 'role'>): Unit {
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

describe('bossLinkFx', () => {
  it('温诺希斯 毒性链接：两名存活玩家生成连线，距离 <80 为 danger', () => {
    const p1 = makeUnit({
      id: 'p1',
      name: 'P1',
      classId: 'MAGE',
      role: 'DPS',
      position: { x: 100, y: 100 },
      buffs: [{ id: 'b1', spellId: 'toxic_link', name: '毒性链接', kind: 'DEBUFF' } as any],
    });
    const p2 = makeUnit({
      id: 'p2',
      name: 'P2',
      classId: 'PRIEST',
      role: 'HEALER',
      position: { x: 140, y: 100 },
      buffs: [{ id: 'b2', spellId: 'toxic_link', name: '毒性链接', kind: 'DEBUFF' } as any],
    });
    const units = [p1, p2];
    const beams = resolveBossLinkBeams({
      units,
      groundEffects: [],
      resolveUnitPos: (id) => units.find((u) => u.id === id)?.position ?? null,
    });
    assert.equal(beams.length, 1);
    assert.equal(beams[0].kind, 'toxic_link');
    assert.equal(beams[0].danger, true);

    p2.position = { x: 190, y: 100 };
    const beamsFar = resolveBossLinkBeams({
      units,
      groundEffects: [],
      resolveUnitPos: (id) => units.find((u) => u.id === id)?.position ?? null,
    });
    assert.equal(beamsFar[0].danger, false);
  });

  it('莫卓克 共鸣水晶：生成连线到地面水晶，近距安全 / 远距 danger', () => {
    const p1 = makeUnit({
      id: 'p1',
      name: 'P1',
      classId: 'HUNTER',
      role: 'DPS',
      position: { x: 300, y: 200 },
      buffs: [{ id: 'rc1', spellId: 'resonating_crystal_link', name: '共鸣水晶连线', kind: 'DEBUFF' } as any],
    });
    const crystal: GroundEffect = {
      id: 'g_rc',
      kind: 'DAMAGE_ZONE',
      spellId: 'resonating_crystal',
      ownerId: 'boss',
      x: 320,
      y: 200,
      radius: 28,
      colorHex: '#60A5FA',
      remainingMs: 10000,
      tickIntervalMs: 1000,
      tickValue: 0,
    };
    const closeBeams = resolveBossLinkBeams({
      units: [p1],
      groundEffects: [crystal],
      resolveUnitPos: () => p1.position!,
    });
    assert.equal(closeBeams.length, 1);
    assert.equal(closeBeams[0].kind, 'resonating_crystal');
    assert.equal(closeBeams[0].danger, false);

    p1.position = { x: 240, y: 200 };
    const farBeams = resolveBossLinkBeams({
      units: [p1],
      groundEffects: [crystal],
      resolveUnitPos: () => p1.position!,
    });
    assert.equal(farBeams[0].danger, true);
  });

  it('哈加拉 传导水晶：Boss 与存活传导水晶及水晶之间生成闪电连线', () => {
    const boss = makeUnit({
      id: 'hagara',
      name: '哈加拉',
      classId: 'BOSS',
      role: 'ENEMY',
      unitKind: 'BOSS',
      position: { x: 500, y: 200 },
    });
    const c1 = makeUnit({
      id: 'c1',
      name: '传导水晶 1',
      classId: 'NPC',
      role: 'ENEMY',
      unitKind: 'ADD',
      summonSpellId: 'conductive_crystal',
      position: { x: 390, y: 160 },
    });
    const c2 = makeUnit({
      id: 'c2',
      name: '传导水晶 2',
      classId: 'NPC',
      role: 'ENEMY',
      unitKind: 'ADD',
      summonSpellId: 'conductive_crystal',
      position: { x: 610, y: 160 },
    });
    const all = [boss, c1, c2];
    const beams = resolveBossLinkBeams({
      units: [],
      bossUnit: boss,
      enemyUnits: [c1, c2],
      groundEffects: [],
      resolveUnitPos: (id) => all.find((u) => u.id === id)?.position ?? null,
    });
    // 2 Boss->Crystal + 1 Crystal<->Crystal
    assert.equal(beams.length, 3);
    assert.ok(beams.every((b) => b.kind === 'conductive_crystal'));
  });
});
