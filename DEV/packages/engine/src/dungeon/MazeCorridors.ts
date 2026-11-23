/**
 * Curved equal-width maze corridors (presentation layer).
 * Prim grid topology stays unchanged; centerlines are smoothed and lake-warped.
 */

export type Pt = { x: number; y: number };

/** Corridor stroke width as a fraction of cellSize (constant → equal width). */
export const MAZE_CORRIDOR_WIDTH_FRAC = 0.82;

/** Dense sample spacing along smoothed polylines (canvas px). */
export const MAZE_CORRIDOR_SAMPLE_SPACING = 4;

function idx(c: number, r: number, cols: number): number {
  return r * cols + c;
}

function cellCenter(
  c: number,
  r: number,
  cellSize: number,
  originX: number,
  originY: number
): Pt {
  return {
    x: originX + c * cellSize + cellSize / 2,
    y: originY + r * cellSize + cellSize / 2,
  };
}

/** Undirected PATH edges as cell-center polylines of length 2. */
export function buildPathEdgePolylines(
  grid: number[],
  cols: number,
  rows: number,
  cellSize: number,
  originX: number,
  originY: number
): Pt[][] {
  const edges: Pt[][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!grid[idx(c, r, cols)]) continue;
      const a = cellCenter(c, r, cellSize, originX, originY);
      // Only right / down to avoid duplicates
      if (c + 1 < cols && grid[idx(c + 1, r, cols)]) {
        edges.push([a, cellCenter(c + 1, r, cellSize, originX, originY)]);
      }
      if (r + 1 < rows && grid[idx(c, r + 1, cols)]) {
        edges.push([a, cellCenter(c, r + 1, cellSize, originX, originY)]);
      }
    }
  }
  return edges;
}

/**
 * Soft “lake” curvature: mild ellipse pull + shoreline undulation.
 * Deterministic from seed; keeps points near the maze bbox.
 */
export function applyLakeCurvature(
  p: Pt,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  seed: number,
  cellSize: number
): Pt {
  const cx = (bounds.minX + bounds.maxX) * 0.5;
  const cy = (bounds.minY + bounds.maxY) * 0.5;
  const hw = Math.max(1, (bounds.maxX - bounds.minX) * 0.5);
  const hh = Math.max(1, (bounds.maxY - bounds.minY) * 0.5);
  const nx = (p.x - cx) / hw;
  const ny = (p.y - cy) / hh;
  const r = Math.hypot(nx, ny);
  // Pull outer cells slightly inward → soft lake silhouette
  const pull = 1 - 0.14 * Math.max(0, Math.min(1, r - 0.25));
  let x = cx + (p.x - cx) * pull;
  let y = cy + (p.y - cy) * pull * 0.9;
  const a = ((seed % 97) / 97) * Math.PI * 2;
  const amp = cellSize * 0.38;
  x += Math.sin(ny * 2.4 + a) * amp;
  y += Math.cos(nx * 2.1 + a * 1.37) * amp * 0.85;
  // Keep inside padded maze bbox so strokes don’t spill HUD
  const pad = cellSize * 0.2;
  x = Math.max(bounds.minX + pad, Math.min(bounds.maxX - pad, x));
  y = Math.max(bounds.minY + pad, Math.min(bounds.maxY - pad, y));
  return { x, y };
}

