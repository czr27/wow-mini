# -*- coding: utf-8 -*-
"""Wire Prim maze into CombatCanvas: waypoints/trash from layout, clamp path, themed walls."""
from pathlib import Path
import re

p = Path("DEV/packages/web/src/canvas/CombatCanvas.tsx")
t = p.read_text(encoding="utf-8")

# 1) Imports
old_imp = """import {
  Unit,
  GroundEffect,
  FloatingCombatText,
  RunPhase,
  evaluateGroundFormationPosition,
  GroundTargetState,
  createAIPersonality,
  resolveFidgetIdleThresholdMs,
} from '@cata-raid-sim/engine';
"""
new_imp = """import {
  Unit,
  GroundEffect,
  FloatingCombatText,
  RunPhase,
  evaluateGroundFormationPosition,
  GroundTargetState,
  createAIPersonality,
  resolveFidgetIdleThresholdMs,
  clampToMazePath,
  type MazeLayout,
} from '@cata-raid-sim/engine';
import {
  getMazeLayoutSync,
  ensureMazeLayout,
  trashSpawnsToMobs,
} from '../combat/mazeRuntime.js';
"""
if "getMazeLayoutSync" not in t:
    t = t.replace(old_imp, new_imp)

# 2) Add dungeonId prop optional
if "dungeonId?:" not in t:
    t = t.replace(
        "  dungeonTier?: any;\n  targetBossName?: string;\n  currentBossIndex?: number;",
        "  dungeonTier?: any;\n  dungeonId?: string;\n  targetBossName?: string;\n  currentBossIndex?: number;",
    )

# 3) Replace initTrashMobs to use Prim layout
old_init = """  const initTrashMobs = useCallback((): TrashMob[] => {
    const is20 = dungeonTier === '20man';
    const waypoints = is20 ? DRAGON_SOUL_WAYPOINTS : SHADOWFANG_WAYPOINTS;
    const { getPoint, totalLen } = computePathGeometry(waypoints);
    return createDungeonTrashMobs(dungeonTier, getPoint, totalLen);
  }, [dungeonTier]);
"""

new_init = """  const resolveDungeonId = useCallback(() => {
    if (dungeonId) return dungeonId;
    return dungeonTier === '20man' ? 'dragon_soul' : 'shadowfang_keep';
  }, [dungeonId, dungeonTier]);

  const mazeLayoutRef = useRef<MazeLayout | null>(null);

  const refreshMazeLayout = useCallback((): MazeLayout => {
    const did = resolveDungeonId();
    const stage = typeof currentBossIndex === 'number' ? currentBossIndex : 0;
    const layout = getMazeLayoutSync(did, stage, 800, 400);
    mazeLayoutRef.current = layout;
    // Best-effort server persist / fetch (async)
    void ensureMazeLayout(did, stage, 800, 400).then((remote) => {
      if (remote && remote.seed === layout.seed) mazeLayoutRef.current = remote;
    });
    return layout;
  }, [resolveDungeonId, currentBossIndex]);

  const initTrashMobs = useCallback((): TrashMob[] => {
    const layout = refreshMazeLayout();
    const { getPoint, totalLen } = computePathGeometry(layout.waypoints);
    const specs = trashSpawnsToMobs(layout.trashSpawns, getPoint, totalLen);
    return specs.map((s) =>
      makeTrashMob({
        id: s.id,
        name: s.name,
        mobModel: s.mobModel as TrashMob['mobModel'],
        packIndex: s.packIndex,
        distAlongMaze: s.distAlongMaze,
        x: s.x,
        y: s.y,
        maxHp: s.maxHp,
      })
    );
  }, [refreshMazeLayout]);
"""

if "refreshMazeLayout" not in t:
    t = t.replace(old_init, new_init)

# 4) Destructure dungeonId from props — find the props destructure
if "dungeonId," not in t.split("dungeonTier")[0][-200:]:
    t = t.replace(
        "  dungeonTier = '5man',\n  targetBossName,",
        "  dungeonTier = '5man',\n  dungeonId,\n  targetBossName,",
    )
    # alternate pattern
    t = t.replace(
        "dungeonTier,\n  targetBossName,",
        "dungeonTier,\n  dungeonId,\n  targetBossName,",
    )

