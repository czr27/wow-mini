import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bodyPitchShearX,
  bodyPitchSquashScale,
  depthFogFactor,
} from '../isoVolumeFx.js';
import { ISO_PITCH_DEG_MAX, ISO_PITCH_DEG_MIN, type ViewCamera } from '../canvasViewMath.js';

describe('isoVolumeFx', () => {
  it('body pitch squash: 90→1, 20→squashAtMin', () => {
    assert.ok(Math.abs(bodyPitchSquashScale(ISO_PITCH_DEG_MAX, 0.78) - 1) < 1e-9);
    assert.ok(Math.abs(bodyPitchSquashScale(ISO_PITCH_DEG_MIN, 0.78) - 0.78) < 1e-9);
    const mid = bodyPitchSquashScale(55, 0.78);
    assert.ok(mid > 0.78 && mid < 1);
  });

  it('shear grows as pitch lowers', () => {
    assert.ok(bodyPitchShearX(90) < bodyPitchShearX(20));
    assert.ok(bodyPitchShearX(20) > 0.05);
  });

  it('depth fog only in ISO and scales with strength', () => {
    const cam: ViewCamera = {
      mode: 'ISO',
      yawRad: 0,
      pivotX: 400,
      pivotY: 200,
      screenX: 400,
      screenY: 200,
      pitchSin: 0.7,
    };
    assert.equal(depthFogFactor(400, 200, { ...cam, mode: 'TOPDOWN' }, 0.5), 0);
    assert.equal(depthFogFactor(400, 200, cam, 0), 0);
    const far = depthFogFactor(400, 200 - 180, cam, 0.5);
    const near = depthFogFactor(400, 200 + 40, cam, 0.5);
    assert.ok(far >= near);
  });
});
