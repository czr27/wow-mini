# -*- coding: utf-8 -*-
from pathlib import Path

# --- CombatCanvas: N-pack timeline driven by mazeLayout ---
canvas = Path("DEV/packages/web/src/canvas/CombatCanvas.tsx")
t = canvas.read_text(encoding="utf-8")

# Widen packCleared ref type
t = t.replace(
    "const packClearedAtElapsedRef = useRef<{ 1: number | null; 2: number | null }>({ 1: null, 2: null });",
    "const packClearedAtElapsedRef = useRef<Record<number, number | null>>({ 1: null, 2: null, 3: null });",
)
t = t.replace(
    "packClearedAtElapsedRef.current = { 1: null, 2: null };",
    "packClearedAtElapsedRef.current = { 1: null, 2: null, 3: null };",
)

old_timeline = """      // Synchronized Milestones along totalT:
      // Pack 1 at 32% distance:
      //   0 ~ 18% totalT: Marching from entrance to Pack 1
      //   18% ~ 38% totalT: Combat with Pack 1 (HP decreases smoothly to 0)
      //   38% ~ 44% totalT: Pack 1 soul dissipation & death fade out
      // Pack 2 at 72% distance:
      //   44% ~ 64% totalT: Marching from Pack 1 to Pack 2
      //   64% ~ 84% totalT: Combat with Pack 2 (HP decreases smoothly to 0)
      //   84% ~ 90% totalT: Pack 2 soul dissipation & death fade out
      // Exit Portal:
      //   90% ~ 100% totalT: Sprinting to Exit Portal!
      // Exactly at 100% (elapsed == totalT), party arrives at the exit portal door!
      const tP1Start = 0.18 * totalT;
      const tP1HpZero = 0.38 * totalT;
      const tP1Clear = 0.44 * totalT;
      const tP2Start = 0.64 * totalT;
      const tP2HpZero = 0.84 * totalT;
      const tP2Clear = 0.90 * totalT;

      const stopDist1 = totalMazeLen * 0.32 - 48;
      const stopDist2 = totalMazeLen * 0.72 - 48;

      const packStillAlive = (packIndex: 1 | 2) =>
        trashMobsRef.current.some(m => m.packIndex === packIndex && !m.isDead && !m.isTombstone);

      // Latch the moment each pack falls so early clears don't snap the lead forward
      if (elapsed < tP1Start) {
        packClearedAtElapsedRef.current[1] = null;
        packClearedAtElapsedRef.current[2] = null;
      } else {
        if (!packStillAlive(1) && packClearedAtElapsedRef.current[1] === null) {
          packClearedAtElapsedRef.current[1] = elapsed;
        }
        if (elapsed >= tP2Start && !packStillAlive(2) && packClearedAtElapsedRef.current[2] === null) {
          packClearedAtElapsedRef.current[2] = elapsed;
        }
      }

      let targetLeadDist = 0;
      let currentEncounterPack = 0;

      if (elapsed < tP1Start) {
        targetLeadDist = (elapsed / tP1Start) * stopDist1;
      } else if (elapsed < tP2Start) {
        if (packStillAlive(1)) {
          targetLeadDist = stopDist1;
          currentEncounterPack = 1;
        } else {
          const marchT0 = packClearedAtElapsedRef.current[1] ?? tP1Clear;
          const denom = Math.max(1, tP2Start - marchT0);
          const ratio = Math.max(0, Math.min(1, (elapsed - marchT0) / denom));
          targetLeadDist = stopDist1 + ratio * (stopDist2 - stopDist1);
        }
      } else if (elapsed < totalT) {
        if (packStillAlive(2)) {
          targetLeadDist = stopDist2;
          currentEncounterPack = 2;
        } else {
          const marchT0 = packClearedAtElapsedRef.current[2] ?? tP2Clear;
          const denom = Math.max(1, totalT - marchT0);
          const ratio = Math.max(0, Math.min(1, (elapsed - marchT0) / denom));
          targetLeadDist = stopDist2 + ratio * (totalMazeLen - stopDist2);
        }
      } else {
        targetLeadDist = totalMazeLen;
      }
"""

