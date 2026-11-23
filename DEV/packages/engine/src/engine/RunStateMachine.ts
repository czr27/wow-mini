import {
  RunPhase,
  Unit,
  EncounterReport,
  DungeonClearCertificate,
  ClassId,
} from '../types.js';
import { CombatEngine } from './CombatEngine.js';
import { ReportManager } from './ReportManager.js';
import { buildDungeonBossHpList } from './TierProfile.js';

export interface DungeonConfig {
  id: string;
  name: string;
  tier: '5man' | '20man';
  /** 赶路目标时长；缺省 5人 7s / 20人 14s */
  travelMs?: number;
  bosses: Array<{
    id: string;
    name: string;
    hp: number;
    timelineId: string;
  }>;
}

type BossSeed = { id: string; name: string; timelineId: string };

function withKillTimeHp(tier: '5man' | '20man', seeds: BossSeed[]) {
  const hpList = buildDungeonBossHpList(tier, seeds.length);
  return seeds.map((b, i) => ({ ...b, hp: hpList[i] }));
}

export const SHADOWFANG_KEEP_CONFIG: DungeonConfig = {
  id: 'shadowfang_keep',
  name: '影牙城堡（英雄模式 · Lv.80）',
  tier: '5man',
  travelMs: 7000,
  // AI 满编可持续 DPS → 非尾王 ≈2 分钟 / 尾王 ≈3 分钟
  bosses: withKillTimeHp('5man', [
    { id: 'ashbury', name: '亚什布里男爵', timelineId: 'ashbury' },
    { id: 'silverlaine', name: '席瓦莱恩男爵', timelineId: 'silverlaine' },
    { id: 'springvale', name: '指挥官斯普林瓦尔', timelineId: 'springvale' },
    { id: 'walden', name: '沃登勋爵', timelineId: 'walden' },
    { id: 'godfrey', name: '高弗雷勋爵', timelineId: 'godfrey' },
  ]),
};

export const DRAGON_SOUL_CONFIG: DungeonConfig = {
  id: 'dragon_soul',
  name: '巨龙之魂（英雄模式 20人 · Lv.80）',
  tier: '20man',
  travelMs: 14000,
  // AI 满编可持续 DPS → 非尾王 ≈3 分钟 / 尾王 ≈5 分钟
  bosses: withKillTimeHp('20man', [
    { id: 'morchok', name: '莫卓克', timelineId: 'morchok' },
    { id: 'zonozz', name: '督军佐诺兹', timelineId: 'zonozz' },
    { id: 'yorsahj', name: '不眠的约萨希', timelineId: 'yorsahj' },
    { id: 'hagara', name: '缚风者哈甲拉', timelineId: 'hagara' },
    { id: 'ultraxion', name: '奥卓克希昂', timelineId: 'ultraxion' },
    { id: 'blackhorn', name: '战争领主黑角', timelineId: 'blackhorn' },
    { id: 'spine', name: '死亡之翼的背脊', timelineId: 'spine' },
    { id: 'madness', name: '死亡之翼的疯狂', timelineId: 'madness' },
  ]),
};

export const DEADMINES_CONFIG: DungeonConfig = {
  id: 'deadmines',
  name: '死亡矿井（英雄模式 · Lv.80）',
  tier: '5man',
  travelMs: 7000,
  bosses: withKillTimeHp('5man', [
    { id: 'glubtok', name: '戈洛克托克', timelineId: 'glubtok' },
    { id: 'helix', name: '赫利克斯·碎轮', timelineId: 'helix' },
    { id: 'foe_reaper', name: '死神 5000', timelineId: 'foe_reaper' },
    { id: 'ripsnarl', name: '撕心船长利普斯纳尔', timelineId: 'ripsnarl' },
    { id: 'cookie', name: '曲奇', timelineId: 'cookie' },
    { id: 'vanessa', name: '梵妮莎·范克里夫', timelineId: 'vanessa' },
  ]),
};

/** 普通难度死矿：不含梵妮莎 */
export const DEADMINES_NORMAL_CONFIG: DungeonConfig = {
  ...DEADMINES_CONFIG,
  name: '死亡矿井（普通模式 · Lv.80）',
  bosses: DEADMINES_CONFIG.bosses.filter(b => b.id !== 'vanessa'),
};

