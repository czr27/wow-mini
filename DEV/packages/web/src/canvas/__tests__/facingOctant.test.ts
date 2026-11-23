import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  radToFacingDir,
  facingPoseFromDir,
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

  it('西侧姿态镜像；正北隐藏五官；东西向加大眼偏置', () => {
    assert.equal(facingPoseFromDir(4).flipX, true); // W
    assert.equal(facingPoseFromDir(0).flipX, false); // E
    assert.equal(facingPoseFromDir(6).showFace, false); // N
    assert.equal(facingPoseFromDir(2).showFace, true); // S
    assert.equal(facingPoseFromDir(5).showFace, true); // NW 侧脸眼
    assert.ok(facingPoseFromDir(0).eyeBiasX >= 3.5);
    assert.ok(facingPoseFromDir(2).eyeBiasX === 0);
  });

  it('嘴/手/鞋辅助：背向不画嘴；手鞋始终可画', async () => {
    const { drawFacingMouth, drawFacingHands, drawFacingShoes, facingHandBiasX } =
      await import('../eightDirModels.js');
    const calls: string[] = [];
    const fakeCtx = {
      fillStyle: '',
      fillRect: () => {
        calls.push('rect');
      },
    } as unknown as CanvasRenderingContext2D;
    const back = facingPoseFromDir(6);
    drawFacingMouth(fakeCtx, '#f00', { pose: back });
    assert.equal(calls.length, 0, '正北不画嘴');
    drawFacingHands(fakeCtx, '#888', { pose: back });
    assert.ok(calls.length >= 2, '正北仍画手');
    drawFacingShoes(fakeCtx, '#000', { pose: back });
    assert.ok(calls.length >= 4, '正北仍画鞋');
    assert.ok(facingHandBiasX(facingPoseFromDir(0)) > 1.5);
    calls.length = 0;
    drawFacingMouth(fakeCtx, '#f00', { pose: facingPoseFromDir(2) });
    assert.ok(calls.length >= 1, '正面画嘴');
  });
});
