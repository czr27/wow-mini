# -*- coding: utf-8 -*-
from pathlib import Path

p = Path("DEV/packages/engine/src/engine/RunStateMachine.ts")
t = p.read_text(encoding="utf-8")

if "getConfiguredTravelMs" not in t:
    t = t.replace(
        "  public getCurrentBoss() {",
        """  public getConfiguredTravelMs(): number {
    if (typeof this.dungeon.travelMs === 'number' && this.dungeon.travelMs > 0) {
      return this.dungeon.travelMs;
    }
    return this.dungeon.tier === '20man' ? 20000 : 10000;
  }

  public beginTravelRecovery() {
    const ms = this.getConfiguredTravelMs();
    this.phase = 'TRAVEL_RECOVERY';
    this.travelRemainingMs = ms;
    this.totalTravelMs = ms;
    this.isCorpseRunning = false;
    this.corpseRunTimerMs = 0;
  }

  public getCurrentBoss() {""",
    )

t = t.replace(
    """      this.currentBossIndex++;
      this.wipesOnCurrentBoss = 0;
      this.phase = 'TRAVEL_RECOVERY';
      this.travelRemainingMs = 12000;
      this.totalTravelMs = 12000;
      this.isCorpseRunning = false;
      this.corpseRunTimerMs = 0;
      this.performTravelRecovery(true, false); // Dead teammates remain dead until revived or corpse run!
""",
    """      this.currentBossIndex++;
      this.wipesOnCurrentBoss = 0;
      this.beginTravelRecovery();
      this.performTravelRecovery(true, false); // Dead teammates remain dead until revived or corpse run!
""",
)

t = t.replace(
    """      this.phase = 'TRAVEL_RECOVERY';
      this.travelRemainingMs = 12000;
      this.totalTravelMs = 12000;
      this.isCorpseRunning = false;
      this.corpseRunTimerMs = 0;
      this.performTravelRecovery(true, true);
""",
    """      this.beginTravelRecovery();
      this.performTravelRecovery(true, true);
""",
)

p.write_text(t, encoding="utf-8")
print("12000 left:", t.count("12000"))
print("has beginTravelRecovery:", "beginTravelRecovery" in t)
