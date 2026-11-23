/**
 * Scenario: healer host opens 5-man → fill AI → kick tank AI
 * - Guest DPS must replace a DPS AI (not claim the empty tank seat)
 * - Guest healer must be rejected (host already holds the only healer seat)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RoomManager } from '../room/RoomManager.js';

function setupHealerHostFilledThenKickTank() {
  const mgr = new RoomManager();
  const room = mgr.createRoom({
    name: '奶妈开房',
    dungeonId: 'shadowfang_keep',
    host: {
      id: 'host_healer',
      name: 'HostHealer',
      classId: 'PRIEST',
      spec: 'HOLY',
      role: 'HEALER',
    },
  });
  assert.equal(room.members.find((m) => m.id === 'host_healer')?.role, 'HEALER');

  const fill = mgr.autoFillAi(room.id);
  assert.ok(fill.success);
  assert.equal(room.members.length, 5, '加满 AI 后应为 5 人');
  assert.equal(room.members.filter((m) => m.role === 'TANK').length, 1);
  assert.equal(room.members.filter((m) => m.role === 'HEALER').length, 1);
  assert.equal(room.members.filter((m) => m.role === 'DPS').length, 3);

  const tankAi = room.members.find((m) => m.isAi && m.role === 'TANK');
  assert.ok(tankAi, '应存在坦克 AI');
  const kicked = mgr.kickMember(room.id, tankAi!.id);
  assert.equal(kicked, true);
  assert.equal(room.members.length, 4);
  assert.ok(
    room.slots.some((s) => !s.occupied && s.role === 'TANK'),
    '踢掉坦克后应留下空坦克席位'
  );
  assert.equal(room.members.filter((m) => m.isAi && m.role === 'DPS').length, 3);

  return { mgr, room, tankSlotIndex: tankAi!.slotIndex };
}

describe('奶妈开房踢坦克后客人加入', () => {
  it('客人 DPS 应顶替 DPS AI，不得占空坦克席 / 不得变成坦克', () => {
    const { mgr, room, tankSlotIndex } = setupHealerHostFilledThenKickTank();
    const dpsBefore = room.members.filter((m) => m.isAi && m.role === 'DPS').map((m) => m.id);

    const join = mgr.joinOrHotSwapPlayer(room.id, {
      id: 'guest_dps',
      name: 'GuestDps',
      classId: 'MAGE',
      spec: 'FIRE',
      role: 'DPS',
    });

    assert.equal(join.ok, true, `DPS 应能加入: ${join.reason || ''}`);
    assert.ok(join.replacedAiId, '应顶替一名 AI');
    assert.ok(dpsBefore.includes(join.replacedAiId!), '被顶替的必须是原先的 DPS AI');
    assert.equal(join.member?.role, 'DPS');
    assert.equal(room.members.find((m) => m.id === 'guest_dps')?.role, 'DPS');
    assert.notEqual(join.member?.slotIndex, tankSlotIndex, '不得坐进被踢掉的坦克席');
    assert.ok(
      room.slots.some((s) => !s.occupied && s.role === 'TANK'),
      '空坦克席应仍空着'
    );
    assert.equal(room.members.length, 4, '顶替后仍为 4（3人+客人，坦克席仍空）');
  });

  it('客人奶妈应被拒绝（房主已占治疗席且无治疗 AI）', () => {
    const { mgr, room } = setupHealerHostFilledThenKickTank();

    const join = mgr.joinOrHotSwapPlayer(room.id, {
      id: 'guest_healer',
      name: 'GuestHealer',
      classId: 'SHAMAN',
      spec: 'RESTORATION',
      role: 'HEALER',
    });

    assert.equal(join.ok, false, '第二名治疗应无法加入');
    assert.match(join.reason || '', /治疗|同职责/);
    assert.ok(!room.members.some((m) => m.id === 'guest_healer'));
    assert.equal(room.members.find((m) => m.id === 'host_healer')?.role, 'HEALER');
    assert.ok(
      room.slots.some((s) => !s.occupied && s.role === 'TANK'),
      '拒绝加入后空坦克席仍空，未被奶妈占用'
    );
  });
});
