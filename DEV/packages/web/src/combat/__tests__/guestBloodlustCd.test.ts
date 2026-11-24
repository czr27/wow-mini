import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CombatEngine,
  createLevel80BaseStats,
  getEffectiveUnitStats,
  getSpellByAnyId,
  isBloodlustSpellId,
  LEVEL_80_STATS,
  resolveCooldownSpellIds,
} from '@cata-raid-sim/engine';
import { applyGuestNetworkCast } from '../applyGuestNetworkCast.js';
import type { AiActiveCast } from '../aiCombatExecutor.js';
import { cooldownRemainingFromTimelines } from '../../net/netTimeline.js';

function makeEngineWithGuestShaman() {
  const engine = new CombatEngine();
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
  engine.addUnit({
    id: 'char_ally',
    name: 'Ally',
    classId: 'WARRIOR',
    spec: 'ARMS',
    role: 'DPS',
    isPlayer: false,
    isHumanControlled: false,
    isAlive: true,
    alive: true,
    hp: LEVEL_80_STATS.dpsHealerBaseHp,
    maxHp: LEVEL_80_STATS.dpsHealerBaseHp,
    mp: 0,
    maxMp: 0,
    absorb: 0,
    resources: [],
    buffs: [],
    threatTable: [],
    position: { x: 220, y: 200 },
    stats: createLevel80BaseStats('DPS'),
  });
  engine.spawnBoss('boss_test', 'Test Boss', 100_000);
  return engine;
}

describe('guest bloodlust / CD aliases', () => {
  it('bloodlust resolves to shaman_heroism and is flagged as lust', () => {
    const sp = getSpellByAnyId('bloodlust', 'SHAMAN');
    assert.ok(sp, 'bloodlust should resolve');
    assert.equal(sp!.id, 'shaman_heroism');
    assert.equal(sp!.isRaidBuff, true);
    assert.ok(isBloodlustSpellId('bloodlust'));
    assert.ok(isBloodlustSpellId('heroism'));
    assert.ok(isBloodlustSpellId('shaman_heroism'));
  });

  it('resolveCooldownSpellIds links bloodlust ↔ heroism ↔ shaman_heroism', () => {
    const ids = resolveCooldownSpellIds('bloodlust', 'SHAMAN');
    assert.ok(ids.includes('bloodlust'));
    assert.ok(ids.includes('heroism'));
    assert.ok(ids.includes('shaman_heroism'));
  });

  it('guest bloodlust applies raid-wide BLOODLUST haste buff', () => {
    const engine = makeEngineWithGuestShaman();
    const guest = engine.getUnit('char_guest')!;
    const ally = engine.getUnit('char_ally')!;
    const casts: Record<string, AiActiveCast> = {};

    const result = applyGuestNetworkCast(
      engine,
      { playerId: 'char_guest', spellId: 'bloodlust', spellName: '嗜血', targetId: 'char_guest' },
      casts
    );
    assert.equal(result.resolvedInstant, true);

    const guestBuff = (guest.buffs || []).find(
      (b) => b.spellId === 'heroism' || (b.tags || []).includes('BLOODLUST')
    );
    const allyBuff = (ally.buffs || []).find(
      (b) => b.spellId === 'heroism' || (b.tags || []).includes('BLOODLUST')
    );
    assert.ok(guestBuff, '施法者应有嗜血');
    assert.ok(allyBuff, '队友应有嗜血');
    assert.ok((guestBuff!.remainingMs || 0) <= 40_000 + 100);
    assert.ok((guestBuff!.remainingMs || 0) >= 30_000);

    const beforeHaste = createLevel80BaseStats('HEALER').haste ?? 0;
    const eff = getEffectiveUnitStats(guest);
    assert.ok(eff.haste >= beforeHaste + 0.29, `嗜血应+30%急速, got ${eff.haste}`);
  });

  it('guest bloodlust starts CD under all alias keys', () => {
    const engine = makeEngineWithGuestShaman();
    const casts: Record<string, AiActiveCast> = {};
    applyGuestNetworkCast(
      engine,
      { playerId: 'char_guest', spellId: 'bloodlust', spellName: '嗜血' },
      casts
    );
    for (const id of ['bloodlust', 'heroism', 'shaman_heroism']) {
      assert.equal(
        engine.cooldownManager.isSpellReady('char_guest', id),
        false,
        `${id} should be on CD`
      );
      assert.ok(engine.cooldownManager.getCdRemaining('char_guest', id) > 290_000);
    }
  });

  it('cooldownRemainingFromTimelines matches bloodlust via heroism timeline', () => {
    const now = 1_000_000;
    const rem = cooldownRemainingFromTimelines(
      [
        {
          unitId: 'char_guest',
          spellId: 'heroism',
          startedAtMs: now - 5_000,
          totalMs: 300_000,
        },
      ],
      'char_guest',
      'bloodlust',
      now
    );
    assert.ok(Math.abs(rem - 295_000) < 50, `expected ~295000 got ${rem}`);
  });

  it('getEffectivePlayerCooldownMs blocks via local shared-CD aliases (not host timeline)', async () => {
    const { getEffectivePlayerCooldownMs } = await import('../handlePlayerCastSlot.js');
    const rem = getEffectivePlayerCooldownMs('bloodlust', {
      slotCdRemainingMs: 0,
      playerCooldowns: {
        heroism: { cdRemainingMs: 295_000, totalCdMs: 300_000 },
      },
      classId: 'SHAMAN',
    });
    assert.ok(rem > 290_000, `should see local alias CD, got ${rem}`);
  });
});
