import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  radToFacingDir,
  facingPoseFromDir,
  facingPoseFromRad,
  FACING_DIR_LABELS,
} from '../facingOctant.js';

describe('facingOctant', () => {
  it('弧度量化为八向 E/SE/S/SW/W/NW/N/NE', () => {
    assert.equal(FACING_DIR_LABELS[radToFacingDir(0)], 'E');
    assert.equal(FACING_DIR_LABELS[radToFacingDir(Math.PI / 2)], 'S');
    assert.equal(FACING_DIR_LABELS[radToFacingDir(Math.PI)], 'W');
    assert.equal(FACING_DIR_LABELS[radToFacingDir(-Math.PI / 2)], 'N');
    assert.equal(FACING_DIR_LABELS[radToFacingDir(Math.PI / 4)], 'SE');
  });

  it('facingPoseFromRad: south face on, north face off; E/W opposite eye bias', () => {
    const south = facingPoseFromRad(Math.PI / 2);
    const north = facingPoseFromRad(-Math.PI / 2);
    const east = facingPoseFromRad(0);
    const west = facingPoseFromRad(Math.PI);
    assert.ok(south.faceAlpha > 0.9);
    assert.equal(south.showFace, true);
    assert.ok(north.faceAlpha < 0.05);
    assert.equal(north.showFace, false);
    assert.ok(east.eyeBiasX > 3.5);
    assert.ok(west.eyeBiasX < -3.5);
    assert.equal(east.flipX, false);
    assert.equal(west.flipX, false);
    assert.ok(Math.abs(south.eyeBiasX) < 0.2);
    // 纯侧视刚开始显化；略偏背仍看不见
    assert.ok(east.faceAlpha > 0.05 && east.faceAlpha < 0.35, `east faceAlpha=${east.faceAlpha}`);
    assert.ok(west.faceAlpha > 0.05 && west.faceAlpha < 0.35, `west faceAlpha=${west.faceAlpha}`);
    const justBack = facingPoseFromRad(-0.2); // 略偏北
    assert.ok(justBack.faceAlpha < 0.05, `justBack faceAlpha=${justBack.faceAlpha}`);
  });

  it('facingPoseFromRad is continuous around the circle', () => {
    const step = (Math.PI * 2) / 64;
    let prev = facingPoseFromRad(-Math.PI);
    for (let i = 1; i <= 64; i++) {
      const rad = -Math.PI + i * step;
      const pose = facingPoseFromRad(rad >= Math.PI ? rad - Math.PI * 2 : rad);
      assert.ok(
        Math.abs(pose.eyeBiasX - prev.eyeBiasX) < 1.1,
        `eyeBias jump at step ${i}: ${prev.eyeBiasX} → ${pose.eyeBiasX}`
      );
      assert.ok(
        Math.abs(pose.faceAlpha - prev.faceAlpha) < 0.35,
        `faceAlpha jump at step ${i}: ${prev.faceAlpha} → ${pose.faceAlpha}`
      );
      assert.ok(
        Math.abs(pose.shoulderScale - prev.shoulderScale) < 0.12,
        `shoulder jump at step ${i}`
      );
      prev = pose;
    }
  });

  it('facingPoseFromDir wraps continuous pose at sector centers', () => {
    assert.ok(facingPoseFromDir(0).eyeBiasX > 3.5); // E
    assert.ok(Math.abs(facingPoseFromDir(2).eyeBiasX) < 0.2); // S
    assert.ok(facingPoseFromDir(6).faceAlpha < 0.05); // N
    assert.ok(facingPoseFromDir(5).faceAlpha < 0.05); // NW 仍偏背，五官未显
    assert.ok(facingPoseFromDir(1).faceAlpha > 0.7); // SE 已朝镜头
  });

  it('volumeBoost 加大侧面肩宽、背向更扁', () => {
    const side = facingPoseFromDir(0, true);
    const back = facingPoseFromDir(6, true);
    const front = facingPoseFromDir(2, true);
    assert.ok(side.shoulderScale > facingPoseFromDir(0).shoulderScale);
    assert.ok(back.shoulderScale < facingPoseFromDir(6).shoulderScale);
    assert.ok(back.depthScaleY < facingPoseFromDir(6).depthScaleY);
    assert.ok(front.depthScaleY >= 1);
  });

  it('嘴/眼背向渐隐；手鞋始终可画', async () => {
    const { drawFacingMouth, drawFacingEyePair, drawFacingHands, drawFacingShoes, facingHandBiasX } =
      await import('../eightDirModels.js');
    const calls: string[] = [];
    const fakeCtx = {
      fillStyle: '',
      globalAlpha: 1,
      fillRect: () => {
        calls.push('rect');
      },
    } as unknown as CanvasRenderingContext2D;

    const back = facingPoseFromRad(-Math.PI / 2);
    drawFacingMouth(fakeCtx, '#f00', { pose: back });
    drawFacingEyePair(fakeCtx, '#0ff', { pose: back });
    assert.equal(calls.length, 0, '正北不画嘴/眼');

    drawFacingHands(fakeCtx, '#888', { pose: back });
    assert.ok(calls.length >= 2, '正北仍画手');
    drawFacingShoes(fakeCtx, '#000', { pose: back });
    assert.ok(calls.length >= 4, '正北仍画鞋');

    assert.ok(facingHandBiasX(facingPoseFromRad(0)) > 1.5);
    calls.length = 0;
    drawFacingMouth(fakeCtx, '#f00', { pose: facingPoseFromRad(Math.PI / 2) });
    assert.ok(calls.length >= 1, '正面画嘴');
  });
});
