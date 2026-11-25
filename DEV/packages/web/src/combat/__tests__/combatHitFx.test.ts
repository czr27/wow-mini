/**
 * Hit FX: size cap, alpha, dedupe, heal snowflake lifecycle.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HIT_FX_ALPHA,
  HIT_FX_MAX_SIZE_PX,
  HIT_FX_SLASH_W,
  HIT_FX_SLASH_H,
  HIT_FX_BOSS_SIZE_MULT,
  HIT_FX_IMPACT_COUNT,
  HIT_FX_CHAR_HEIGHT_PX,
  HIT_FX_BOSS_HEIGHT_PX,
  createHitFxState,
  ingestCombatActionsAsHitFx,
  pruneHitFx,
  rangedShapeForClass,
  spawnHitProjectile,
  spawnHitSlash,
  spawnHealSnowBurst,
  resolveProjectileFlightStyle,
} from '../combatHitFx.js';
import type { NetworkCombatAction, Unit } from '@cata-raid-sim/engine';

function unit(partial: Partial<Unit> & Pick<Unit, 'id' | 'name' | 'classId' | 'role'>): Unit {
  return {
    isPlayer: false,
    isAlive: true,
    alive: true,
    hp: 10000,
    maxHp: 10000,
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
  } as Unit;
}

describe('combatHitFx', () => {
  it('外接尺寸与半透明常量：12×12 / 切割 6×24；Boss 投射 1.5×', () => {
    assert.equal(HIT_FX_MAX_SIZE_PX, 12);
    assert.equal(HIT_FX_SLASH_W, 6);
    assert.equal(HIT_FX_SLASH_H, 24);
    assert.equal(HIT_FX_BOSS_SIZE_MULT, HIT_FX_BOSS_HEIGHT_PX / HIT_FX_CHAR_HEIGHT_PX);
    assert.ok(HIT_FX_ALPHA >= 0.6 && HIT_FX_ALPHA <= 0.85);
    assert.equal(rangedShapeForClass('MAGE').shape, 'droplet');
    assert.equal(rangedShapeForClass('DRUID').color.startsWith('#'), true);
  });

  it('同 action id 不重复 ingest；远程法师产水滴投射；支持 resolveScale', () => {
    const mage = unit({
      id: 'm1',
      name: '法师',
      classId: 'MAGE',
      role: 'DPS',
      position: { x: 10, y: 10 },
    });
    const boss = unit({
      id: 'boss',
      name: '阿什伯里男爵',
      classId: 'BOSS',
      role: 'ENEMY',
      unitKind: 'BOSS',
      position: { x: 200, y: 200 },
    });
    const map = new Map<string, Unit>([
      [mage.id, mage],
      [boss.id, boss],
    ]);
    const state = createHitFxState();
    const seen = new Set<string>();
    const action: NetworkCombatAction = {
      id: 'act_1',
      atMs: Date.now(),
      actorId: mage.id,
      spellId: 'frostbolt',
      spellName: '寒冰箭',
      kind: 'CAST_LAND',
      targetId: boss.id,
    };
    ingestCombatActionsAsHitFx(state, {
      actions: [action],
      unitsById: map,
      seenIds: seen,
      resolveScale: () => 0.7,
    });
    assert.equal(state.projectiles.length, HIT_FX_IMPACT_COUNT);
    assert.equal(state.projectiles[0].shape, 'droplet');
    assert.equal(state.projectiles[0].scale, 0.7);
    assert.equal(state.projectiles[0].flight, 'arc');
    assert.equal(resolveProjectileFlightStyle('HUNTER'), 'straight');
    ingestCombatActionsAsHitFx(state, { actions: [action], unitsById: map, seenIds: seen });
    assert.equal(state.projectiles.length, HIT_FX_IMPACT_COUNT, '同 id 不得双画');

    // Boss ranged skill → projectile at 1.5× player-allowed scale
    const bossRanged: NetworkCombatAction = {
      id: 'boss_ranged_1',
      atMs: Date.now(),
      actorId: boss.id,
      spellId: 'shadow_bolt',
      spellName: '暗影箭',
      kind: 'INSTANT',
      targetId: mage.id,
      visualTone: 'ENEMY',
    };
    ingestCombatActionsAsHitFx(state, { actions: [bossRanged], unitsById: map, seenIds: seen });
    assert.equal(state.projectiles.length, HIT_FX_IMPACT_COUNT * 2);
    assert.equal(state.projectiles[HIT_FX_IMPACT_COUNT].scale, HIT_FX_BOSS_SIZE_MULT);

    // Boss melee skill → slash at 1.5×
    mage.position = { x: 180, y: 200 };
    boss.position = { x: 200, y: 200 };
    const bossMelee: NetworkCombatAction = {
      id: 'boss_melee_1',
      atMs: Date.now(),
      actorId: boss.id,
      spellId: 'trample',
      spellName: '践踏',
      kind: 'INSTANT',
      targetId: mage.id,
      visualTone: 'ENEMY',
    };
    ingestCombatActionsAsHitFx(state, { actions: [bossMelee], unitsById: map, seenIds: seen });
    assert.equal(state.slashes.length, HIT_FX_IMPACT_COUNT);
    assert.equal(state.slashes[0].scale, HIT_FX_BOSS_SIZE_MULT);
  });

  it('治疗 CAST_START→INSTANT 五片雪花绕身螺旋上升；prune 清理', () => {
    const healer = unit({
      id: 'h1',
      name: '奶',
      classId: 'PRIEST',
      role: 'HEALER',
      position: { x: 50, y: 50 },
    });
    const tank = unit({
      id: 't1',
      name: '坦',
      classId: 'WARRIOR',
      role: 'TANK',
      position: { x: 80, y: 50 },
    });
    const map = new Map<string, Unit>([
      [healer.id, healer],
      [tank.id, tank],
    ]);
    const state = createHitFxState();
    const seen = new Set<string>();
    const now = 1000;
    ingestCombatActionsAsHitFx(state, {
      actions: [
        {
          id: 'hs',
          atMs: now,
          actorId: healer.id,
          spellId: 'flash_heal',
          spellName: '快速治疗',
          kind: 'CAST_START',
          targetId: tank.id,
          visualTone: 'HEAL',
        },
      ],
      unitsById: map,
      seenIds: seen,
      now,
    });
    assert.equal(state.snowBursts.length, 1);
    assert.equal(state.snowBursts[0].flakes.length, 5);
    assert.ok(state.snowBursts[0].form < 1);
    assert.equal(state.snowBursts[0].cx, 50);
    assert.equal(state.snowBursts[0].cy, 50);
    assert.ok(typeof state.snowBursts[0].flakes[0].phase === 'number');
    ingestCombatActionsAsHitFx(state, {
      actions: [
        {
          id: 'hl',
          atMs: now + 100,
          actorId: healer.id,
          spellId: 'flash_heal',
          spellName: '快速治疗',
          kind: 'INSTANT',
          targetId: tank.id,
          visualTone: 'HEAL',
        },
      ],
      unitsById: map,
      seenIds: seen,
      now: now + 100,
    });
    assert.equal(state.snowBursts[0].form, 1);
    assert.equal(state.snowBursts[0].fading, true);
    pruneHitFx(state, now + 100 + 2000);
    assert.equal(state.snowBursts.length, 0);
  });

  it('maze helpers：职业色投射 / 手部切割 / 雪花 spiral burst', () => {
    const state = createHitFxState();
    spawnHitProjectile(state, {
      fromX: 0,
      fromY: 0,
      toX: 40,
      toY: 0,
      classId: 'DRUID',
      scale: 0.7,
    });
    assert.equal(state.projectiles.length, HIT_FX_IMPACT_COUNT);
    assert.equal(state.projectiles[0].scale, 0.7);
    spawnHitSlash(state, {
      x: 10,
      y: 10,
      angle: 0,
      color: '#7f1d1d',
      scale: 0.7,
    });
    assert.equal(state.slashes[0].color, '#7f1d1d');
    spawnHealSnowBurst(state, { actorId: 'h1', x: 20, y: 30, scale: 0.7 });
    assert.equal(state.snowBursts[0].flakes.length, 5);
    assert.equal(state.snowBursts[0].cx, 20);
    assert.equal(state.snowBursts[0].cy, 30);
    assert.equal(state.snowBursts[0].fading, true);
  });

  it('近战单体为突刺(thrust)，近战 AOE 为横扫(sweep)，远程 AOE 不产生横扫', () => {
    const warrior = unit({
      id: 'w1',
      name: '战',
      classId: 'WARRIOR',
      role: 'DPS',
      position: { x: 100, y: 100 },
    });
    const mage = unit({
      id: 'm1',
      name: '法',
      classId: 'MAGE',
      role: 'DPS',
      position: { x: 40, y: 100 },
    });
    const boss = unit({
      id: 'boss',
      name: 'B',
      classId: 'BOSS',
      role: 'ENEMY',
      unitKind: 'BOSS',
      position: { x: 130, y: 100 },
    });
    const map = new Map<string, Unit>([
      [warrior.id, warrior],
      [mage.id, mage],
      [boss.id, boss],
    ]);
    const state = createHitFxState();
    const seen = new Set<string>();
    const now = 2000;

    // 1. Single-target melee -> thrust
    ingestCombatActionsAsHitFx(state, {
      actions: [
        {
          id: 'st_mortal',
          atMs: now,
          actorId: warrior.id,
          spellId: 'mortal_strike',
          spellName: '致死打击',
          kind: 'INSTANT',
          targetId: boss.id,
        },
      ],
      unitsById: map,
      seenIds: seen,
      now,
    });
    assert.equal(state.slashes.length, HIT_FX_IMPACT_COUNT);
    assert.equal(state.slashes[0].mode, 'thrust');

    // 2. AoE melee spin (Whirlwind) -> sweep with wide spin arc
    ingestCombatActionsAsHitFx(state, {
      actions: [
        {
          id: 'aoe_ww',
          atMs: now + 10,
          actorId: warrior.id,
          spellId: 'whirlwind',
          spellName: '旋风斩',
          kind: 'INSTANT',
          targetId: boss.id,
          x: 100,
          y: 100,
          radius: 120,
          aoePulse: true,
        },
      ],
      unitsById: map,
      seenIds: seen,
      now: now + 10,
    });
    const wwSlashes = state.slashes.filter((s) => s.id.startsWith('aoe_ww'));
    assert.equal(wwSlashes.length, 2);
    assert.equal(wwSlashes[0].mode, 'sweep');
    assert.ok((wwSlashes[0].sweepArcRad ?? 0) > Math.PI * 1.4);

    // 3. AoE melee frontal cleave -> sweep (narrower than spin)
    ingestCombatActionsAsHitFx(state, {
      actions: [
        {
          id: 'aoe_cleave',
          atMs: now + 20,
          actorId: warrior.id,
          spellId: 'cleave',
          spellName: '顺劈斩',
          kind: 'INSTANT',
          targetId: boss.id,
          x: 100,
          y: 100,
          radius: 100,
          aoePulse: true,
        },
      ],
      unitsById: map,
      seenIds: seen,
      now: now + 20,
    });
    const cleaveSlashes = state.slashes.filter((s) => s.id.startsWith('aoe_cleave'));
    assert.equal(cleaveSlashes.length, 2);
    assert.equal(cleaveSlashes[0].mode, 'sweep');
    assert.ok((cleaveSlashes[0].sweepArcRad ?? 0) < (wwSlashes[0].sweepArcRad ?? 0));

    // 4. Ranged caster AoE (Blizzard) -> no melee sweep
    const beforeMage = state.slashes.length;
    ingestCombatActionsAsHitFx(state, {
      actions: [
        {
          id: 'aoe_blizzard',
          atMs: now + 30,
          actorId: mage.id,
          spellId: 'blizzard',
          spellName: '暴风雪',
          kind: 'INSTANT',
          x: 130,
          y: 100,
          radius: 200,
          aoePulse: true,
        },
      ],
      unitsById: map,
      seenIds: seen,
      now: now + 30,
    });
    assert.equal(state.slashes.length, beforeMage);

    // 5. Boss melee AoE -> sweep at boss scale; Boss magic AoE -> no melee sweep
    ingestCombatActionsAsHitFx(state, {
      actions: [
        {
          id: 'boss_aoe_cleave',
          atMs: now + 40,
          actorId: boss.id,
          spellId: 'boss_cleave',
          spellName: '顺劈',
          kind: 'INSTANT',
          targetId: warrior.id,
          x: 130,
          y: 100,
          radius: 120,
          aoePulse: true,
          visualTone: 'ENEMY',
        },
        {
          id: 'boss_aoe_nova',
          atMs: now + 50,
          actorId: boss.id,
          spellId: 'shadow_nova',
          spellName: '全场暗影新星',
          kind: 'INSTANT',
          targetId: warrior.id,
          x: 130,
          y: 100,
          radius: 400,
          aoePulse: true,
          visualTone: 'ENEMY',
        },
      ],
      unitsById: map,
      seenIds: seen,
      now: now + 40,
    });
    const bossCleave = state.slashes.filter((s) => s.id.startsWith('boss_aoe_cleave'));
    const bossNova = state.slashes.filter((s) => s.id.startsWith('boss_aoe_nova'));
    assert.equal(bossCleave.length, 2);
    assert.equal(bossCleave[0].mode, 'sweep');
    assert.equal(bossCleave[0].scale, HIT_FX_BOSS_SIZE_MULT);
    assert.equal(bossNova.length, 0);
  });
});
