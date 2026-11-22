import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mergeAccounts,
  mergeClearCertificates,
  mergeCharacter,
  mergeAccountLists,
} from '../auth/accountMerge.js';
import type { CharacterRecord, DungeonClearCertificate, UserAccount } from '../types.js';

function baseChar(partial: Partial<CharacterRecord> & Pick<CharacterRecord, 'id' | 'name'>): CharacterRecord {
  return {
    classId: 'MAGE',
    lastSpec: 'FIRE',
    specKeybindings: { FIRE: { 0: '1' } },
    clearCertificates: [],
    createdAtIso: '2026-01-01T00:00:00.000Z',
    updatedAtMs: 1000,
    ...partial,
  };
}

function baseAcc(partial: Partial<UserAccount> & Pick<UserAccount, 'username' | 'characters'>): UserAccount {
  return {
    id: 'acc_1',
    passwordHash: 'wow123',
    createdAtIso: '2026-01-01T00:00:00.000Z',
    updatedAtMs: 1000,
    ...partial,
  };
}

test('mergeCharacter: later updatedAtMs wins keybinds, certificates are unioned', () => {
  const older = baseChar({
    id: 'c1',
    name: '吉安娜',
    updatedAtMs: 1000,
    specKeybindings: { FIRE: { 0: '1' } },
    clearCertificates: [
      {
        id: 'cert_a',
        dungeonId: 'shadowfang_keep',
        dungeonName: '影牙',
        clearedAtIso: '2026-01-01T00:00:00.000Z',
        characterName: '吉安娜',
        characterClass: 'MAGE',
        characterSpec: 'FIRE',
        totalDurationSec: 100,
        encounters: [],
        characterStats: {
          totalDamage: 1,
          dps: 1,
          totalHealing: 0,
          effectiveHealing: 0,
          effectiveHps: 0,
          overhealPct: 0,
          damageTaken: 0,
          interrupts: 0,
          deaths: 0,
        },
      } as DungeonClearCertificate,
    ],
  });
  const newer = baseChar({
    id: 'c1',
    name: '吉安娜',
    updatedAtMs: 5000,
    specKeybindings: { FIRE: { 0: 'Q' } },
    clearCertificates: [
      {
        id: 'cert_b',
        dungeonId: 'shadowfang_keep',
        dungeonName: '影牙',
        clearedAtIso: '2026-01-02T00:00:00.000Z',
        characterName: '吉安娜',
        characterClass: 'MAGE',
        characterSpec: 'FIRE',
        totalDurationSec: 90,
        encounters: [],
        characterStats: {
          totalDamage: 2,
          dps: 2,
          totalHealing: 0,
          effectiveHealing: 0,
          effectiveHps: 0,
          overhealPct: 0,
          damageTaken: 0,
          interrupts: 0,
          deaths: 0,
        },
      } as DungeonClearCertificate,
    ],
  });

  const merged = mergeCharacter(older, newer);
  assert.equal(merged.specKeybindings.FIRE[0], 'Q');
  assert.equal(merged.clearCertificates.length, 2);
  assert.equal(merged.updatedAtMs, 5000);
});

test('mergeClearCertificates: same id keeps later clearedAtIso', () => {
  const a: DungeonClearCertificate = {
    id: 'same',
    dungeonId: 'shadowfang_keep',
    dungeonName: '影牙',
    clearedAtIso: '2026-01-01T00:00:00.000Z',
    characterName: 'A',
    characterClass: 'MAGE',
    characterSpec: 'FIRE',
    totalDurationSec: 1,
    encounters: [],
    characterStats: {
      totalDamage: 1,
      dps: 1,
      totalHealing: 0,
      effectiveHealing: 0,
      effectiveHps: 0,
      overhealPct: 0,
      damageTaken: 0,
      interrupts: 0,
      deaths: 0,
    },
  };
  const b = { ...a, clearedAtIso: '2026-02-01T00:00:00.000Z', characterName: 'B' };
  const merged = mergeClearCertificates([a], [b]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].characterName, 'B');
});

test('mergeAccounts / mergeAccountLists: LWW by character timestamp', () => {
  const local = baseAcc({
    username: 'Champion',
    updatedAtMs: 1000,
    characters: [
      baseChar({ id: 'c1', name: '旧', updatedAtMs: 1000, lastSpec: 'FIRE' }),
      baseChar({ id: 'c2', name: '仅本地', updatedAtMs: 2000, classId: 'ROGUE', lastSpec: 'COMBAT' }),
    ],
  });
  const remote = baseAcc({
    username: 'Champion',
    updatedAtMs: 9000,
    characters: [
      baseChar({ id: 'c1', name: '新', updatedAtMs: 9000, lastSpec: 'FROST' }),
      baseChar({ id: 'c3', name: '仅远端', updatedAtMs: 3000, classId: 'DK', lastSpec: 'BLOOD' }),
    ],
  });

  const merged = mergeAccounts(local, remote);
  assert.equal(merged.characters.length, 3);
  const c1 = merged.characters.find((c) => c.id === 'c1')!;
  assert.equal(c1.lastSpec, 'FROST');
  assert.equal(c1.name, '新');
  assert.ok(merged.characters.some((c) => c.id === 'c2'));
  assert.ok(merged.characters.some((c) => c.id === 'c3'));

  const list = mergeAccountLists([local], [remote]);
  assert.equal(list.length, 1);
  assert.equal(list[0].characters.length, 3);
});
