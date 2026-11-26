import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CombatEngine } from '@cata-raid-sim/engine';
import { handlePlayerCastSlot } from '../handlePlayerCastSlot.js';

function makeUnit(id: string, isPlayer: boolean, hp: number): any {
  return {
    id,
    name: id,
    classId: 'DRUID',
    role: 'HEALER',
    isPlayer,
    isAlive: true,
    alive: true,
    hp,
    maxHp: 40000,
    mp: 30000,
    maxMp: 30000,
    position: { x: isPlayer ? 180 : 300, y: 200 },
    stats: {
      attackPower: 0,
      spellPower: 3800,
      critChance: 0.2,
      haste: 0,
      armor: 1000,
      dodge: 0,
      parry: 0,
      block: 0,
      spellResist: 0,
    },
    buffs: [],
    resources: [],
  };
}

describe('Alt self-cast (handlePlayerCastSlot)', () => {
  it('selfCast=true 时即使当前选中队友，友方治疗技能也直接对自身施放', () => {
    const engine = new CombatEngine();
    const player = makeUnit('p_me', true, 25000);
    const ally = makeUnit('ally_1', false, 15000);
    engine.addUnit(player);
    engine.addUnit(ally);

    let castTargetId: string | null = null;
    handlePlayerCastSlot(0, {
      getPlayerSlots: () => [
        {
          slotIdx: 0,
          spellId: 'rejuvenation',
          name: '回春术',
          iconText: '回',
          cdRemainingMs: 0,
          totalCdMs: 0,
          colorHex: '#10B981',
        },
      ],
      engine,
      currentChar: {
        id: 'p_me',
        name: 'p_me',
        classId: 'DRUID',
        lastSpec: 'RESTORATION',
      } as any,
      isNetworkGuest: false,
      netConnected: false,
      activeRoomId: null,
      guestCdTimelinesRef: { current: [] },
      sendNetworkCast: () => {},
      bossTargetId: null,
      playerCast: null,
      playerGcdRemainingMs: 0,
      playerCooldowns: {},
      groundTargetState: null,
      setGroundTargetState: () => {},
      lastPlayerMoveMs: 0,
      selectedTargetId: ally.id,
      selfCast: true,
      setSelectedTargetId: () => {},
      setCastTargetId: (id) => {
        castTargetId = id;
      },
      runPhase: 'BOSS_COMBAT',
      setAutoApproachTarget: () => {},
      isApproaching: false,
      setIsApproaching: () => {},
      setPlayerGcdRemainingMs: () => {},
      setPlayerGcdTotalMs: () => {},
      triggerCooldown: () => {},
      playerCastRef: { current: null },
      setPlayerCast: () => {},
      getPredictedHealAmount: () => 5000,
      setIncomingCasts: () => {},
      setIncomingHeals: () => {},
      onFriendlyUnitsChanged: () => {},
      bossAi: null,
      handleDispelUnit: () => {},
      onScreenShake: () => {},
    });

    assert.equal(castTargetId, player.id, 'selfCast=true 应将施法目标锁定为自身');
    assert.ok(player.buffs.some((b: any) => b.spellId === 'rejuvenation'), '自身应获得回春术');
    assert.equal(ally.buffs.length, 0, '未对选中队友施放');
  });
});
