/**
 * RoomManager.replaceHumanWithAi — 非房主离席后 AI 接续席位。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RoomManager } from '../room/RoomManager.js';

describe('replaceHumanWithAi', () => {
  it('非房主离席：席位变为 AI，保留职责，房主不变', () => {
    const mgr = new RoomManager();
    const room = mgr.createRoom({
      name: 'AI接续',
      dungeonId: 'shadowfang_keep',
      host: { id: 'host1', name: 'Host', classId: 'DK', spec: 'BLOOD', role: 'TANK' },
    });
    mgr.autoFillAi(room.id);
    const join = mgr.joinOrHotSwapPlayer(room.id, {
      id: 'guest1',
      name: 'Guest',
      classId: 'PRIEST',
      spec: 'HOLY',
      role: 'HEALER',
    });
    assert.ok(join.ok);
    room.status = 'IN_COMBAT';
    const beforeCount = room.members.length;
    const guestRole = room.members.find((m) => m.id === 'guest1')!.role;

    const result = mgr.replaceHumanWithAi(room.id, 'guest1');
    assert.equal(result.ok, true);
    assert.ok(result.aiMemberId);
    assert.equal(result.roomDeleted, undefined);
    assert.equal(mgr.getRoom(room.id)!.hostId, 'host1');
    assert.equal(mgr.getRoom(room.id)!.members.length, beforeCount);
    assert.ok(!mgr.getRoom(room.id)!.members.some((m) => m.id === 'guest1'));
    const ai = mgr.getRoom(room.id)!.members.find((m) => m.id === result.aiMemberId);
    assert.ok(ai?.isAi);
    assert.equal(ai!.role, guestRole);
    assert.equal(mgr.countHumanPlayers(room.id), 1);
  });

  it('最后一名人类（房主）被替换 → 房间删除', () => {
    const mgr = new RoomManager();
    const room = mgr.createRoom({
      name: '仅房主',
      dungeonId: 'shadowfang_keep',
      host: { id: 'solo', name: 'Solo', classId: 'MAGE', spec: 'FIRE', role: 'DPS' },
    });
    mgr.autoFillAi(room.id);
    room.status = 'IN_COMBAT';
    const result = mgr.replaceHumanWithAi(room.id, 'solo');
    assert.equal(result.ok, true);
    assert.equal(result.roomDeleted, true);
    assert.equal(mgr.getRoom(room.id), undefined);
  });
});
