import {
  LeaderboardEntry,
  LeaderboardMetric,
  DungeonClearCertificate,
  ClassId,
} from '../types.js';

export class LeaderboardManager {
  private entries: LeaderboardEntry[] = [];
  private storageKey = 'cata_raid_sim_leaderboard_v1';

  constructor() {
    this.loadFromStorage();
    if (this.entries.length === 0) {
      this.initBenchmarkRecords();
    }
  }

  private initBenchmarkRecords() {
    const benchmarks: LeaderboardEntry[] = [
      // Fast Kill benchmarks (Shadowfang Keep bosses)
      {
        id: 'bench_1',
        characterName: 'Kungen',
        characterClass: 'DK',
        characterSpec: 'BLOOD',
        dungeonId: 'shadowfang_keep',
        bossId: 'ashbury',
        bossName: '亚什布里男爵',
        metric: 'FAST_KILL',
        value: 46.5,
        unit: 'SEC',
        recordedAtIso: '2026-11-20T12:00:00Z',
        certificateId: 'cert_bench_1',
      },
      {
        id: 'bench_2',
        characterName: 'Sejta',
        characterClass: 'DK',
        characterSpec: 'BLOOD',
        dungeonId: 'shadowfang_keep',
        bossId: 'silverlaine',
        bossName: '席瓦莱恩男爵',
        metric: 'FAST_KILL',
        value: 52.8,
        unit: 'SEC',
        recordedAtIso: '2026-11-20T13:00:00Z',
        certificateId: 'cert_bench_2',
      },
      {
        id: 'bench_3',
        characterName: 'Fragnance',
        characterClass: 'ROGUE',
        characterSpec: 'COMBAT',
        dungeonId: 'shadowfang_keep',
        bossId: 'springvale',
        bossName: '指挥官斯普林瓦尔',
        metric: 'FAST_KILL',
        value: 58.2,
        unit: 'SEC',
        recordedAtIso: '2026-11-20T14:00:00Z',
        certificateId: 'cert_bench_3',
      },
      {
        id: 'bench_4',
        characterName: 'Gingi',
        characterClass: 'MAGE',
        characterSpec: 'FIRE',
        dungeonId: 'shadowfang_keep',
        bossId: 'walden',
        bossName: '沃登勋爵',
        metric: 'FAST_KILL',
        value: 49.3,
        unit: 'SEC',
        recordedAtIso: '2026-11-20T15:00:00Z',
        certificateId: 'cert_bench_4',
      },
      {
        id: 'bench_5',
        characterName: 'Sco',
        characterClass: 'DK',
        characterSpec: 'BLOOD',
        dungeonId: 'shadowfang_keep',
        bossId: 'godfrey',
        bossName: '高弗雷勋爵',
        metric: 'FAST_KILL',
        value: 78.4,
        unit: 'SEC',
        recordedAtIso: '2026-11-20T16:00:00Z',
        certificateId: 'cert_bench_5',
      },
      // Max DPS benchmarks
      {
        id: 'bench_dps_1',
        characterName: 'Blatty',
        characterClass: 'MAGE',
        characterSpec: 'FIRE',
        dungeonId: 'shadowfang_keep',
        metric: 'MAX_DPS',
        value: 23450,
        unit: 'DPS',
        recordedAtIso: '2026-11-20T16:30:00Z',
        certificateId: 'cert_bench_6',
      },
      {
        id: 'bench_dps_2',
        characterName: 'Perfecto',
        characterClass: 'ROGUE',
        characterSpec: 'COMBAT',
        dungeonId: 'shadowfang_keep',
        metric: 'MAX_DPS',
        value: 21800,
        unit: 'DPS',
        recordedAtIso: '2026-11-20T17:00:00Z',
        certificateId: 'cert_bench_7',
      },
      {
        id: 'bench_dps_3',
        characterName: 'Sparky',
        characterClass: 'SHAMAN',
        characterSpec: 'ELEMENTAL',
        dungeonId: 'shadowfang_keep',
        metric: 'MAX_DPS',
        value: 19900,
        unit: 'DPS',
        recordedAtIso: '2026-11-20T17:30:00Z',
        certificateId: 'cert_bench_8',
      },
      // Max Effective HPS (Non-overheal) benchmarks
      {
        id: 'bench_hps_1',
        characterName: 'Zaelia',
        characterClass: 'SHAMAN',
        characterSpec: 'RESTORATION',
        dungeonId: 'shadowfang_keep',
        metric: 'MAX_EFFECTIVE_HPS',
        value: 16800,
        unit: 'HPS',
        recordedAtIso: '2026-11-20T18:00:00Z',
        certificateId: 'cert_bench_9',
      },
      {
        id: 'bench_hps_2',
        characterName: 'Kuznam',
        characterClass: 'DRUID',
        characterSpec: 'RESTORATION',
        dungeonId: 'shadowfang_keep',
        metric: 'MAX_EFFECTIVE_HPS',
        value: 15900,
        unit: 'HPS',
        recordedAtIso: '2026-11-20T18:30:00Z',
        certificateId: 'cert_bench_10',
      },
    ];

    this.entries = benchmarks;
    this.saveToStorage();
  }

