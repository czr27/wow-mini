import {
  RunPhase,
  Unit,
  EncounterReport,
  DungeonClearCertificate,
  ClassId,
} from '../types.js';
import { CombatEngine } from './CombatEngine.js';
import { ReportManager } from './ReportManager.js';

export interface DungeonConfig {
  id: string;
  name: string;
  tier: '5man' | '20man';
  bosses: Array<{
    id: string;
    name: string;
    hp: number;
    timelineId: string;
  }>;
}

export const SHADOWFANG_KEEP_CONFIG: DungeonConfig = {
  id: 'shadowfang_keep',
  name: '影牙城堡（英雄模式）',
  tier: '5man',
  bosses: [
    // 5-man minor bosses: tuned for 2~3 minutes (avg 150s at ~42k group DPS)
    { id: 'ashbury', name: '亚什布里男爵', hp: 5800000, timelineId: 'ashbury' },
    { id: 'silverlaine', name: '席瓦莱恩男爵', hp: 6200000, timelineId: 'silverlaine' },
    { id: 'springvale', name: '指挥官斯普林瓦尔', hp: 6500000, timelineId: 'springvale' },
    { id: 'walden', name: '沃登勋爵', hp: 6800000, timelineId: 'walden' },
    // 5-man major boss: tuned for 5 minutes (300s at ~42k group DPS = 12.5M HP)
    { id: 'godfrey', name: '高弗雷勋爵', hp: 12500000, timelineId: 'godfrey' },
  ],
};

export const DRAGON_SOUL_CONFIG: DungeonConfig = {
  id: 'dragon_soul',
  name: '巨龙之魂（英雄模式 20人）',
  tier: '20man',
  bosses: [
    // 20-man minor bosses: tuned for 5 minutes (300s at ~250k group DPS = 75M HP)
    { id: 'morchok', name: '莫卓克', hp: 75000000, timelineId: 'morchok' },
    { id: 'zonozz', name: '督军佐诺兹', hp: 75000000, timelineId: 'zonozz' },
    { id: 'yorsahj', name: '不眠的约萨希', hp: 75000000, timelineId: 'yorsahj' },
    { id: 'hagara', name: '缚风者哈甲拉', hp: 75000000, timelineId: 'hagara' },
    { id: 'ultraxion', name: '奥卓克希昂', hp: 78000000, timelineId: 'ultraxion' },
    { id: 'blackhorn', name: '战争领主黑角', hp: 80000000, timelineId: 'blackhorn' },
    { id: 'spine', name: '死亡之翼的背脊', hp: 85000000, timelineId: 'spine' },
    // 20-man major boss: tuned for 8 minutes (480s at ~250k group DPS = 120M HP)
    { id: 'madness', name: '死亡之翼的疯狂', hp: 120000000, timelineId: 'madness' },
  ],
};

export class RunStateMachine {
  public phase: RunPhase = 'LOBBY';
  public currentBossIndex = 0;
  public travelRemainingMs = 0;
  public totalTravelMs = 12000;
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
      u => (u.isAlive ?? u.alive) && u.hp > 0 && (u.role === 'HEALER' || u.classId === 'SHAMAN' || u.classId === 'DRUID')
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
      unit.energy = 100;
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
    this.phase = 'TRAVEL_RECOVERY';
    this.currentBossIndex = 0;
    this.totalRunDurationSec = 0;
    this.encounterReports = [];
    this.wipesOnCurrentBoss = 0;
    this.travelRemainingMs = 12000; // 12 seconds recovery
    this.totalTravelMs = 12000;
    this.isCleared = false;
    this.latestWipeReport = null;
    this.isCorpseRunning = false;
    this.corpseRunTimerMs = 0;
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
        unit.energy = 100;
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

  private applyRaidBuffs() {
    const hasDk = this.combatEngine.friendlyUnits.some(u => u.classId === 'DK');
    const hasDruid = this.combatEngine.friendlyUnits.some(u => u.classId === 'DRUID');
    const hasMage = this.combatEngine.friendlyUnits.some(u => u.classId === 'MAGE');

    for (const unit of this.combatEngine.friendlyUnits) {
      if (hasDk) {
        unit.buffs.push({
          id: `buff_horn_${unit.id}`,
          spellId: 'horn_of_winter',
          name: '寒冬号角',
          kind: 'BUFF',
          tags: ['STAT'],
          sourceUnitId: 'raid',
          targetUnitId: unit.id,
          durationMs: 3600000,
          remainingMs: 3600000,
          stacks: 1,
          maxStacks: 1,
        });
      }
      if (hasDruid) {
        unit.buffs.push({
          id: `buff_motw_${unit.id}`,
          spellId: 'mark_of_the_wild',
          name: '野性印记',
          kind: 'BUFF',
          tags: ['STAT'],
          sourceUnitId: 'raid',
          targetUnitId: unit.id,
          durationMs: 3600000,
          remainingMs: 3600000,
          stacks: 1,
          maxStacks: 1,
        });
      }
      if (hasMage) {
        unit.buffs.push({
          id: `buff_arcane_${unit.id}`,
          spellId: 'arcane_brilliance',
          name: '奥术光辉',
          kind: 'BUFF',
          tags: ['STAT'],
          sourceUnitId: 'raid',
          targetUnitId: unit.id,
          durationMs: 3600000,
          remainingMs: 3600000,
          stacks: 1,
          maxStacks: 1,
        });
      }
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
      this.phase = 'TRAVEL_RECOVERY';
      this.travelRemainingMs = 12000;
      this.totalTravelMs = 12000;
      this.isCorpseRunning = false;
      this.corpseRunTimerMs = 0;
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
      this.phase = 'TRAVEL_RECOVERY';
      this.travelRemainingMs = 12000;
      this.totalTravelMs = 12000;
      this.isCorpseRunning = false;
      this.corpseRunTimerMs = 0;
      this.performTravelRecovery(true, true);
    } else {
      // End dungeon run and show summary (uncompleted/wiped)
      this.isCleared = false;
      this.phase = 'SUMMARY';
    }
  }
}
