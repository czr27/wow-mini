/**
 * Cast lifecycle EFFECT → remote action-bar timelines.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CombatEffect, NetworkCastTimeline } from '@cata-raid-sim/engine';
import {
  applyCastEndFlashToCompanionCasts,
  applyCastLifecycleToTimelines,
  applyRemoteCastEffect,
  companionCastsFromTimelines,
  stampBossCastOntoUnit,
  syncBossCastHud,
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

  it('CAST_LAND flashes green full bar; INTERRUPT flashes red', () => {
    const tl: NetworkCastTimeline[] = [
      {
        unitId: 'healer',
        spellId: 'healing_touch',
        spellName: '治疗之触',
        startedAtMs: Date.now() - 500,
        totalMs: 2500,
      },
    ];
    const land = applyCastEndFlashToCompanionCasts(
      {},
      {
        effectId: 'e5',
        sourceId: 'healer',
        targetId: 'tank',
        spellId: 'healing_touch',
        spellName: '治疗之触',
        kind: 'CAST_LAND',
      },
      tl,
      Date.now()
    );
    assert.equal(land.healer.endFlash, 'success');
    assert.equal(land.healer.progress, 1);

    const kick = applyCastEndFlashToCompanionCasts(
      {},
      {
        effectId: 'e6',
        sourceId: 'boss',
        targetId: 'boss',
        spellId: 'shadowfury',
        kind: 'INTERRUPT',
      },
      [
        {
          unitId: 'boss',
          spellId: 'shadowfury',
          spellName: '暗影之怒',
          startedAtMs: Date.now(),
          totalMs: 3000,
        },
      ],
      Date.now()
    );
    assert.equal(kick.boss.endFlash, 'interrupt');
    assert.equal(kick.boss.progress, 1);
  });

  it('stampBossCastOntoUnit sets nameplate fields for guest canvas', () => {
    const boss: any = { id: 'boss' };
    stampBossCastOntoUnit(boss, {
      spellName: '暗影箭',
      progress: 0.4,
      totalMs: 2000,
    });
    assert.equal(boss.isCasting, true);
    assert.equal(boss.castingSpellName, '暗影箭');
    assert.ok(Math.abs(boss.castProgress - 0.4) < 1e-6);
    stampBossCastOntoUnit(boss, null);
    assert.equal(boss.isCasting, false);
  });

  it('applyRemoteCastEffect is the single CAST HUD mutate path', () => {
    const start = applyRemoteCastEffect({
      effect: {
        effectId: 'e7',
        sourceId: 'boss',
        targetId: 'tank',
        spellId: 'bolt',
        spellName: '暗影箭',
        kind: 'CAST_START',
        totalMs: 2000,
        atMs: 1_000_000,
      },
      timelines: [],
      companionCasts: {},
      skipUnitId: 'me',
      now: 1_000_200,
    });
    assert.equal(start.timelines.length, 1);
    assert.ok(start.companionCasts.boss);
    assert.ok(start.companionCasts.boss.progress > 0);

    const land = applyRemoteCastEffect({
      effect: {
        effectId: 'e8',
        sourceId: 'boss',
        targetId: 'tank',
        spellId: 'bolt',
        kind: 'CAST_LAND',
        atMs: 1_002_000,
      },
      timelines: start.timelines,
      companionCasts: start.companionCasts,
      skipUnitId: 'me',
      now: 1_002_000,
    });
    assert.equal(land.timelines.length, 0);
    assert.equal(land.companionCasts.boss.endFlash, 'success');

    const boss: any = { id: 'boss' };
    let guest: any = 'unset';
    syncBossCastHud({
      boss,
      cast: land.companionCasts.boss,
      setGuestBossCasting: (v) => {
        guest = v;
      },
    });
    assert.equal(guest, null);
    assert.equal(boss.castProgress, 1);
  });

  it('syncBossCastHud preserves recentOverheadSkillName when not casting (instant/post-cast)', () => {
    const boss: any = { id: 'boss' };
    syncBossCastHud({
      boss,
      cast: null,
      recentOverheadSkillName: '践踏',
    });
    assert.equal(boss.isCasting, false);
    assert.equal(boss.overheadSkillName, '践踏');

    syncBossCastHud({
      boss,
      cast: { spellName: '暗影箭', progress: 0.5, totalMs: 2000 },
      recentOverheadSkillName: '践踏',
    });
    assert.equal(boss.isCasting, true);
    assert.equal(boss.castingSpellName, '暗影箭');
    assert.equal(boss.overheadSkillName, '暗影箭');

    syncBossCastHud({
      boss,
      cast: null,
      recentOverheadSkillName: null,
    });
    assert.equal(boss.isCasting, false);
    assert.equal(boss.overheadSkillName, undefined);
  });
});
