import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CombatEngine,
  classifySpellCastMode,
  getCastLifecyclePolicy,
  isChanneledSpell,
  AccountManager,
  createLevel80BaseStats,
  LEVEL_80_STATS,
  type Spell,
  type Unit,
} from '../index.js';
import {
  sanitizeSavedActionBarPos,
  computeBottomCenterPos,
  clampHudPosToViewport,
  isLegacyResetSentinelPos,
} from '../../../web/src/utils/hudLayout.js';

function createTestMage(id = 'mage_1'): Unit {
  const stats = createLevel80BaseStats('DPS', 'MAGE');
  const maxHp = LEVEL_80_STATS.dpsHealerBaseHp;
  return {
    id,
    name: '测试奥法',
    classId: 'MAGE',
    spec: 'ARCANE',
    role: 'DPS',
    isPlayer: true,
    alive: true,
    isAlive: true,
    hp: maxHp,
    maxHp,
    mp: 30_000,
    maxMp: 30_000,
    absorb: 0,
    stats: { ...stats, haste: 0.5 },
    resources: [{ kind: 'MANA', current: 30_000, max: 30_000 }],
    buffs: [],
    threatTable: [],
    position: { x: 180, y: 190 },
  };
}

function createTestBoss(id = 'boss_1'): Unit {
  return {
    id,
    name: '测试首领',
    classId: 'WARRIOR',
    role: 'ENEMY',
    isPlayer: false,
    alive: true,
    isAlive: true,
    hp: 1_000_000,
    maxHp: 1_000_000,
    absorb: 0,
    stats: {
      attackPower: 2000,
      spellPower: 0,
      critChance: 0.05,
      haste: 0,
      mastery: 0,
      armor: 1000,
      spellResist: 0,
      dodge: 0,
      parry: 0,
      block: 0,
      versatility: 0,
      speed: 1,
    },
    resources: [],
    buffs: [],
    threatTable: [],
    position: { x: 520, y: 190 },
  };
}

test('CastLifecycle classifies INSTANT, CASTED, and CHANNELED spells accurately', () => {
  assert.equal(classifySpellCastMode({ spellId: 'fireball', castTimeMs: 2250 }), 'CASTED');
  assert.equal(classifySpellCastMode({ spellId: 'tranquility', castTimeMs: -1, channelDurationMs: 8000 }), 'CHANNELED');
  assert.equal(classifySpellCastMode({ spellId: 'divine_hymn', castTimeMs: 8000, channelDurationMs: 8000 }), 'CHANNELED');
  assert.equal(classifySpellCastMode({ spellId: 'rejuvenation', castTimeMs: 0 }), 'INSTANT');
  assert.equal(classifySpellCastMode({ spellId: 'healing_touch', castTimeMs: 2500, isInstantOverride: true }), 'INSTANT');

  assert.equal(isChanneledSpell({ spellId: 'arcane_missiles' }), true);
  assert.equal(isChanneledSpell({ spellId: 'mind_flay' }), true);
  assert.equal(isChanneledSpell({ spellId: 'drain_soul' }), true);
  assert.equal(isChanneledSpell({ spellId: 'evocation' }), true);
  assert.equal(isChanneledSpell({ spellId: 'fireball', castTimeMs: 2250 }), false);
});

test('CastLifecycle policies enforce exact resource & CD timing for CASTED vs CHANNELED', () => {
  const casted = getCastLifecyclePolicy('CASTED');
  assert.equal(casted.deductResourceOnStart, false);
  assert.equal(casted.triggerCooldownOnStart, false);
  assert.equal(casted.deductResourceOnComplete, true);
  assert.equal(casted.triggerCooldownOnComplete, true);

  const channeled = getCastLifecyclePolicy('CHANNELED');
  assert.equal(channeled.deductResourceOnStart, true);
  assert.equal(channeled.triggerCooldownOnStart, true);
  assert.equal(channeled.deductResourceOnComplete, false);
  assert.equal(channeled.triggerCooldownOnComplete, false);
});

test('CombatEngine: interrupting a CHANNELED spell preserves resource deduction AND active cooldown', () => {
  const engine = new CombatEngine();
  const mage = createTestMage('p1');
  const boss = createTestBoss('b1');
  engine.addUnit(mage);
  engine.addUnit(boss);

  const tranquilityLike: Spell = {
    id: 'test_channel_cd',
    name: '宁静测试',
    classId: 'DRUID',
    school: 'NATURE',
    castTimeMs: -1,
    channelDurationMs: 8000,
    cooldownMs: 180_000,
    gcdCategory: 'NORMAL',
    resourceCost: { MANA: 4500 },
    targetType: 'AOE_FRIEND',
    effects: [{ kind: 'HEAL', baseValue: 5000, school: 'NATURE' }],
  };
  engine.registerSpell(tranquilityLike);

  const started = engine.castSpell('p1', 'test_channel_cd', 'p1');
  assert.equal(started, true);

  // Immediately upon channel initiation: resource deducted & CD active!
  assert.equal(mage.mp, 25_500);
  assert.ok(engine.cooldownManager.getCdRemaining('p1', 'test_channel_cd') > 170_000);

  // Advance 500ms and interrupt mid-channel
  engine.tick(500);
  const interrupted = engine.interruptCast('p1', 0);
  assert.equal(interrupted, true);

  // After interrupt: resource stays deducted (allowing tiny passive MP5 regen during 500ms tick) and spell stays on CD!
  assert.ok((mage.mp ?? 0) >= 25_500 && (mage.mp ?? 0) < 26_000, `Expected mana ~25500 after 4500 cost, got ${mage.mp}`);
  assert.ok(
    engine.cooldownManager.getCdRemaining('p1', 'test_channel_cd') > 170_000,
    'Channeled spell MUST remain on cooldown after being interrupted mid-channel'
  );
  // Attempting to cast again must be blocked by CD
  engine.tick(1500); // clear GCD
  assert.equal(engine.castSpell('p1', 'test_channel_cd', 'p1'), false);
});

