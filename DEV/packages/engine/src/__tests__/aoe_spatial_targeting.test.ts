/**
 * Spatial AoE / smart-heal targeting: Wild Growth 15yd around selected target, etc.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RANGE_10YD_PX,
  RANGE_15YD_PX,
  RANGE_30YD_PX,
  RANGE_40YD_PX,
  getSpellByAnyId,
  selectAoeHealTargets,
  selectChainJumpTargets,
  resolveSpellAoeSplash,
  yardsToPx,
} from '../index.js';
import { CombatEngine } from '../engine/CombatEngine.js';
import { registerClassSpells, makeHealer, makeAlly, makeBoss, castAndResolve } from './helpers/combatFixtures.js';

describe('智能群体治疗空间范围', () => {
  it('1. 码→像素尺度：40码=320，30码=240，15码=120，10码=80', () => {
    assert.equal(RANGE_40YD_PX, 320);
    assert.equal(RANGE_30YD_PX, 240);
    assert.equal(RANGE_15YD_PX, 120);
    assert.equal(RANGE_10YD_PX, 80);
    assert.equal(yardsToPx(15), 120);
    assert.equal(yardsToPx(30), 240);
    assert.equal(yardsToPx(40), 320);
  });

  it('2. Registry：野性成长 aoeRadius=15码（选中目标为圆心）；治疗之环等仍 30 码', () => {
    const wg = getSpellByAnyId('druid_wild_growth', 'DRUID');
    assert.ok(wg);
    assert.equal(wg!.aoeRadiusPx, RANGE_15YD_PX);
    assert.equal(wg!.aoeCenterMode, 'TARGET');
    assert.equal(wg!.rangePx, RANGE_40YD_PX);
    assert.equal(wg!.maxAoeTargets, 5);

    const coh = getSpellByAnyId('priest_circle_of_healing', 'PRIEST');
    assert.ok(coh);
    assert.equal(coh!.aoeRadiusPx, RANGE_30YD_PX);
    assert.equal(coh!.aoeCenterMode, 'TARGET');

    const poh = getSpellByAnyId('priest_prayer_of_healing', 'PRIEST');
    assert.ok(poh);
    assert.equal(poh!.aoeRadiusPx, RANGE_30YD_PX);

    const lod = getSpellByAnyId('paladin_light_of_dawn', 'PALADIN');
    assert.ok(lod);
    assert.equal(lod!.aoeRadiusPx, RANGE_30YD_PX);
    assert.equal(lod!.aoeCenterMode, 'CASTER');

    const ch = getSpellByAnyId('shaman_chain_heal', 'SHAMAN');
    assert.ok(ch);
    assert.equal(ch!.aoeRadiusPx, RANGE_10YD_PX);

    const profile = resolveSpellAoeSplash('druid_wild_growth');
    assert.ok(profile);
    assert.equal(profile!.radiusPx, RANGE_15YD_PX);
    assert.equal(profile!.centerMode, 'TARGET');
    assert.equal(profile!.maxTargets, 5);
  });

  it('3. 野性成长：以选中单位为圆心，超出 15 码的队友不会被选中', () => {
    const caster = {
      id: 'druid',
      hp: 10000,
      maxHp: 10000,
      position: { x: 0, y: 0 },
      isAlive: true,
    };
    const tank = {
      id: 'tank',
      hp: 3000,
      maxHp: 10000,
      position: { x: 50, y: 0 },
      isAlive: true,
    };
    // 15yd = 120px；相对坦克圆心 180px → 不可溅射
    const far = {
      id: 'far_dps',
      hp: 1000,
      maxHp: 10000,
      position: { x: 50 + RANGE_15YD_PX + 60, y: 0 },
      isAlive: true,
    };
    const near = {
      id: 'near_dps',
      hp: 2000,
      maxHp: 10000,
      position: { x: 50 + 80, y: 0 },
      isAlive: true,
    };

    const chosen = selectAoeHealTargets({
      spellId: 'druid_wild_growth',
      allies: [caster, tank, far, near] as any,
      caster: caster as any,
      primaryTarget: tank as any,
      maxAoeTargets: 5,
    });
    const ids = chosen.map((u) => u.id);
    assert.ok(ids.includes('tank'), '圆心单位在范围内且受伤时应入选');
    assert.ok(ids.includes('near_dps'), '15码内伤员应被选中');
    assert.ok(!ids.includes('far_dps'), '超出15码的伤员不得被野性成长命中');
    // 施法者距坦克圆心 50 < 120，可入选补位
    assert.ok(ids.includes('druid'), '范围内满血友方可补名额');
  });

  it('3a. 野性成长：严格按血量%最低取 5 人；满血圆心不强制占位', () => {
    const center = {
      id: 'center_full',
      hp: 10000,
      maxHp: 10000,
      position: { x: 0, y: 0 },
      isAlive: true,
    };
    const allies = [
      center,
      { id: 'a', hp: 1000, maxHp: 10000, position: { x: 20, y: 0 }, isAlive: true },
      { id: 'b', hp: 2000, maxHp: 10000, position: { x: 30, y: 0 }, isAlive: true },
      { id: 'c', hp: 3000, maxHp: 10000, position: { x: 40, y: 0 }, isAlive: true },
      { id: 'd', hp: 4000, maxHp: 10000, position: { x: 50, y: 0 }, isAlive: true },
      { id: 'e', hp: 5000, maxHp: 10000, position: { x: 60, y: 0 }, isAlive: true },
      { id: 'f_healthier', hp: 9000, maxHp: 10000, position: { x: 70, y: 0 }, isAlive: true },
    ];
    const chosen = selectAoeHealTargets({
      spellId: 'wild_growth',
      allies: allies as any,
      caster: center as any,
      primaryTarget: center as any,
      maxAoeTargets: 5,
    });
    const ids = chosen.map((u) => u.id);
    assert.equal(chosen.length, 5);
    assert.deepEqual(ids.sort(), ['a', 'b', 'c', 'd', 'e'].sort());
    assert.ok(!ids.includes('center_full'), '满血圆心不应挤掉更残血队友');
    assert.ok(!ids.includes('f_healthier'), '第6残血不得挤进前5');
  });

  it('3c. 野性成长：无人残血时范围内满血友方仍受益', () => {
    const caster = {
      id: 'druid',
      hp: 10000,
      maxHp: 10000,
      position: { x: 0, y: 0 },
      isAlive: true,
    };
    const tank = {
      id: 'tank',
      hp: 10000,
      maxHp: 10000,
      position: { x: 40, y: 0 },
      isAlive: true,
    };
    const dps = {
      id: 'dps',
      hp: 10000,
      maxHp: 10000,
      position: { x: 80, y: 0 },
      isAlive: true,
    };
    const far = {
      id: 'far',
      hp: 10000,
      maxHp: 10000,
      position: { x: 40 + RANGE_15YD_PX + 80, y: 0 },
      isAlive: true,
    };
    const chosen = selectAoeHealTargets({
      spellId: 'druid_wild_growth',
      allies: [caster, tank, dps, far] as any,
      caster: caster as any,
      primaryTarget: tank as any,
      maxAoeTargets: 5,
    });
    const ids = chosen.map((u) => u.id);
    assert.ok(ids.includes('druid'));
    assert.ok(ids.includes('tank'));
    assert.ok(ids.includes('dps'));
    assert.ok(!ids.includes('far'), '超距满血也不应命中');
  });

  it('3b. 野性成长：受伤的自己在溅射范围内可入选；宠物不占名额', () => {
    const caster = {
      id: 'druid',
      hp: 4000,
      maxHp: 10000,
      position: { x: 0, y: 0 },
      isAlive: true,
    };
    const tank = {
      id: 'tank',
      hp: 2000,
      maxHp: 10000,
      position: { x: 40, y: 0 },
      isAlive: true,
    };
    const pet = {
      id: 'pet',
      hp: 100,
      maxHp: 5000,
      position: { x: 20, y: 0 },
      isAlive: true,
      isPet: true,
      unitKind: 'PET',
    };
    const chosen = selectAoeHealTargets({
      spellId: 'druid_wild_growth',
      allies: [caster, tank, pet] as any,
      caster: caster as any,
      primaryTarget: tank as any,
      maxAoeTargets: 5,
    });
    const ids = chosen.map((u) => u.id);
    assert.ok(ids.includes('druid'), '受伤的自己应吃到野性成长');
    assert.ok(ids.includes('tank'), '圆心受伤时应入选');
    assert.ok(!ids.includes('pet'), '宠物不应占用野性成长名额');
  });

  it('4. 治疗链：弹跳只落在上一跳 10 码内，不会全图跳跃', () => {
    const seed = {
      id: 'a',
      hp: 4000,
      maxHp: 10000,
      position: { x: 0, y: 0 },
      isAlive: true,
    };
    const jumpOk = {
      id: 'b',
      hp: 3000,
      maxHp: 10000,
      position: { x: RANGE_10YD_PX - 10, y: 0 },
      isAlive: true,
    };
    const tooFar = {
      id: 'c',
      hp: 1000,
      maxHp: 10000,
      position: { x: RANGE_10YD_PX * 2 + 40, y: 0 },
      isAlive: true,
    };
    const chosen = selectChainJumpTargets({
      allies: [seed, jumpOk, tooFar] as any,
      seed: seed as any,
      jumpRadiusPx: RANGE_10YD_PX,
      maxTargets: 4,
    });
    const ids = chosen.map((u) => u.id);
    assert.deepEqual(ids, ['a', 'b']);
    assert.ok(!ids.includes('c'), '超出弹跳距离的更残血目标也不应被跳到');
  });

  it('5. 黎明圣光：以施法者为中心 30 码，远离自身的队友不吃到', () => {
    const paladin = {
      id: 'pala',
      hp: 8000,
      maxHp: 10000,
      position: { x: 0, y: 0 },
      isAlive: true,
    };
    const near = {
      id: 'near',
      hp: 2000,
      maxHp: 10000,
      position: { x: 100, y: 0 },
      isAlive: true,
    };
    const far = {
      id: 'far',
      hp: 500,
      maxHp: 10000,
      position: { x: RANGE_30YD_PX + 80, y: 0 },
      isAlive: true,
    };
    const chosen = selectAoeHealTargets({
      spellId: 'paladin_light_of_dawn',
      allies: [paladin, near, far] as any,
      caster: paladin as any,
      primaryTarget: far as any,
      maxAoeTargets: 5,
    });
    const ids = chosen.map((u) => u.id);
    assert.ok(ids.includes('near'));
    assert.ok(!ids.includes('far'), '远离骑士自身的目标不应被黎明圣光选中');
  });

  it('6. CombatEngine.castSpell 野性成长：15 码溅射真实上 HoT', () => {
    const engine = new CombatEngine();
    registerClassSpells(engine, 'DRUID');
    const druid = makeHealer('DRUID', { id: 'druid', mp: 50_000, maxMp: 50_000 });
    druid.position = { x: 0, y: 0 };
    const tank = makeAlly('tank', 0.3);
    tank.position = { x: 40, y: 0 };
    const near = makeAlly('near', 0.25);
    near.position = { x: 100, y: 0 }; // 距坦克圆心 60px < 120
    const far = makeAlly('far', 0.1);
    far.position = { x: 40 + RANGE_15YD_PX + 80, y: 0 };
    engine.addUnit(druid);
    engine.addUnit(tank);
    engine.addUnit(near);
    engine.addUnit(far);
    engine.addUnit(makeBoss());

    assert.equal(castAndResolve(engine, 'druid', 'druid_wild_growth', tank.id), true);

    const hasWg = (u: { buffs: Array<{ spellId?: string }> }) =>
      u.buffs.some((b) => (b.spellId || '').includes('wild_growth'));

    assert.ok(hasWg(tank as any) || hasWg(near as any), '15码内伤员应获得野性成长');
    assert.ok(!hasWg(far as any), '超距队友不得获得野性成长');
  });
});