export const SCARLET_MONASTERY_CONFIG: DungeonConfig = {
  id: 'scarlet_monastery',
  name: '血色修道院（英雄模式 · Lv.80）',
  tier: '5man',
  travelMs: 7000,
  bosses: withKillTimeHp('5man', [
    { id: 'vishas', name: '审讯员韦沙斯', timelineId: 'vishas' },
    { id: 'thalnoren', name: '血法师萨尔诺斯', timelineId: 'thalnoren' },
    { id: 'loksey', name: '驯犬者洛克希', timelineId: 'loksey' },
    { id: 'doan', name: '奥法师杜安', timelineId: 'doan' },
    { id: 'herod', name: '赫洛德', timelineId: 'herod' },
    { id: 'mograine_whitemane', name: '莫格莱尼与怀特迈恩', timelineId: 'mograine_whitemane' },
  ]),
};

export const STRATHOLME_CONFIG: DungeonConfig = {
  id: 'stratholme',
  name: '斯坦索姆（英雄模式 · Lv.80）',
  tier: '5man',
  travelMs: 7000,
  bosses: withKillTimeHp('5man', [
    { id: 'willey', name: '炮手威利', timelineId: 'willey' },
    { id: 'balnazzar', name: '巴纳扎尔', timelineId: 'balnazzar' },
    { id: 'ramstein', name: '屠宰房助手拉姆斯登', timelineId: 'ramstein' },
    { id: 'rivendare', name: '瑞文戴尔男爵', timelineId: 'rivendare' },
  ]),
};

export const ZULGURUB_CONFIG: DungeonConfig = {
  id: 'zulgurub',
  name: '祖尔格拉布（英雄模式 · Lv.80）',
  tier: '5man',
  travelMs: 7000,
  bosses: withKillTimeHp('5man', [
    { id: 'venoxis', name: '高阶祭司温诺希斯', timelineId: 'venoxis' },
    { id: 'mandokir', name: '血领主曼多基尔', timelineId: 'mandokir' },
    { id: 'kilnara', name: '高阶祭司基尔娜拉', timelineId: 'kilnara' },
    { id: 'zanzil', name: '赞吉尔', timelineId: 'zanzil' },
    { id: 'jindo', name: '碎神者金度', timelineId: 'jindo' },
  ]),
};

/** 普通难度祖格：Boss 列表同英雄；血量由 spawnBoss 按英雄预算 ÷1.5 */
export const ZULGURUB_NORMAL_CONFIG: DungeonConfig = {
  ...ZULGURUB_CONFIG,
  name: '祖尔格拉布（普通模式 · Lv.80）',
};

const DUNGEON_CONFIG_BY_ID: Record<string, DungeonConfig> = {
  shadowfang_keep: SHADOWFANG_KEEP_CONFIG,
  dragon_soul: DRAGON_SOUL_CONFIG,
  deadmines: DEADMINES_CONFIG,
  scarlet_monastery: SCARLET_MONASTERY_CONFIG,
  stratholme: STRATHOLME_CONFIG,
  zulgurub: ZULGURUB_CONFIG,
};

/** 按 dungeonId 解析配置；死矿普通去掉梵妮莎；祖格普通仅改显示名（血量 ÷1.5） */
export function getDungeonConfig(
  dungeonId: string,
  difficulty?: 'NORMAL' | 'HEROIC' | 'CUSTOM',
): DungeonConfig {
  if (dungeonId === 'deadmines' && difficulty === 'NORMAL') {
    return DEADMINES_NORMAL_CONFIG;
  }
  if (dungeonId === 'zulgurub' && difficulty === 'NORMAL') {
    return ZULGURUB_NORMAL_CONFIG;
  }
  return DUNGEON_CONFIG_BY_ID[dungeonId] || SHADOWFANG_KEEP_CONFIG;
}

export function listDungeonConfigs(): DungeonConfig[] {
  return Object.values(DUNGEON_CONFIG_BY_ID);
}

export class RunStateMachine {
  public phase: RunPhase = 'LOBBY';
  public currentBossIndex = 0;
  public travelRemainingMs = 0;
  /** 5 人约 7s、20 人约 14s；startRun / 进赶路时按 dungeon.tier 刷新 */
  public totalTravelMs = 7000;
  public wipeVoteTimerMs = 0;
  public totalRunDurationSec = 0;
  public encounterReports: EncounterReport[] = [];
  public currentBossStartTime = 0;
  public wipesOnCurrentBoss = 0;
  public latestWipeReport: EncounterReport | null = null;
  public isCleared = false;
  public isCorpseRunning = false;
  public corpseRunTimerMs = 0;
  public totalCorpseRunMs = 10000;

