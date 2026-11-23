/**
 * Prim 迷宫生成（可复用于任意副本赶路段）。
 * 种子 = hash(dungeonId + stageIndex)，保证同关卡布局/小怪位一致。
 */

export type MazeCellKind = 'WALL' | 'PATH';

export interface MazeTheme {
  id: string;
  /** 地面主色 */
  floorColor: string;
  /** 墙壁主色 */
  wallColor: string;
  /** 路径描边 / 高亮 */
  pathAccent: string;
  /** 背景氛围色 */
  ambienceColor: string;
  /** 火把/装饰色 */
  torchColor: string;
}

export interface MazeTrashNamePool {
  packNames: string[];
  models: string[];
}

export interface MazeDungeonProfile {
  dungeonId: string;
  name: string;
  tier: '5man' | '20man';
  /** 目标赶路时长（ms） */
  targetTravelMs: number;
  theme: MazeTheme;
  trash: MazeTrashNamePool;
}

export interface MazeTrashSpawnSpec {
  id: string;
  name: string;
  mobModel: string;
  packIndex: number;
  /** 沿解通路路径的归一化距离 0..1（遭遇堆用；氛围堆为最近主路投影） */
  pathT: number;
  offsetX: number;
  offsetY: number;
  maxHp: number;
  /**
   * true = 赶路时间线上会停下来打的遭遇堆（每图 2–3 堆）；
   * false = 仅场景刷新，必须在必经主路外（≥3 格岔道/死胡同）。
   */
  isEncounter: boolean;
  /** 非遭遇堆：绝对画布坐标（主路外通路格）；有值时优先于 pathT+offset */
  worldX?: number;
  worldY?: number;
}

/**
 * Maze fills HUD-safe rect (no central fraction cap). Kept for cache compatibility;
 * placement uses side margins from combat-stats width instead.
 */
export const MAZE_VIEWPORT_FRACTION = 1;

/**
 * Bump when HUD insets / placement rules change so cached layouts regenerate.
 * Rev 2: larger bottom inset — 3 action bars + resource strip were covering maze paths.
 * Rev 3: whole maze playfield shifted up 100px to clear action bars.
 * Rev 4–5: interim canvas-size experiments (reverted).
 * Rev 6: canvas stays 780×360; maze W/H grows inside it and stays centered;
 *        L/R leave up to 1.5× stats width; top fixed; bottom extends +30.
 * Rev 7: maze generate width / cols ×1.6 (more complex); travel ms unchanged —
 *        clients speed march/combat chase ×1.6 so clear time stays the same.
 * Rev 8: ≥6 trash packs spawned; 2–3 marked isEncounter on the march path.
 * Rev 9: non-encounter packs spawn only off the mandatory path (≥3 cells away).
 */
export const MAZE_LAYOUT_REVISION = 9;

/** Non-encounter packs must sit at least this many PATH cells off the main route. */
export const MAZE_AMBIENT_MIN_PATH_DIST = 3;

/** Minimum trash packs visible in each maze (ambience + encounters). */
export const MAZE_MIN_SPAWN_PACKS = 6;
/** Path encounters per maze (inclusive range). */
export const MAZE_ENCOUNTER_PACKS_MIN = 2;
export const MAZE_ENCOUNTER_PACKS_MAX = 3;

/** @deprecated Rev6 centers in HUD-safe box; kept for callers/tests. */
export const MAZE_UPWARD_SHIFT_PX = 0;

/** Combat canvas design size — do not grow the canvas for maze. */
export const MAZE_CANVAS_LOGICAL_SIZE = { width: 780, height: 360 } as const;

/** Default combat StatsPanel width — maze L/R each leave up to 1.5× this. */
export const COMBAT_STATS_DEFAULT_WIDTH = 300;
export const MAZE_SIDE_MARGIN_FROM_STATS = Math.round(COMBAT_STATS_DEFAULT_WIDTH * 1.5); // 450

/** Bottom inset before “再向下” extension (rev3 action-bar clearance). */
const MAZE_BOTTOM_INSET_BASE = 172;
/** Maze bottom edge extends this many px lower than the prior clearance. */
export const MAZE_BOTTOM_EXTEND_PX = 30;

/**
 * Maze playfield / grid width scale vs rev6 (~70% band + base cols).
 * Longer path → clients multiply march/combat chase by the same factor so
 * targetTravelMs (过关时间) stays unchanged.
 */
