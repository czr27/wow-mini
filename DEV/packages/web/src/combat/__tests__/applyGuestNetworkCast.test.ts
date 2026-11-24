import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CombatEngine,
  createLevel80BaseStats,
  getSpellByAnyId,
  LEVEL_80_STATS,
} from '@cata-raid-sim/engine';
import {
  applyGuestNetworkCast,
  resolveGuestCastTarget,
  tickGuestNetworkCasts,
  type GuestCastInput,
} from '../applyGuestNetworkCast.js';
import { resolveGuestOutboundTargetId } from '../handlePlayerCastSlot.js';
import type { AiActiveCast } from '../aiCombatExecutor.js';

function makeEngineWithGuestAndHost() {
  const engine = new CombatEngine();
  engine.addUnit({
    id: 'char_host',
    name: 'Host',
    classId: 'WARRIOR',
    spec: 'PROTECTION',
    role: 'TANK',
    isPlayer: true,
    isHumanControlled: true,
    isAlive: true,
    alive: true,
    hp: LEVEL_80_STATS.tankBaseHp,
    maxHp: LEVEL_80_STATS.tankBaseHp,
    mp: 0,
    maxMp: 0,
    absorb: 0,
    resources: [],
    buffs: [],
    threatTable: [],
    position: { x: 400, y: 200 },
    stats: createLevel80BaseStats('TANK'),
  });
  engine.addUnit({
    id: 'char_guest',
    name: 'Guest',
    classId: 'SHAMAN',
    spec: 'RESTORATION',
    role: 'HEALER',
    isPlayer: false,
    isHumanControlled: true,
    isAlive: true,
    alive: true,
    hp: LEVEL_80_STATS.dpsHealerBaseHp,
    maxHp: LEVEL_80_STATS.dpsHealerBaseHp,
    mp: LEVEL_80_STATS.healerBaseMp,
    maxMp: LEVEL_80_STATS.healerBaseMp,
    absorb: 0,
    resources: [{ kind: 'MANA', current: LEVEL_80_STATS.healerBaseMp, max: LEVEL_80_STATS.healerBaseMp }],
    buffs: [],
    threatTable: [],
    position: { x: 200, y: 200 },
    stats: createLevel80BaseStats('HEALER'),
  });
  engine.spawnBoss('boss_test', 'Test Boss', 100_000);
  return engine;
}

function makeEngineWithGuest() {
  return makeEngineWithGuestAndHost();
}

