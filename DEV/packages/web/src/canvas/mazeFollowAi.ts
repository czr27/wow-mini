export interface MazePoint {
  x: number;
  y: number;
}

export interface MazePathGeometry {
  segLens: number[];
  totalLen: number;
  getPoint: (dist: number) => MazePoint;
  getPose: (dist: number) => { x: number; y: number; dx: number; dy: number };
}

export interface MazeProjection {
  distAlongPath: number;
  closestPoint: MazePoint;
  distToPath: number;
}

export interface HumanFollowCandidate {
  id: string;
  position: MazePoint;
  isAlive: boolean;
  isLocalPlayer?: boolean;
}

export interface FollowLeaderResult {
  leaderId: string;
  position: MazePoint;
  distAlongPath: number;
  distToExit: number;
}

export interface ManualMazeFollowParams {
  unitId: string;
  role: string;
  classId: string;
  rank: number;
  is20Man: boolean;
  leaderPos: MazePoint;
  leaderDistAlongPath: number;
  currentPos: MazePoint;
  waypoints: MazePoint[];
  geometry: MazePathGeometry;
  cellSize?: number;
  currentEncounterPack?: number;
  tickCount?: number;
  speedScale?: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function hashUnitId(unitId: string): { signed: number; unit: number } {
  let h = 2166136261;
  for (let i = 0; i < unitId.length; i++) {
    h ^= unitId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const unit = ((h >>> 0) % 1000) / 1000;
  const signed = unit * 2 - 1;
  return { signed, unit };
}

export function computePathGeometry(waypoints: MazePoint[]): MazePathGeometry {
  const segLens: number[] = [];
  let totalLen = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const seg = Math.hypot(
      waypoints[i + 1].x - waypoints[i].x,
      waypoints[i + 1].y - waypoints[i].y
    );
    segLens.push(seg);
    totalLen += seg;
  }

  const getPose = (dist: number): { x: number; y: number; dx: number; dy: number } => {
    if (waypoints.length === 0) return { x: 0, y: 0, dx: 1, dy: 0 };
    if (waypoints.length === 1) return { x: waypoints[0].x, y: waypoints[0].y, dx: 1, dy: 0 };

    let remaining = clamp(dist, 0, totalLen);
    for (let i = 0; i < segLens.length; i++) {
      const segLen = segLens[i];
      if (remaining <= segLen || i === segLens.length - 1) {
        const ratio = segLen > 1e-6 ? clamp(remaining / segLen, 0, 1) : 0;
        const a = waypoints[i];
        const b = waypoints[i + 1];
        const dx = segLen > 1e-6 ? (b.x - a.x) / segLen : 1;
        const dy = segLen > 1e-6 ? (b.y - a.y) / segLen : 0;
        return {
          x: a.x + (b.x - a.x) * ratio,
          y: a.y + (b.y - a.y) * ratio,
          dx,
          dy,
        };
      }
      remaining -= segLen;
    }
    const last = waypoints[waypoints.length - 1];
    const prev = waypoints[waypoints.length - 2];
    const segLen = Math.hypot(last.x - prev.x, last.y - prev.y) || 1;
    return {
      x: last.x,
      y: last.y,
      dx: (last.x - prev.x) / segLen,
      dy: (last.y - prev.y) / segLen,
    };
  };

  const getPoint = (dist: number): MazePoint => {
    const pose = getPose(dist);
    return { x: pose.x, y: pose.y };
  };

  return { segLens, totalLen, getPoint, getPose };
}

export function projectPointToMazePath(
  waypoints: MazePoint[],
  segLens: number[],
  point: MazePoint
): MazeProjection {
  if (waypoints.length === 0) {
    return { distAlongPath: 0, closestPoint: { ...point }, distToPath: 0 };
  }
  if (waypoints.length === 1) {
    const d = Math.hypot(point.x - waypoints[0].x, point.y - waypoints[0].y);
    return { distAlongPath: 0, closestPoint: { ...waypoints[0] }, distToPath: d };
  }

  let bestDistSq = Infinity;
  let bestAlong = 0;
  let bestPoint: MazePoint = { ...waypoints[0] };
  let accLen = 0;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const lenSq = vx * vx + vy * vy;
    const segLen = segLens[i] ?? Math.hypot(vx, vy);
    const t = lenSq > 1e-6
      ? clamp(((point.x - a.x) * vx + (point.y - a.y) * vy) / lenSq, 0, 1)
      : 0;
    const px = a.x + vx * t;
    const py = a.y + vy * t;
    const dSq = (point.x - px) * (point.x - px) + (point.y - py) * (point.y - py);
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestAlong = accLen + segLen * t;
      bestPoint = { x: px, y: py };
    }
    accLen += segLen;
  }

  return {
    distAlongPath: bestAlong,
    closestPoint: bestPoint,
    distToPath: Math.sqrt(bestDistSq),
  };
}

/**
 * Prioritize following the living human player closest to the maze exit.
 * Primary metric: furthest progress along the maze path toward the exit.
 * Tie-breaker (within 8px path progress): smaller Euclidean distance to exit.
 */