export const MAZE_WIDTH_COMPLEXITY_SCALE = 1.6;
/** Same as width scale — use for lead / WASD / party lerp during travel. */
export const MAZE_TRAVERSE_SPEED_SCALE = MAZE_WIDTH_COMPLEXITY_SCALE;

/**
 * Resolve L/R insets for a canvas (equal on both sides → maze stays centered).
 * Prefer leaving 1.5× default stats width each side when the canvas is wide enough
 * to still keep the maze wider than the old ~50% band; otherwise target
 * ~70% × MAZE_WIDTH_COMPLEXITY_SCALE of canvas width (clamped to full width).
 */
export function mazeSideInsetForCanvas(canvasWidth: number): number {
  const desired = MAZE_SIDE_MARGIN_FROM_STATS;
  const oldBand = canvasWidth * 0.5;
  const playIfDesired = canvasWidth - 2 * desired;
  if (playIfDesired >= oldBand * 1.1) return desired;
  const targetPlay = Math.min(
    canvasWidth,
    Math.ceil(canvasWidth * 0.7 * MAZE_WIDTH_COMPLEXITY_SCALE)
  );
  return Math.max(0, Math.floor((canvasWidth - targetPlay) / 2));
}

/** HUD-safe insets for the design canvas (maze grows inside; canvas size fixed). */
export const MAZE_HUD_SAFE_INSETS = {
  left: mazeSideInsetForCanvas(MAZE_CANVAS_LOGICAL_SIZE.width),
  right: mazeSideInsetForCanvas(MAZE_CANVAS_LOGICAL_SIZE.width),
  top: 56,
  bottom: MAZE_BOTTOM_INSET_BASE - MAZE_BOTTOM_EXTEND_PX, // 142
} as const;

export interface MazeLayout {
  dungeonId: string;
  stageIndex: number;
  seed: number;
  cols: number;
  rows: number;
  cellSize: number;
  /** Top-left of maze grid in canvas px (central 50% ∩ HUD-safe). */
  originX: number;
  originY: number;
  /** rows * cols, 1=PATH 0=WALL */
  grid: number[];
  /** 画布坐标通路折线（入口→出口） */
  waypoints: Array<{ x: number; y: number }>;
  entrance: { x: number; y: number; col: number; row: number };
  exit: { x: number; y: number; col: number; row: number };
  trashSpawns: MazeTrashSpawnSpec[];
  theme: MazeTheme;
  targetTravelMs: number;
  packCount: number;
  generatedAtMs: number;
  /** Must match MAZE_VIEWPORT_FRACTION; stale caches without this are regenerated */
  viewportFraction?: number;
  /** Must match MAZE_LAYOUT_REVISION */
  layoutRevision?: number;
}

/**
 * Fit maze grid into HUD-safe area (raid frames / banner / action bar), capped to
 * viewportFraction of the canvas, then center within that box.
 */
export function computeMazePlacement(
  cols: number,
  rows: number,
  baseCellSize: number,
  canvasWidth: number,
  canvasHeight: number,
  viewportFraction: number = MAZE_VIEWPORT_FRACTION
): { cellSize: number; originX: number; originY: number; mazeW: number; mazeH: number } {
  const side = mazeSideInsetForCanvas(canvasWidth);
  const safeX0 = side;
  const safeY0 = MAZE_HUD_SAFE_INSETS.top;
  const safeX1 = canvasWidth - side;
  const safeY1 = canvasHeight - MAZE_HUD_SAFE_INSETS.bottom;
  const safeW = Math.max(1, safeX1 - safeX0);
  const safeH = Math.max(1, safeY1 - safeY0);
  // Fill HUD-safe rect (viewportFraction≤1 keeps optional cap for legacy callers)
  const playW = Math.max(1, Math.min(safeW, canvasWidth * Math.max(viewportFraction, 0.5)));
  const playH = Math.max(1, Math.min(safeH, canvasHeight * Math.max(viewportFraction, 0.5)));
  // Always center the playfield (and the maze inside it) on the canvas.
  const playX0 = (canvasWidth - playW) / 2;
  const playY0 = safeY0 + (safeH - playH) / 2;

  const rawW = Math.max(1, cols * baseCellSize);
  const rawH = Math.max(1, rows * baseCellSize);
  const scale = Math.min(playW / rawW, playH / rawH);
  const cellSize = Math.max(6, Math.floor(baseCellSize * scale));
  const mazeW = cols * cellSize;
  const mazeH = rows * cellSize;
  const originX = playX0 + (playW - mazeW) / 2;
  const originY = playY0 + (playH - mazeH) / 2;
  return { cellSize, originX, originY, mazeW, mazeH };
}

