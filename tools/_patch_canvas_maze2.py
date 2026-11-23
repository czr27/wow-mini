# -*- coding: utf-8 -*-
"""Second pass: publish/apply maze sync, draw Prim walls, clamp movement, fix start waypoint."""
from pathlib import Path

p = Path("DEV/packages/web/src/canvas/CombatCanvas.tsx")
t = p.read_text(encoding="utf-8")

# Import sync bridge
if "publishHostMazeSync" not in t:
    t = t.replace(
        "} from '../combat/mazeRuntime.js';",
        """} from '../combat/mazeRuntime.js';
import {
  publishHostMazeSync,
  readGuestMazeSync,
} from '../combat/mazeSyncBridge.js';
""",
    )

# Fix start waypoint on trash reset
t = t.replace(
    "      const startWp = (dungeonTier === '20man' ? DRAGON_SOUL_WAYPOINTS : SHADOWFANG_WAYPOINTS)[0];",
    "      const startWp = (mazeLayoutRef.current || refreshMazeLayout()).waypoints[0] || { x: 60, y: 80 };",
)

# After trash combat / before STAGE A draw — publish host maze sync when traveling
# Find isEncounteringRef assignment area end — inject publish near targetLeadDist apply
needle = "      isEncounteringRef.current = currentEncounterPack > 0;\n      currentEncounterPackRef.current = currentEncounterPack;"
if "publishHostMazeSync" not in t[t.find(needle):t.find(needle)+800]:
    t = t.replace(
        needle,
        needle
        + """

      // Host: broadcast maze trash HP / tombstones / seed for guests
      if (!syncRemotePositions) {
        publishHostMazeSync({
          mazeSeed: mazeLayout.seed,
          mazeDungeonId: mazeLayout.dungeonId,
          mazeStageIndex: mazeLayout.stageIndex,
          mazeLeadDist: mazeLeadDistRef.current,
          mazeTrash: trashMobsRef.current.map((m) => ({
            id: m.id,
            hp: m.hp,
            maxHp: m.maxHp,
            isDead: m.isDead,
            isTombstone: m.isTombstone,
            dissipateAlpha: m.dissipateAlpha,
          })),
        });
      } else {
        // Guest: mirror host trash HP / tombstones (do not local-sim DPS)
        const guestMaze = readGuestMazeSync();
        if (guestMaze?.mazeTrash?.length) {
          const byId = new Map(guestMaze.mazeTrash.map((x) => [x.id, x]));
          for (const mob of trashMobsRef.current) {
            const sn = byId.get(mob.id);
            if (!sn) continue;
            mob.hp = sn.hp;
            mob.maxHp = sn.maxHp;
            mob.visualHp = sn.hp;
            mob.isDead = sn.isDead;
            mob.isTombstone = sn.isTombstone;
            if (typeof sn.dissipateAlpha === 'number') mob.dissipateAlpha = sn.dissipateAlpha;
          }
        }
      }
""",
    )

# Draw Prim walls: after ambience fill in SFK branch, inject grid walls using mazeLayout
# Insert helper before STAGE A comment
helper = '''
      const drawPrimWalls = (layout: MazeLayout, theme: MazeLayout['theme']) => {
        const mazeW = layout.cols * layout.cellSize;
        const mazeH = layout.rows * layout.cellSize;
        const originX = Math.max(20, (width - mazeW) / 2);
        const originY = Math.max(40, (height - mazeH) / 2);
        for (let r = 0; r < layout.rows; r++) {
          for (let c = 0; c < layout.cols; c++) {
            const v = layout.grid[r * layout.cols + c];
            const x = originX + c * layout.cellSize;
            const y = originY + r * layout.cellSize;
            if (!v) {
              ctx.fillStyle = theme.wallColor;
              ctx.fillRect(x, y, layout.cellSize + 0.5, layout.cellSize + 0.5);
            } else {
              ctx.fillStyle = theme.floorColor;
              ctx.fillRect(x + 1, y + 1, layout.cellSize - 1, layout.cellSize - 1);
            }
          }
        }
        // accent path polyline on top
        ctx.strokeStyle = theme.pathAccent;
        ctx.lineWidth = Math.max(10, layout.cellSize * 0.45);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.moveTo(mazeWaypoints[0].x, mazeWaypoints[0].y);
        for (let i = 1; i < mazeWaypoints.length; i++) ctx.lineTo(mazeWaypoints[i].x, mazeWaypoints[i].y);
        ctx.stroke();
        ctx.globalAlpha = 1;
      };
'''

