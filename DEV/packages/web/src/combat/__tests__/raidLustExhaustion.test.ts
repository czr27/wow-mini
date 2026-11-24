/**
 * 嗜血/英勇/时间扭曲 → 上急速 + 疲惫；已疲惫者不再受益。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine, type Unit } from '@cata-raid-sim/engine';
import {
  applyRaidLustBuff,
  EXHAUSTION_DURATION_MS,
  EXHAUSTION_SPELL_ID,
  unitHasExhaustion,
} from '../raidLustBuff.js';

function ally(partial: Partial<Unit> & { id: string }): Unit {
  return {
    id: partial.id,
    name: partial.name ?? partial.id,
    classId: partial.classId ?? 'MAGE',
    spec: 'FIRE',
    role: partial.role ?? 'DPS',
    isPlayer: !!partial.isPlayer,
    isHumanControlled: !!partial.isHumanControlled,
    isAlive: true,
    alive: true,
    hp: 30_000,
    maxHp: 30_000,
    absorb: 0,
    resources: [],
    buffs: [],
    threatTable: [],
    position: { x: 100, y: 100 },
    stats: {
      attackPower: 1,
      spellPower: 1,
      critChance: 0.2,
      haste: 0.2,
      armor: 0,
      spellResist: 0,
      block: 0,
      parry: 0,
      dodge: 0,
      mastery: 0,
      versatility: 0,
      speed: 1,
    },
  };
}

describe('raidLustExhaustion', () => {
  it('嗜血给全团上急速 buff + 疲惫 debuff', () => {
    const engine = new CombatEngine();
    const shaman = ally({ id: 'sham', classId: 'SHAMAN', role: 'HEALER', isHumanControlled: true });
    const tank = ally({ id: 'tank', classId: 'DK', role: 'TANK' });
    engine.addUnit(shaman);
    engine.addUnit(tank);

    const n = applyRaidLustBuff(engine, shaman, 'bloodlust');
    assert.equal(n, 2);
    for (const u of [shaman, tank]) {
      assert.ok((u.buffs || []).some((b) => (b.tags || []).includes('BLOODLUST')));
      assert.ok(unitHasExhaustion(u));
      const exh = (u.buffs || []).find((b) => b.spellId === EXHAUSTION_SPELL_ID);
      assert.ok(exh);
      assert.equal(exh!.kind, 'DEBUFF');
      assert.ok((exh!.remainingMs || 0) >= EXHAUSTION_DURATION_MS - 1000);
    }
  });

  it('已疲惫单位第二次嗜血不再吃到急速', () => {
    const engine = new CombatEngine();
    const shaman = ally({ id: 'sham', classId: 'SHAMAN', role: 'HEALER' });
    const tank = ally({ id: 'tank', classId: 'DK', role: 'TANK' });
    engine.addUnit(shaman);
    engine.addUnit(tank);

    assert.equal(applyRaidLustBuff(engine, shaman, 'heroism'), 2);
    // Clear only lust buffs, keep exhaustion
    for (const u of [shaman, tank]) {
      u.buffs = (u.buffs || []).filter((b) => !(b.tags || []).includes('BLOODLUST'));
    }
    assert.equal(applyRaidLustBuff(engine, shaman, 'time_warp'), 0);
    assert.ok(!((tank.buffs || []).some((b) => (b.tags || []).includes('BLOODLUST'))));
    assert.ok(unitHasExhaustion(tank));
  });
});