/** Prefer baked origin from layout (waypoints/exit share the same space). */
export function getMazeDrawOrigin(
  layout: Pick<MazeLayout, 'cols' | 'rows' | 'cellSize' | 'originX' | 'originY'>,
  canvasWidth = MAZE_CANVAS_LOGICAL_SIZE.width,
  canvasHeight = MAZE_CANVAS_LOGICAL_SIZE.height,
  viewportFraction: number = MAZE_VIEWPORT_FRACTION
): { originX: number; originY: number; mazeW: number; mazeH: number } {
  const mazeW = layout.cols * layout.cellSize;
  const mazeH = layout.rows * layout.cellSize;
  if (typeof layout.originX === 'number' && typeof layout.originY === 'number') {
    return { originX: layout.originX, originY: layout.originY, mazeW, mazeH };
  }
  // Legacy layouts without origin: re-fit into central HUD-safe box
  const placed = computeMazePlacement(
    layout.cols,
    layout.rows,
    layout.cellSize,
    canvasWidth,
    canvasHeight,
    viewportFraction
  );
  return {
    originX: placed.originX,
    originY: placed.originY,
    mazeW,
    mazeH,
  };
}

/** True when layout was built for the current HUD-safe placement revision. */
export function isMazeLayoutViewportCurrent(layout: MazeLayout | null | undefined): boolean {
  return (
    !!layout &&
    layout.viewportFraction === MAZE_VIEWPORT_FRACTION &&
    layout.layoutRevision === MAZE_LAYOUT_REVISION &&
    typeof layout.originX === 'number' &&
    typeof layout.originY === 'number'
  );
}

export interface MazeGenerateOptions {
  dungeonId: string;
  stageIndex: number;
  profile: MazeDungeonProfile;
  /** 画布宽高，用于映射格子到像素 */
  canvasWidth?: number;
  canvasHeight?: number;
  /** 若提供则跳过生成直接校验/补全（服务端缓存命中） */
  cached?: MazeLayout | null;
}

