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

describe('joinOrHotSwapPlayer 同职责约束', () => {
  it('DPS 不得顶替坦克 AI 并改分工；应拒绝加入', () => {
    const mgr = new RoomManager();
    const room = mgr.createRoom({
      name: '职责任务',
      dungeonId: 'shadowfang_keep',
      host: { id: 'host_dps', name: 'HostDps', classId: 'MAGE', spec: 'FIRE', role: 'DPS' },
    });
    mgr.autoFillAi(room.id);
    // Fill all DPS AI seats with humans so only Tank/Healer AI remain
    const dpsAis = room.members.filter((m) => m.isAi && m.role === 'DPS');
    for (let i = 0; i < dpsAis.length; i++) {
      const ok = mgr.joinOrHotSwapPlayer(room.id, {
        id: `dps_human_${i}`,
        name: `DpsH${i}`,
        classId: 'ROGUE',
        spec: 'COMBAT',
        role: 'DPS',
      });
      assert.ok(ok.ok, `应能顶替第 ${i} 个 DPS AI`);
    }
    assert.equal(
      room.members.filter((m) => m.isAi && m.role === 'DPS').length,
      0,
      'DPS AI 应已全部被顶替'
    );
    assert.ok(room.members.some((m) => m.isAi && m.role === 'TANK'));

    const denied = mgr.joinOrHotSwapPlayer(room.id, {
      id: 'late_dps',
      name: 'LateDps',
      classId: 'WARLOCK',
      spec: 'AFFLICTION',
      role: 'DPS',
    });
    assert.equal(denied.ok, false);
    assert.match(denied.reason || '', /输出|同职责/);
    assert.ok(!room.members.some((m) => m.id === 'late_dps'));
    assert.ok(
      room.members.every((m) => m.id !== 'late_dps' || m.role === 'DPS'),
      '不得把加入者改成坦克'
    );
  });

  it('有同职责 AI 时可加入且保持自己的分工', () => {
    const mgr = new RoomManager();
    const room = mgr.createRoom({
      name: '同职',
      dungeonId: 'shadowfang_keep',
      host: { id: 'host_t', name: 'HostT', classId: 'DK', spec: 'BLOOD', role: 'TANK' },
    });
    mgr.autoFillAi(room.id);
    const join = mgr.joinOrHotSwapPlayer(room.id, {
      id: 'guest_dps',
      name: 'GuestDps',
      classId: 'MAGE',
      spec: 'FIRE',
      role: 'DPS',
    });
    assert.ok(join.ok);
    assert.equal(join.member?.role, 'DPS');
    assert.equal(room.members.find((m) => m.id === 'guest_dps')?.role, 'DPS');
  });
});