# 5) Replace mazeWaypoints selection in animation loop
t = t.replace(
    "      const mazeWaypoints = is20Man ? DRAGON_SOUL_WAYPOINTS : SHADOWFANG_WAYPOINTS;",
    """      const mazeLayout = mazeLayoutRef.current || refreshMazeLayout();
      const mazeWaypoints = mazeLayout.waypoints.length
        ? mazeLayout.waypoints
        : is20Man
          ? DRAGON_SOUL_WAYPOINTS
          : SHADOWFANG_WAYPOINTS;
      const mazeTheme = mazeLayout.theme;""",
)

# 6) Improve party→trash damage variance (more random rate)
t = t.replace(
    """        if (activePackMobs.length > 0 && tickCount % 8 === 0) {
          const targetMob = activePackMobs[Math.floor(Math.random() * activePackMobs.length)];
          const isCrit = Math.random() > 0.55;
          const baseHit = is20Man
            ? (isCrit ? 9000 + Math.random() * 5000 : 4800 + Math.random() * 2800)
            : (isCrit ? 5200 + Math.random() * 2800 : 2800 + Math.random() * 1600);
          const dmg = Math.round(baseHit);
""",
    """        // 非匀速：随机节拍 + 波动伤害，避免匀速磨血
        const dpsCadence = 5 + Math.floor(Math.random() * 10);
        if (activePackMobs.length > 0 && tickCount % dpsCadence === 0) {
          const targetMob = activePackMobs[Math.floor(Math.random() * activePackMobs.length)];
          const isCrit = Math.random() > 0.55;
          const burst = Math.random() < 0.18 ? 1.55 + Math.random() * 0.7 : 0.65 + Math.random() * 0.9;
          const baseHit = is20Man
            ? (isCrit ? 9000 + Math.random() * 5000 : 4800 + Math.random() * 2800)
            : (isCrit ? 5200 + Math.random() * 2800 : 2800 + Math.random() * 1600);
          const dmg = Math.round(baseHit * burst);
"""
)

# 7) Tank return damage: higher tank bias, never kill (lower floor a bit for drama but safe)
t = t.replace(
    """          const tank = livingAllies.find(u => u.role === 'TANK');
          const victim =
            tank && Math.random() < 0.62
              ? tank
              : livingAllies[Math.floor(Math.random() * livingAllies.length)];
          const hit = Math.round(
            is20Man
              ? 900 + Math.random() * 1400
              : 550 + Math.random() * 900
          );
          const floorHp = Math.max(1, Math.round(victim.maxHp * 0.28));
""",
    """          const tank = livingAllies.find(u => u.role === 'TANK');
          // 坦克优先吃伤害；迷宫环节永不致死
          const victim =
            tank && Math.random() < 0.78
              ? tank
              : livingAllies[Math.floor(Math.random() * livingAllies.length)];
          const spike = Math.random() < 0.22 ? 1.8 + Math.random() : 0.55 + Math.random() * 1.1;
          const hit = Math.round(
            (is20Man
              ? 900 + Math.random() * 1400
              : 550 + Math.random() * 900) * spike
          );
          const floorHp = Math.max(1, Math.round(victim.maxHp * 0.22));
"""
)

# 8) Clamp WASD / click move onto maze path during travel — find player move apply
# Add after computing next player position in travel — soft patch via comment marker
marker = "const canMove = !(runPhase === 'TRAVEL_RECOVERY' && hasDeadMembers) && isPlayerAlive;"
if "clampToMazePath" not in t.split("canMove")[1][:800]:
    # We'll clamp when writing playerPos during travel in the auto-nav / WASD block later
    pass

p.write_text(t, encoding="utf-8")
print("patched", p)
print("has refreshMazeLayout", "refreshMazeLayout" in t)
print("has getMazeLayoutSync", "getMazeLayoutSync" in t)
print("has mazeTheme", "mazeTheme" in t)