/** 简单可复现 PRNG (mulberry32) */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(dungeonId: string, stageIndex: number): number {
  const s = `${dungeonId}::stage_${stageIndex}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function idx(col: number, row: number, cols: number): number {
  return row * cols + col;
}

/**
 * 根据目标时长估算迷宫规模与小怪堆数。
 * 宽度/列数 × MAZE_WIDTH_COMPLEXITY_SCALE（相对 rev6）；过关时长仍由 targetTravelMs 决定。
 * 场景至少刷 MAZE_MIN_SPAWN_PACKS 堆；路径遭遇 2–3 堆（packCount）。
 */
export function scaleMazeParams(targetTravelMs: number, tier: '5man' | '20man'): {
  cols: number;
  rows: number;
  /** 路径上会停下来打的遭遇堆数（2–3） */
  packCount: number;
  /** 场景总刷新堆数（≥6，含遭遇堆） */
  spawnPackCount: number;
  cellSize: number;
} {
  const sec = Math.max(8, Math.min(30, targetTravelMs / 1000));
  // odd dimensions for classic Prim cell carving — rev6 base × width scale
  const base = tier === '20man' ? 29 : 21;
  const boost = Math.round((sec - 10) * 0.8);
  let cols = Math.round((base + boost) * MAZE_WIDTH_COMPLEXITY_SCALE);
  let rows = Math.max(15, Math.round((base - 4 + Math.floor(boost / 2)) * Math.sqrt(MAZE_WIDTH_COMPLEXITY_SCALE)));
  if (cols % 2 === 0) cols += 1;
  if (rows % 2 === 0) rows += 1;
  cols = Math.max(15, Math.min(65, cols));
  rows = Math.max(15, Math.min(41, rows));
  // 路径遭遇 2–3 堆；场景总刷新 ≥6
  const packCount =
    tier === '20man' || sec >= 10 ? MAZE_ENCOUNTER_PACKS_MAX : MAZE_ENCOUNTER_PACKS_MIN;
  const spawnPackCount = Math.max(MAZE_MIN_SPAWN_PACKS, packCount + 3);
  // 同画布内列更多 → 格子略小，通路仍能塞进 playfield
  const cellSize = tier === '20man' ? 18 : 22;
  return { cols, rows, packCount, spawnPackCount, cellSize };
}

/**
 * Prim 迷宫：在奇数坐标单元格上生长，打通相邻墙。
 * 返回 grid（1=通路 0=墙）。
 */
export function generatePrimGrid(
  cols: number,
  rows: number,
  rand: () => number
): { grid: number[]; startCol: number; startRow: number; endCol: number; endRow: number } {
  const grid = new Array(cols * rows).fill(0);
  const inMaze = new Array(cols * rows).fill(false);

  const startCol = 1;
  const startRow = 1;
  grid[idx(startCol, startRow, cols)] = 1;
  inMaze[idx(startCol, startRow, cols)] = true;

  type Edge = { c: number; r: number; toC: number; toR: number };
  const frontier: Edge[] = [];

  const tryAddFrontier = (c: number, r: number) => {
    const dirs = [
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2],
    ];
    for (const [dc, dr] of dirs) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 1 || nr < 1 || nc >= cols - 1 || nr >= rows - 1) continue;
      if (inMaze[idx(nc, nr, cols)]) continue;
      frontier.push({ c, r, toC: nc, toR: nr });
    }
  };
  tryAddFrontier(startCol, startRow);

  while (frontier.length > 0) {
    const pick = Math.floor(rand() * frontier.length);
    const edge = frontier[pick];
    frontier[pick] = frontier[frontier.length - 1];
    frontier.pop();

    if (inMaze[idx(edge.toC, edge.toR, cols)]) continue;

    const wallC = (edge.c + edge.toC) >> 1;
    const wallR = (edge.r + edge.toR) >> 1;
    grid[idx(wallC, wallR, cols)] = 1;
    grid[idx(edge.toC, edge.toR, cols)] = 1;
    inMaze[idx(edge.toC, edge.toR, cols)] = true;
    tryAddFrontier(edge.toC, edge.toR);
  }

  // 出口：右下区域最近的通路格
  let endCol = cols - 2;
  let endRow = rows - 2;
  if (!grid[idx(endCol, endRow, cols)]) {
    outer: for (let r = rows - 2; r >= 1; r--) {
      for (let c = cols - 2; c >= 1; c--) {
        if (grid[idx(c, r, cols)]) {
          endCol = c;
          endRow = r;
          break outer;
        }
      }
    }
  }

  // 保证入口/出口在边界开口
  grid[idx(startCol, startRow, cols)] = 1;
  grid[idx(endCol, endRow, cols)] = 1;
  if (startCol - 1 >= 0) grid[idx(startCol - 1, startRow, cols)] = 1;
  if (endCol + 1 < cols) grid[idx(endCol + 1, endRow, cols)] = 1;

  return { grid, startCol, startRow, endCol, endRow };
}

/** BFS 最短通路（入口→出口）作为玩家赶路主路 */
export function findPathCells(
  grid: number[],
  cols: number,
  rows: number,
  start: { c: number; r: number },
  end: { c: number; r: number }
): Array<{ c: number; r: number }> {
  const key = (c: number, r: number) => r * cols + c;
  const prev = new Map<number, number>();
  const q: Array<{ c: number; r: number }> = [start];
  const seen = new Set<number>([key(start.c, start.r)]);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  while (q.length) {
    const cur = q.shift()!;
    if (cur.c === end.c && cur.r === end.r) break;
    for (const [dc, dr] of dirs) {
      const nc = cur.c + dc;
      const nr = cur.r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const k = key(nc, nr);
      if (seen.has(k)) continue;
      if (!grid[idx(nc, nr, cols)]) continue;
      seen.add(k);
      prev.set(k, key(cur.c, cur.r));
      q.push({ c: nc, r: nr });
    }
  }

  const path: Array<{ c: number; r: number }> = [];
  let curK = key(end.c, end.r);
  if (!seen.has(curK)) {
    // fallback：直线抽样
    return [start, end];
  }
  while (true) {
    const c = curK % cols;
    const r = Math.floor(curK / cols);
    path.push({ c, r });
    if (curK === key(start.c, start.r)) break;
    const p = prev.get(curK);
    if (p === undefined) break;
    curK = p;
  }
  path.reverse();
  return path;
}

function cellToPixel(
  c: number,
  r: number,
  cellSize: number,
  originX: number,
  originY: number
): { x: number; y: number } {
  return {
    x: originX + c * cellSize + cellSize / 2,
    y: originY + r * cellSize + cellSize / 2,
  };
}

/** 折线抽稀：去掉共线中间点，保留拐点 */
function simplifyPath(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (points.length <= 2) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const bcx = c.x - b.x;
    const bcy = c.y - b.y;
    // 共线则跳过 b
    if (Math.abs(abx * bcy - aby * bcx) < 1e-6) continue;
    out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

/** PATH cells whose graph distance from the mandatory route is ≥ minDist. */
export function collectOffMainPathCells(
  grid: number[],
  cols: number,
  rows: number,
  mainPath: Array<{ c: number; r: number }>,
  minDist: number = MAZE_AMBIENT_MIN_PATH_DIST
): Array<{ c: number; r: number; dist: number }> {
  const dist = new Array(cols * rows).fill(Number.POSITIVE_INFINITY);
  const q: Array<{ c: number; r: number }> = [];
  for (const p of mainPath) {
    const k = idx(p.c, p.r, cols);
    if (dist[k] === 0) continue;
    dist[k] = 0;
    q.push(p);
  }
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  let qi = 0;
  while (qi < q.length) {
    const cur = q[qi++];
    const d0 = dist[idx(cur.c, cur.r, cols)];
    for (const [dc, dr] of dirs) {
      const nc = cur.c + dc;
      const nr = cur.r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      if (!grid[idx(nc, nr, cols)]) continue;
      const k = idx(nc, nr, cols);
      if (dist[k] <= d0 + 1) continue;
      dist[k] = d0 + 1;
      q.push({ c: nc, r: nr });
    }
  }

  const pick = (need: number) => {
    const out: Array<{ c: number; r: number; dist: number }> = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!grid[idx(c, r, cols)]) continue;
        const d = dist[idx(c, r, cols)];
        if (d >= need && Number.isFinite(d)) out.push({ c, r, dist: d });
      }
    }
    return out;
  };

  let cells = pick(minDist);
  if (cells.length < 2) cells = pick(Math.max(1, minDist - 1));
  if (cells.length < 2) cells = pick(1);
  return cells;
}

function nearestPathT(
  pathPixels: Array<{ x: number; y: number }>,
  totalLen: number,
  segLens: number[],
  x: number,
  y: number
): number {
  if (totalLen <= 0 || pathPixels.length === 0) return 0.5;
  let bestD = Number.POSITIVE_INFINITY;
  let bestAlong = 0;
  let along = 0;
  for (let i = 0; i < pathPixels.length - 1; i++) {
    const a = pathPixels[i];
    const b = pathPixels[i + 1];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len = segLens[i] || Math.hypot(abx, aby);
    const t = len > 0 ? Math.max(0, Math.min(1, ((x - a.x) * abx + (y - a.y) * aby) / (len * len))) : 0;
    const px = a.x + abx * t;
    const py = a.y + aby * t;
    const d = Math.hypot(x - px, y - py);
    if (d < bestD) {
      bestD = d;
      bestAlong = along + t * len;
    }
    along += len;
  }
  return Math.max(0, Math.min(1, bestAlong / totalLen));
}

function placeTrashSpawns(
  pathPixels: Array<{ x: number; y: number }>,
  spawnPackCount: number,
  encounterPackCount: number,
  profile: MazeDungeonProfile,
  stageIndex: number,
  rand: () => number,
  offPathCells: Array<{ c: number; r: number; dist: number }>,
  cellSize: number,
  originX: number,
  originY: number
): MazeTrashSpawnSpec[] {
  const segLens: number[] = [];
  let totalLen = 0;
  for (let i = 0; i < pathPixels.length - 1; i++) {
    const len = Math.hypot(
      pathPixels[i + 1].x - pathPixels[i].x,
      pathPixels[i + 1].y - pathPixels[i].y
    );
    segLens.push(len);
    totalLen += len;
  }
  const getPoint = (dist: number) => {
    let rem = Math.max(0, Math.min(totalLen, dist));
    for (let i = 0; i < segLens.length; i++) {
      if (rem <= segLens[i]) {
        const t = segLens[i] > 0 ? rem / segLens[i] : 0;
        return {
          x: pathPixels[i].x + (pathPixels[i + 1].x - pathPixels[i].x) * t,
          y: pathPixels[i].y + (pathPixels[i + 1].y - pathPixels[i].y) * t,
        };
      }
      rem -= segLens[i];
    }
    return pathPixels[pathPixels.length - 1] || { x: originX, y: originY };
  };

  const names = profile.trash.packNames;
  const models = profile.trash.models;
  const spawns: MazeTrashSpawnSpec[] = [];
  const is20 = profile.tier === '20man';
  const totalPacks = Math.max(MAZE_MIN_SPAWN_PACKS, spawnPackCount);
  const encounters = Math.max(
    MAZE_ENCOUNTER_PACKS_MIN,
    Math.min(MAZE_ENCOUNTER_PACKS_MAX, encounterPackCount, totalPacks)
  );

  // Encounter pack indices evenly spaced among 1..totalPacks
  const encounterSet = new Set<number>();
  for (let e = 1; e <= encounters; e++) {
    const ei = Math.round((e / (encounters + 1)) * (totalPacks + 1));
    encounterSet.add(Math.max(1, Math.min(totalPacks, ei)));
  }
  for (let p = 1; encounterSet.size < encounters && p <= totalPacks; p++) {
    encounterSet.add(p);
  }

  // Shuffle off-path sites for ambient packs
  const sites = offPathCells.slice();
  for (let i = sites.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [sites[i], sites[j]] = [sites[j], sites[i]];
  }
  let siteCursor = 0;
  const usedSites = new Set<string>();

  for (let p = 1; p <= totalPacks; p++) {
    const isEncounter = encounterSet.has(p);
    const mobsInPack = is20 ? 3 : 2;

    if (isEncounter) {
      const pathT = (p / (totalPacks + 1)) * 0.85 + 0.08;
      const base = getPoint(totalLen * pathT);
      for (let m = 0; m < mobsInPack; m++) {
        const nameIdx = (stageIndex * 7 + p * 3 + m) % names.length;
        const modelIdx = (stageIndex * 5 + p * 2 + m) % models.length;
        const ang = rand() * Math.PI * 2;
        const rad = 10 + rand() * 14;
        spawns.push({
          id: `${profile.dungeonId}_s${stageIndex}_p${p}_m${m}`,
          name: names[nameIdx],
          mobModel: models[modelIdx],
          packIndex: p,
          pathT,
          offsetX: Math.cos(ang) * rad * (m === 0 ? 1 : -0.6),
          offsetY: Math.sin(ang) * rad * (m === 0 ? 1 : -0.6),
          maxHp: is20
            ? Math.round(48000 + rand() * 16000 + p * 2000)
            : Math.round(20000 + rand() * 8000 + p * 1500),
          isEncounter: true,
        });
        void base;
      }
      continue;
    }

    // Ambient: must be off the mandatory route (≥3 PATH cells when possible)
    let site = sites[siteCursor++];
    while (site && usedSites.has(`${site.c},${site.r}`) && siteCursor < sites.length) {
      site = sites[siteCursor++];
    }
    if (!site && sites.length > 0) {
      site = sites[Math.floor(rand() * sites.length)];
    }
    if (site) usedSites.add(`${site.c},${site.r}`);

    const anchor = site
      ? cellToPixel(site.c, site.r, cellSize, originX, originY)
      : getPoint(totalLen * 0.5);
    const pathT = nearestPathT(pathPixels, totalLen, segLens, anchor.x, anchor.y);

    for (let m = 0; m < mobsInPack; m++) {
      const nameIdx = (stageIndex * 7 + p * 3 + m) % names.length;
      const modelIdx = (stageIndex * 5 + p * 2 + m) % models.length;
      const ang = rand() * Math.PI * 2;
      const rad = 6 + rand() * 10;
      const ox = Math.cos(ang) * rad * (m === 0 ? 1 : -0.55);
      const oy = Math.sin(ang) * rad * (m === 0 ? 1 : -0.55);
      spawns.push({
        id: `${profile.dungeonId}_s${stageIndex}_p${p}_m${m}`,
        name: names[nameIdx],
        mobModel: models[modelIdx],
        packIndex: p,
        pathT,
        offsetX: ox,
        offsetY: oy,
        maxHp: is20
          ? Math.round(48000 + rand() * 16000 + p * 2000)
          : Math.round(20000 + rand() * 8000 + p * 1500),
        isEncounter: false,
        worldX: anchor.x + ox,
        worldY: anchor.y + oy,
      });
    }
  }
  return spawns;
}

/**
 * 生成（或校验缓存）完整迷宫布局。新增副本只需提供 MazeDungeonProfile。
 */
export function generateMazeLayout(opts: MazeGenerateOptions): MazeLayout {
  const { dungeonId, stageIndex, profile } = opts;
  if (
    opts.cached &&
    opts.cached.dungeonId === dungeonId &&
    opts.cached.stageIndex === stageIndex &&
    isMazeLayoutViewportCurrent(opts.cached)
  ) {
    return opts.cached;
  }

  const seed = hashSeed(dungeonId, stageIndex);
  const rand = mulberry32(seed);
  const {
    cols,
    rows,
    packCount,
    spawnPackCount,
    cellSize: baseCellSize,
  } = scaleMazeParams(profile.targetTravelMs, profile.tier);
  const { grid, startCol, startRow, endCol, endRow } = generatePrimGrid(cols, rows, rand);

  const canvasW = opts.canvasWidth ?? MAZE_CANVAS_LOGICAL_SIZE.width;
  const canvasH = opts.canvasHeight ?? MAZE_CANVAS_LOGICAL_SIZE.height;
  // Concentrate maze in central 50% ∩ HUD-safe; ambience/texture remain full-bleed
  const { cellSize, originX, originY } = computeMazePlacement(
    cols,
    rows,
    baseCellSize,
    canvasW,
    canvasH,
    MAZE_VIEWPORT_FRACTION
  );

  const cells = findPathCells(grid, cols, rows, { c: startCol, r: startRow }, { c: endCol, r: endRow });
  const rawPixels = cells.map((cell) => cellToPixel(cell.c, cell.r, cellSize, originX, originY));
  const waypoints = simplifyPath(rawPixels);
  const offPathCells = collectOffMainPathCells(
    grid,
    cols,
    rows,
    cells,
    MAZE_AMBIENT_MIN_PATH_DIST
  );

  const trashSpawns = placeTrashSpawns(
    waypoints,
    spawnPackCount,
    packCount,
    profile,
    stageIndex,
    rand,
    offPathCells,
    cellSize,
    originX,
    originY
  );
  const entrancePx = cellToPixel(startCol, startRow, cellSize, originX, originY);
  const exitPx = cellToPixel(endCol, endRow, cellSize, originX, originY);

  return {
    dungeonId,
    stageIndex,
    seed,
    cols,
    rows,
    cellSize,
    originX,
    originY,
    grid,
    waypoints,
    entrance: { ...entrancePx, col: startCol, row: startRow },
    exit: { ...exitPx, col: endCol, row: endRow },
    trashSpawns,
    theme: profile.theme,
    targetTravelMs: profile.targetTravelMs,
    packCount,
    generatedAtMs: Date.now(),
    viewportFraction: MAZE_VIEWPORT_FRACTION,
    layoutRevision: MAZE_LAYOUT_REVISION,
  };
}

/** 将世界坐标钳制到最近通路格子中心（玩家只走迷宫通路） */
export function clampToMazePath(
  layout: MazeLayout,
  x: number,
  y: number,
  canvasWidth = MAZE_CANVAS_LOGICAL_SIZE.width,
  canvasHeight = MAZE_CANVAS_LOGICAL_SIZE.height
): { x: number; y: number } {
  const { originX, originY } = getMazeDrawOrigin(layout, canvasWidth, canvasHeight);

  let best = { x, y, dist: Infinity };
  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < layout.cols; c++) {
      if (!layout.grid[idx(c, r, layout.cols)]) continue;
      const p = cellToPixel(c, r, layout.cellSize, originX, originY);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < best.dist) best = { x: p.x, y: p.y, dist: d };
    }
  }
  return { x: best.x, y: best.y };
}
