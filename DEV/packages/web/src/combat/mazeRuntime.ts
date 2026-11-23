/**
 * 赶路迷宫运行时：调用引擎 Prim 生成器；缺失时向服务器拉取/固化。
 */
import {
  generateMazeLayout,
  getMazeProfile,
  isMazeLayoutViewportCurrent,
  MAZE_CANVAS_LOGICAL_SIZE,
  type MazeLayout,
  type MazeTrashSpawnSpec,
} from '@cata-raid-sim/engine';

const memoryCache = new Map<string, MazeLayout>();

function cacheKey(dungeonId: string, stageIndex: number): string {
  return `${dungeonId}::${stageIndex}`;
}

export function getMazeLayoutSync(
  dungeonId: string,
  stageIndex: number,
  canvasWidth = MAZE_CANVAS_LOGICAL_SIZE.width,
  canvasHeight = MAZE_CANVAS_LOGICAL_SIZE.height
): MazeLayout {
  const key = cacheKey(dungeonId, stageIndex);
  const hit = memoryCache.get(key);
  if (hit && isMazeLayoutViewportCurrent(hit)) return hit;
  if (hit) memoryCache.delete(key);

  const profile = getMazeProfile(dungeonId);
  const layout = generateMazeLayout({
    dungeonId,
    stageIndex,
    profile,
    canvasWidth,
    canvasHeight,
  });
  memoryCache.set(key, layout);
  return layout;
}

/** 异步：优先内存 → 服务器缓存 → 本地生成并 POST 固化 */
export async function ensureMazeLayout(
  dungeonId: string,
  stageIndex: number,
  canvasWidth = MAZE_CANVAS_LOGICAL_SIZE.width,
  canvasHeight = MAZE_CANVAS_LOGICAL_SIZE.height
): Promise<MazeLayout> {
  const key = cacheKey(dungeonId, stageIndex);
  const mem = memoryCache.get(key);
  if (mem && isMazeLayoutViewportCurrent(mem)) return mem;

  try {
    const res = await fetch(`/api/maze-layouts/${encodeURIComponent(dungeonId)}/${stageIndex}`, {
      cache: 'no-cache',
    });
    if (res.ok) {
      const data = (await res.json()) as { layout?: MazeLayout };
      if (data?.layout?.waypoints?.length && isMazeLayoutViewportCurrent(data.layout)) {
        memoryCache.set(key, data.layout);
        return data.layout;
      }
    }
  } catch {
    // offline / server down — generate locally
  }

  const layout = getMazeLayoutSync(dungeonId, stageIndex, canvasWidth, canvasHeight);
  try {
    await fetch(`/api/maze-layouts/${encodeURIComponent(dungeonId)}/${stageIndex}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout }),
    });
  } catch {
    // persistence best-effort
  }
  return layout;
}

export function trashSpawnsToMobs(
  spawns: MazeTrashSpawnSpec[],
  getPoint: (dist: number) => { x: number; y: number },
  totalLen: number
): Array<{
  id: string;
  name: string;
  mobModel: string;
  packIndex: number;
  distAlongMaze: number;
  x: number;
  y: number;
  maxHp: number;
  isEncounter: boolean;
}> {
  return spawns.map((s) => {
    const dist = totalLen * s.pathT;
    const onPath = getPoint(dist);
    const useWorld =
      typeof s.worldX === 'number' &&
      typeof s.worldY === 'number' &&
      Number.isFinite(s.worldX) &&
      Number.isFinite(s.worldY);
    return {
      id: s.id,
      name: s.name,
      mobModel: s.mobModel,
      packIndex: s.packIndex,
      distAlongMaze: dist,
      x: useWorld ? s.worldX! : onPath.x + s.offsetX,
      y: useWorld ? s.worldY! : onPath.y + s.offsetY,
      maxHp: s.maxHp,
      isEncounter: s.isEncounter !== false,
    };
  });
}

export function clearMazeMemoryCache(): void {
  memoryCache.clear();
}