  constructor(
    public dungeon: DungeonConfig = SHADOWFANG_KEEP_CONFIG,
    public combatEngine: CombatEngine,
    public reportManager: ReportManager
  ) {}

  public getConfiguredTravelMs(): number {
    if (typeof this.dungeon.travelMs === 'number' && this.dungeon.travelMs > 0) {
      return this.dungeon.travelMs;
    }
    return this.dungeon.tier === '20man' ? 14000 : 7000;
  }

  public beginTravelRecovery() {
    const ms = this.getConfiguredTravelMs();
    this.phase = 'TRAVEL_RECOVERY';
    this.travelRemainingMs = ms;
    this.totalTravelMs = ms;
    this.isCorpseRunning = false;
    this.corpseRunTimerMs = 0;
  }

  public getCurrentBoss() {
    return this.dungeon.bosses[this.currentBossIndex] || null;
  }

  public isLastBoss(): boolean {
    return this.currentBossIndex >= this.dungeon.bosses.length - 1;
  }

  public checkIsCleared(): boolean {
    if (this.isCleared) return true;
    if (!this.dungeon || !this.dungeon.bosses) return false;
    const killCount = this.encounterReports.filter(r => r.result === 'KILL').length;
    return killCount >= this.dungeon.bosses.length;
  }

  public hasLivingRevivers(): boolean {
    return this.combatEngine.friendlyUnits.some(
      u =>
        (u.isAlive ?? u.alive) &&
        u.hp > 0 &&
        (u.role === 'HEALER' ||
          u.classId === 'SHAMAN' ||
          u.classId === 'DRUID' ||
          u.classId === 'PALADIN' ||
          u.classId === 'PRIEST')
    );
  }

  public getDeadUnits(): Unit[] {
    return this.combatEngine.friendlyUnits.filter(u => (!u.isAlive && !u.alive) || u.hp <= 0);
  }

  public canAdvanceTravel(): boolean {
    return !this.isCorpseRunning && this.getDeadUnits().length === 0;
  }

  public massResurrect() {
    for (const unit of this.combatEngine.friendlyUnits) {
      unit.isAlive = true;
      unit.alive = true;
      unit.hp = unit.maxHp;
      unit.mp = unit.maxMp;
      unit.energy = unit.classId === 'ROGUE' ? 100 : (unit.energy ?? 0);
      unit.focus = unit.classId === 'HUNTER' ? 100 : (unit.focus ?? 0);
      unit.rage = unit.classId === 'WARRIOR' ? 25 : (unit.rage ?? 0);
      unit.holyPower = 0;
      unit.absorb = 0;
      unit.buffs = unit.buffs.filter(b => b.kind === 'BUFF');
      unit.threatTable = [];
      if (unit.runes) {
        for (const r of unit.runes) {
          r.cooldownMs = 0;
        }
      }
    }
    this.isCorpseRunning = false;
    this.corpseRunTimerMs = 0;
  }

  public startRun() {
    this.currentBossIndex = 0;
    this.totalRunDurationSec = 0;
    this.encounterReports = [];
    this.wipesOnCurrentBoss = 0;
    this.isCleared = false;
    this.latestWipeReport = null;
    this.beginTravelRecovery();
    this.performTravelRecovery(false, true);
  }

  public fastForwardTravel() {
    if (this.phase === 'TRAVEL_RECOVERY') {
      if (!this.canAdvanceTravel()) {
        return;
      }
      this.travelRemainingMs = 0;
      this.enterBossCombat();
    }
  }

  public tick(deltaMs: number) {
    if (this.phase !== 'LOBBY' && this.phase !== 'SUMMARY') {
      this.totalRunDurationSec += deltaMs / 1000;
    }

    if (this.phase === 'TRAVEL_RECOVERY') {
      const deadUnits = this.getDeadUnits();
      if (deadUnits.length > 0) {
        // Dead teammates exist: wait for revival or corpse run
        const hasReviver = this.hasLivingRevivers();
        if (!hasReviver) {
          // All revivers are dead! 10-second corpse run penalty!
          if (!this.isCorpseRunning) {
            this.isCorpseRunning = true;
            this.corpseRunTimerMs = this.totalCorpseRunMs;
          }
          this.corpseRunTimerMs -= deltaMs;
          if (this.corpseRunTimerMs <= 0) {
            // Corpse run finished: mass resurrection!
            this.massResurrect();
            this.combatEngine.effectsManager?.addFloatingText({
              targetId: this.combatEngine.friendlyUnits[0]?.id || 'raid',
              text: '跑尸归来 · 全员群体复活！',
              category: 'HEAL',
              isCrit: true,
            });
          }
        } else {
          // Living revivers exist: waiting for revival
          this.isCorpseRunning = false;
          this.corpseRunTimerMs = 0;
        }
      } else {
        // All teammates are alive: normal travel countdown
        this.isCorpseRunning = false;
        this.corpseRunTimerMs = 0;
        this.travelRemainingMs -= deltaMs;
        if (this.travelRemainingMs <= 0) {
          this.enterBossCombat();
        }
      }
    } else if (this.phase === 'BOSS_COMBAT') {
      this.checkCombatState();
    } else if (this.phase === 'WIPE_VOTE') {
      this.wipeVoteTimerMs -= deltaMs;
      if (this.wipeVoteTimerMs <= 0) {
        // Timeout default: retry boss
        this.handleWipeVoteChoice('RETRY');
      }
    }
  }

