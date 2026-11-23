import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ISO_PITCH_DEG_MAX,
  ISO_PITCH_DEG_MIN,
  ISO_PITCH_SIN,
  clampIsoPitchDeg,
  pitchDegFromOrbitDrag,
  pitchDegToSin,
  screenDirToWorld,
  viewToWorld,
  worldToView,
  viewDepthKey,
  type ViewCamera,
} from '../canvasViewMath.js';

describe('canvasViewMath', () => {
  it('TOPDOWN is identity at zoom 1', () => {
    const cam: ViewCamera = {
      mode: 'TOPDOWN',
      yawRad: 1.2,
      pivotX: 100,
      pivotY: 80,
      screenX: 400,
      screenY: 200,
      zoom: 1,
    };
    assert.deepEqual(worldToView(40, 50, cam), { x: 40, y: 50 });
    assert.deepEqual(viewToWorld(40, 50, cam), { x: 40, y: 50 });
  });

  it('TOPDOWN zoom round-trips around screen center', () => {
    const cam: ViewCamera = {
      mode: 'TOPDOWN',
      yawRad: 0,
      pivotX: 390,
      pivotY: 180,
      screenX: 390,
      screenY: 180,
      zoom: 0.5,
    };
    const v = worldToView(490, 220, cam);
    const back = viewToWorld(v.x, v.y, cam);
    assert.ok(Math.abs(back.x - 490) < 1e-6);
    assert.ok(Math.abs(back.y - 220) < 1e-6);
    // Center stays fixed
    assert.deepEqual(worldToView(390, 180, cam), { x: 390, y: 180 });
  });

  it('ISO maps pivot to screen center and round-trips', () => {
    const cam: ViewCamera = {
      mode: 'ISO',
      yawRad: Math.PI / 5,
      pivotX: 230,
      pivotY: 180,
      screenX: 400,
      screenY: 200,
      pitchSin: ISO_PITCH_SIN,
      zoom: 1.5,
    };
    const atPivot = worldToView(230, 180, cam);
    assert.ok(Math.abs(atPivot.x - 400) < 1e-6);
    assert.ok(Math.abs(atPivot.y - 200) < 1e-6);

    const pts = [
      { x: 230, y: 180 },
      { x: 290, y: 200 },
      { x: 140, y: 120 },
      { x: 500, y: 250 },
    ];
    for (const p of pts) {
      const v = worldToView(p.x, p.y, cam);
      const back = viewToWorld(v.x, v.y, cam);
      assert.ok(Math.abs(back.x - p.x) < 1e-6, `x ${back.x} vs ${p.x}`);
      assert.ok(Math.abs(back.y - p.y) < 1e-6, `y ${back.y} vs ${p.y}`);
    }
  });

  it('pitch drag: mouse down → 90°, mouse up → 20°, clamped', () => {
    assert.equal(clampIsoPitchDeg(10), ISO_PITCH_DEG_MIN);
    assert.equal(clampIsoPitchDeg(100), ISO_PITCH_DEG_MAX);
    assert.ok(Math.abs(pitchDegToSin(90) - 1) < 1e-9);
    assert.ok(Math.abs(pitchDegToSin(20) - 0.4) < 1e-9);
    const span = ISO_PITCH_DEG_MAX - ISO_PITCH_DEG_MIN;
    assert.ok(Math.abs(pitchDegToSin(60) - (0.4 + ((60 - 20) / span) * 0.6)) < 1e-9);
    assert.equal(pitchDegFromOrbitDrag(60, 10_000), ISO_PITCH_DEG_MAX);
    assert.equal(pitchDegFromOrbitDrag(60, -10_000), ISO_PITCH_DEG_MIN);
  });

  it('screenDirToWorld: unpitch then un-yaw (camera-relative)', () => {
    const cam: ViewCamera = {
      mode: 'ISO',
      yawRad: 0,
      pivotX: 0,
      pivotY: 0,
      screenX: 0,
      screenY: 0,
      pitchSin: 0.5,
    };
    // Screen up (0,-1): unpitch → (0,-2); yaw 0 → world (0,-2)
    const up = screenDirToWorld(0, -1, cam);
    assert.ok(Math.abs(up.x) < 1e-9);
    assert.ok(Math.abs(up.y - -2) < 1e-9);

    const cam90: ViewCamera = { ...cam, yawRad: Math.PI / 2 };
    // Screen right (1,0): no pitch on X; yaw 90° → world (0, 1)
    const right = screenDirToWorld(1, 0, cam90);
    assert.ok(Math.abs(right.x) < 1e-9);
    assert.ok(Math.abs(right.y - 1) < 1e-9);
    // Screen up at yaw 90° → world +X after unpitch
    const up90 = screenDirToWorld(0, -1, cam90);
    assert.ok(Math.abs(up90.x - 2) < 1e-9);
    assert.ok(Math.abs(up90.y) < 1e-9);
  });

  it('pitch foreshortens camera-forward the same at every yaw', () => {
    const pitch = 0.5;
    const depth = 100;
    for (const yaw of [0, Math.PI / 4, Math.PI / 2, Math.PI]) {
      const cam: ViewCamera = {
        mode: 'ISO',
        yawRad: yaw,
        pivotX: 0,
        pivotY: 0,
        screenX: 0,
        screenY: 0,
        pitchSin: pitch,
        zoom: 1,
      };
      // Camera-forward in world = R(+yaw) * (0, depth)
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const wx = -depth * s;
      const wy = depth * c;
      const v = worldToView(wx, wy, cam);
      assert.ok(Math.abs(v.x) < 1e-6, `yaw=${yaw} vx=${v.x}`);
      assert.ok(Math.abs(v.y - depth * pitch) < 1e-6, `yaw=${yaw} vy=${v.y}`);
    }
  });

  it('viewDepthKey: closer-to-camera has larger key (draw later)', () => {
    const cam: ViewCamera = {
      mode: 'ISO',
      yawRad: 0,
      pivotX: 100,
      pivotY: 100,
      screenX: 200,
      screenY: 200,
      pitchSin: 0.7,
      zoom: 1,
    };
    // yaw 0: depth = worldY - pivotY; larger world Y => closer (bottom of screen)
    const far = viewDepthKey(100, 50, cam);
    const near = viewDepthKey(100, 150, cam);
    assert.ok(near > far, `near=${near} far=${far}`);
    // yaw 90°: depth aligns with +X in world after -yaw rotate
    const cam90: ViewCamera = { ...cam, yawRad: Math.PI / 2 };
    const left = viewDepthKey(50, 100, cam90);
    const right = viewDepthKey(150, 100, cam90);
    assert.ok(left > right, `left=${left} right=${right}`);
  });

});