if "drawPrimWalls" not in t:
    t = t.replace(
        "      // ── STAGE A: TRAVEL_RECOVERY (Random Procedural Guaranteed-Passable Maze) ──\n      if (runPhase === 'TRAVEL_RECOVERY') {",
        "      // ── STAGE A: TRAVEL_RECOVERY (Prim maze) ──\n      if (runPhase === 'TRAVEL_RECOVERY') {"
        + helper,
    )

# Replace DS fill+corridor start with theme walls
# For DS branch: after fillRect, call drawPrimWalls and skip old corridor stroke by commenting via replace of first big corridor block
# Simpler: after `ctx.fillStyle = '#110508'; ctx.fillRect` insert drawPrimWalls
t = t.replace(
    """        if (is20Man) {
          // ── Dragon Soul (20-man Obsidian & Molten Magma) ──
          ctx.fillStyle = '#110508';
          ctx.fillRect(0, 0, width, height);
""",
    """        if (is20Man) {
          // ── Dragon Soul (20-man Obsidian & Molten Magma) ──
          ctx.fillStyle = mazeTheme?.ambienceColor || '#110508';
          ctx.fillRect(0, 0, width, height);
          drawPrimWalls(mazeLayout, mazeTheme);
""",
)

t = t.replace(
    """        } else {
          // ── Shadowfang Keep (5-man Castle Corridors) ──
          ctx.fillStyle = '#080814';
          ctx.fillRect(0, 0, width, height);
""",
    """        } else {
          // ── Shadowfang Keep (5-man Castle Corridors) ──
          ctx.fillStyle = mazeTheme?.ambienceColor || '#080814';
          ctx.fillRect(0, 0, width, height);
          drawPrimWalls(mazeLayout, mazeTheme);
""",
)

# Clamp player WASD position onto maze path during travel
# Look for playerPosRef updates with keys — add clamp after velocity integrate
# Common pattern: playerPosRef.current = { x: nx, y: ny }
# We'll add a post-step clamp when TRAVEL_RECOVERY
clamp_block = """
      // 玩家只走迷宫通路
      if (runPhase === 'TRAVEL_RECOVERY' && mazeLayoutRef.current) {
        const clamped = clampToMazePath(mazeLayoutRef.current, playerPosRef.current.x, playerPosRef.current.y, width, height);
        // Soft pull toward path center (keep some control feel)
        playerPosRef.current = {
          x: playerPosRef.current.x * 0.35 + clamped.x * 0.65,
          y: playerPosRef.current.y * 0.35 + clamped.y * 0.65,
        };
      }
"""

# Insert before STAGE A if not present
if "玩家只走迷宫通路" not in t:
    t = t.replace(
        "      // ── STAGE A: TRAVEL_RECOVERY (Prim maze) ──",
        clamp_block + "\n      // ── STAGE A: TRAVEL_RECOVERY (Prim maze) ──",
    )

# Guest should skip local trash DPS simulation — wrap the discrete combat block
# Mark: if syncRemotePositions, skip party hits trash
t = t.replace(
    "        // 非匀速：随机节拍 + 波动伤害，避免匀速磨血\n        const dpsCadence = 5 + Math.floor(Math.random() * 10);\n        if (activePackMobs.length > 0 && tickCount % dpsCadence === 0) {",
    "        // 非匀速：随机节拍 + 波动伤害；客人端不本地结算（跟房主快照）\n        const dpsCadence = 5 + Math.floor(Math.random() * 10);\n        if (!syncRemotePositions && activePackMobs.length > 0 && tickCount % dpsCadence === 0) {",
)

t = t.replace(
    "        // Trash returns light damage onto the party (prefer tank, never lethal wipe)\n        if (activePackMobs.length > 0 && livingAllies.length > 0 && tickCount % 14 === 0) {",
    "        // Trash returns light damage onto the party (prefer tank, never lethal wipe)\n        if (!syncRemotePositions && activePackMobs.length > 0 && livingAllies.length > 0 && tickCount % 14 === 0) {",
)

p.write_text(t, encoding="utf-8")
print("ok", "publishHostMazeSync" in t, "drawPrimWalls" in t, "玩家只走迷宫通路" in t)