  public enterBossCombat() {
    this.phase = 'BOSS_COMBAT';
    this.currentBossStartTime = this.combatEngine.nowMs;
    const boss = this.getCurrentBoss();
    if (boss) {
      this.combatEngine.spawnBoss(boss.id, boss.name, boss.hp);
    }
  }

  public performTravelRecovery(applyBuffs: boolean = true, reviveAll: boolean = false) {
    if (!this.combatEngine || !this.combatEngine.friendlyUnits) return;
    // 1. Recover HP & Mana for friendly units (living units recover fully, dead units stay dead unless reviveAll)
    for (const unit of this.combatEngine.friendlyUnits) {
      const isDead = (!unit.isAlive && !unit.alive) || unit.hp <= 0;
      if (reviveAll || !isDead) {
        unit.isAlive = true;
        unit.alive = true;
        unit.hp = unit.maxHp;
        unit.mp = unit.maxMp;
        unit.energy = unit.classId === 'ROGUE' ? 100 : (unit.energy ?? 0);
        unit.focus = unit.classId === 'HUNTER' ? 100 : (unit.focus ?? 0);
        unit.rage = unit.classId === 'WARRIOR' ? 25 : (unit.rage ?? 0);
        unit.holyPower = 0;
        unit.absorb = 0;
        unit.buffs = unit.buffs.filter(b => b.kind === 'BUFF'); // clear harmful debuffs
        unit.threatTable = [];
        if (unit.runes) {
          for (const r of unit.runes) {
            r.cooldownMs = 0;
          }
        }
      } else {
        unit.isAlive = false;
        unit.alive = false;
        unit.hp = 0;
        unit.absorb = 0;
        unit.buffs = [];
        unit.threatTable = [];
      }
    }
    // 2. Clear threat manager and all ground effects
    this.combatEngine.threatManager?.resetAll();
    this.combatEngine.effectsManager?.clearAll();

    // 3. Reset all cooldowns
    this.combatEngine.resetCooldowns();

    // 4. Auto apply raid buffs (Horn of Winter, Mark of the Wild, Arcane Brilliance)
    if (applyBuffs) {
      this.applyRaidBuffs();
    }

    // 5. Reset boss to full health if current boss exists
    const currentBoss = this.getCurrentBoss();
    if (currentBoss) {
      this.combatEngine.spawnBoss(currentBoss.id, currentBoss.name, currentBoss.hp);
    }
  }

  private ensureRaidBuff(
    unit: {
      id: string;
      buffs: Array<{ id?: string; spellId?: string; remainingMs?: number; durationMs?: number }>;
    },
    spellId: string,
    name: string
  ) {
    const existing = unit.buffs.find(
      (b) =>
        (b.spellId || '').toLowerCase() === spellId ||
        (b.spellId || '').toLowerCase().includes(spellId)
    );
    if (existing) {
      existing.durationMs = 3_600_000;
      existing.remainingMs = 3_600_000;
      // Refresh path still applies HP/MP bonuses (idempotent) if old push skipped them.
      this.combatEngine.applyBuff(unit as any, {
        id: String(existing.id || `buff_${spellId}_${unit.id}`),
        spellId,
        name,
        kind: 'BUFF',
        tags: ['STAT'],
        sourceUnitId: 'raid',
        targetUnitId: unit.id,
        durationMs: 3_600_000,
        remainingMs: 3_600_000,
        stacks: 1,
        maxStacks: 1,
      });
      return;
    }
    this.combatEngine.applyBuff(unit as any, {
      id: `buff_${spellId}_${unit.id}`,
      spellId,
      name,
      kind: 'BUFF',
      tags: ['STAT'],
      sourceUnitId: 'raid',
      targetUnitId: unit.id,
      durationMs: 3_600_000,
      remainingMs: 3_600_000,
      stacks: 1,
      maxStacks: 1,
    });
  }

