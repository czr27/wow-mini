/**
 * 战斗统计：技能名中文化；承伤细则按「受到的技能/普攻」拆分。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CombatEngine,
  resolveCombatSkillDisplayName,
} from '../index.js';
import { makeAlly, makeBoss, makeHealer, registerClassSpells } from './helpers/combatFixtures.js';

describe('战斗统计显示名与承伤细则', () => {
  it('1. resolveCombatSkillDisplayName：immolation / warlock_immolation → 献祭', () => {
    assert.equal(resolveCombatSkillDisplayName('immolation'), '献祭');
    assert.equal(resolveCombatSkillDisplayName('warlock_immolation'), '献祭');
    assert.equal(resolveCombatSkillDisplayName('immolation_aura'), '献祭光环');
    assert.equal(resolveCombatSkillDisplayName(undefined), '普通攻击');
    assert.ok(!/[a-z]/i.test(resolveCombatSkillDisplayName('warlock_immolation') || ''));
  });

  it('2. applyDamage 输出细则用中文技能名，不出现 immolation', () => {
    const engine = new CombatEngine();
    registerClassSpells(engine, 'WARLOCK');
    const lock = makeHealer('WARLOCK', { id: 'lock', maxHp: 100_000, hp: 100_000 });
    lock.role = 'DPS';
    const boss = makeBoss();
    engine.addUnit(lock);
    engine.addUnit(boss);

    engine.applyDamage(lock.id, boss.id, 5000, false, 'warlock_immolation', 'FIRE');
    engine.applyDamage(lock.id, boss.id, 3000, false, 'immolation', 'FIRE');

    const keys = Object.keys(lock.combatStats?.skillDamage || {});
    assert.ok(keys.includes('献祭'), `keys=${JSON.stringify(keys)}`);
    assert.ok(!keys.some((k) => /immolation/i.test(k)), `英文泄漏: ${JSON.stringify(keys)}`);
    assert.equal(lock.combatStats?.skillDamage?.['献祭'], 8000);
  });

  it('3. 承伤细则记录打到自己的技能/普攻，而非自己的输出技能', () => {
    const engine = new CombatEngine();
    const tank = makeAlly('tank', 1);
    tank.maxHp = 200_000;
    tank.hp = 200_000;
    const boss = makeBoss();
    engine.addUnit(tank);
    engine.addUnit(boss);

    engine.applyDamage(boss.id, tank.id, 12_000, false, undefined, 'PHYSICAL');
    engine.applyDamage(boss.id, tank.id, 8_000, false, 'mortal_strike', 'PHYSICAL');
    engine.applyDamage(boss.id, tank.id, 5_000, false, '窒息术', 'SHADOW');

    assert.equal(tank.combatStats?.damageTaken, 25_000);
    const taken = tank.combatStats?.skillDamageTaken || {};
    assert.equal(taken['普通攻击'], 12_000);
    assert.ok(taken['致死打击'] === 8_000 || taken['mortal_strike'] === undefined);
    // 中文名直接保留
    assert.equal(taken['窒息术'], 5_000);
    // 自己没有对别人输出时，skillDamage 不应混入承伤
    assert.ok(!tank.combatStats?.skillDamage || Object.keys(tank.combatStats.skillDamage).length === 0);
  });
});
