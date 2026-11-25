/**
 * Ground/totem/pet summons are reported once; remote apply must not re-broadcast.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine } from '@cata-raid-sim/engine';
import {
  configureCombatAuthority,
  resetCombatAuthority,
} from '../networkCombatAuthority.js';
import {
  installSummonReporters,
  uninstallSummonReporters,
  withSuppressSummonReport,
  reportGroundSummon,
} from '../summonReport.js';
import { applyCombatEffectToEngine } from '../applyCombatEffect.js';

describe('summonReport', () => {
  it('remote GROUND_PLACE apply draws without looping publish when suppressed', () => {
    resetCombatAuthority();
    configureCombatAuthority({
      localPlayerId: 'p2',
      isNetworkHost: false,
      isNetworkGuest: true,
      activeRoomId: 'room1',
      isUnitLocalAuthority: (id) => id === 'p2',
    });
    const engine = new CombatEngine();
    installSummonReporters(engine);

    applyCombatEffectToEngine(engine, {
      effectId: 'e_boss_puddle',
      sourceId: 'boss',
      targetId: 'boss',
      spellId: 'fire_blossom',
      kind: 'GROUND_PLACE',
      x: 400,
      y: 200,
      radius: 45,
      groundEffectId: 'blossom_1',
      groundKind: 'DAMAGE_ZONE',
      colorHex: '#F97316',
      remainingMs: 6000,
      tickValue: 9000,
    });

    const g = engine.effectsManager?.groundEffects?.find((x) => x.id === 'blossom_1');
    assert.ok(g, 'remote drew ground from summon receipt');
    assert.equal(g!.tickValue, 9000);
    assert.equal(g!.ownerId, 'boss');

    uninstallSummonReporters();
    resetCombatAuthority();
  });

  it('withSuppressSummonReport blocks reportGroundSummon', () => {
    let called = 0;
    // reportGroundSummon no-ops when suppress>0 even if networked
    configureCombatAuthority({
      localPlayerId: 'p1',
      isNetworkHost: true,
      isNetworkGuest: false,
      activeRoomId: 'r',
      isUnitLocalAuthority: () => true,
    });
    withSuppressSummonReport(() => {
      reportGroundSummon({
        id: 'x',
        kind: 'TOTEM',
        spellId: 'spirit_link',
        ownerId: 'p1',
        x: 1,
        y: 2,
        radius: 80,
        colorHex: '#EAB308',
        remainingMs: 1000,
        tickIntervalMs: 1000,
        tickElapsedMs: 0,
        tickValue: 0,
      } as any);
      called = 1;
    });
    assert.equal(called, 1);
    resetCombatAuthority();
  });
});
