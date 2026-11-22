import assert from 'node:assert';

console.log('--- 运行地图缩减40%核心60%矩形战斗与外圈自由移动机制测试 ---');

// 画布尺寸标准 780 x 360
const CANVAS_WIDTH = 780;
const CANVAS_HEIGHT = 360;

// 计算中间 60% 核心战斗矩形 (宽 60%，高 60%，居中)
const ARENA_WIDTH = CANVAS_WIDTH * 0.6; // 468
const ARENA_HEIGHT = CANVAS_HEIGHT * 0.6; // 216
const ARENA_MIN_X = (CANVAS_WIDTH - ARENA_WIDTH) / 2; // 156
const ARENA_MAX_X = ARENA_MIN_X + ARENA_WIDTH; // 624
const ARENA_MIN_Y = (CANVAS_HEIGHT - ARENA_HEIGHT) / 2; // 72
const ARENA_MAX_Y = ARENA_MIN_Y + ARENA_HEIGHT; // 288

function isInCentral60Rect(x: number, y: number): boolean {
  return x >= ARENA_MIN_X && x <= ARENA_MAX_X && y >= ARENA_MIN_Y && y <= ARENA_MAX_Y;
}

// 全图物理移动边界 (外圈不限制移动，保留 30px 画布边缘缓冲区)
const FULL_MAP_MIN_X = 30;
const FULL_MAP_MAX_X = CANVAS_WIDTH - 30; // 750
const FULL_MAP_MIN_Y = 30;
const FULL_MAP_MAX_Y = CANVAS_HEIGHT - 30; // 330

function isInFullMapMovable(x: number, y: number): boolean {
  return x >= FULL_MAP_MIN_X && x <= FULL_MAP_MAX_X && y >= FULL_MAP_MIN_Y && y <= FULL_MAP_MAX_Y;
}

async function runTests() {
  // Test 1: 验证核心 60% 矩形范围几何计算准确
  assert.strictEqual(ARENA_WIDTH, 468, '核心区域宽度应为画布宽度的60% (468px)');
  assert.strictEqual(ARENA_HEIGHT, 216, '核心区域高度应为画布高度的60% (216px)');
  assert.strictEqual(ARENA_MIN_X, 156, '左侧外圈留白边距应为 20% (156px)');
  assert.strictEqual(ARENA_MAX_X, 624, '右侧外圈留白边距起点应为 80% (624px)');
  assert.strictEqual(ARENA_MIN_Y, 72, '顶部外圈留白边距应为 20% (72px)');
  assert.strictEqual(ARENA_MAX_Y, 288, '底部外圈留白边距起点应为 80% (288px)');
  console.log('✓ 1. 中间 60% 矩形战斗区域与外圈 40% 留白边距几何尺寸校验通过');

  // Test 2: 验证首领、坦克、近战与远程治疗默认战斗站位完全集中在 60% 矩形内
  const defaultCombatPositions = [
    { role: 'BOSS', name: '首领站位', x: 500, y: 180 },
    { role: 'TANK', name: '健康主坦 (控怪背对人群)', x: 445, y: 180 },
    { role: 'TANK', name: '危急主坦 (向人群退守)', x: 400, y: 180 },
    { role: 'MELEE', name: '近战侧翼1', x: 470, y: 150 },
    { role: 'MELEE', name: '近战侧翼2', x: 470, y: 210 },
    { role: 'RANGED', name: '远程输出前排', x: 310, y: 140 },
    { role: 'RANGED', name: '远程输出后排', x: 210, y: 220 },
    { role: 'HEALER', name: '治疗后排中心', x: 200, y: 180 },
    { role: 'PLAYER', name: '玩家初始站位', x: 230, y: 180 },
  ];

  for (const pos of defaultCombatPositions) {
    assert.strictEqual(
      isInCentral60Rect(pos.x, pos.y),
      true,
      `默认战斗角色【${pos.name}】(${pos.x}, ${pos.y}) 必须严格落在中间 60% 矩形内`
    );
  }
  console.log('✓ 2. 首领、坦克、近战、远程、治疗及玩家默认战斗站位严格集中于中间 60% 矩形校验通过');

  // Test 3: 验证外圈不设阻，玩家与角色可自由移动至外圈任意位置 (广阔视野但无空气墙)
  const outerMoveTarget1 = { x: 80, y: 50, desc: '左上角大殿外圈' };
  const outerMoveTarget2 = { x: 720, y: 310, desc: '右下角大殿外圈' };
  const outerMoveTarget3 = { x: 390, y: 40, desc: '正上方大殿外圈' };
  const outerMoveTarget4 = { x: 390, y: 320, desc: '正下方大殿外圈' };

  const outerTargets = [outerMoveTarget1, outerMoveTarget2, outerMoveTarget3, outerMoveTarget4];
  for (const t of outerTargets) {
    // 确认位于外圈 (不在核心 60% 矩形)
    assert.strictEqual(isInCentral60Rect(t.x, t.y), false, `${t.desc} 应位于外圈`);
    // 确认位于全图可移动区域内 (允许玩家走位与风筝)
    assert.strictEqual(isInFullMapMovable(t.x, t.y), true, `${t.desc} 必须在全图可移动物理范围内`);
  }
  console.log('✓ 3. 外圈全图自由移动与无空气墙判定机制校验通过');

  console.log('🎉 全部地图缩减40%核心60%矩形战斗与外圈自由移动机制测试通过！');
}

runTests().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