describe('applyGuestNetworkCast', () => {
  it('instant guest heal applies without engine.spellBook (castSpell would no-op)', () => {
    const engine = makeEngineWithGuest();
    const guest = engine.getUnit('char_guest')!;
    const hpBefore = guest.hp;
    guest.hp = Math.floor(guest.maxHp * 0.5);
    const casts: Record<string, AiActiveCast> = {};

    // Prove spellBook path is empty in production-like setup
    assert.equal(engine.getSpell('riptide') || engine.getSpell('shaman_riptide'), undefined);

    const input: GuestCastInput = {
      playerId: 'char_guest',
      spellId: 'riptide',
      spellName: '激流',
      targetId: 'char_guest',
    };
    const result = applyGuestNetworkCast(engine, input, casts);
    assert.equal(result.resolvedInstant, true);
    assert.equal(result.startedCast, false);
    assert.ok(guest.hp > Math.floor(guest.maxHp * 0.5), '瞬发治疗应回血');
    assert.ok(guest.hp <= hpBefore || guest.hp > Math.floor(guest.maxHp * 0.5));
  });

  it('cast-time guest spell starts bar then lands after tick', () => {
    const engine = makeEngineWithGuest();
    const boss = engine.bossUnit!;
    const hpBefore = boss.hp;
    const casts: Record<string, AiActiveCast> = {};

    const result = applyGuestNetworkCast(
      engine,
      {
        playerId: 'char_guest',
        spellId: 'lightning_bolt',
        spellName: '闪电箭',
        targetId: boss.id,
      },
      casts
    );
    assert.equal(result.startedCast, true);
    assert.ok(casts['char_guest'], '应写入读条');
    assert.equal(boss.hp, hpBefore, '读条中不应提前结算');

    const total = casts['char_guest'].totalMs;
    tickGuestNetworkCasts(engine, casts, total + 10);
    assert.equal(casts['char_guest'], undefined);
    assert.ok(boss.hp < hpBefore, '读条完成后应对 Boss 造成伤害');
  });

  it('heal with leaked boss targetId retargets to ally (not boss)', () => {
    const engine = makeEngineWithGuestAndHost();
    const guest = engine.getUnit('char_guest')!;
    const host = engine.getUnit('char_host')!;
    const boss = engine.bossUnit!;
    host.hp = Math.floor(host.maxHp * 0.4);
    guest.hp = Math.floor(guest.maxHp * 0.9);
    const casts: Record<string, AiActiveCast> = {};
    const hostHpBefore = host.hp;
    const bossHpBefore = boss.hp;

    const result = applyGuestNetworkCast(
      engine,
      {
        playerId: 'char_guest',
        spellId: 'riptide',
        spellName: '激流',
        targetId: boss.id, // leaked boss selection
      },
      casts
    );
    assert.equal(result.resolvedInstant, true);
    assert.ok(host.hp > hostHpBefore, '应治疗血量最低的友方(房主)');
    assert.equal(boss.hp, bossHpBefore, '治疗不应打到 Boss');
  });

  it('cast-time heal on host lands after bar; boss id ignored', () => {
    const engine = makeEngineWithGuestAndHost();
    const host = engine.getUnit('char_host')!;
    const boss = engine.bossUnit!;
    host.hp = Math.floor(host.maxHp * 0.5);
    const casts: Record<string, AiActiveCast> = {};
    const hostHpBefore = host.hp;

    const result = applyGuestNetworkCast(
      engine,
      {
        playerId: 'char_guest',
        spellId: 'healing_wave',
        spellName: '治疗波',
        targetId: host.id,
      },
      casts
    );
    assert.equal(result.startedCast, true);
    assert.equal(casts['char_guest']?.targetId, host.id);

    tickGuestNetworkCasts(engine, casts, (casts['char_guest']?.totalMs || 2500) + 10);
    assert.ok(host.hp > hostHpBefore, '读条治疗应落在房主');
    assert.equal(boss.hp, 100_000);
  });

  it('resolveGuestCastTarget rejects boss for ally spells', () => {
    const engine = makeEngineWithGuestAndHost();
    const guest = engine.getUnit('char_guest')!;
    const host = engine.getUnit('char_host')!;
    host.hp = Math.floor(host.maxHp * 0.3);
    const norm = getSpellByAnyId('riptide', 'SHAMAN') || getSpellByAnyId('riptide');
    assert.ok(norm);
    const target = resolveGuestCastTarget(engine, guest, norm!, engine.bossUnit!.id);
    assert.equal(target?.id, host.id);
  });

  it('resolveGuestOutboundTargetId never sends boss for heals/HoTs', () => {
    const engine = makeEngineWithGuestAndHost();
    const bossId = engine.bossUnit!.id;
    assert.equal(
      resolveGuestOutboundTargetId({
        spellId: 'rejuvenation',
        classId: 'DRUID',
        selectedTargetId: bossId,
        bossTargetId: bossId,
        playerId: 'char_guest',
        bossId,
        engine,
      }),
      'char_guest'
    );
    assert.equal(
      resolveGuestOutboundTargetId({
        spellId: 'healing_wave',
        classId: 'SHAMAN',
        selectedTargetId: 'char_host',
        bossTargetId: bossId,
        playerId: 'char_guest',
        bossId,
        engine,
      }),
      'char_host'
    );
    assert.equal(
      resolveGuestOutboundTargetId({
        spellId: 'lightning_bolt',
        classId: 'SHAMAN',
        selectedTargetId: null,
        bossTargetId: bossId,
        playerId: 'char_guest',
        bossId,
        engine,
      }),
      bossId
    );
  });

  it('GCD 未好时拒绝新 CAST，不得清掉进行中的读条', () => {
    const engine = makeEngineWithGuest();
    const boss = engine.bossUnit!;
    const casts: Record<string, AiActiveCast> = {};
    const first = applyGuestNetworkCast(
      engine,
      {
        playerId: 'char_guest',
        spellId: 'lightning_bolt',
        spellName: '闪电箭',
        targetId: boss.id,
      },
      casts
    );
    assert.equal(first.startedCast, true);
    assert.ok(casts['char_guest']);
    const kept = casts['char_guest'];

    const second = applyGuestNetworkCast(
      engine,
      {
        playerId: 'char_guest',
        spellId: 'lightning_bolt',
        spellName: '闪电箭',
        targetId: boss.id,
      },
      casts
    );
    assert.equal(second.startedCast, false);
    assert.equal(casts['char_guest'], kept, 'GCD 中拒绝不得 wipe 读条');
  });

  it('缺少 isHumanControlled 时 tick 仍应结算客人读条', () => {
    const engine = makeEngineWithGuest();
    const guest = engine.getUnit('char_guest')!;
    guest.isHumanControlled = false;
    const boss = engine.bossUnit!;
    const hpBefore = boss.hp;
    const casts: Record<string, AiActiveCast> = {};
    applyGuestNetworkCast(
      engine,
      {
        playerId: 'char_guest',
        spellId: 'lightning_bolt',
        spellName: '闪电箭',
        targetId: boss.id,
      },
      casts
    );
    assert.ok(casts['char_guest']);
    tickGuestNetworkCasts(engine, casts, (casts['char_guest']?.totalMs || 2000) + 10);
    assert.equal(casts['char_guest'], undefined);
    assert.ok(boss.hp < hpBefore);
  });
});
