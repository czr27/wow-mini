/**
 * Visual differentiation & host/guest deterministic parity for:
 * - Friend/foe/self unit selection rings
 * - Ground ring motifs (spell + class)
 * - Projectiles (投掷) & melee slashes/rend (割裂)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GroundEffect, NetworkCombatAction, Unit } from '@cata-raid-sim/engine';
import { resolveUnitSelectionRingStyle } from '../unitSelectionRing.js';
import { resolveAoeRingMotif, syncPersistentRingsFromGround } from '../aoeRingDraw.js';
import {
  createHitFxState,
  ingestCombatActionsAsHitFx,
  resolveHitFxVisual,
} from '../combatHitFx.js';

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

describe('FX differentiation & network consistency', () => {
  it('敌我光圈选定样式区分：敌方红+十字准星 / 自身金+朝向标 / 友方职业色', () => {
    const enemy = resolveUnitSelectionRingStyle({ isEnemy: true, isBoss: true });
    assert.equal(enemy.affiliation, 'ENEMY');
    assert.equal(enemy.outerColor, '#FF4444');
    assert.equal(enemy.reticleTicks, 4);
    assert.equal(enemy.showFacingNotch, false);

    const self = resolveUnitSelectionRingStyle({ isSelf: true, classId: 'MAGE', role: 'DPS' });
    assert.equal(self.affiliation, 'SELF');
    assert.equal(self.outerColor, '#FFD700');
    assert.equal(self.showFacingNotch, true);

    const allyHealer = resolveUnitSelectionRingStyle({ classId: 'SHAMAN', role: 'HEALER' });
    assert.equal(allyHealer.affiliation, 'ALLY');
    assert.equal(allyHealer.reticleTicks, 4);
    assert.notEqual(allyHealer.outerColor, enemy.outerColor);
  });

  it('地面光圈纹理按技能与职业确定性分化，同步携带 spellId/ownerClassId', () => {
    assert.equal(resolveAoeRingMotif('healing_rain', 'SHAMAN', 'HEAL'), 'WATER_RIPPLE');
    assert.equal(resolveAoeRingMotif('efflorescence', 'DRUID', 'HEAL'), 'NATURE_PETAL');
    assert.equal(resolveAoeRingMotif('power_word_barrier', 'PRIEST', 'FRIENDLY'), 'HOLY_RUNE');
    assert.equal(resolveAoeRingMotif('blizzard', 'MAGE', 'ENEMY'), 'FROST_CRYSTAL');
    assert.equal(resolveAoeRingMotif('death_and_decay', 'DK', 'ENEMY'), 'UNHOLY_SIGIL');

    const shaman = makeUnit({ id: 's1', name: '萨满', classId: 'SHAMAN', role: 'HEALER' });
    const units = new Map([[shaman.id, shaman]]);
    const ground: GroundEffect[] = [
      {
        id: 'g_rain',
        kind: 'HEAL_ZONE',
        spellId: 'healing_rain',
        ownerId: shaman.id,
        x: 200,
        y: 120,
        radius: 64,
        colorHex: '#10B981',
        remainingMs: 8000,
        tickIntervalMs: 1000,
        tickValue: 2000,
      },
    ];
    const rings = syncPersistentRingsFromGround([], ground, units, 1000);
    assert.equal(rings.length, 1);
    assert.equal(rings[0].spellId, 'healing_rain');
    assert.equal(rings[0].ownerClassId, 'SHAMAN');
  });

  it('投掷与割裂按技能/职业区分，且主机与客机产生完全一致的视觉结果', () => {
    const fire = resolveHitFxVisual({ spellId: 'fireball', classId: 'MAGE' });
    const frost = resolveHitFxVisual({ spellId: 'frostbolt', classId: 'MAGE' });
    const arcane = resolveHitFxVisual({ spellId: 'arcane_blast', classId: 'MAGE' });
    assert.equal(fire.shape, 'orb');
    assert.equal(frost.shape, 'droplet');
    assert.equal(arcane.shape, 'star');
    assert.notEqual(fire.projColor, frost.projColor);

    const rend = resolveHitFxVisual({ spellId: 'rend', classId: 'WARRIOR' });
    const backstab = resolveHitFxVisual({ spellId: 'backstab', classId: 'ROGUE' });
    const obliterate = resolveHitFxVisual({ spellId: 'obliterate', classId: 'DK' });
    const crusader = resolveHitFxVisual({ spellId: 'crusader_strike', classId: 'PALADIN' });
    assert.equal(rend.slashStyle, 'claw_rend');
    assert.equal(backstab.slashStyle, 'cross_twin');
    assert.equal(obliterate.slashStyle, 'frost_jagged');
    assert.equal(crusader.slashStyle, 'holy_arc');

    // Host vs Guest deterministic parity
    const warrior = makeUnit({ id: 'w1', name: '战', classId: 'WARRIOR', role: 'DPS', position: { x: 100, y: 100 } });
    const boss = makeUnit({ id: 'boss', name: 'B', classId: 'BOSS', role: 'ENEMY', unitKind: 'BOSS', position: { x: 130, y: 100 } });
    const units = new Map([[warrior.id, warrior], [boss.id, boss]]);
    const action: NetworkCombatAction = {
      id: 'net_act_rend_1',
      atMs: 5000,
      actorId: warrior.id,
      spellId: 'rend',
      spellName: '撕裂',
      kind: 'INSTANT',
      targetId: boss.id,
    };

    const hostFx = createHitFxState();
    const guestFx = createHitFxState();
    ingestCombatActionsAsHitFx(hostFx, { actions: [action], unitsById: units, seenIds: new Set(), now: 5000 });
    ingestCombatActionsAsHitFx(guestFx, { actions: [action], unitsById: units, seenIds: new Set(), now: 5000 });

    assert.equal(hostFx.slashes.length, guestFx.slashes.length);
    for (let i = 0; i < hostFx.slashes.length; i++) {
      assert.equal(hostFx.slashes[i].style, guestFx.slashes[i].style);
      assert.equal(hostFx.slashes[i].color, guestFx.slashes[i].color);
      assert.equal(hostFx.slashes[i].angle, guestFx.slashes[i].angle);
    }
  });
});
