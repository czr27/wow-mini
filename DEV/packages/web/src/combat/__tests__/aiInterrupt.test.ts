/**
 * AI interrupt: CD / resource / range gates + probabilistic kick on interruptible boss casts.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CombatEngine,
  BossAI,
  getSpellByAnyId,
  getUnitPersonality,
  RANGE_MELEE_PX,
  type Unit,
} from '@cata-raid-sim/engine';
import { runFriendlyAiCombatTick, type FriendlyAiCombatTickCtx } from '../aiCombatExecutor.js';

function makeUnit(partial: Partial<Unit> & Pick<Unit, 'id' | 'name' | 'classId' | 'role'>): Unit {
  return {
    isPlayer: false,
    isAlive: true,
    alive: true,
    hp: 100_000,
    maxHp: 100_000,
    absorb: 0,
    mp: 50_000,
    maxMp: 50_000,
    energy: 100,
    rage: 50,
    focus: 100,
    runicPower: 40,
    holyPower: 0,
    resources: [],
    buffs: [],
    threatTable: [],
    position: { x: 200, y: 200 },
    stats: {
      attackPower: 500,
      spellPower: 500,
      critChance: 0.2,
      haste: 0.2,
      armor: 100,
      spellResist: 0,
      block: 0,
      parry: 0,
      dodge: 0.05,
      mastery: 0.1,
      versatility: 0,
      speed: 0,
    },
    combatStats: {
      damageDealt: 0,
      healingDone: 0,
      overhealDone: 0,
      damageTaken: 0,
      interruptCount: 0,
    },
    ...partial,
  } as Unit;
}

function stubCtx(opts: {
  engine: CombatEngine;
  boss: Unit;
  bossAi: BossAI;
  tickCount: number;
  cdReady?: boolean;
}): FriendlyAiCombatTickCtx {
  const cdReady = opts.cdReady !== false;
  return {
    engine: opts.engine,
    boss: opts.boss,
    livingEnemies: [opts.boss],
    bossThreatTargetId: null,
    tickCount: opts.tickCount,
    deltaMs: 50,
    bossAi: opts.bossAi,
    aiCasts: {},
    aiCooldowns: {},
    currentCasts: {},
    getUnitAIPersonality: () =>
      ({
        seed: 1,
        name: 't',
        id: 't',
        resourceHealthyThreshold: 0.3,
        energyReserveThreshold: 30,
        throughputVsEfficiencyBias: 0.5,
        cycleAggression: 1.1,
        aoeThresholdCount: 3,
        tickOffset: 0,
        fidgetIdleThresholdMs: 10000,
        fidgetRadiusPx: 20,
        fidgetDurationMs: 1000,
      }) as any,
    inferAiSpecForUnit: (u) => {
      if (u.classId === 'ROGUE') return 'COMBAT';
      if (u.classId === 'MAGE') return 'FIRE';
      if (u.classId === 'WARRIOR') return 'ARMS';
      return 'RESTORATION';
    },
    isAiCdReady: () => cdReady,
    markAiCdUsed: () => {},
    notifyOom: () => {},
    addIncomingCast: () => {},
  };
}

describe('AI interrupt', () => {
  it('距离内 + 资源足够时，可打断 interruptible Boss 读条（强制概率=1）', () => {
    const engine = new CombatEngine();
    const boss = makeUnit({
      id: 'boss',
      name: '测试首领',
      classId: 'BOSS',
      role: 'ENEMY',
      unitKind: 'BOSS',
      position: { x: 220, y: 200 },
    });
    const rogue = makeUnit({
      id: 'rogue_ai',
      name: 'AI贼',
      classId: 'ROGUE',
      role: 'DPS',
      energy: 100,
      position: { x: 200, y: 200 }, // within melee
    });
    engine.addUnit(boss);
    engine.addUnit(rogue);

    const bossAi = new BossAI('ashbury', 'shadowfang');
    const kick = getSpellByAnyId('rogue_kick');
    assert.ok(kick?.isInterrupt);
    assert.equal(kick!.rangePx, RANGE_MELEE_PX);

    bossAi.currentCasting = {
      skill: {
        id: 'test_cast',
        name: '可打断读条',
        castTimeMs: 3000,
        cooldownMs: 10000,
        lastCastMs: -99999,
        interruptible: true,
        school: 'SHADOW',
        range: 320,
        targetKind: 'RANGED_TARGET',
        description: 'test',
        execute: () => {},
      },
      elapsedMs: 2000,
    };

    const { tickOffset } = getUnitPersonality(rogue);
    const tickCount = ((16 - (tickOffset % 16)) % 16) + 16; // (tick + offset) % 16 === 0
    const origRandom = Math.random;
    Math.random = () => 0; // always pass chance roll
    try {
      runFriendlyAiCombatTick(stubCtx({ engine, boss, bossAi, tickCount }));
    } finally {
      Math.random = origRandom;
    }

    assert.equal(bossAi.currentCasting, null, 'Boss 读条应被打断');
    assert.ok((rogue.combatStats?.interruptCount || 0) >= 1, '应计打断次数');
  });

  it('超出打断射程时不应打断', () => {
    const engine = new CombatEngine();
    const boss = makeUnit({
      id: 'boss',
      name: '测试首领',
      classId: 'BOSS',
      role: 'ENEMY',
      unitKind: 'BOSS',
      position: { x: 500, y: 200 },
    });
    const rogue = makeUnit({
      id: 'rogue_ai',
      name: 'AI贼',
      classId: 'ROGUE',
      role: 'DPS',
      energy: 100,
      position: { x: 200, y: 200 }, // far > melee
    });
    engine.addUnit(boss);
    engine.addUnit(rogue);

    const bossAi = new BossAI('ashbury', 'shadowfang');
    bossAi.currentCasting = {
      skill: {
        id: 'test_cast',
        name: '可打断读条',
        castTimeMs: 3000,
        cooldownMs: 10000,
        lastCastMs: -99999,
        interruptible: true,
        school: 'SHADOW',
        range: 320,
        targetKind: 'RANGED_TARGET',
        description: 'test',
        execute: () => {},
      },
      elapsedMs: 1500,
    };

    const { tickOffset } = getUnitPersonality(rogue);
    const tickCount = ((16 - (tickOffset % 16)) % 16) + 16;
    const origRandom = Math.random;
    Math.random = () => 0;
    try {
      runFriendlyAiCombatTick(stubCtx({ engine, boss, bossAi, tickCount }));
    } finally {
      Math.random = origRandom;
    }

    assert.ok(bossAi.currentCasting, '超距不得打断');
    assert.equal(rogue.combatStats?.interruptCount || 0, 0);
  });

  it('不可打断读条不应被踢掉', () => {
    const engine = new CombatEngine();
    const boss = makeUnit({
      id: 'boss',
      name: '测试首领',
      classId: 'BOSS',
      role: 'ENEMY',
      unitKind: 'BOSS',
      position: { x: 220, y: 200 },
    });
    const mage = makeUnit({
      id: 'mage_ai',
      name: 'AI法',
      classId: 'MAGE',
      role: 'DPS',
      mp: 50000,
      maxMp: 50000,
      position: { x: 200, y: 200 },
    });
    engine.addUnit(boss);
    engine.addUnit(mage);

    const bossAi = new BossAI('ashbury', 'shadowfang');
    bossAi.currentCasting = {
      skill: {
        id: 'uninterruptible',
        name: '不可打断',
        castTimeMs: 4000,
        cooldownMs: 20000,
        lastCastMs: -99999,
        interruptible: false,
        school: 'SHADOW',
        range: 320,
        targetKind: 'RANGED_TARGET',
        description: 'test',
        execute: () => {},
      },
      elapsedMs: 2000,
    };

    const { tickOffset } = getUnitPersonality(mage);
    const tickCount = ((16 - (tickOffset % 16)) % 16) + 16;
    const origRandom = Math.random;
    Math.random = () => 0;
    try {
      runFriendlyAiCombatTick(stubCtx({ engine, boss, bossAi, tickCount }));
    } finally {
      Math.random = origRandom;
    }

    assert.ok(bossAi.currentCasting, '不可打断读条应保留');
  });
});
