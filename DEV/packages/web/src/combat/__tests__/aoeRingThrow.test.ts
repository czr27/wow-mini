/**
 * Remote AoE rings: throw from caster → grow; magic arc vs hunter straight.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AOE_REMOTE_THROW_MIN_DIST_PX,
  AOE_RING_GROW_MS,
  createPersistentRing,
  resolveAoeRingPose,
  resolveAoeThrowMs,
  syncPersistentRingsFromGround,
} from '../aoeRingDraw.js';
import {
  resolveProjectileFlightStyle,
  sampleProjectileFlight,
} from '../combatHitFx.js';
import type { GroundEffect, Unit } from '@cata-raid-sim/engine';

function unit(partial: Partial<Unit> & Pick<Unit, 'id' | 'name' | 'classId' | 'role'>): Unit {
  return {
    isPlayer: true,
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

describe('aoeRing throw + projectile flight', () => {
  it('法系抛物线 / 猎人直线', () => {
    assert.equal(resolveProjectileFlightStyle('MAGE'), 'arc');
    assert.equal(resolveProjectileFlightStyle('DRUID'), 'arc');
    assert.equal(resolveProjectileFlightStyle('WARLOCK'), 'arc');
    assert.equal(resolveProjectileFlightStyle('HUNTER'), 'straight');
    assert.equal(resolveProjectileFlightStyle('WARRIOR'), 'straight');
  });

  it('抛物线中点抬升，直线中点不抬升', () => {
    const arc = sampleProjectileFlight(0, 100, 200, 100, 0.5, 'arc');
    const line = sampleProjectileFlight(0, 100, 200, 100, 0.5, 'straight');
    assert.equal(line.y, 100);
    assert.ok(arc.y < 100, `arc mid should lift above start, got y=${arc.y}`);
    assert.ok(arc.lift > 0);
  });

  it('远端光环：抛出阶段小半径且位置在施法者→落点之间，落地后放大到最终', () => {
    const now = 1_000_000;
    const ring = createPersistentRing({
      id: 'g1',
      x: 300,
      y: 100,
      radius: 80,
      tone: 'HEAL',
      baseAlpha: 0.5,
      remainingMs: 10_000,
      now,
      fromX: 100,
      fromY: 100,
      flight: 'arc',
    });
    assert.ok(ring.throwMs >= 220);
    assert.equal(ring.growMs, AOE_RING_GROW_MS);

    const midThrow = resolveAoeRingPose(ring, now + ring.throwMs * 0.5);
    assert.equal(midThrow.throwing, true);
    assert.ok(midThrow.radius < 80 * 0.4, `seed radius too large: ${midThrow.radius}`);
    assert.ok(midThrow.x > 100 && midThrow.x < 300);
    assert.ok(midThrow.y < 100, 'mage/heal arc should lift mid-flight');

    const justLanded = resolveAoeRingPose(ring, now + ring.throwMs);
    assert.equal(justLanded.throwing, false);
    assert.ok(justLanded.radius < 80);

    const grown = resolveAoeRingPose(ring, now + ring.throwMs + ring.growMs + 1);
    assert.equal(grown.radius, 80);
    assert.equal(grown.x, 300);
    assert.equal(grown.y, 100);
  });

  it('脚下放置：无抛出行程，仅短放大', () => {
    assert.equal(resolveAoeThrowMs(AOE_REMOTE_THROW_MIN_DIST_PX - 1), 0);
    const now = 2_000_000;
    const ring = createPersistentRing({
      id: 'local',
      x: 120,
      y: 120,
      radius: 60,
      tone: 'FRIENDLY',
      baseAlpha: 0.4,
      remainingMs: 5000,
      now,
      fromX: 118,
      fromY: 119,
      flight: 'straight',
    });
    assert.equal(ring.throwMs, 0);
    const early = resolveAoeRingPose(ring, now + 40);
    assert.equal(early.throwing, false);
    assert.ok(early.radius < 60);
  });

  it('syncPersistentRingsFromGround：新远端圈带施法者起点与职业飞行样式', () => {
    const mage = unit({
      id: 'm1',
      name: '法师',
      classId: 'MAGE',
      role: 'DPS',
      position: { x: 50, y: 50 },
    });
    const hunter = unit({
      id: 'h1',
      name: '猎人',
      classId: 'HUNTER',
      role: 'DPS',
      position: { x: 50, y: 50 },
    });
    const units = new Map<string, Unit>([
      [mage.id, mage],
      [hunter.id, hunter],
    ]);
    const now = 3_000_000;
    const ground: GroundEffect[] = [
      {
        id: 'rain1',
        kind: 'HEAL_ZONE',
        spellId: 'healing_rain',
        ownerId: mage.id,
        x: 250,
        y: 50,
        radius: 60,
        colorHex: '#10B981',
        remainingMs: 8000,
        tickIntervalMs: 1000,
        tickElapsedMs: 0,
        tickValue: 1000,
      },
      {
        id: 'trap1',
        kind: 'DAMAGE_ZONE',
        spellId: 'explosive_trap',
        ownerId: hunter.id,
        x: 250,
        y: 80,
        radius: 50,
        colorHex: '#EF4444',
        remainingMs: 8000,
        tickIntervalMs: 1000,
        tickElapsedMs: 0,
        tickValue: 1000,
      },
    ];
    const rings = syncPersistentRingsFromGround([], ground, units, now);
    const rain = rings.find((r) => r.id === 'rain1')!;
    const trap = rings.find((r) => r.id === 'trap1')!;
    assert.ok(rain);
    assert.ok(trap);
    assert.equal(rain.tone, 'HEAL');
    assert.equal(trap.tone, 'ENEMY');
    assert.equal(rain.friendlyCaster, true);
    assert.equal(trap.friendlyCaster, true);
    assert.equal(rain.flight, 'arc');
    assert.equal(trap.flight, 'straight');
    assert.equal(rain.fromX, 50);
    assert.ok(rain.throwMs > 0);
    assert.ok(trap.throwMs > 0);

    const rainMid = resolveAoeRingPose(rain, now + rain.throwMs * 0.5);
    const trapMid = resolveAoeRingPose(trap, now + trap.throwMs * 0.5);
    assert.ok(rainMid.y < 50, 'mage throw lifts');
    assert.equal(trapMid.y, 50 + (80 - 50) * 0.5, 'hunter throw stays linear');
  });
});