/** Catmull-Rom → dense polyline (open curve). */
export function smoothCatmullRom(points: Pt[], samplesPerSeg = 6): Pt[] {
  if (points.length <= 2) return points.slice();
  const out: Pt[] = [];
  const pts = points;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const n = i === pts.length - 2 ? samplesPerSeg : samplesPerSeg;
    for (let s = 0; s < n; s++) {
      const t = s / samplesPerSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x:
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y:
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Resample polyline to ~spacing px steps. */
export function resamplePolyline(points: Pt[], spacing: number): Pt[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [points[0]];
  const out: Pt[] = [{ ...points[0] }];
  let carry = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    let d = spacing - carry;
    while (d <= len) {
      const t = d / len;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      d += spacing;
    }
    carry = len - (d - spacing);
  }
  const last = points[points.length - 1];
  const tip = out[out.length - 1];
  if (Math.hypot(tip.x - last.x, tip.y - last.y) > 0.5) out.push({ ...last });
  return out;
}

export function mazeBoundsFromLayout(layout: {
  originX: number;
  originY: number;
  cols: number;
  rows: number;
  cellSize: number;
}): { minX: number; maxX: number; minY: number; maxY: number } {
  return {
    minX: layout.originX,
    maxX: layout.originX + layout.cols * layout.cellSize,
    minY: layout.originY,
    maxY: layout.originY + layout.rows * layout.cellSize,
  };
}

/**
 * Build curved corridor polylines for every PATH edge (equal-width stroke later).
 * Also returns a smoothed lake-warped main-route polyline for travel waypoints.
 */
export function buildCurvedCorridors(opts: {
  grid: number[];
  cols: number;
  rows: number;
  cellSize: number;
  originX: number;
  originY: number;
  seed: number;
  mainPathCells: Array<{ c: number; r: number }>;
}): {
  corridorWidth: number;
  corridorPolylines: Pt[][];
  mainWaypoints: Pt[];
} {
  const { grid, cols, rows, cellSize, originX, originY, seed, mainPathCells } = opts;
  const bounds = {
    minX: originX,
    maxX: originX + cols * cellSize,
    minY: originY,
    maxY: originY + rows * cellSize,
  };
  const warp = (p: Pt) => applyLakeCurvature(p, bounds, seed, cellSize);

  const rawEdges = buildPathEdgePolylines(grid, cols, rows, cellSize, originX, originY);
  const corridorPolylines = rawEdges.map((edge) => {
    const warped = edge.map(warp);
    // 2-point edges: fabricate mid control for a gentle bow
    if (warped.length === 2) {
      const mid = {
        x: (warped[0].x + warped[1].x) * 0.5,
        y: (warped[0].y + warped[1].y) * 0.5,
      };
      const bowed = applyLakeCurvature(mid, bounds, seed ^ 0x9e3779b9, cellSize);
      return resamplePolyline(smoothCatmullRom([warped[0], bowed, warped[1]], 5), MAZE_CORRIDOR_SAMPLE_SPACING);
    }
    return resamplePolyline(smoothCatmullRom(warped, 5), MAZE_CORRIDOR_SAMPLE_SPACING);
  });

  const mainRaw = mainPathCells.map((cell) =>
    warp(cellCenter(cell.c, cell.r, cellSize, originX, originY))
  );
  const mainWaypoints = resamplePolyline(
    smoothCatmullRom(mainRaw.length >= 2 ? mainRaw : mainRaw.concat(mainRaw), 8),
    MAZE_CORRIDOR_SAMPLE_SPACING
  );

  return {
    corridorWidth: Math.max(8, cellSize * MAZE_CORRIDOR_WIDTH_FRAC),
    corridorPolylines,
    mainWaypoints,
  };
}

/** Project point onto nearest segment of polylines; clamp lateral offset to halfWidth. */
export function clampToCorridorPolylines(
  polylines: Pt[][],
  x: number,
  y: number,
  halfWidth: number
): Pt {
  let bestX = x;
  let bestY = y;
  let bestD = Infinity;
  for (const poly of polylines) {
    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i];
      const b = poly[i + 1];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const len2 = abx * abx + aby * aby;
      const t = len2 > 1e-8 ? Math.max(0, Math.min(1, ((x - a.x) * abx + (y - a.y) * aby) / len2)) : 0;
      const px = a.x + abx * t;
      const py = a.y + aby * t;
      const d = Math.hypot(x - px, y - py);
      if (d < bestD) {
        bestD = d;
        bestX = px;
        bestY = py;
      }
    }
  }
  if (!Number.isFinite(bestD) || bestD === Infinity) return { x, y };
  if (bestD <= halfWidth || bestD < 1e-6) {
    // Soft pull toward centerline
    const k = Math.min(1, halfWidth / Math.max(bestD, 1e-6));
    return {
      x: x + (bestX - x) * (1 - k * 0.35),
      y: y + (bestY - y) * (1 - k * 0.35),
    };
  }
  // Outside ribbon: snap onto edge of ribbon toward centerline
  const ux = (x - bestX) / bestD;
  const uy = (y - bestY) / bestD;
  return { x: bestX + ux * halfWidth, y: bestY + uy * halfWidth };
}
