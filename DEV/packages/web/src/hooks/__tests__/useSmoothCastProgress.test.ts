import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeSmoothCastStep,
  shouldReanchorCastClock,
} from '../useSmoothCastProgress.js';

describe('useSmoothCastProgress helpers', () => {
  it('computes linear ratio and 1-decimal remaining time across frames', () => {
    const start = 10_000;
    const total = 1500;

    const s0 = computeSmoothCastStep(start, start, total);
    assert.equal(s0.ratio, 0);
    assert.equal(s0.remainText, '1.5');

    const sMid = computeSmoothCastStep(start + 750, start, total);
    assert.equal(sMid.ratio, 0.5);
    assert.equal(sMid.remainText, '0.8');

    const sEnd = computeSmoothCastStep(start + 2000, start, total);
    assert.equal(sEnd.ratio, 1);
    assert.equal(sEnd.remainText, '0.0');
  });

  it('ignores normal 20Hz tick jitter without re-anchoring', () => {
    // Tick says 500ms, local rAF clock is at 525ms -> 25ms drift <= 80ms threshold
    assert.equal(shouldReanchorCastClock(500, 450, 525), false);
  });

  it('re-anchors on new cast reset or large drift', () => {
    // Elapsed dropped significantly -> new cast of same spell
    assert.equal(shouldReanchorCastClock(0, 1400, 1450), true);
    // Large drift (> 80ms), e.g., tab backgrounded or haste change
    assert.equal(shouldReanchorCastClock(900, 850, 500), true);
  });
});
