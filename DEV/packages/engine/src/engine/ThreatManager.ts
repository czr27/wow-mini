/**
 * [E-04] ThreatManager — 仇恨系统
 *
 * 每个敌方单位维护一张独立的仇恨列表。
 * - 伤害产生1:1仇恨
 * - 治疗产生0.5:1仇恨（由CombatEngine负责换算后传入）
 * - 嘲讽：直接成为第一位并×110%
 * - 目标切换逻辑：
 *   * 当前目标死亡：立刻转火存活的第一仇恨目标
 *   * 近战 OT 阈值：需要超过当前目标仇恨的 110%
 *   * 远程 OT 阈值：需要超过当前目标仇恨的 130%
 */
export class ThreatManager {
  /** threatTable[enemyId][sourceId] = threat amount */
  private tables: Map<string, Map<string, number>> = new Map();
  /** enemyId -> current target id */
  private currentTargets: Map<string, string> = new Map();

  registerUnit(unitId: string): void {
    if (!this.tables.has(unitId)) {
      this.tables.set(unitId, new Map());
    }
  }

  /**
   * Add threat on `enemyId`'s table from `sourceId`.
   * @param amount Already-scaled threat value
   */
  addThreat(enemyId: string, sourceId: string, amount: number): void {
    if (!enemyId || amount <= 0) return;
    const table = this.getOrCreate(enemyId);
    const current = table.get(sourceId) ?? 0;
    table.set(sourceId, current + amount);
  }

  /**
   * Taunt: `casterId` instantly becomes top of `enemyId`'s threat table at ×110%.
   */
  applyTaunt(enemyId: string, casterId: string): void {
    const table = this.getOrCreate(enemyId);
    const topThreat = this.getTopThreat(enemyId);
    // Set to 110% of top threat (at least 1)
    const newThreat = Math.max(1, topThreat * 1.1);
    table.set(casterId, newThreat);
    this.currentTargets.set(enemyId, casterId);
  }

  /** Get the unit currently at the top of `enemyId`'s threat table (tank target). */
  getTopThreatSource(enemyId: string): string | undefined {
    const table = this.tables.get(enemyId);
    if (!table || table.size === 0) return undefined;
    let topId: string | undefined;
    let topVal = -1;
    for (const [id, val] of table) {
      if (val > topVal) { topVal = val; topId = id; }
    }
    return topId;
  }

  /**
   * Evaluates the authentic WoW OT (Over-Threat) mechanism:
   * - If current target is dead or undefined, switches to highest living threat source.
   * - Melee needs >110% of current target threat to pull aggro.
   * - Ranged needs >130% of current target threat to pull aggro.
   */
  resolveTarget(
    enemyId: string,
    isAliveCheck?: (unitId: string) => boolean,
    isMeleeCheck?: (unitId: string) => boolean,
  ): string | undefined {
    const table = this.tables.get(enemyId);
    if (!table || table.size === 0) return undefined;

    const currentTarget = this.currentTargets.get(enemyId);
    const currentAlive = currentTarget ? (isAliveCheck ? isAliveCheck(currentTarget) : true) : false;

    // Filter alive candidates
    const livingEntries: Array<{ id: string; threat: number }> = [];
    for (const [id, val] of table) {
      if (!isAliveCheck || isAliveCheck(id)) {
        livingEntries.push({ id, threat: val });
      }
    }
    if (livingEntries.length === 0) {
      this.currentTargets.delete(enemyId);
      return undefined;
    }

    livingEntries.sort((a, b) => b.threat - a.threat);
    const highest = livingEntries[0];

    // If no current target or current target is dead, switch immediately to top living
    if (!currentTarget || !currentAlive) {
      this.currentTargets.set(enemyId, highest.id);
      return highest.id;
    }

    // Current target is alive, check OT threshold
    const currentThreat = table.get(currentTarget) ?? 0;
    if (currentThreat <= 0) {
      this.currentTargets.set(enemyId, highest.id);
      return highest.id;
    }

    // Check if highest threat candidate pulls aggro (OT)
    if (highest.id !== currentTarget) {
      const isMelee = isMeleeCheck ? isMeleeCheck(highest.id) : true;
      const threshold = currentThreat * (isMelee ? 1.10 : 1.30);
      if (highest.threat >= threshold) {
        // Aggro pulled! (OT)
        this.currentTargets.set(enemyId, highest.id);
        return highest.id;
      }
    }

    return currentTarget;
  }

  getCurrentTarget(enemyId: string): string | undefined {
    return this.currentTargets.get(enemyId);
  }

  setCurrentTarget(enemyId: string, targetId: string): void {
    this.currentTargets.set(enemyId, targetId);
  }

  onUnitDeath(unitId: string): void {
    // Zero out threat for dead unit across all enemy tables
    for (const [enemyId, table] of this.tables.entries()) {
      table.set(unitId, 0);
      if (this.currentTargets.get(enemyId) === unitId) {
        this.currentTargets.delete(enemyId);
      }
    }
  }

  /** Get the threat value of the leader on `enemyId`'s table. */
  getTopThreat(enemyId: string): number {
    const table = this.tables.get(enemyId);
    if (!table || table.size === 0) return 0;
    return Math.max(...table.values());
  }

  getThreatFor(enemyId: string, sourceId: string): number {
    return this.tables.get(enemyId)?.get(sourceId) ?? 0;
  }

  /** Full sorted threat list for a given enemy (descending). */
  getThreatList(enemyId: string): Array<{ sourceId: string; amount: number }> {
    const table = this.tables.get(enemyId);
    if (!table) return [];
    return Array.from(table.entries())
      .map(([sourceId, amount]) => ({ sourceId, amount }))
      .sort((a, b) => b.amount - a.amount);
  }

  resetThreat(enemyId: string): void {
    this.tables.get(enemyId)?.clear();
    this.currentTargets.delete(enemyId);
  }

  resetAll(): void {
    for (const table of this.tables.values()) table.clear();
    this.currentTargets.clear();
  }

  private getOrCreate(enemyId: string): Map<string, number> {
    if (!this.tables.has(enemyId)) this.tables.set(enemyId, new Map());
    return this.tables.get(enemyId)!;
  }
}
