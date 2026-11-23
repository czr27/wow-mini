import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CombatDisplayPrefs, FloatingCombatText, Unit } from '@cata-raid-sim/engine';
import { resolveCombatDisplayPrefs } from '@cata-raid-sim/engine';
import { resolveLocalFloatingTextMode } from '../floatingTextFilter.js';

function unit(partial: Partial<Unit> & { id: string }): Unit {
  return {
    name: partial.id,
    classId: 'WARRIOR',
    role: 'DPS',
    isAlive: true,
    alive: true,
    hp: 100,
    maxHp: 100,
    buffs: [],
    threatTable: [],
    position: { x: 0, y: 0 },
    stats: {} as any,
    ...partial,
  } as Unit;
}

function fct(partial: Partial<FloatingCombatText> & { category: string; targetId: string }): FloatingCombatText {
  return {
    id: 't1',
    text: '1000',
    isCrit: false,
    createdAtMs: Date.now(),
    ...partial,
  } as FloatingCombatText;
}

const baseOpts = () => {
  const me = unit({ id: 'me', isPlayer: true, role: 'HEALER' });
  const guest = unit({ id: 'guest', isHumanControlled: true, role: 'DPS' });
  const allyAi = unit({ id: 'ai1', role: 'DPS' });
  const pet = unit({ id: 'pet1', isPet: true, ownerId: 'me', role: 'DPS' });
  const boss = unit({ id: 'boss', role: 'ENEMY' });
  return {
    me,
    guest,
    allyAi,
    pet,
    boss,
    units: [me, guest, allyAi, pet, boss],
    localPlayerId: 'me' as string,
    bossUnitId: 'boss' as string,
  };
};