test('CombatEngine: interrupting a CASTED spell spends NO resource and triggers NO cooldown; completing spends & triggers CD', () => {
  const engine = new CombatEngine();
  const mage = createTestMage('p2');
  const boss = createTestBoss('b2');
  engine.addUnit(mage);
  engine.addUnit(boss);

  const castedSpellWithCd: Spell = {
    id: 'test_casted_cd',
    name: '熔岩爆裂测试',
    classId: 'SHAMAN',
    school: 'FIRE',
    castTimeMs: 2000,
    cooldownMs: 8000,
    gcdCategory: 'NORMAL',
    resourceCost: { MANA: 3000 },
    targetType: 'ENEMY',
    effects: [{ kind: 'DAMAGE', baseValue: 15_000, school: 'FIRE' }],
  };
  engine.registerSpell(castedSpellWithCd);

  const initialBossHp = boss.hp;
  const started = engine.castSpell('p2', 'test_casted_cd', 'b2');
  assert.equal(started, true);

  // During cast: NO resource deducted yet, NO spell CD triggered yet
  assert.equal(mage.mp, 30_000, 'Casted spell must NOT deduct mana before cast finishes');
  assert.equal(engine.cooldownManager.getCdRemaining('p2', 'test_casted_cd'), 0, 'Casted spell must NOT enter CD before cast finishes');

  // Interrupt mid-cast
  engine.tick(400);
  const interrupted = engine.interruptCast('p2', 0);
  assert.equal(interrupted, true);

  // After interrupt: 0 damage, 0 mana lost, 0 spell CD
  assert.equal(boss.hp, initialBossHp, 'Interrupted casted spell must deal 0 damage');
  assert.equal(mage.mp, 30_000, 'Interrupted casted spell must NOT consume mana');
  assert.equal(engine.cooldownManager.getCdRemaining('p2', 'test_casted_cd'), 0, 'Interrupted casted spell must NOT enter cooldown');

  // Clear GCD, recast and let it finish cleanly
  engine.tick(1200);
  assert.equal(engine.castSpell('p2', 'test_casted_cd', 'b2'), true);
  engine.tick(2000);

  // Now completed: damage dealt, mana deducted (~27000 plus minor MP5 regen), and CD active!
  assert.ok(boss.hp < initialBossHp, 'Completed casted spell must deal damage');
  assert.ok((mage.mp ?? 0) >= 27_000 && (mage.mp ?? 0) < 27_500, `Completed casted spell must deduct mana (~27000), got ${mage.mp}`);
  assert.ok(engine.cooldownManager.getCdRemaining('p2', 'test_casted_cd') > 0, 'Completed casted spell must enter cooldown');
});

test('HUD layout utility: sanitizes legacy {0,0} reset bug and computes bottom-center anchor accurately', () => {
  assert.equal(isLegacyResetSentinelPos(null), true);
  assert.equal(isLegacyResetSentinelPos(undefined), true);
  assert.equal(isLegacyResetSentinelPos({ x: 0, y: 0 }), true);
  assert.equal(isLegacyResetSentinelPos({ x: 420, y: 700 }), false);

  assert.equal(sanitizeSavedActionBarPos({ x: 0, y: 0 }), null);
  assert.deepEqual(sanitizeSavedActionBarPos({ x: 300, y: 500 }), { x: 300, y: 500 });

  // 1440x900 viewport, 560x180 ActionBar -> centered horizontally, anchored 16px above bottom
  const anchor = computeBottomCenterPos(1440, 900, 560, 180, 16);
  assert.equal(anchor.x, 440);
  assert.equal(anchor.y, 704);

  // Clamping keeps dragged bar inside viewport (below title bar h-14=56)
  assert.deepEqual(clampHudPosToViewport({ x: -50, y: 9999 }, 1440, 900, 560, 180), { x: 0, y: 720 });
  assert.deepEqual(clampHudPosToViewport({ x: 10, y: 0 }, 1440, 900, 200, 80), { x: 10, y: 56 });
});

test('AccountManager.saveCharacterUiLayout deletes actionBar key when reset with null', () => {
  const mgr = new AccountManager();
  mgr.register('hud_test_user', 'test_hash');
  mgr.login('hud_test_user', 'test_hash');
  const char = mgr.createCharacter('测试德鲁伊', 'DRUID', 'RESTORATION');
  assert.ok(char);

  mgr.saveCharacterUiLayout(char.id, { actionBar: { x: 250, y: 310 } });
  assert.deepEqual(mgr.getCharacterUiLayout(char.id)?.actionBar, { x: 250, y: 310 });

  // Resetting ActionBar passes null -> key is removed (not saved as {x:0, y:0})
  mgr.saveCharacterUiLayout(char.id, { actionBar: null });
  const afterReset = mgr.getCharacterUiLayout(char.id);
  assert.equal(afterReset?.actionBar, undefined);
});
