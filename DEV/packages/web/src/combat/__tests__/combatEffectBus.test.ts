/**
 * Sharded-authority effect bus: idempotent apply + gather batch preserves effectId.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CombatEffect } from '@cata-raid-sim/engine';
import {
  AppliedEffectRing,
  CombatEffectIdGen,
  EffectGatherQueue,
  consumeRemoteEffect,
  emitCombatEffect,
} from '../combatEffectBus.js';

describe('combatEffectBus', () => {
  it('effectId embeds owner + epoch + seq', () => {
    const gen = new CombatEffectIdGen();
    gen.beginEpoch(1_000_000);
    const a = gen.next('p1', 1_000_100);
    const b = gen.next('p1', 1_000_200);
    assert.notEqual(a, b);
    assert.ok(a.startsWith('p1_'));
    assert.ok(a.includes((1_000_000).toString(36)));
  });

  it('AppliedEffectRing rejects duplicates', () => {
    const ring = new AppliedEffectRing(4);
    assert.equal(ring.mark('e1'), true);
    assert.equal(ring.mark('e1'), false);
    assert.equal(ring.has('e1'), true);
  });

  it('emit applies locally once when authority, then batch echo is skipped', () => {
    const gen = new CombatEffectIdGen();
    gen.beginEpoch(5_000);
    const applied = new AppliedEffectRing();
    const sent: CombatEffect[] = [];
    let applyCount = 0;
    const effect = emitCombatEffect({
      partial: {
        sourceId: 'p1',
        targetId: 'p1',
        spellId: 'healing_touch',
        kind: 'HEAL',
        amount: 1000,
      },
      ownerId: 'p1',
      idGen: gen,
      applied,
      isLocalAuthority: (id) => id === 'p1',
      applyLocal: () => {
        applyCount += 1;
      },
      send: (e) => sent.push(e),
    });
    assert.equal(applyCount, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].effectId, effect.effectId);

    // Batch echo of same effectId
    const again = consumeRemoteEffect(effect, applied, () => {
      applyCount += 1;
    });
    assert.equal(again, false);
    assert.equal(applyCount, 1);
  });

  it('gather flush keeps original effectIds and merges snapshots by owner', () => {
    const q = new EffectGatherQueue(200);
    q.enqueueEffect({
      effectId: 'p1_abc_1',
      sourceId: 'p1',
      targetId: 'boss',
      spellId: 'lb',
      kind: 'DAMAGE',
      amount: 10,
    });
    q.enqueueEffect({
      effectId: 'p2_abc_1',
      sourceId: 'p2',
      targetId: 'p1',
      spellId: 'heal',
      kind: 'HEAL',
      amount: 5,
    });
    q.enqueueSnapshot({
      ownerId: 'p1',
      timeMs: 1,
      units: [{ id: 'p1' } as any],
    });
    q.enqueueSnapshot({
      ownerId: 'p1',
      timeMs: 2,
      units: [{ id: 'p1', hp: 99 } as any],
    });
    // Too early
    assert.equal(q.tryFlush(50), null);
    const batch = q.tryFlush(250);
    assert.ok(batch);
    assert.equal(batch!.effects.length, 2);
    assert.equal(batch!.effects[0].effectId, 'p1_abc_1');
    assert.equal(batch!.effects[1].effectId, 'p2_abc_1');
    assert.equal(batch!.snapshots.length, 1);
    assert.equal(batch!.snapshots[0].units[0].hp, 99);
  });

  it('consumeRemoteEffect applies foreign heal once', () => {
    const applied = new AppliedEffectRing();
    let n = 0;
    const e: CombatEffect = {
      effectId: 'host_x_1',
      sourceId: 'host',
      targetId: 'guest',
      spellId: 'flash',
      kind: 'HEAL',
      amount: 200,
    };
    assert.equal(
      consumeRemoteEffect(e, applied, () => {
        n += 1;
      }),
      true
    );
    assert.equal(
      consumeRemoteEffect(e, applied, () => {
        n += 1;
      }),
      false
    );
    assert.equal(n, 1);
  });
});
