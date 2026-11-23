/**
 * Non-tank AI must never use taunt skills (e.g. Feral Growl).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine } from '../engine/CombatEngine.js';
import { TankAI } from '../ai/TankAI.js';
import { DpsAI } from '../ai/DpsAI.js';
import { getSpellByAnyId } from '../classes/ClassRegistry.js';
import { registerClassSpells } from './helpers/combatFixtures.js';
import type { GameState } from '../ai/AIController.js';
import type { Unit } from '../types.js';

function makeUnit(partial: Partial<Unit> & Pick<Unit, 'id' | 'name' | 'classId' | 'role'>): Unit {
  return {
    isPlayer: false,
    isAlive: true,
    alive: true,
    hp: 50000,
    maxHp: 50000,
    mp: 0,
    maxMp: 0,
    absorb: 0,
    resources: [],
    buffs: [],
    threatTable: [],
    position: { x: 100, y: 100 },
    stats: {
      attackPower: 500,
      spellPower: 500,
      critChance: 0.1,
      haste: 0.1,
      armor: 100,
      spellResist: 0,
      block: 0,
      parry: 0,
      dodge: 0.05,
      mastery: 0.1,
      versatility: 0,
      speed: 0,
    },
    ...partial,
  };
}

describe('非坦克 AI 禁止嘲讽', () => {
  it('1. TankAI：野德 DPS（含低吼）OT 时不会输出嘲讽动作', () => {
    const feral = makeUnit({
      id: 'feral_dps',
      name: '野德',
      classId: 'DRUID',
      role: 'DPS',
      spec: 'FERAL',
    });
    const tank = makeUnit({
      id: 'tank_1',
      name: '主坦',
      classId: 'WARRIOR',
      role: 'TANK',
      spec: 'PROTECTION',
    });
    const boss = makeUnit({
      id: 'boss_1',
      name: 'Boss',
      classId: 'BOSS',
      role: 'ENEMY',
      hp: 500000,
      maxHp: 500000,
      threatTable: [{ sourceUnitId: feral.id, amount: 99999 }],
    });
    const gs: GameState = {
      units: [feral, tank, boss],
      bossId: 'boss_1',
      bossChannelSpellId: null,
      bossChannelRemainingMs: 0,
      elapsedMs: 2000,
      phase: 'BOSS_COMBAT',
    };
    const actions = new TankAI().decide(feral, gs);
    assert.ok(
      !actions.some((a) => getSpellByAnyId(a.action.spellId, 'DRUID')?.isTaunt),
      '非坦克 AI 不得选择嘲讽'
    );
  });

  it('2. DpsAI：候选动作不含嘲讽', () => {
    const feral = makeUnit({
      id: 'feral_dps2',
      name: '野德2',
      classId: 'DRUID',
      role: 'DPS',
      spec: 'FERAL',
    });
    const boss = makeUnit({
      id: 'boss_2',
      name: 'Boss',
      classId: 'BOSS',
      role: 'ENEMY',
      hp: 500000,
      maxHp: 500000,
    });
    const gs: GameState = {
      units: [feral, boss],
      bossId: 'boss_2',
      bossChannelSpellId: null,
      bossChannelRemainingMs: 0,
      elapsedMs: 1000,
      phase: 'BOSS_COMBAT',
    };
    const actions = new DpsAI().decide(feral, gs);
    assert.ok(
      !actions.some((a) => getSpellByAnyId(a.action.spellId, 'DRUID')?.isTaunt),
      'DpsAI 不得选择嘲讽'
    );
  });

  it('3. CombatEngine.castSpell：非坦克 AI 施放低吼不改变仇恨首位', () => {
    const engine = new CombatEngine();
    registerClassSpells(engine, 'DRUID');
    const feral = makeUnit({
      id: 'feral_ai',
      name: '野德AI',
      classId: 'DRUID',
      role: 'DPS',
      spec: 'FERAL',
      isPlayer: false,
    });
    const tank = makeUnit({
      id: 'tank_ai',
      name: '坦',
      classId: 'WARRIOR',
      role: 'TANK',
      spec: 'PROTECTION',
      isPlayer: false,
    });
    const boss = makeUnit({
      id: 'boss_cast',
      name: 'Boss',
      classId: 'BOSS',
      role: 'ENEMY',
      hp: 500000,
      maxHp: 500000,
    });
    engine.addUnit(feral);
    engine.addUnit(tank);
    engine.addUnit(boss);
    engine.threatManager.addThreat(boss.id, tank.id, 10000);
    engine.threatManager.applyTaunt(boss.id, tank.id);
    assert.equal(engine.threatManager.getTopThreatSource(boss.id), tank.id);

    const growl = getSpellByAnyId('druid_growl', 'DRUID');
    assert.ok(growl?.isTaunt);
    const ok = engine.castSpell(feral.id, growl!.id, boss.id);
    assert.equal(ok, true, '低吼施放应成功（效果被角色门禁吞掉）');

    assert.equal(
      engine.threatManager.getTopThreatSource(boss.id),
      tank.id,
      '非坦克 AI 低吼不得抢走仇恨'
    );
  });

  it('4. CombatEngine.castSpell：坦克 AI 嘲讽仍生效', () => {
    const engine = new CombatEngine();
    registerClassSpells(engine, 'DK');
    const tank = makeUnit({
      id: 'tank_ok',
      name: '血DK',
      classId: 'DK',
      role: 'TANK',
      spec: 'BLOOD',
      isPlayer: false,
    });
    const dps = makeUnit({
      id: 'dps_ot',
      name: '法师',
      classId: 'MAGE',
      role: 'DPS',
      isPlayer: false,
    });
    const boss = makeUnit({
      id: 'boss_ok',
      name: 'Boss',
      classId: 'BOSS',
      role: 'ENEMY',
      hp: 500000,
      maxHp: 500000,
    });
    engine.addUnit(tank);
    engine.addUnit(dps);
    engine.addUnit(boss);
    engine.threatManager.addThreat(boss.id, dps.id, 50000);

    const taunt = getSpellByAnyId('dk_dark_command', 'DK');
    assert.ok(taunt?.isTaunt);
    const ok = engine.castSpell(tank.id, taunt!.id, boss.id);
    assert.equal(ok, true);
    assert.equal(engine.threatManager.getTopThreatSource(boss.id), tank.id);
  });
});
