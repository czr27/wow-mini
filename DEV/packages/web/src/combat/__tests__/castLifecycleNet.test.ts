/**
 * Cast lifecycle EFFECT → remote action-bar timelines.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CombatEffect, NetworkCastTimeline } from '@cata-raid-sim/engine';
import {
  applyCastLifecycleToTimelines,
  companionCastsFromTimelines,
} from '../castLifecycleNet.js';

describe('castLifecycleNet', () => {
  it('CAST_START adds timeline with totalMs; CAST_LAND / INTERRUPT clear', () => {
    let tl: NetworkCastTimeline[] = [];
    const start: CombatEffect = {
      effectId: 'e1',
      sourceId: 'ai1',
      targetId: 'tank',
      spellId: 'healing_touch',
      spellName: '治疗之触',
      kind: 'CAST_START',
      totalMs: 2500,
      isChannel: false,
      atMs: 1_000_000,
    };
    tl = applyCastLifecycleToTimelines(tl, start, 'me');
    assert.equal(tl.length, 1);
    assert.equal(tl[0].totalMs, 2500);
    assert.equal(tl[0].unitId, 'ai1');

    const bars = companionCastsFromTimelines(tl, 'me', 1_000_500);
    assert.ok(bars.ai1);
    assert.ok(bars.ai1.progress > 0 && bars.ai1.progress < 1);

    tl = applyCastLifecycleToTimelines(tl, { ...start, effectId: 'e2', kind: 'CAST_LAND' }, 'me');
    assert.equal(tl.length, 0);
  });

  it('skips own unitId for local player bar', () => {
    let tl: NetworkCastTimeline[] = [];
    tl = applyCastLifecycleToTimelines(
      tl,
      {
        effectId: 'e3',
        sourceId: 'me',
        targetId: 'me',
        spellId: 'flash',
        kind: 'CAST_START',
        totalMs: 1500,
        atMs: Date.now(),
      },
      'me'
    );
    assert.equal(tl.length, 0);
  });

  it('INTERRUPT clears bar', () => {
    let tl: NetworkCastTimeline[] = [
      {
        unitId: 'boss',
        spellId: 'shadowfury',
        spellName: '暗影之怒',
        startedAtMs: Date.now(),
        totalMs: 3000,
      },
    ];
    tl = applyCastLifecycleToTimelines(
      tl,
      {
        effectId: 'e4',
        sourceId: 'boss',
        targetId: 'boss',
        spellId: 'shadowfury',
        kind: 'INTERRUPT',
      },
      'me'
    );
    assert.equal(tl.length, 0);
  });
});
