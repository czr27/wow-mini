/**
 * Hot-join: reject when human role seats are full; otherwise kick AI DPS→奶→坦
 * only if composition stays valid.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RoomManager,
  compositionValidAfterAiSwap,
  isHumanRoleFull,
  pickHotJoinAiReplacement,
} from '../room/RoomManager.js';

describe('hot-join human role full + AI kick', () => {
  it('rejects when human DPS already at quota max', () => {
    const mgr = new RoomManager();
    const room = mgr.createRoom({
      name: '满DPS',
      dungeonId: 'shadowfang_keep',
      difficulty: 'HEROIC',
      host: { id: 't1', name: '坦', classId: 'DK', spec: 'BLOOD', role: 'TANK' },
    });
    mgr.autoFillAi(room.id);
    // Replace AI DPS seats with humans until 3 human DPS
    const dpsAis = room.members.filter((m) => m.isAi && m.role === 'DPS');
    let n = 0;
    for (const ai of dpsAis) {
      if (n >= 3) break;
      const join = mgr.joinOrHotSwapPlayer(room.id, {
        id: `dps${n}`,
        name: `输出${n}`,
        classId: 'MAGE',
        spec: 'FIRE',
        role: 'DPS',
      });
      assert.equal(join.ok, true, join.reason);
      n++;
    }
    assert.equal(isHumanRoleFull(room, 'DPS'), true);
    const denied = mgr.joinOrHotSwapPlayer(room.id, {
      id: 'late_dps',
      name: '迟到',
      classId: 'ROGUE',
      spec: 'COMBAT',
      role: 'DPS',
    });
    assert.equal(denied.ok, false);
    assert.match(denied.reason || '', /占满/);
  });

  it('healer join keeps 1/1/3 — kicks healer AI (DPS kick would break comp)', () => {
    const mgr = new RoomManager();
    const room = mgr.createRoom({
      name: '顶奶',
      dungeonId: 'shadowfang_keep',
      difficulty: 'NORMAL',
      host: { id: 't1', name: '坦', classId: 'DK', spec: 'BLOOD', role: 'TANK' },
    });
    mgr.autoFillAi(room.id);
    const healerAi = room.members.find((m) => m.isAi && m.role === 'HEALER');
    assert.ok(healerAi);
    // Prefer DPS kick, but -1 DPS +1 H → 1/2/2 invalid; so kick healer AI
    const join = mgr.joinOrHotSwapPlayer(room.id, {
      id: 'h_human',
      name: '安度因',
      classId: 'PRIEST',
      spec: 'HOLY',
      role: 'HEALER',
    });
    assert.equal(join.ok, true, join.reason);
    assert.equal(join.replacedAiId, healerAi!.id);
    const roles = room.members.reduce(
      (a, m) => {
        a[m.role] = (a[m.role] || 0) + 1;
        return a;
      },
      {} as Record<string, number>
    );
    assert.equal(roles.TANK, 1);
    assert.equal(roles.HEALER, 1);
    assert.equal(roles.DPS, 3);
  });

  it('second healer rejected when human healer seat full', () => {
    const mgr = new RoomManager();
    const room = mgr.createRoom({
      name: '双奶拒',
      dungeonId: 'shadowfang_keep',
      difficulty: 'HEROIC',
      host: { id: 't1', name: '坦', classId: 'DK', spec: 'BLOOD', role: 'TANK' },
    });
    mgr.autoFillAi(room.id);
    assert.equal(
      mgr.joinOrHotSwapPlayer(room.id, {
        id: 'h1',
        name: '奶1',
        classId: 'PRIEST',
        spec: 'HOLY',
        role: 'HEALER',
      }).ok,
      true
    );
    const denied = mgr.joinOrHotSwapPlayer(room.id, {
      id: 'h2',
      name: '奶2',
      classId: 'SHAMAN',
      spec: 'RESTORATION',
      role: 'HEALER',
    });
    assert.equal(denied.ok, false);
    assert.match(denied.reason || '', /占满/);
  });

  it('compositionValidAfterAiSwap blocks tank-break', () => {
    const members = [
      { id: 't', role: 'TANK', isAi: false, isPlayer: true },
      { id: 'h', role: 'HEALER', isAi: true, isPlayer: false },
      { id: 'd1', role: 'DPS', isAi: true, isPlayer: false },
      { id: 'd2', role: 'DPS', isAi: true, isPlayer: false },
      { id: 'd3', role: 'DPS', isAi: true, isPlayer: false },
    ] as any;
    const room = {
      dungeonId: 'shadowfang_keep',
      difficulty: 'HEROIC' as const,
      members,
    };
    // Kick only tank? no tank AI. Kick DPS add TANK → 2/1/2 invalid
    assert.equal(compositionValidAfterAiSwap(room, 'DPS', 'TANK'), false);
    assert.equal(compositionValidAfterAiSwap(room, 'HEALER', 'HEALER'), true);
  });

  it('pick with room prefers composition-legal AI', () => {
    const members = [
      { id: 't', role: 'TANK', isAi: false, isPlayer: true, classId: 'DK', isHost: true, isReady: true, slotIndex: 0, name: 't', spec: 'BLOOD' },
      { id: 'h', role: 'HEALER', isAi: true, isPlayer: false, classId: 'PRIEST', isHost: false, isReady: true, slotIndex: 1, name: 'h', spec: 'HOLY' },
      { id: 'd1', role: 'DPS', isAi: true, isPlayer: false, classId: 'MAGE', isHost: false, isReady: true, slotIndex: 2, name: 'd', spec: 'FIRE' },
      { id: 'd2', role: 'DPS', isAi: true, isPlayer: false, classId: 'ROGUE', isHost: false, isReady: true, slotIndex: 3, name: 'd2', spec: 'COMBAT' },
      { id: 'd3', role: 'DPS', isAi: true, isPlayer: false, classId: 'WARLOCK', isHost: false, isReady: true, slotIndex: 4, name: 'd3', spec: 'AFFLICTION' },
    ] as any;
    const room = { dungeonId: 'shadowfang_keep', difficulty: 'HEROIC' as const, members };
    const ais = members.filter((m: any) => m.isAi);
    // New tank: cannot kick DPS (breaks 1/1/3); no tank AI → undefined
    const pickTank = pickHotJoinAiReplacement(ais, 'DK', 'TANK', {
      room,
      addPlayerRole: 'TANK',
    });
    assert.equal(pickTank, undefined);
    // New healer: DPS kick → 1/2/2 invalid; healer AI kick keeps 1/1/3
    const pickH = pickHotJoinAiReplacement(ais, 'PRIEST', 'HEALER', {
      room,
      addPlayerRole: 'HEALER',
    });
    assert.equal(pickH?.role, 'HEALER');
  });
});

