/**
 * 全团增益应真实抬高血量/蓝量，并提高有效攻强/法强（伤害与治疗）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CombatEngine,
  RunStateMachine,
  Calculator,
  ReportManager,
  getEffectiveUnitStats,
  SHADOWFANG_KEEP_CONFIG,
} from '../index.js';
import { makeHealer, makeAlly } from './helpers/combatFixtures.js';

describe('全团增益资源与输出加成', () => {
  it('1. applyBuff 野性印记：maxHp+5%、maxMp+5%、有效 AP/SP+5%', () => {
    const engine = new CombatEngine();
    const u = makeHealer('DRUID', {
      id: 'd1',
      maxHp: 100_000,
      hp: 100_000,
      maxMp: 50_000,
      mp: 50_000,
    });
    u.stats = {
      ...u.stats,
      spellPower: 10_000,
      attackPower: 8_000,
      armor: 1_000,
      critChance: 0.2,
      haste: 0.1,
      spellResist: 0,
      block: 0,
      parry: 0,
      dodge: 0,
      mastery: 0,
      versatility: 0,
      speed: 1,
    };
    engine.addUnit(u);

    engine.applyBuff(u, {
      id: 'motw',
      spellId: 'mark_of_the_wild',
      name: '野性印记',
      kind: 'BUFF',
      tags: ['STAT'],
      sourceUnitId: 'raid',
      targetUnitId: u.id,
      stacks: 1,
      maxStacks: 1,
      durationMs: 3_600_000,
      remainingMs: 3_600_000,
    });

    assert.equal(u.maxHp, 105_000);
    assert.equal(u.hp, 100_000, '只抬上限，当前血不变（满血也会相对变残）');
    assert.equal(u.maxMp, 52_500);
    assert.equal(u.mp, 52_500);
    const mana = u.resources.find((r) => r.kind === 'MANA');
    assert.ok(mana);
    assert.equal(mana!.max, 52_500);

    const eff = getEffectiveUnitStats(u);
    assert.equal(eff.spellPower, Math.round(10_000 * 1.05));
    assert.equal(eff.attackPower, Math.round(8_000 * 1.05));
  });

  it('1b. 残血拍爪子：只加上限不加当前血，血量百分比下降', () => {
    const engine = new CombatEngine();
    const u = makeHealer('DRUID', {
      id: 'hurt',
      maxHp: 100_000,
      hp: 60_000,
      maxMp: 50_000,
      mp: 10_000,
    });
    engine.addUnit(u);

    engine.applyBuff(u, {
      id: 'motw',
      spellId: 'mark_of_the_wild',
      name: '野性印记',
      kind: 'BUFF',
      tags: ['STAT'],
      sourceUnitId: 'raid',
      targetUnitId: u.id,
      stacks: 1,
      maxStacks: 1,
      durationMs: 3_600_000,
      remainingMs: 3_600_000,
    });

    assert.equal(u.maxHp, 105_000);
    assert.equal(u.hp, 60_000, '当前血保持不变');
    assert.equal(u.maxMp, 52_500);
    assert.equal(u.mp, 12_500);
  });

  it('2. 奥术光辉：maxMp+10%，法强×1.1，暴击+5%', () => {
    const engine = new CombatEngine();
    const u = makeHealer('MAGE', { id: 'm1', maxMp: 40_000, mp: 40_000 });
    u.stats = { ...u.stats, spellPower: 10_000, critChance: 0.2 };
    engine.addUnit(u);
    engine.applyBuff(u, {
      id: 'ab',
      spellId: 'arcane_brilliance',
      name: '奥术光辉',
      kind: 'BUFF',
      tags: ['STAT'],
      sourceUnitId: 'raid',
      targetUnitId: u.id,
      stacks: 1,
      maxStacks: 1,
      durationMs: 1000,
      remainingMs: 1000,
    });
    assert.equal(u.maxMp, 44_000);
    const eff = getEffectiveUnitStats(u);
    assert.equal(eff.spellPower, Math.round(10_000 * 1.1));
    assert.ok(Math.abs(eff.critChance - 0.25) < 1e-9);
  });

  it('3. performTravelRecovery 自动团 buff 走 applyBuff：德/法在场则全团抬血抬蓝', () => {
    const engine = new CombatEngine();
    const druid = makeHealer('DRUID', {
      id: 'druid',
      maxHp: 100_000,
      hp: 80_000,
      maxMp: 50_000,
      mp: 20_000,
    });
    const mage = makeHealer('MAGE', {
      id: 'mage',
      maxHp: 90_000,
      hp: 90_000,
      maxMp: 40_000,
      mp: 40_000,
    });
    const tank = makeAlly('tank', 1);
    tank.classId = 'WARRIOR';
    tank.role = 'TANK';
    tank.maxHp = 200_000;
    tank.hp = 200_000;
    tank.maxMp = 0;
    tank.mp = 0;
    tank.stats = { ...tank.stats, attackPower: 10_000 };

    engine.addUnit(druid);
    engine.addUnit(mage);
    engine.addUnit(tank);

    const rsm = new RunStateMachine(SHADOWFANG_KEEP_CONFIG, engine, new ReportManager());
    rsm.performTravelRecovery(true, true);

    assert.ok(druid.buffs.some((b) => (b.spellId || '').includes('mark_of_the_wild')));
    assert.ok(druid.buffs.some((b) => (b.spellId || '').includes('arcane_brilliance')));
    // MotW +5% HP, AB 不抬 HP；MotW +5% MP 再 AB +10% MP
    assert.equal(druid.maxHp, Math.round(100_000 * 1.05));
    assert.equal(druid.hp, druid.maxHp);
    assert.equal(druid.maxMp, Math.round(Math.round(50_000 * 1.05) * 1.1));
    assert.equal(druid.mp, druid.maxMp);

    assert.equal(tank.maxHp, Math.round(200_000 * 1.05));
    assert.equal(tank.hp, tank.maxHp);

    const tankAp = getEffectiveUnitStats(tank).attackPower;
    assert.equal(tankAp, Math.round(10_000 * 1.05));
  });

  it('4. Calculator 治疗量随 MotW 法强提升而增加', () => {
    const engine = new CombatEngine();
    const calc = new Calculator(engine);
    const healer = makeHealer('DRUID', { id: 'h1' });
    healer.stats = { ...healer.stats, spellPower: 10_000, critChance: 0 };
    const ally = makeAlly('a1', 1);
    ally.hp = 10_000;
    ally.maxHp = 200_000;
    engine.addUnit(healer);
    engine.addUnit(ally);

    const before = calc.calcHealing(healer, ally, 5_000, false).healing;

    engine.applyBuff(healer, {
      id: 'motw',
      spellId: 'mark_of_the_wild',
      name: '野性印记',
      kind: 'BUFF',
      tags: ['STAT'],
      sourceUnitId: 'raid',
      targetUnitId: healer.id,
      stacks: 1,
      maxStacks: 1,
      durationMs: 1000,
      remainingMs: 1000,
    });

    const after = calc.calcHealing(healer, ally, 5_000, false).healing;
    assert.ok(after > before, `治疗应提高：${before} -> ${after}`);
  });
});
