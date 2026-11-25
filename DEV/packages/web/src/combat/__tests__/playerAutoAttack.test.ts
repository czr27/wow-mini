import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_ATTACK_RANGE_PX } from '@cata-raid-sim/engine';
import {
  PLAYER_AUTO_ATTACK_INTERVAL_TICKS,
  tickPlayerAndPetAutoAttacks,
} from '../playerAutoAttack.js';

function makeMockUnit(overrides: Record<string, any> = {}): any {
  return {
    id: 'player_1',
    name: '战士',
    classId: 'WARRIOR',
    role: 'DPS',
    isPlayer: true,
    isAlive: true,
    alive: true,
    hp: 40000,
    maxHp: 40000,
    position: { x: 500, y: 190 },
    stats: { critChance: 0.2 },
    buffs: [],
    ...overrides,
  };
}

describe('playerAutoAttack', () => {
  it('近战距离技能间隙按独立 40-tick 计时普攻，超出 5 码不触发', () => {
    const hits: any[] = [];
    const actions: any[] = [];
    const engine: any = {
      friendlyUnits: [],
      resolveAttackHit: (attacker: any, defender: any, dmg: number) => {
        hits.push({ attackerId: attacker.id, defenderId: defender.id, dmg });
        return { outcome: 'HIT', damage: dmg };
      },
      logCombatAction: (ev: any) => actions.push(ev),
    };

    const player = makeMockUnit({ position: { x: 540 - AUTO_ATTACK_RANGE_PX, y: 190 } });
    const boss = makeMockUnit({
      id: 'boss_1',
      name: 'Boss',
      role: 'ENEMY',
      isPlayer: false,
      position: { x: 540, y: 190 },
    });
    engine.friendlyUnits = [player];

    const lastPlayerAttackTickRef = { current: 0 };
    const lastPetAttackTickRef = { current: 0 };

    // Before 40 ticks: no swing
    tickPlayerAndPetAutoAttacks({
      engine,
      playerUnit: player,
      boss,
      tickCount: PLAYER_AUTO_ATTACK_INTERVAL_TICKS - 1,
      isAsphyxiateChannel: false,
      isPlayerCasting: false,
      lastPlayerAttackTickRef,
      lastPetAttackTickRef,
    });
    assert.equal(hits.length, 0);
    assert.equal(actions.length, 0);

    // At 40 ticks in melee range: swings once
    tickPlayerAndPetAutoAttacks({
      engine,
      playerUnit: player,
      boss,
      tickCount: PLAYER_AUTO_ATTACK_INTERVAL_TICKS,
      isAsphyxiateChannel: false,
      isPlayerCasting: false,
      lastPlayerAttackTickRef,
      lastPetAttackTickRef,
    });
    assert.equal(hits.length, 1);
    assert.equal(actions.length, 1);
    assert.equal(lastPlayerAttackTickRef.current, PLAYER_AUTO_ATTACK_INTERVAL_TICKS);

    // Out of melee range at tick 80: no swing, timer still advances
    player.position.x = 540 - AUTO_ATTACK_RANGE_PX - 1;
    tickPlayerAndPetAutoAttacks({
      engine,
      playerUnit: player,
      boss,
      tickCount: PLAYER_AUTO_ATTACK_INTERVAL_TICKS * 2,
      isAsphyxiateChannel: false,
      isPlayerCasting: false,
      lastPlayerAttackTickRef,
      lastPetAttackTickRef,
    });
    assert.equal(hits.length, 1);
    assert.equal(actions.length, 1);
  });

  it('读条/引导技能打断普攻并重置计时，施法结束后在技能间隙恢复', () => {
    const hits: any[] = [];
    const engine: any = {
      friendlyUnits: [],
      resolveAttackHit: (_a: any, _d: any, dmg: number) => {
        hits.push(dmg);
        return { outcome: 'HIT', damage: dmg };
      },
      logCombatAction: () => {},
    };

    const player = makeMockUnit({ position: { x: 520, y: 190 } });
    const boss = makeMockUnit({
      id: 'boss_1',
      role: 'ENEMY',
      isPlayer: false,
      position: { x: 540, y: 190 },
    });
    engine.friendlyUnits = [player];

    const lastPlayerAttackTickRef = { current: 0 };
    const lastPetAttackTickRef = { current: 0 };

    // At tick 40 while casting: interrupted, does NOT swing, resets timer to 40
    tickPlayerAndPetAutoAttacks({
      engine,
      playerUnit: player,
      boss,
      tickCount: 40,
      isAsphyxiateChannel: false,
      isPlayerCasting: true,
      lastPlayerAttackTickRef,
      lastPetAttackTickRef,
    });
    assert.equal(hits.length, 0);
    assert.equal(lastPlayerAttackTickRef.current, 40);

    // At tick 60 after cast ends: only 20 ticks since interrupt, still waits
    tickPlayerAndPetAutoAttacks({
      engine,
      playerUnit: player,
      boss,
      tickCount: 60,
      isAsphyxiateChannel: false,
      isPlayerCasting: false,
      lastPlayerAttackTickRef,
      lastPetAttackTickRef,
    });
    assert.equal(hits.length, 0);

    // At tick 80 (40 ticks after cast ended): swings in skill gap
    tickPlayerAndPetAutoAttacks({
      engine,
      playerUnit: player,
      boss,
      tickCount: 80,
      isAsphyxiateChannel: false,
      isPlayerCasting: false,
      lastPlayerAttackTickRef,
      lastPetAttackTickRef,
    });
    assert.equal(hits.length, 1);
  });

  it('普攻未命中/闪避/招架（damage=0）不上报 logCombatAction；命中时上报一次', () => {
    const actions: any[] = [];
    let nextOutcome: 'MISS' | 'DODGE' | 'PARRY' | 'HIT' = 'MISS';
    const engine: any = {
      friendlyUnits: [],
      resolveAttackHit: (_a: any, _d: any, dmg: number) => ({
        outcome: nextOutcome,
        damage: nextOutcome === 'HIT' ? dmg : 0,
      }),
      logCombatAction: (ev: any) => actions.push(ev),
    };

    const player = makeMockUnit({ position: { x: 520, y: 190 } });
    const boss = makeMockUnit({
      id: 'boss_1',
      role: 'ENEMY',
      isPlayer: false,
      position: { x: 540, y: 190 },
    });
    engine.friendlyUnits = [player];

    const lastPlayerAttackTickRef = { current: 0 };
    const lastPetAttackTickRef = { current: 0 };

    for (const [idx, outcome] of (['MISS', 'DODGE', 'PARRY'] as const).entries()) {
      nextOutcome = outcome;
      tickPlayerAndPetAutoAttacks({
        engine,
        playerUnit: player,
        boss,
        tickCount: (idx + 1) * 40,
        isAsphyxiateChannel: false,
        isPlayerCasting: false,
        lastPlayerAttackTickRef,
        lastPetAttackTickRef,
      });
    }
    assert.equal(actions.length, 0, '未成功的普攻不应上报 action');

    nextOutcome = 'HIT';
    tickPlayerAndPetAutoAttacks({
      engine,
      playerUnit: player,
      boss,
      tickCount: 160,
      isAsphyxiateChannel: false,
      isPlayerCasting: false,
      lastPlayerAttackTickRef,
      lastPetAttackTickRef,
    });
    assert.equal(actions.length, 1, '命中时上报一次');
    assert.equal(actions[0].spellId, 'auto_attack');
  });
});