describe('resolveLocalFloatingTextMode', () => {
  it('defaults match prior hard-coded filter (self on, ally off)', () => {
    const { units, localPlayerId, bossUnitId } = baseOpts();
    const o = { localPlayerId, units, bossUnitId };

    assert.equal(
      resolveLocalFloatingTextMode(
        fct({ category: 'DAMAGE_SKILL', targetId: 'boss', sourceId: 'me' }),
        o
      ),
      'OUTGOING'
    );
    assert.equal(
      resolveLocalFloatingTextMode(
        fct({ category: 'DAMAGE_AUTO', targetId: 'boss', sourceId: 'pet1' }),
        o
      ),
      'OUTGOING'
    );
    assert.equal(
      resolveLocalFloatingTextMode(
        fct({
          category: 'DAMAGE_SKILL',
          targetId: 'boss',
          sourceId: 'guest',
          isFromPlayerOrPet: true,
        }),
        o
      ),
      null
    );
    assert.equal(
      resolveLocalFloatingTextMode(fct({ category: 'HEAL', targetId: 'me', sourceId: 'guest' }), o),
      'HEAL_SELF'
    );
    assert.equal(
      resolveLocalFloatingTextMode(
        fct({ category: 'DAMAGE_TAKEN', targetId: 'me', sourceId: 'boss' }),
        o
      ),
      'TAKEN_SELF'
    );
    assert.equal(
      resolveLocalFloatingTextMode(fct({ category: 'HEAL', targetId: 'guest', sourceId: 'me' }), o),
      'HEAL_SELF'
    );
    assert.equal(
      resolveLocalFloatingTextMode(fct({ category: 'HEAL', targetId: 'guest', sourceId: 'guest' }), o),
      null
    );
  });

  it('hides miss/status on self and enemy', () => {
    const { units, localPlayerId, bossUnitId } = baseOpts();
    const o = { localPlayerId, units, bossUnitId };
    assert.equal(
      resolveLocalFloatingTextMode(
        fct({ category: 'MISS', targetId: 'boss', sourceId: 'me', text: '未命中' }),
        o
      ),
      null
    );
    assert.equal(
      resolveLocalFloatingTextMode(fct({ category: 'STATUS', targetId: 'me', text: '冷却中' }), o),
      null
    );
  });

  it('respects SCT scope prefs independently', () => {
    const { units, localPlayerId, bossUnitId } = baseOpts();
    const allOff: Partial<CombatDisplayPrefs> = {
      showSctMyDamage: false,
      showSctMyHeal: false,
      showSctHealOnMe: false,
      showSctDamageOnMe: false,
      showSctAllyDamage: false,
      showSctAllyHeal: false,
    };
    const o = (prefs: Partial<CombatDisplayPrefs>) => ({
      localPlayerId,
      units,
      bossUnitId,
      prefs: resolveCombatDisplayPrefs({ ...allOff, ...prefs }),
    });

    assert.equal(
      resolveLocalFloatingTextMode(
        fct({ category: 'DAMAGE_SKILL', targetId: 'boss', sourceId: 'me' }),
        o({ showSctMyDamage: true })
      ),
      'OUTGOING'
    );
    assert.equal(
      resolveLocalFloatingTextMode(
        fct({ category: 'DAMAGE_SKILL', targetId: 'boss', sourceId: 'me' }),
        o({})
      ),
      null
    );

    assert.equal(
      resolveLocalFloatingTextMode(
        fct({ category: 'HEAL', targetId: 'guest', sourceId: 'me' }),
        o({ showSctMyHeal: true })
      ),
      'HEAL_SELF'
    );
    assert.equal(
      resolveLocalFloatingTextMode(
        fct({ category: 'HEAL', targetId: 'me', sourceId: 'guest' }),
        o({ showSctHealOnMe: true })
      ),
      'HEAL_SELF'
    );
    assert.equal(
      resolveLocalFloatingTextMode(
        fct({ category: 'DAMAGE_TAKEN', targetId: 'me', sourceId: 'boss' }),
        o({ showSctDamageOnMe: true })
      ),
      'TAKEN_SELF'
    );

    assert.equal(
      resolveLocalFloatingTextMode(
        fct({ category: 'DAMAGE_SKILL', targetId: 'boss', sourceId: 'guest' }),
        o({ showSctAllyDamage: true })
      ),
      'ALLY_OUTGOING'
    );
    assert.equal(
      resolveLocalFloatingTextMode(
        fct({ category: 'DAMAGE_SKILL', targetId: 'boss', sourceId: 'ai1' }),
        o({ showSctAllyDamage: true })
      ),
      'ALLY_OUTGOING'
    );
    assert.equal(
      resolveLocalFloatingTextMode(
        fct({ category: 'HEAL', targetId: 'guest', sourceId: 'ai1' }),
        o({ showSctAllyHeal: true })
      ),
      'ALLY_HEAL'
    );
  });

  it('heal-on-self shows when either healOnMe or myHeal is on', () => {
    const { units, localPlayerId, bossUnitId } = baseOpts();
    const base = resolveCombatDisplayPrefs({
      showSctMyDamage: false,
      showSctMyHeal: false,
      showSctHealOnMe: false,
      showSctDamageOnMe: false,
      showSctAllyDamage: false,
      showSctAllyHeal: false,
    });
    const selfHeal = fct({ category: 'HEAL', targetId: 'me', sourceId: 'me' });
    assert.equal(
      resolveLocalFloatingTextMode(selfHeal, {
        localPlayerId,
        units,
        bossUnitId,
        prefs: { ...base, showSctHealOnMe: true },
      }),
      'HEAL_SELF'
    );
    assert.equal(
      resolveLocalFloatingTextMode(selfHeal, {
        localPlayerId,
        units,
        bossUnitId,
        prefs: { ...base, showSctMyHeal: true },
      }),
      'HEAL_SELF'
    );
    assert.equal(
      resolveLocalFloatingTextMode(selfHeal, {
        localPlayerId,
        units,
        bossUnitId,
        prefs: base,
      }),
      null
    );
  });
});
