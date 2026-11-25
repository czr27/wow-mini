import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CombatEngine,
  ReportManager,
  RunStateMachine,
  SHADOWFANG_KEEP_CONFIG,
  type Unit,
} from '@cata-raid-sim/engine';
import {
  createLocalEncounterRecorder,
  encountersForCertificateClaim,
  mergeHostEncounterReports,
  noteGuestCombatSnapshot,
} from '../localEncounterRecorder.js';

function makeFriend(id: string, damage: number): Unit {
  return {
    id,
    name: id,
    classId: 'MAGE',
    role: 'DPS',
    spec: 'Arcane',
    isPlayer: id === 'me',
    isAlive: true,
    alive: true,
    hp: 100,
    maxHp: 100,
    absorb: 0,
    mp: 100,
    maxMp: 100,
    position: { x: 0, y: 0 },
    buffs: [],
    threatTable: [],
    resources: [],
    stats: {} as Unit['stats'],
    combatStats: {
      damageDealt: damage,
      healingDone: 0,
      overhealDone: 0,
      damageTaken: 0,
      interruptCount: 0,
      skillDamage: { Fireball: damage },
    },
  } as Unit;
}

function makeBoss(alive: boolean): Unit {
  return {
    id: 'ashbury',
    name: 'Ashbury',
    classId: 'BOSS',
    role: 'ENEMY',
    isAlive: alive,
    alive,
    hp: alive ? 1000 : 0,
    maxHp: 1000,
    mp: 0,
    maxMp: 0,
    position: { x: 0, y: 0 },
    buffs: [],
    threatTable: [],
    resources: [],
    stats: {} as Unit['stats'],
  } as Unit;
}

describe('localEncounterRecorder', () => {
  it('records KILL deltas locally without host encounterReports', () => {
    const engine = new CombatEngine();
    const reportMgr = new ReportManager();
    const rsm = new RunStateMachine(SHADOWFANG_KEEP_CONFIG, engine, reportMgr);
    const rec = createLocalEncounterRecorder();

    engine.addUnit(makeFriend('me', 0));
    engine.addUnit(makeFriend('tank', 0));
    engine.addUnit(makeBoss(true));
    rsm.phase = 'BOSS_COMBAT';
    rsm.currentBossIndex = 0;

    noteGuestCombatSnapshot({ state: rec, rsm, engine, nowMs: 1000 });
    assert.equal(rec.baselineByUnit.get('me')?.damageDealt, 0);

    const me = engine.friendlyUnits.find((u) => u.id === 'me')!;
    me.combatStats!.damageDealt = 5000;
    me.combatStats!.skillDamage = { Fireball: 5000 };
    const tank = engine.friendlyUnits.find((u) => u.id === 'tank')!;
    tank.combatStats!.damageDealt = 2000;
    const boss = engine.bossUnit!;
    boss.isAlive = false;
    (boss as { alive?: boolean }).alive = false;
    boss.hp = 0;

    noteGuestCombatSnapshot({ state: rec, rsm, engine, nowMs: 40000 });

    const kill = rsm.encounterReports.find((e) => e.bossIndex === 0 && e.result === 'KILL');
    assert.ok(kill, 'should record local kill');
    const meStat = kill!.unitStats.find((u) => u.unitId === 'me');
    assert.equal(meStat?.totalDamage, 5000);
  });

  it('mergeHostEncounterReports does not overwrite local stats', () => {
    const engine = new CombatEngine();
    const reportMgr = new ReportManager();
    const rsm = new RunStateMachine(SHADOWFANG_KEEP_CONFIG, engine, reportMgr);
    rsm.encounterReports = [
      {
        bossIndex: 0,
        bossId: 'ashbury',
        bossName: 'Ashbury',
        result: 'KILL',
        durationSec: 30,
        wipesBeforeKill: 0,
        unitStats: [
          {
            unitId: 'me',
            name: 'me',
            classId: 'MAGE',
            role: 'DPS',
            isPlayer: true,
            totalDamage: 999,
            dps: 33,
            totalHealing: 0,
            hps: 0,
            overhealPct: 0,
            damageTaken: 0,
            interrupts: 0,
            deaths: 0,
          },
        ],
      },
    ];
    mergeHostEncounterReports(rsm, [
      {
        bossIndex: 0,
        bossId: 'ashbury',
        bossName: 'Ashbury',
        result: 'KILL',
        durationSec: 99,
        wipesBeforeKill: 0,
        unitStats: [
          {
            unitId: 'me',
            name: 'me',
            classId: 'MAGE',
            role: 'DPS',
            isPlayer: true,
            totalDamage: 1,
            dps: 1,
            totalHealing: 0,
            hps: 0,
            overhealPct: 0,
            damageTaken: 0,
            interrupts: 0,
            deaths: 0,
          },
        ],
      },
      {
        bossIndex: 1,
        bossId: 'silverlaine',
        bossName: 'Silverlaine',
        result: 'KILL',
        durationSec: 40,
        wipesBeforeKill: 0,
        unitStats: [],
      },
    ]);
    assert.equal(rsm.encounterReports.find((e) => e.bossIndex === 0)?.unitStats[0]?.totalDamage, 999);
    assert.ok(rsm.encounterReports.some((e) => e.bossIndex === 1));
  });

  it('encountersForCertificateClaim fills stubs when cleared (hot-join gaps)', () => {
    const engine = new CombatEngine();
    const reportMgr = new ReportManager();
    const rsm = new RunStateMachine(SHADOWFANG_KEEP_CONFIG, engine, reportMgr);
    const rec = createLocalEncounterRecorder();
    rsm.isCleared = true;
    engine.addUnit(makeFriend('me', 100));
    const enc = encountersForCertificateClaim(rsm, engine, rec);
    assert.ok(enc.length >= rsm.dungeon.bosses.length);
    assert.ok(enc.every((e) => e.result === 'KILL'));
  });
});
