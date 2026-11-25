import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AUTHORITY_INITIAL_WAIT_MS,
  AUTHORITY_SILENCE_KICK_MS,
  allAuthoritiesInitialReady,
  beginAuthorityPresenceEpoch,
  endAuthorityPresenceEpoch,
  noteAuthorityPacket,
  takeAuthoritySilenceKicks,
  trackAuthoritySeat,
} from '../authorityPresence.js';
import type { LobbyRoom } from '@cata-raid-sim/engine';

function roomWithGuests(hostId: string, guestIds: string[]): LobbyRoom {
  return {
    id: 'r1',
    hostId,
    members: [
      { id: hostId, name: 'H', isHost: true, isAi: false, role: 'HEALER', classId: 'PRIEST', slotIndex: 0 } as any,
      ...guestIds.map(
        (id, i) =>
          ({
            id,
            name: id,
            isHost: false,
            isAi: false,
            role: 'DPS',
            classId: 'MAGE',
            slotIndex: i + 1,
          }) as any
      ),
    ],
  } as LobbyRoom;
}

describe('authorityPresence', () => {
  it('host soft-waits for initial OWNER_SNAPSHOT then times out', () => {
    endAuthorityPresenceEpoch();
    beginAuthorityPresenceEpoch(roomWithGuests('host', ['g1', 'g2']), 'host', 1000);
    assert.equal(allAuthoritiesInitialReady(undefined, undefined, 1000), false);
    noteAuthorityPacket('g1', 'OWNER_SNAPSHOT', 1100);
    assert.equal(allAuthoritiesInitialReady(undefined, undefined, 1100), false);
    noteAuthorityPacket('g2', 'OWNER_SNAPSHOT', 1200);
    assert.equal(allAuthoritiesInitialReady(undefined, undefined, 1200), true);
  });

  it('initial wait expires so combat is not stuck forever', () => {
    endAuthorityPresenceEpoch();
    beginAuthorityPresenceEpoch(roomWithGuests('host', ['g1']), 'host', 1000);
    assert.equal(allAuthoritiesInitialReady(undefined, undefined, 1000), false);
    assert.equal(
      allAuthoritiesInitialReady(undefined, undefined, 1000 + AUTHORITY_INITIAL_WAIT_MS),
      true
    );
  });

  it('hot-join track does not block combat', () => {
    endAuthorityPresenceEpoch();
    beginAuthorityPresenceEpoch(roomWithGuests('host', []), 'host', 1000);
    assert.equal(allAuthoritiesInitialReady(undefined, undefined, 1000), true);
    trackAuthoritySeat('hot', 1500);
    assert.equal(allAuthoritiesInitialReady(undefined, undefined, 1500), true);
  });

  it('silence >10s yields kick once', () => {
    endAuthorityPresenceEpoch();
    beginAuthorityPresenceEpoch(roomWithGuests('host', ['g1']), 'host', 1000);
    noteAuthorityPacket('g1', 'PLAYER_INPUT', 1000);
    assert.deepEqual(takeAuthoritySilenceKicks(1000 + AUTHORITY_SILENCE_KICK_MS - 1), []);
    assert.deepEqual(takeAuthoritySilenceKicks(1000 + AUTHORITY_SILENCE_KICK_MS), ['g1']);
    assert.deepEqual(takeAuthoritySilenceKicks(1000 + AUTHORITY_SILENCE_KICK_MS + 5000), []);
  });

  it('any packet refreshes silence timer', () => {
    endAuthorityPresenceEpoch();
    beginAuthorityPresenceEpoch(roomWithGuests('host', ['g1']), 'host', 1000);
    noteAuthorityPacket('g1', 'OWNER_SNAPSHOT', 1000);
    noteAuthorityPacket('g1', 'COMBAT_EFFECT', 1000 + AUTHORITY_SILENCE_KICK_MS - 100);
    assert.deepEqual(
      takeAuthoritySilenceKicks(1000 + AUTHORITY_SILENCE_KICK_MS),
      [],
      'recent effect keeps seat alive'
    );
    assert.deepEqual(
      takeAuthoritySilenceKicks(1000 + AUTHORITY_SILENCE_KICK_MS - 100 + AUTHORITY_SILENCE_KICK_MS),
      ['g1']
    );
  });
});
