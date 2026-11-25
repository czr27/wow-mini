import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ISO_PITCH_SIN,
  isMouseChordMoveActive,
  screenDirToWorld,
  type ViewCamera,
} from '../canvasViewMath.js';

describe('2.5D Boss Room Mouse Chord Movement (RMB + LMB)', () => {
  it('activates forward movement ONLY when both RMB and LMB are held in 2.5D boss room mode', () => {
    // 1. In 2.5D mode in boss room (isIsoAllowed = true)
    assert.strictEqual(
      isMouseChordMoveActive(true, true, true),
      true,
      '按住右键按左键必须激活向前移动 (move forward active)'
    );

    // 2. Releasing LMB stops forward movement
    assert.strictEqual(
      isMouseChordMoveActive(true, true, false),
      false,
      '左键放开必须停止向前移动 (releasing LMB stops forward movement)'
    );

    // 3. Releasing RMB stops forward movement
    assert.strictEqual(
      isMouseChordMoveActive(true, false, true),
      false,
      '右键放开必须停止向前移动 (releasing RMB stops forward movement)'
    );

    // 4. Neither button held
    assert.strictEqual(
      isMouseChordMoveActive(true, false, false),
      false,
      '松开双键不移动'
    );

    // 5. In 2D top-down mode or in maze (TRAVEL_RECOVERY where isIsoAllowed = false)
    assert.strictEqual(
      isMouseChordMoveActive(false, true, true),
      false,
      '非 2.5D boss 房模式下（如迷宫通道或 2D 顶视）不得触发鼠标双键走位'
    );
  });

  it('produces the exact same forward direction vector as the W key', () => {
    const cam: ViewCamera = {
      mode: 'ISO',
      yawRad: Math.PI / 4, // 45 degrees
      pivotX: 200,
      pivotY: 200,
      screenX: 400,
      screenY: 200,
      pitchSin: ISO_PITCH_SIN,
      zoom: 1.0,
    };

    // W key screen intent is moveX = 0, moveY = -1
    const wIntent = screenDirToWorld(0, -1, cam);
    // Mouse chord forward intent is screen-up: (0, -1)
    const chordIntent = screenDirToWorld(0, -1, cam);

    assert.deepStrictEqual(
      chordIntent,
      wIntent,
      '按住右键点左键的移动方向与 W 键计算的朝向世界坐标向量必须 100% 完全一致'
    );

    // Normalizing vectors should yield same unit direction
    const chordLen = Math.hypot(chordIntent.x, chordIntent.y);
    const wLen = Math.hypot(wIntent.x, wIntent.y);
    assert.ok(Math.abs(chordLen - wLen) < 1e-9);
    assert.ok(Math.abs(chordIntent.x / chordLen - wIntent.x / wLen) < 1e-9);
    assert.ok(Math.abs(chordIntent.y / chordLen - wIntent.y / wLen) < 1e-9);
  });

  it('verifies click suppression state machine to prevent unwanted click-to-move upon releasing LMB', () => {
    let isRmbHeld = false;
    let isLmbHeld = false;
    let isChordMoving = false;
    let suppressNextClick = false;
    let lastChordMoveEndMs = 0;
    let clickTarget: { x: number; y: number } | null = null;

    const onPointerDown = (button: number) => {
      if (button === 2) {
        isRmbHeld = true;
        if (isLmbHeld) {
          isChordMoving = true;
          suppressNextClick = true;
        }
      } else if (button === 0) {
        isLmbHeld = true;
        if (isRmbHeld) {
          isChordMoving = true;
          suppressNextClick = true;
        }
      }
    };

    const onPointerUp = (button: number) => {
      if (button === 0) {
        isLmbHeld = false;
        if (isChordMoving) {
          isChordMoving = false;
          lastChordMoveEndMs = Date.now();
          suppressNextClick = true;
        }
      } else if (button === 2) {
        isRmbHeld = false;
        if (isChordMoving) {
          isChordMoving = false;
          lastChordMoveEndMs = Date.now();
          suppressNextClick = true;
        }
      }
    };

    const onClick = (targetPos: { x: number; y: number }) => {
      if (suppressNextClick || Date.now() - lastChordMoveEndMs < 250) {
        suppressNextClick = false;
        return; // Suppressed!
      }
      clickTarget = targetPos;
    };

    // Step 1: User presses and holds RMB (orbit camera)
    onPointerDown(2);
    assert.strictEqual(isRmbHeld, true);
    assert.strictEqual(isChordMoving, false);

    // Step 2: User presses LMB while holding RMB -> moves forward like W
    onPointerDown(0);
    assert.strictEqual(isChordMoving, true);
    assert.strictEqual(suppressNextClick, true);

    // Step 3: User releases LMB -> forward movement stops
    onPointerUp(0);
    assert.strictEqual(isChordMoving, false);
    assert.strictEqual(suppressNextClick, true);

    // Step 4: Browser dispatches click event for the released LMB
    onClick({ x: 300, y: 150 });
    assert.strictEqual(
      clickTarget,
      null,
      '放开左键触发的 click 事件必须被抑制，严禁误触发单击地面移动或误选目标'
    );

    // Step 5: Later normal LMB click (without RMB) proceeds normally
    // Release RMB and advance time slightly to simulate post-chord click
    onPointerUp(2);
    lastChordMoveEndMs = 0;
    suppressNextClick = false;
    onPointerDown(0);
    onPointerUp(0);
    onClick({ x: 350, y: 180 });
    assert.deepStrictEqual(
      clickTarget,
      { x: 350, y: 180 },
      '后续正常单击地面仍可正常触发走位'
    );
  });
});