new_timeline = """      // Prim 迷宫：按 layout.packCount / trash.pathT 切分赶路时间线（5人~10s / 20人~20s）
      const packCount = Math.max(1, mazeLayout.packCount || 2);
      const packWindows = Array.from({ length: packCount }, (_, i) => {
        const packIndex = i + 1;
        const pathT =
          mazeLayout.trashSpawns.find((s) => s.packIndex === packIndex)?.pathT ??
          (packIndex / (packCount + 1)) * 0.85 + 0.08;
        const stopDist = Math.max(0, totalMazeLen * pathT - 48);
        const segStart = (i / packCount) * 0.88 * totalT;
        const segEnd = ((i + 1) / packCount) * 0.88 * totalT;
        const segLen = Math.max(1, segEnd - segStart);
        return {
          packIndex,
          stopDist,
          fightStart: segStart + segLen * 0.32,
          forceKillAt: segStart + segLen * 0.82,
          clearAt: segEnd,
        };
      });
      const exitSprintStart = 0.9 * totalT;

      const packStillAlive = (packIndex: number) =>
        trashMobsRef.current.some((m) => m.packIndex === packIndex && !m.isDead && !m.isTombstone);

      if (elapsed < (packWindows[0]?.fightStart ?? 0)) {
        for (let p = 1; p <= packCount; p++) packClearedAtElapsedRef.current[p] = null;
      } else {
        for (const w of packWindows) {
          if (
            elapsed >= w.fightStart &&
            !packStillAlive(w.packIndex) &&
            packClearedAtElapsedRef.current[w.packIndex] == null
          ) {
            packClearedAtElapsedRef.current[w.packIndex] = elapsed;
          }
        }
      }

      let targetLeadDist = 0;
      let currentEncounterPack = 0;

      if (elapsed >= totalT) {
        targetLeadDist = totalMazeLen;
      } else {
        let handled = false;
        for (let i = 0; i < packWindows.length; i++) {
          const w = packWindows[i];
          const prevStop = i === 0 ? 0 : packWindows[i - 1].stopDist;
          const nextFight = i + 1 < packWindows.length ? packWindows[i + 1].fightStart : exitSprintStart;
          if (elapsed < w.fightStart) {
            const marchStart = i === 0 ? 0 : packWindows[i - 1].clearAt;
            const denom = Math.max(1, w.fightStart - marchStart);
            const ratio = Math.max(0, Math.min(1, (elapsed - marchStart) / denom));
            targetLeadDist = prevStop + ratio * (w.stopDist - prevStop);
            handled = true;
            break;
          }
          if (packStillAlive(w.packIndex)) {
            targetLeadDist = w.stopDist;
            currentEncounterPack = w.packIndex;
            handled = true;
            break;
          }
          // cleared — march toward next stop / exit until next fight window
          if (elapsed < nextFight) {
            const marchT0 = packClearedAtElapsedRef.current[w.packIndex] ?? w.clearAt;
            const nextStop =
              i + 1 < packWindows.length ? packWindows[i + 1].stopDist : totalMazeLen;
            const denom = Math.max(1, nextFight - marchT0);
            const ratio = Math.max(0, Math.min(1, (elapsed - marchT0) / denom));
            targetLeadDist = w.stopDist + ratio * (nextStop - w.stopDist);
            handled = true;
            break;
          }
        }
        if (!handled) {
          const last = packWindows[packWindows.length - 1];
          const marchT0 = packClearedAtElapsedRef.current[last.packIndex] ?? last.clearAt;
          const denom = Math.max(1, totalT - marchT0);
          const ratio = Math.max(0, Math.min(1, (elapsed - marchT0) / denom));
          targetLeadDist = last.stopDist + ratio * (totalMazeLen - last.stopDist);
        }
      }
"""

if "Prim 迷宫：按 layout.packCount" not in t:
    if old_timeline not in t:
        raise SystemExit("timeline block not found")
    t = t.replace(old_timeline, new_timeline)

# Update trash reset/fightStart to use packWindows
old_reset = """      trashMobsRef.current.forEach(mob => {
        const fightStart = mob.packIndex === 1 ? tP1Start : tP2Start;
        const forceKillAt = mob.packIndex === 1 ? tP1HpZero : tP2HpZero;
"""
new_reset = """      trashMobsRef.current.forEach(mob => {
        const win = packWindows.find((w) => w.packIndex === mob.packIndex) || packWindows[0];
        const fightStart = win.fightStart;
        const forceKillAt = win.forceKillAt;
"""
if "packWindows.find((w) => w.packIndex === mob.packIndex)" not in t:
    t = t.replace(old_reset, new_reset)

# Default totalT fallback
t = t.replace(
    "const totalT = totalTravelMs && totalTravelMs > 0 ? totalTravelMs : 12000;\n      const rem = travelRemainingMs !== undefined ? travelRemainingMs : 12000;",
    "const totalT = totalTravelMs && totalTravelMs > 0 ? totalTravelMs : (is20Man ? 20000 : 10000);\n      const rem = travelRemainingMs !== undefined ? travelRemainingMs : totalT;",
)

canvas.write_text(t, encoding="utf-8")
print("canvas packs ok")

# --- CombatHudScreen: pass dungeonId ---
hud = Path("DEV/packages/web/src/screens/CombatHudScreen.tsx")
h = hud.read_text(encoding="utf-8")
if "dungeonId," not in h.split("dungeonTier,")[1][:80]:
    h = h.replace("    dungeonTier,\n    targetBossName,", "    dungeonTier,\n    dungeonId,\n    targetBossName,")
if "dungeonId={dungeonId}" not in h:
    h = h.replace(
        "          dungeonTier={dungeonTier}\n          targetBossName={targetBossName}",
        "          dungeonTier={dungeonTier}\n          dungeonId={dungeonId}\n          targetBossName={targetBossName}",
    )
hud.write_text(h, encoding="utf-8")
print("hud ok")

# --- App: pass dungeonId + travel default ---
app = Path("DEV/packages/web/src/App.tsx")
a = app.read_text(encoding="utf-8")
if "dungeonId={rsmRef.current?.dungeon.id" not in a and 'dungeonId={rsmRef.current?.dungeon?.id' not in a:
    a = a.replace(
        "            dungeonTier={dungeonTier}\n            targetBossName={targetBossName}",
        "            dungeonTier={dungeonTier}\n            dungeonId={rsmRef.current?.dungeon?.id}\n            targetBossName={targetBossName}",
    )
a = a.replace(
    "totalTravelMs={rsmRef.current?.totalTravelMs || 12000}",
    "totalTravelMs={rsmRef.current?.totalTravelMs || (dungeonTier === '20man' ? 20000 : 10000)}",
)
app.write_text(a, encoding="utf-8")
print("app ok")
