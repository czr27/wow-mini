/**
 * AoE ring visual rules: opacity tiers, tones, pulse payload for room sync.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AOE_ALPHA_AT_LARGE,
  AOE_ALPHA_AT_SMALL,
  AOE_FADE_MS,
  AOE_INSTANT_HOLD_MS,
  emitAoePulse,
  resolveAoeActorTier,
  resolveAoeAlphaByRadiusPx,
  resolveAoeTone,
} from '../engine/AoeRingVisual.js';
import { yardsToPx } from '../classes/ClassRegistry.js';
import { CombatEngine } from '../engine/CombatEngine.js';
import { encodeNetMessage, decodeNetMessage, type NetworkCombatSnapshot } from '../net/NetProtocol.js';
import type { Unit } from '../types.js';

function makeUnit(partial: Partial<Unit> & Pick<Unit, 'id' | 'name' | 'classId' | 'role'>): Unit {
  return {
    isPlayer: false,
    isAlive: true,
    alive: true,
    hp: 10000,
    maxHp: 10000,
    absorb: 0,
    resources: [],
    buffs: [],
    threatTable: [],
    position: { x: 100, y: 100 },
    stats: {
      attackPower: 500,
      spellPower: 500,
      critChance: 0.1,
      haste: 0.1,
      armor: 100,
      spellResist: 0,
      block: 0,
      parry: 0,
      dodge: 0.05,
      mastery: 0.1,
      versatility: 0,
      speed: 0,
    },
    ...partial,
  };
}

describe('AoE 光圈视觉规则', () => {
  it('1. 透明度按半径：≤5码 40%(alpha0.6)、≥30码 96%(alpha0.04)、中间线性', () => {
    assert.equal(AOE_ALPHA_AT_SMALL, 0.6);
    assert.equal(AOE_ALPHA_AT_LARGE, 0.04);
    assert.equal(resolveAoeAlphaByRadiusPx(yardsToPx(5)), AOE_ALPHA_AT_SMALL);
    assert.equal(resolveAoeAlphaByRadiusPx(yardsToPx(3)), AOE_ALPHA_AT_SMALL);
    assert.equal(resolveAoeAlphaByRadiusPx(yardsToPx(30)), AOE_ALPHA_AT_LARGE);
    assert.equal(resolveAoeAlphaByRadiusPx(yardsToPx(40)), AOE_ALPHA_AT_LARGE);
    const mid = resolveAoeAlphaByRadiusPx(yardsToPx(17.5));
    assert.ok(Math.abs(mid - (AOE_ALPHA_AT_SMALL + AOE_ALPHA_AT_LARGE) / 2) < 0.02);
    assert.equal(resolveAoeActorTier({ isPlayer: true }), 'PLAYER');
    assert.equal(resolveAoeActorTier({ classId: 'BOSS', role: 'ENEMY', unitKind: 'BOSS' }), 'BOSS');
  });

  it('2. 色调：治疗绿 / 友方黄 / 敌方红（色调不影响透明度；填充与敌我无关）', () => {
    assert.equal(resolveAoeTone({ isHeal: true }), 'HEAL');
    assert.equal(resolveAoeTone({ groundKind: 'HEAL_ZONE' }), 'HEAL');
    assert.equal(resolveAoeTone({ spellId: 'healing_rain' }), 'HEAL');
    assert.equal(resolveAoeTone({ groundKind: 'TOTEM', spellId: 'healing_tide' }), 'HEAL');
    assert.equal(resolveAoeTone({ groundKind: 'TOTEM', spellId: 'lightwell' }), 'HEAL');
    assert.equal(resolveAoeTone({ groundKind: 'HEAL_ZONE', spellId: 'swiftmend' }), 'HEAL');
    assert.equal(resolveAoeTone({ groundKind: 'HEAL_ZONE', spellId: 'efflorescence' }), 'HEAL');
    // 非回血友方增益 → 黄（即便施法者是敌方，填充仍按分类）
    assert.equal(resolveAoeTone({ groundKind: 'TOTEM', spellId: 'spirit_link', isEnemyActor: true }), 'FRIENDLY');
    assert.equal(resolveAoeTone({ groundKind: 'TOTEM', spellId: 'mana_tide' }), 'FRIENDLY');
    assert.equal(resolveAoeTone({ groundKind: 'TOTEM', spellId: 'windfury_totem' }), 'FRIENDLY');
    assert.equal(resolveAoeTone({ groundKind: 'TOTEM', spellId: 'power_word_barrier' }), 'FRIENDLY');
    // 伤害红（友方枯萎凋零 / 暴风雪 / 冰霜宝珠仍为红填充）
    assert.equal(resolveAoeTone({ groundKind: 'DAMAGE_ZONE', spellId: 'death_and_decay', isEnemyActor: false }), 'ENEMY');
    assert.equal(resolveAoeTone({ groundKind: 'DAMAGE_ZONE', spellId: 'blizzard' }), 'ENEMY');
    assert.equal(resolveAoeTone({ groundKind: 'DAMAGE_ZONE', spellId: 'frozen_orb' }), 'ENEMY');
    assert.equal(resolveAoeTone({ groundKind: 'CONE_WARNING' }), 'ENEMY');
    assert.equal(resolveAoeTone({ isEnemyActor: false }), 'FRIENDLY');
    // 同一半径下 alpha 与色调无关：绿/黄/红共用 resolveAoeAlphaByRadiusPx
    const a10 = resolveAoeAlphaByRadiusPx(yardsToPx(10));
    const a40 = resolveAoeAlphaByRadiusPx(yardsToPx(40));
    assert.equal(a10, resolveAoeAlphaByRadiusPx(yardsToPx(10)));
    assert.ok(a10 > a40, '小圈应比大圈更不透明（透明度更低）');
  });

  it('3. 瞬时保留 100ms + 10ms 渐隐常量', () => {
    assert.equal(AOE_INSTANT_HOLD_MS, 100);
    assert.equal(AOE_FADE_MS, 10);
  });

  it('4. 瞬时 AOE 不再 emit 光圈；仅 GROUND_PLACE 可写动作日志且 aoePulse=false', () => {
    const engine = new CombatEngine();
    const boss = makeUnit({ id: 'boss', name: 'B', classId: 'BOSS', role: 'ENEMY', unitKind: 'BOSS' });
    engine.addUnit(boss);
    assert.equal(
      emitAoePulse(engine, {
        actorId: boss.id,
        spellId: 'blood_boil',
        x: 220,
        y: 180,
        radius: 120,
        tone: 'ENEMY',
      }),
      null,
      '瞬时结算不应产生光圈动作'
    );
    assert.equal(engine.drainRecentActions().length, 0);

    emitAoePulse(engine, {
      actorId: boss.id,
      spellId: 'desecration',
      spellName: '亵渎',
      x: 220,
      y: 180,
      radius: 120,
      tone: 'ENEMY',
      kind: 'GROUND_PLACE',
      groundEffectId: 'g1',
    });
    const recentActions = engine.drainRecentActions();
    assert.equal(recentActions.length, 1);
    assert.equal(recentActions[0].aoePulse, false);
    assert.equal(recentActions[0].kind, 'GROUND_PLACE');

    const snap: NetworkCombatSnapshot = {
      roomId: 'r_fx',
      seq: 1,
      timeMs: Date.now(),
      runPhase: 'BOSS_COMBAT',
      units: [],
      recentActions,
    };
    const wire = encodeNetMessage({ type: 'COMBAT_STATE', roomId: snap.roomId, payload: snap });
    const body = decodeNetMessage(wire)!.payload as NetworkCombatSnapshot;
    assert.equal(body.recentActions![0].aoePulse, false);
  });

  it('5. 锥形预警按 facingRad/coneAngleRad 命中，与圆形光圈共用半径字段', () => {
    const engine = new CombatEngine();
    engine.effectsManager.addGroundEffect({
      kind: 'CONE_WARNING',
      spellId: 'pistol_barrage',
      ownerId: 'boss',
      x: 100,
      y: 100,
      radius: 120,
      colorHex: '#EF4444',
      remainingMs: 3000,
      facingRad: 0, // +X
      coneAngleRad: Math.PI / 3,
    });
    assert.equal(engine.effectsManager.isPositionInHazard({ x: 180, y: 100 }), true);
    assert.equal(engine.effectsManager.isPositionInHazard({ x: 20, y: 100 }), false);
    assert.equal(engine.effectsManager.isPositionInHazard({ x: 160, y: 180 }), false);
  });
});
