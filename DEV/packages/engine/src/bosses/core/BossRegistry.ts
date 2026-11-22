import type { BossEncounterModule } from './BossTypes.js';

/**
 * [BossRegistry] 集中式副本首领机制注册中心
 * 支持按副本名拆分加载，方便后续平滑横向扩展新副本（如火源之界、黑翼血环等）
 */
class BossRegistryImpl {
  private encounters: Map<string, BossEncounterModule> = new Map();
  private dungeonMap: Map<string, Set<string>> = new Map();

  /**
   * 注册单个副本首领机制模块
   */
  public register(encounter: BossEncounterModule): void {
    const scopedKey = this.getKey(encounter.dungeonId, encounter.id);
    this.encounters.set(scopedKey, encounter);
    this.encounters.set(encounter.id, encounter); // 允许直接按 bossId 索引（兼容旧代码）

    if (!this.dungeonMap.has(encounter.dungeonId)) {
      this.dungeonMap.set(encounter.dungeonId, new Set());
    }
    this.dungeonMap.get(encounter.dungeonId)!.add(encounter.id);
  }

  /**
   * 批量注册副本首领
   */
  public registerAll(encounters: BossEncounterModule[]): void {
    for (const enc of encounters) {
      this.register(enc);
    }
  }

  /**
   * 获取指定副本或通用首领模块
   */
  public get(bossId: string, dungeonId?: string): BossEncounterModule | undefined {
    if (dungeonId) {
      const scoped = this.encounters.get(this.getKey(dungeonId, bossId));
      if (scoped) return scoped;
    }
    return this.encounters.get(bossId);
  }

  /**
   * 获取某副本下的全部首领模块
   */
  public getByDungeon(dungeonId: string): BossEncounterModule[] {
    const bossIds = this.dungeonMap.get(dungeonId);
    if (!bossIds) return [];
    const list: BossEncounterModule[] = [];
    for (const bId of bossIds) {
      const enc = this.encounters.get(this.getKey(dungeonId, bId));
      if (enc) list.push(enc);
    }
    return list;
  }

  /**
   * 获取当前所有已注册的副本 ID 列表
   */
  public getRegisteredDungeons(): string[] {
    return Array.from(this.dungeonMap.keys());
  }

  private getKey(dungeonId: string, bossId: string): string {
    return `${dungeonId}:${bossId}`;
  }
}

export const BossRegistry = new BossRegistryImpl();