export function selectExitClosestHumanLeader(
  candidates: HumanFollowCandidate[],
  waypoints: MazePoint[],
  segLens: number[]
): FollowLeaderResult | null {
  if (candidates.length === 0) return null;
  const alive = candidates.filter((c) => c.isAlive);
  const pool = alive.length > 0 ? alive : candidates;
  const exitPoint = waypoints.length > 0 ? waypoints[waypoints.length - 1] : null;

  let best: FollowLeaderResult | null = null;
  let bestIsLocal = false;

  for (const c of pool) {
    const proj = projectPointToMazePath(waypoints, segLens, c.position);
    const distToExit = exitPoint
      ? Math.hypot(c.position.x - exitPoint.x, c.position.y - exitPoint.y)
      : 0;

    if (!best) {
      best = {
        leaderId: c.id,
        position: { ...c.position },
        distAlongPath: proj.distAlongPath,
        distToExit,
      };
      bestIsLocal = !!c.isLocalPlayer;
      continue;
    }

    const pathDiff = proj.distAlongPath - best.distAlongPath;
    if (pathDiff > 8) {
      best = {
        leaderId: c.id,
        position: { ...c.position },
        distAlongPath: proj.distAlongPath,
        distToExit,
      };
      bestIsLocal = !!c.isLocalPlayer;
    } else if (Math.abs(pathDiff) <= 8) {
      if (
        distToExit < best.distToExit - 1 ||
        (Math.abs(distToExit - best.distToExit) <= 1 && !!c.isLocalPlayer && !bestIsLocal)
      ) {
        best = {
          leaderId: c.id,
          position: { ...c.position },
          distAlongPath: proj.distAlongPath,
          distToExit,
        };
        bestIsLocal = !!c.isLocalPlayer;
      }
    }
  }

  return best;
}

function isMeleeDps(role: string, classId: string): boolean {
  return (
    role === 'DPS' &&
    (classId === 'ROGUE' || classId === 'DK' || classId === 'WARRIOR' || classId === 'PALADIN')
  );
}

/**
 * Compute natural corridor-aware target position & next step for an AI companion
 * in manual movement mode (after auto-pathfinding is cancelled).
 */
export function stepManualMazeCompanion(params: ManualMazeFollowParams): MazePoint {
  const {
    unitId,
    role,
    classId,
    rank,
    is20Man,
    leaderPos,
    leaderDistAlongPath,
    currentPos,
    waypoints,
    geometry,
    cellSize = 28,
    currentEncounterPack = 0,
    tickCount = 0,
    speedScale = 1,
  } = params;

  const { signed: hSigned, unit: hUnit } = hashUnitId(unitId);

  // If companion is already on the corridor and only slightly ahead of the leader
  // (e.g. leader paused or tapped backward), hold ground naturally instead of moonwalking.
  const curProj = projectPointToMazePath(waypoints, geometry.segLens, currentPos);
  const aheadOfLeader = curProj.distAlongPath - leaderDistAlongPath;
  if (
    currentEncounterPack === 0 &&
    curProj.distToPath <= 20 &&
    aheadOfLeader > 0 &&
    aheadOfLeader <= 18
  ) {
    return { x: currentPos.x, y: currentPos.y };
  }

  // Role-based trail distance along the maze behind the leader
  const rankStep = is20Man ? 7 : 12;
  let trailDist: number;
  if (role === 'TANK') {
    trailDist = Math.min(20, 8 + rank * (is20Man ? 4 : 6));
  } else if (isMeleeDps(role, classId)) {
    trailDist = Math.min(is20Man ? 90 : 54, 14 + rank * rankStep);
  } else {
    trailDist = Math.min(is20Man ? 130 : 82, 18 + rank * rankStep);
  }
  trailDist = Math.max(6, trailDist + (hUnit - 0.5) * 6);

  const targetPathDist = clamp(leaderDistAlongPath - trailDist, 0, geometry.totalLen);
  const pose = geometry.getPose(targetPathDist);
  const nx = -pose.dy;
  const ny = pose.dx;

  // Natural staggered lateral spread inside corridor walls
  const maxLat = Math.min(11, cellSize * 0.28);
  const side = rank % 2 === 0 ? 1 : -1;
  let latOffset = side * (0.35 + hUnit * 0.65) * maxLat + hSigned * 1.5;
  latOffset = clamp(latOffset, -maxLat, maxLat);

  let targetX = pose.x + nx * latOffset;
  let targetY = pose.y + ny * latOffset;

  // Blend slightly toward leader's lateral position when close so companions react to side-steps
  if (trailDist < 22) {
    const leaderPose = geometry.getPose(leaderDistAlongPath);
    const leaderOffX = clamp(leaderPos.x - leaderPose.x, -maxLat, maxLat);
    const leaderOffY = clamp(leaderPos.y - leaderPose.y, -maxLat, maxLat);
    targetX += leaderOffX * 0.35;
    targetY += leaderOffY * 0.35;
  }

  // Skirmish fan-out & subtle breathing during trash encounters
  if (currentEncounterPack > 0) {
    if (role === 'TANK') {
      targetX += pose.dx * 4;
      targetY += pose.dy * 4;
    } else if (isMeleeDps(role, classId)) {
      targetX += pose.dx * 2 + nx * (side * 3);
      targetY += pose.dy * 2 + ny * (side * 3);
    } else {
      const bob = Math.sin(tickCount * 0.06 + hUnit * Math.PI * 2) * 2.2;
      targetX -= pose.dx * 3 - nx * bob;
      targetY -= pose.dy * 3 - ny * bob;
    }
  }

  const dx = targetX - currentPos.x;
  const dy = targetY - currentPos.y;
  const dist = Math.hypot(dx, dy);

  // Deadzone: avoid micro-jitter when already comfortably settled
  if (dist <= 3.5) {
    return { x: currentPos.x, y: currentPos.y };
  }

  // Smooth catch-up curve with slight per-unit speed variation
  const personalPace = 0.92 + hUnit * 0.16;
  const rawStep =
    dist > 60
      ? Math.min(7.5 * speedScale, dist * 0.18 * speedScale)
      : Math.max(1.8 * speedScale, dist * 0.14 * speedScale);
  const step = Math.min(dist, rawStep * personalPace);

  return {
    x: currentPos.x + (dx / dist) * step,
    y: currentPos.y + (dy / dist) * step,
  };
}
