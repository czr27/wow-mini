/**
 * 服务端房间独立战斗会话测试：
 * 1. 开局自动创建 RoomCombatSession，房主与客人同权上报 PLAYER_INPUT / COMBAT_EFFECT / OWNER_SNAPSHOT
 * 2. 服务端直接回传 INPUT_ACK（支撑玩家↔服务端 RTT 计算与退避重传）
 * 3. 服务端收集并周期广播 COMBAT_STATE 与 COMBAT_BATCH
 * 4. 团灭投票 FINISH 或全员离开时销毁战斗会话与房间
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EventEmitter } from 'node:events';
import {
  decodeNetMessage,
  encodeNetMessage,
  type CombatBatch,
  type LobbyRoom,
  type NetEnvelope,
  type NetworkCombatSnapshot,
} from '@cata-raid-sim/engine';
import { RoomWsHub } from '../roomWs.js';

const WS_OPEN = 1;

class FakeWs extends EventEmitter {
  readyState = WS_OPEN;
  readonly OPEN = WS_OPEN;
  readonly inbox: NetEnvelope[] = [];

  send(data: string) {
    const msg = decodeNetMessage(String(data));
    if (msg) this.inbox.push(msg);
  }

  close() {
    this.readyState = 3;
    this.emit('close');
  }

  inject(msg: NetEnvelope) {
    this.emit('message', Buffer.from(encodeNetMessage(msg)));
  }

  lastOfType(type: string): NetEnvelope | undefined {
    for (let i = this.inbox.length - 1; i >= 0; i--) {
      if (this.inbox[i].type === type) return this.inbox[i];
    }
    return undefined;
  }

  allOfType(type: string): NetEnvelope[] {
    return this.inbox.filter((m) => m.type === type);
  }
}

function authClient(
  hub: RoomWsHub,
  opts: { playerId: string; username: string; playerName: string; classId: string; spec: string; role: string }
): FakeWs {
  const ws = new FakeWs();
  hub.handleConnection(ws as any);
  ws.inject({
    type: 'AUTH',
    timeMs: Date.now(),
    payload: opts,
  });
  return ws;
}

describe('服务端房间独立战斗会话（Server-Authoritative Room Session）', () => {
  it('1. 房主与客人同权上报 PLAYER_INPUT / COMBAT_EFFECT / OWNER_SNAPSHOT，服务端直接回传 INPUT_ACK 并周期广播', () => {
    const hub = new RoomWsHub();
    const host = authClient(hub, {
      playerId: 'p_host',
      username: 'u_host',
      playerName: 'HostMage',
      classId: 'MAGE',
      spec: 'FIRE',
      role: 'DPS',
    });
    const guest = authClient(hub, {
      playerId: 'p_guest',
      username: 'u_guest',
      playerName: 'GuestPriest',
      classId: 'PRIEST',
      spec: 'HOLY',
      role: 'HEALER',
    });

    host.inject({
      type: 'ROOM_CREATE',
      timeMs: Date.now(),
      payload: {
        name: '服务端权威测试房',
        dungeonId: 'shadowfang_keep',
        host: { id: 'p_host', name: 'HostMage', classId: 'MAGE', spec: 'FIRE', role: 'DPS' },
      },
    });
    const roomId = (host.lastOfType('ROOM_UPDATE')!.payload as LobbyRoom).id;
    host.inject({ type: 'ROOM_ACTION', roomId, payload: { action: 'AUTO_FILL_AI' } });
    guest.inject({ type: 'ROOM_JOIN', roomId, payload: { roomId } });
    guest.inject({ type: 'ROOM_ACTION', roomId, payload: { action: 'SET_READY', ready: true } });
    host.inject({ type: 'ROOM_START', roomId });

    const cs = hub.getCombatSession(roomId);
    assert.ok(cs, 'ROOM_START 后服务端应创建独立 RoomCombatSession');

    // 房主与客人均发送带 clientInputId 的 PLAYER_INPUT
    host.inbox.length = 0;
    guest.inbox.length = 0;

    host.inject({
      type: 'PLAYER_INPUT',
      roomId,
      payload: {
        playerId: 'p_host',
        kind: 'CAST',
        spellId: 'fireball',
        clientInputId: 'ci_host_1',
        clientInputAttempt: 1,
      },
    });
    guest.inject({
      type: 'PLAYER_INPUT',
      roomId,
      payload: {
        playerId: 'p_guest',
        kind: 'CAST',
        spellId: 'flash_heal',
        clientInputId: 'ci_guest_1',
        clientInputAttempt: 2,
      },
    });

    const hostAck = host.lastOfType('INPUT_ACK')?.payload as any;
    const guestAck = guest.lastOfType('INPUT_ACK')?.payload as any;
    assert.equal(hostAck?.acks?.[0]?.clientInputId, 'ci_host_1');
    assert.equal(hostAck?.acks?.[0]?.attempt, 1);
    assert.equal(guestAck?.acks?.[0]?.clientInputId, 'ci_guest_1');
    assert.equal(guestAck?.acks?.[0]?.attempt, 2);

    // 上报 COMBAT_EFFECT 与 OWNER_SNAPSHOT，服务端在 4 ticks (200ms) 后广播 COMBAT_STATE 与 COMBAT_BATCH
    host.inject({
      type: 'COMBAT_EFFECT',
      roomId,
      payload: {
        effectId: 'eff_host_1',
        sourceId: 'p_host',
        targetId: 'p_guest',
        spellId: 'arcane_intellect',
        kind: 'APPLY_BUFF',
      },
    });
    guest.inject({
      type: 'OWNER_SNAPSHOT',
      roomId,
      payload: {
        ownerId: 'p_guest',
        timeMs: Date.now(),
        units: [
          {
            id: 'p_guest',
            name: 'GuestPriest',
            classId: 'PRIEST',
            spec: 'HOLY',
            role: 'HEALER',
            isPlayer: true,
            isHumanControlled: true,
            isAlive: true,
            hp: 45000,
            maxHp: 50000,
            absorb: 0,
            position: { x: 140, y: 240 },
            buffs: [],
          },
        ],
      },
    });

    // 推进 4 个服务端 tick
    for (let i = 0; i < 4; i++) cs!.tick(50);

    const stateMsg = guest.lastOfType('COMBAT_STATE')?.payload as NetworkCombatSnapshot;
    const batchMsg = host.lastOfType('COMBAT_BATCH')?.payload as CombatBatch;
    assert.ok(stateMsg, '服务端应向房间广播 COMBAT_STATE');
    assert.ok(batchMsg, '服务端应向房间广播 COMBAT_BATCH');
    assert.ok(batchMsg.effects.some((e) => e.effectId === 'eff_host_1'));
    assert.ok(batchMsg.snapshots.some((s) => s.ownerId === 'p_guest'));
    assert.equal(
      stateMsg.units.some((u) => u.id === 'p_host' || u.id === 'p_guest'),
      false,
      'COMBAT_STATE 仅同步服务端权威单位（AI/Boss），不覆盖人类自身权威'
    );

    hub.dispose();
  });

  it('2. 团灭投票选择 FINISH（不重试）时服务端销毁房间与战斗会话', () => {
    const hub = new RoomWsHub();
    const host = authClient(hub, {
      playerId: 'p_w1',
      username: 'u_w1',
      playerName: 'Tank1',
      classId: 'WARRIOR',
      spec: 'PROTECTION',
      role: 'TANK',
    });
    const guest = authClient(hub, {
      playerId: 'p_w2',
      username: 'u_w2',
      playerName: 'Heal2',
      classId: 'PRIEST',
      spec: 'HOLY',
      role: 'HEALER',
    });

    host.inject({
      type: 'ROOM_CREATE',
      timeMs: Date.now(),
      payload: {
        name: '团灭销毁房',
        dungeonId: 'shadowfang_keep',
        host: { id: 'p_w1', name: 'Tank1', classId: 'WARRIOR', spec: 'PROTECTION', role: 'TANK' },
      },
    });
    const roomId = (host.lastOfType('ROOM_UPDATE')!.payload as LobbyRoom).id;
    host.inject({ type: 'ROOM_ACTION', roomId, payload: { action: 'AUTO_FILL_AI' } });
    guest.inject({ type: 'ROOM_JOIN', roomId, payload: { roomId } });
    guest.inject({ type: 'ROOM_ACTION', roomId, payload: { action: 'SET_READY', ready: true } });
    host.inject({ type: 'ROOM_START', roomId });

    assert.ok(hub.getCombatSession(roomId));

    // 发起 WIPE 投票并全员投 FINISH
    host.inject({ type: 'VOTE_START', roomId, payload: { kind: 'WIPE' } });
    host.inject({ type: 'VOTE_CAST', roomId, payload: { kind: 'WIPE', playerId: 'p_w1', choice: 'FINISH' } });
    guest.inject({ type: 'VOTE_CAST', roomId, payload: { kind: 'WIPE', playerId: 'p_w2', choice: 'FINISH' } });

    assert.equal(hub.getCombatSession(roomId), undefined, '团灭不重试后应销毁战斗会话');
    assert.equal(hub.roomManager.getRoom(roomId), undefined, '团灭不重试后应销毁房间');
    const closed = guest.lastOfType('ROOM_CLOSED')?.payload as any;
    assert.equal(closed?.reason, 'wipe_finish');
    assert.equal(closed?.forceSummary, true);

    hub.dispose();
  });

  it('3. 服务端 AI 队友自主运行完整技能决策循环（Boss 掉血/产生读条或治疗效果）', () => {
    const hub = new RoomWsHub();
    const host = authClient(hub, {
      playerId: 'p_ai_h',
      username: 'u_ai_h',
      playerName: 'HostDps',
      classId: 'MAGE',
      spec: 'FIRE',
      role: 'DPS',
    });

    host.inject({
      type: 'ROOM_CREATE',
      timeMs: Date.now(),
      payload: {
        name: 'AI服务端运行测试房',
        dungeonId: 'shadowfang_keep',
        host: { id: 'p_ai_h', name: 'HostDps', classId: 'MAGE', spec: 'FIRE', role: 'DPS' },
      },
    });
    const roomId = (host.lastOfType('ROOM_UPDATE')!.payload as LobbyRoom).id;
    host.inject({ type: 'ROOM_ACTION', roomId, payload: { action: 'AUTO_FILL_AI' } });
    host.inject({ type: 'ROOM_START', roomId });

    const cs = hub.getCombatSession(roomId)!;
    assert.ok(cs);
    // 快进赶路进入 BOSS_COMBAT，推进 80 个服务端 tick（4 秒）确保坦克接怪建立仇恨且 AI 读条落地
    cs.fastForwardTravel();
    for (let i = 0; i < 80; i++) {
      cs.tick(50);
    }

    const boss = cs.engine.bossUnit;
    assert.ok(boss, '进入 BOSS_COMBAT 后服务端应生成 Boss');
    assert.ok(boss.hp < boss.maxHp, `AI 队友应在服务端自主攻击 Boss 使血量下降 (${boss.hp}/${boss.maxHp})`);

    hub.dispose();
  });

  it('4. 玩家给服务端权威 AI 挂 HoT、给 Boss 挂 DoT：服务端保留周期字段并正常跳血/跳伤', () => {
    const hub = new RoomWsHub();
    const host = authClient(hub, {
      playerId: 'p_hot_h',
      username: 'u_hot_h',
      playerName: 'HostDruid',
      classId: 'DRUID',
      spec: 'RESTO_HEAL',
      role: 'HEALER',
    });

    host.inject({
      type: 'ROOM_CREATE',
      timeMs: Date.now(),
      payload: {
        name: 'HoT/DoT服务端跳数测试房',
        dungeonId: 'shadowfang_keep',
        host: { id: 'p_hot_h', name: 'HostDruid', classId: 'DRUID', spec: 'RESTO_HEAL', role: 'HEALER' },
      },
    });
    const roomId = (host.lastOfType('ROOM_UPDATE')!.payload as LobbyRoom).id;
    host.inject({ type: 'ROOM_ACTION', roomId, payload: { action: 'AUTO_FILL_AI' } });
    host.inject({ type: 'ROOM_START', roomId });

    const cs = hub.getCombatSession(roomId)!;
    assert.ok(cs);
    cs.fastForwardTravel();
    cs.tick(50);

    const aiTank = cs.engine.friendlyUnits.find((u) => u.id !== 'p_hot_h' && u.role === 'TANK')!;
    const boss = cs.engine.bossUnit!;
    assert.ok(aiTank && boss);

    aiTank.hp = 10_000;
    const bossHpBefore = boss.hp;

    cs.handleCombatEffect({
      effectId: 'eff_hot_rejuv_1',
      sourceId: 'p_hot_h',
      targetId: aiTank.id,
      spellId: 'rejuvenation',
      spellName: '回春术',
      kind: 'APPLY_BUFF',
      buff: {
        spellId: 'rejuvenation',
        name: '回春术',
        kind: 'BUFF',
        tags: ['HOT'],
        stacks: 1,
        maxStacks: 1,
        durationMs: 12000,
        remainingMs: 12000,
        school: 'NATURE',
        tickIntervalMs: 1000,
        tickValue: 3000,
      },
    });

    cs.handleCombatEffect({
      effectId: 'eff_dot_moonfire_1',
      sourceId: 'p_hot_h',
      targetId: boss.id,
      spellId: 'moonfire',
      spellName: '月火术',
      kind: 'APPLY_BUFF',
      buff: {
        spellId: 'moonfire',
        name: '月火术',
        kind: 'DEBUFF',
        tags: ['DOT'],
        stacks: 1,
        maxStacks: 1,
        durationMs: 12000,
        remainingMs: 12000,
        school: 'ARCANE',
        tickIntervalMs: 1000,
        tickValue: 2500,
      },
    });

    // 仅推进 AuraManager 1.2s 验证 HoT/DoT 真实跳数（排除其他 AI/Boss 干扰）
    cs.engine.auraManager.tickAll((cs.engine as any).units, 1200);

    assert.ok(aiTank.hp > 10_000, `AI 坦克身上的 HoT 应正常跳血 (hp=${aiTank.hp})`);
    assert.ok(boss.hp < bossHpBefore, `Boss 身上的 DoT 应正常跳伤 (${boss.hp} < ${bossHpBefore})`);

    // 5. 真人拥有的地面治疗圈在服务端 tick 时仅倒计时、不重复给 AI 加血；且 COMBAT_EFFECT 不重复累加真人 combatStats
    const playerUnit = cs.engine.getUnit('p_hot_h')!;
    playerUnit.combatStats = {
      damageDealt: 10_000,
      healingDone: 5_000,
      overhealDone: 0,
      damageTaken: 0,
      interruptCount: 0,
      skillDamage: { '愤怒': 10_000 },
      skillHealing: { '回春术': 5_000 },
    };
    const aiHpBeforeGround = aiTank.hp;
    cs.engine.effectsManager.addGroundEffect({
      id: 'human_hrain_1',
      kind: 'HEAL_ZONE',
      spellId: 'healing_rain',
      ownerId: 'p_hot_h',
      x: aiTank.position.x,
      y: aiTank.position.y,
      radius: 120,
      colorHex: '#10B981',
      remainingMs: 5000,
      tickIntervalMs: 500,
      tickElapsedMs: 0,
      tickValue: 4000,
    });
    // 直接调用 tickEnginePreservingHumans 1.2s，验证真人地面圈不在服务端重复跳疗
    (cs as any).tickEnginePreservingHumans(1200);
    assert.equal(aiTank.hp, aiHpBeforeGround, '真人地面圈在服务端不应重复结算 AI 治疗');
    const hr = cs.engine.effectsManager.groundEffects.find((g) => g.id === 'human_hrain_1');
    assert.ok(hr && hr.remainingMs < 5000, '真人地面圈应在服务端正常倒计时');

    // 真人上报 DAMAGE/HEAL 落地扣血/加血，但不再叠加真人 combatStats（避免与 OWNER_SNAPSHOT 双倍统计）
    const bossHpBeforeDirect = boss.hp;
    cs.handleCombatEffect({
      effectId: 'eff_direct_wrath_1',
      sourceId: 'p_hot_h',
      targetId: boss.id,
      spellId: 'wrath',
      spellName: '愤怒',
      kind: 'DAMAGE',
      amount: 6000,
    });
    assert.ok(boss.hp < bossHpBeforeDirect, 'Boss 应正常受到伤害');
    assert.equal(playerUnit.combatStats.damageDealt, 10_000, '服务端不重复累加真人 combatStats.damageDealt');

    hub.dispose();
  });
});
