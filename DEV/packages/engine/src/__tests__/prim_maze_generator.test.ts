import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  generateMazeLayout,
  hashSeed,
  scaleMazeParams,
  clampToMazePath,
  collectOffMainPathCells,
  findPathCells,
  MAZE_VIEWPORT_FRACTION,
  MAZE_HUD_SAFE_INSETS,
  MAZE_LAYOUT_REVISION,
  MAZE_CANVAS_LOGICAL_SIZE,
  MAZE_AMBIENT_MIN_PATH_DIST,
  isMazeLayoutViewportCurrent,
} from '../dungeon/MazeGenerator.js';
import {
  getMazeProfile,
  SHADOWFANG_MAZE_PROFILE,
  DRAGON_SOUL_MAZE_PROFILE,
} from '../dungeon/DungeonMazeProfiles.js';

describe('Prim 迷宫生成器', () => {
  it('同副本同关卡种子稳定，异关卡不同', () => {
    assert.equal(hashSeed('shadowfang_keep', 0), hashSeed('shadowfang_keep', 0));
    assert.notEqual(hashSeed('shadowfang_keep', 0), hashSeed('shadowfang_keep', 1));
    assert.notEqual(hashSeed('shadowfang_keep', 0), hashSeed('dragon_soul', 0));
  });

  it('5人约7s / 20人约14s 规模与堆数合理，宽度+30%且比例不变', () => {
    const s5 = scaleMazeParams(7000, '5man');
    const s20 = scaleMazeParams(14000, '20man');
    assert.ok(s5.packCount >= 2 && s5.packCount <= 3);
    assert.ok(s20.packCount >= 2 && s20.packCount <= 3);
    assert.ok(s5.spawnPackCount >= 8, '5人总堆数应 ≥ 8');
    assert.ok(s20.spawnPackCount >= 11, '20人总堆数应 ≥ 11');
    assert.ok(s20.cols >= s5.cols);
    // rev10 宽度再增 30%: 5人 cols: 31 -> 41 (≥39)
    assert.ok(s5.cols >= 39, '5 人列数应约增加 30% 到 41 列');
    assert.ok(s20.cols >= 65, '20 人列数应约增加 30% 到 67 列');
    // 比例严格保持不变 (ratio 差异 < 0.05)
    assert.ok(Math.abs(s5.cols / s5.rows - 31 / 21) < 0.05, '5人长宽比必须保持不变');
    assert.ok(Math.abs(s20.cols / s20.rows - 51 / 33) < 0.05, '20人长宽比必须保持不变');
    assert.ok(SHADOWFANG_MAZE_PROFILE.targetTravelMs === 7000);
    assert.ok(DRAGON_SOUL_MAZE_PROFILE.targetTravelMs === 14000);
  });

  it('生成可通达入口→出口通路，至少 6 堆刷新、路径遭遇 2–3 堆', () => {
    const profile = getMazeProfile('shadowfang_keep');
    const a = generateMazeLayout({ dungeonId: 'shadowfang_keep', stageIndex: 0, profile });
    const b = generateMazeLayout({ dungeonId: 'shadowfang_keep', stageIndex: 0, profile });
    assert.equal(a.seed, b.seed);
    assert.deepEqual(a.waypoints, b.waypoints);
    assert.ok(a.waypoints.length >= 2);
    const packIds = new Set(a.trashSpawns.map((s) => s.packIndex));
    assert.ok(packIds.size >= 6, '场景至少 6 堆');
    const encounterPacks = new Set(
      a.trashSpawns.filter((s) => s.isEncounter).map((s) => s.packIndex)
    );
    assert.ok(encounterPacks.size >= 2 && encounterPacks.size <= 3);
    assert.equal(a.packCount, encounterPacks.size);
    assert.ok(a.trashSpawns.every((s) => typeof s.isEncounter === 'boolean'));
    assert.ok(a.grid.some((v) => v === 1));
    assert.ok(a.grid.some((v) => v === 0));
    assert.ok(isMazeLayoutViewportCurrent(a));

    const c = generateMazeLayout({ dungeonId: 'shadowfang_keep', stageIndex: 1, profile });
    assert.notEqual(a.seed, c.seed);
  });

  it('非遭遇怪必须在必经主路外（≥3 格岔道）', () => {
    const layout = generateMazeLayout({
      dungeonId: 'shadowfang_keep',
      stageIndex: 0,
      profile: getMazeProfile('shadowfang_keep'),
    });
    const main = findPathCells(
      layout.grid,
      layout.cols,
      layout.rows,
      { c: layout.entrance.col, r: layout.entrance.row },
      { c: layout.exit.col, r: layout.exit.row }
    );
    const off = collectOffMainPathCells(
      layout.grid,
      layout.cols,
      layout.rows,
      main,
      MAZE_AMBIENT_MIN_PATH_DIST
    );
    assert.ok(off.length >= 1, '应有主路外通路格');

    const ambient = layout.trashSpawns.filter((s) => !s.isEncounter);
    assert.ok(ambient.length > 0);
    for (const s of ambient) {
      assert.ok(typeof s.worldX === 'number' && typeof s.worldY === 'number');
      // 映射回格子：应落在 off-main 集合或至少不在主路格子中心带
      const col = Math.floor((s.worldX! - layout.originX) / layout.cellSize);
      const row = Math.floor((s.worldY! - layout.originY) / layout.cellSize);
      const onMain = main.some((p) => p.c === col && p.r === row);
      assert.equal(onMain, false, `氛围堆落在主路格 (${col},${row})`);
    }

    // 验证场景怪各堆之间有良好空间间隔，不扎堆
    const ambientPackCenters: Array<{ x: number; y: number }> = [];
    const packMap = new Map<number, Array<{ x: number; y: number }>>();
    for (const s of ambient) {
      if (!packMap.has(s.packIndex)) packMap.set(s.packIndex, []);
      packMap.get(s.packIndex)!.push({ x: s.worldX!, y: s.worldY! });
    }
    for (const [, mobs] of packMap) {
      const avgX = mobs.reduce((acc, m) => acc + m.x, 0) / mobs.length;
      const avgY = mobs.reduce((acc, m) => acc + m.y, 0) / mobs.length;
      ambientPackCenters.push({ x: avgX, y: avgY });
    }
    for (let i = 0; i < ambientPackCenters.length; i++) {
      for (let j = i + 1; j < ambientPackCenters.length; j++) {
        const d = Math.hypot(ambientPackCenters[i].x - ambientPackCenters[j].x, ambientPackCenters[i].y - ambientPackCenters[j].y);
        assert.ok(d >= layout.cellSize * 2.5, `氛围堆间距过近: ${d}`);
      }
    }
  });

  it('画布不变，迷宫在屏幕中间 70% 区域居中铺满', () => {
    const canvasW = MAZE_CANVAS_LOGICAL_SIZE.width;
    const canvasH = MAZE_CANVAS_LOGICAL_SIZE.height;
    assert.equal(canvasW, 780);
    assert.equal(canvasH, 360);
    const layout = generateMazeLayout({
      dungeonId: 'shadowfang_keep',
      stageIndex: 0,
      profile: getMazeProfile('shadowfang_keep'),
      canvasWidth: canvasW,
      canvasHeight: canvasH,
    });
    assert.equal(layout.viewportFraction, MAZE_VIEWPORT_FRACTION);
    assert.equal(layout.layoutRevision, MAZE_LAYOUT_REVISION);
    const mazeW = layout.cols * layout.cellSize;
    const mazeH = layout.rows * layout.cellSize;
    assert.ok(mazeW <= canvasW * MAZE_VIEWPORT_FRACTION + 1);
    assert.ok(mazeH <= canvasH * MAZE_VIEWPORT_FRACTION + 1);
    assert.ok(layout.originX >= MAZE_HUD_SAFE_INSETS.left - 0.5);
    assert.ok(layout.originY >= MAZE_HUD_SAFE_INSETS.top - 0.5);
    assert.ok(layout.originX + mazeW <= canvasW - MAZE_HUD_SAFE_INSETS.right + 0.5);
    assert.ok(layout.originY + mazeH <= canvasH - MAZE_HUD_SAFE_INSETS.bottom + 0.5);
    assert.equal(MAZE_HUD_SAFE_INSETS.top, 54, '70% 居中上边距为 54');
    assert.equal(MAZE_HUD_SAFE_INSETS.bottom, 54, '70% 居中下边距为 54');
    // 迷宫水平居中（左右边距相等）
    const leftGap = layout.originX;
    const rightGap = canvasW - (layout.originX + mazeW);
    assert.ok(Math.abs(leftGap - rightGap) <= 1);
    assert.ok(layout.exit.x > layout.originX && layout.exit.y > layout.originY);
  });

  it('旧 layoutRevision 缓存视为过期并应重新生成', () => {
    const fresh = generateMazeLayout({
      dungeonId: 'shadowfang_keep',
      stageIndex: 0,
      profile: getMazeProfile('shadowfang_keep'),
    });
    const forged = { ...fresh, layoutRevision: 1 };
    assert.equal(isMazeLayoutViewportCurrent(forged), false);
    assert.equal(isMazeLayoutViewportCurrent(fresh), true);
  });

  it('clampToMazePath 落在通路格上', () => {
    const layout = generateMazeLayout({
      dungeonId: 'shadowfang_keep',
      stageIndex: 2,
      profile: getMazeProfile('shadowfang_keep'),
    });
    const p = clampToMazePath(layout, 0, 0);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  });

  it('缓存命中直接返回', () => {
    const profile = getMazeProfile('dragon_soul');
    const first = generateMazeLayout({ dungeonId: 'dragon_soul', stageIndex: 3, profile });
    const second = generateMazeLayout({
      dungeonId: 'dragon_soul',
      stageIndex: 3,
      profile,
      cached: first,
    });
    assert.equal(second, first);
  });

  it('四本五人迷宫主题与模型已换皮', () => {
    const ids = ['deadmines', 'scarlet_monastery', 'stratholme', 'zulgurub'] as const;
    const themeIds = new Set<string>();
    for (const id of ids) {
      const p = getMazeProfile(id);
      assert.equal(p.dungeonId, id);
      assert.ok(p.theme.id, id);
      themeIds.add(p.theme.id);
      assert.ok(p.trash.models.length >= 2);
      assert.equal(
        p.trash.models.some(m => m === 'WORGEN_PATROL' || m === 'DARK_WOLF'),
        false,
        `${id} 仍用影牙小怪模型`,
      );
      const layout = generateMazeLayout({ dungeonId: id, stageIndex: 0, profile: p });
      const packs = new Set(layout.trashSpawns.map((s) => s.packIndex));
      assert.ok(packs.size >= 6);
      const encounters = new Set(layout.trashSpawns.filter((s) => s.isEncounter).map((s) => s.packIndex));
      assert.ok(encounters.size >= 2 && encounters.size <= 3);
      assert.ok(layout.trashSpawns.every(s => p.trash.models.includes(s.mobModel)));
    }
    assert.equal(themeIds.size, 4);
  });
});