  private loadFromStorage() {
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(this.storageKey);
        if (raw) {
          this.entries = JSON.parse(raw);
        }
      } catch (e) {
        console.warn('Failed to load leaderboard from storage', e);
      }
    }
  }

  public saveToStorage() {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(this.entries));
      } catch (e) {
        console.warn('Failed to save leaderboard to storage', e);
      }
    }
  }

  /**
   * Submit a cleared dungeon certificate into world rankings
   */
  public submitRunCertificate(cert: DungeonClearCertificate) {
    // 1. Submit Boss kill times
    for (const enc of cert.encounters) {
      if (enc.result === 'KILL' && enc.durationSec > 0) {
        this.entries.push({
          id: `entry_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          characterName: cert.characterName,
          characterClass: cert.characterClass,
          characterSpec: cert.characterSpec,
          dungeonId: cert.dungeonId,
          bossId: enc.bossId,
          bossName: enc.bossName,
          metric: 'FAST_KILL',
          value: parseFloat(enc.durationSec.toFixed(1)),
          unit: 'SEC',
          recordedAtIso: new Date().toISOString(),
          certificateId: cert.id,
        });
      }
    }

    // 2. Submit Overall DPS record
    if (cert.characterStats.dps > 0) {
      this.entries.push({
        id: `entry_dps_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        characterName: cert.characterName,
        characterClass: cert.characterClass,
        characterSpec: cert.characterSpec,
        dungeonId: cert.dungeonId,
        metric: 'MAX_DPS',
        value: Math.round(cert.characterStats.dps),
        unit: 'DPS',
        recordedAtIso: new Date().toISOString(),
        certificateId: cert.id,
      });
    }

    // 3. Submit Effective HPS (Non-overheal) record
    if (cert.characterStats.effectiveHps > 0) {
      this.entries.push({
        id: `entry_hps_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        characterName: cert.characterName,
        characterClass: cert.characterClass,
        characterSpec: cert.characterSpec,
        dungeonId: cert.dungeonId,
        metric: 'MAX_EFFECTIVE_HPS',
        value: Math.round(cert.characterStats.effectiveHps),
        unit: 'HPS',
        recordedAtIso: new Date().toISOString(),
        certificateId: cert.id,
      });
    }

    this.saveToStorage();
  }

  /**
   * Return all leaderboard entries (for client-side multi-metric / multi-dungeon filtering)
   */
  public getAllEntries(): LeaderboardEntry[] {
    return [...this.entries];
  }

  /**
   * Get sorted leaderboard entries for a given metric
   */
  public getLeaderboard(
    metric: LeaderboardMetric,
    filter?: {
      bossId?: string;
      classId?: ClassId;
      dungeonId?: string;
    }
  ): LeaderboardEntry[] {
    let list = this.entries.filter(e => e.metric === metric);

    if (filter?.dungeonId) {
      list = list.filter(e => e.dungeonId === filter.dungeonId);
    }
    if (filter?.bossId) {
      list = list.filter(e => e.bossId === filter.bossId);
    }
    if (filter?.classId) {
      list = list.filter(e => e.characterClass === filter.classId);
    }

    // Sort: FAST_KILL is ascending (lower time is better), DPS/HPS is descending (higher is better)
    if (metric === 'FAST_KILL') {
      list.sort((a, b) => a.value - b.value);
    } else {
      list.sort((a, b) => b.value - a.value);
    }

    return list.slice(0, 50); // Top 50
  }
}