  private applyRaidBuffs() {
    const hasDk = this.combatEngine.friendlyUnits.some(u => u.classId === 'DK');
    const hasDruid = this.combatEngine.friendlyUnits.some(u => u.classId === 'DRUID');
    const hasMage = this.combatEngine.friendlyUnits.some(u => u.classId === 'MAGE');

    for (const unit of this.combatEngine.friendlyUnits) {
      if (!unit.isAlive && !unit.alive) continue;
      if (hasDk) this.ensureRaidBuff(unit, 'horn_of_winter', '寒冬号角');
      if (hasDruid) this.ensureRaidBuff(unit, 'mark_of_the_wild', '野性印记');
      if (hasMage) this.ensureRaidBuff(unit, 'arcane_brilliance', '奥术光辉');
      // Resource bonuses may raise caps after the pre-buff full heal — top off bars.
      unit.hp = unit.maxHp;
      if (unit.maxMp && unit.maxMp > 0) unit.mp = unit.maxMp;
    }
  }

  private checkCombatState() {
    const boss = this.combatEngine.bossUnit;
    const allPlayersDead = this.combatEngine.friendlyUnits.every(u => !u.alive);

    if (boss && !boss.alive) {
      // Boss killed!
      this.onBossKilled();
    } else if (allPlayersDead) {
      // Raid wiped!
      this.onRaidWiped();
    }
  }

  private onBossKilled() {
    const boss = this.getCurrentBoss();
    const durationSec = Math.max(1, (this.combatEngine.nowMs - this.currentBossStartTime) / 1000);

    const report = this.reportManager.generateEncounterReport(
      this.currentBossIndex,
      boss ? boss.id : 'unknown',
      boss ? boss.name : 'Unknown Boss',
      'KILL',
      durationSec,
      this.wipesOnCurrentBoss,
      this.combatEngine.friendlyUnits
    );
    this.encounterReports.push(report);

    if (this.isLastBoss()) {
      // Dungeon Cleared!
      this.isCleared = true;
      this.phase = 'SUMMARY';
    } else {
      // Advance to next boss
      this.currentBossIndex++;
      this.wipesOnCurrentBoss = 0;
      this.beginTravelRecovery();
      this.performTravelRecovery(true, false); // Dead teammates remain dead until revived or corpse run!
    }
  }

  private onRaidWiped() {
    this.wipesOnCurrentBoss++;
    this.phase = 'WIPE_VOTE';
    this.wipeVoteTimerMs = 15000;

    const boss = this.combatEngine.bossUnit;
    const durationSec = Math.max(1, (this.combatEngine.nowMs - this.currentBossStartTime) / 1000);
    const bossRemainingHpPct = boss && boss.maxHp > 0 ? parseFloat(((boss.hp / boss.maxHp) * 100).toFixed(1)) : 0;

    // Identify first death or highest damage taken
    const sortedDmg = [...this.combatEngine.friendlyUnits].sort(
      (a, b) => (b.combatStats?.damageTaken || 0) - (a.combatStats?.damageTaken || 0)
    );
    const topVictim = sortedDmg[0];
    const wipeCause = topVictim
      ? `${topVictim.name} 承受 ${topVictim.combatStats?.damageTaken || 0} 点伤害倒下导致灭团`
      : '全团生命值归零灭团';

    const report = this.reportManager.generateEncounterReport(
      this.currentBossIndex,
      boss ? boss.id : 'unknown',
      boss ? boss.name : 'Unknown Boss',
      'WIPE',
      durationSec,
      this.wipesOnCurrentBoss,
      this.combatEngine.friendlyUnits,
      bossRemainingHpPct,
      wipeCause,
      topVictim?.name
    );
    this.latestWipeReport = report;
    this.encounterReports.push(report);
  }

  public handleWipeVoteChoice(choice: 'RETRY' | 'FINISH') {
    if (choice === 'RETRY') {
      // Reset to travel recovery of current boss
      this.beginTravelRecovery();
      this.performTravelRecovery(true, true);
    } else {
      // End dungeon run and show summary (uncompleted/wiped)
      this.isCleared = false;
      this.phase = 'SUMMARY';
    }
  }
}
