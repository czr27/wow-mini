/**
 * Iteration C: Ultraxion twilight realm trio.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine } from '../engine/CombatEngine.js';
import { createBossAI } from '../bosses/index.js';
import {
  isInTwilightRealm,
  useHeroicWill,
  TWILIGHT_ERUPTION_MS,
  type UltraxionAiState,
} from '../bosses/dragonsoul/ultraxion.js';
import { makeUnit, makeBoss, makeTank } from './helpers/combatFixtures.js';

function setupRaid(n = 5) {
  const engine = new CombatEngine();
  engine.difficulty = 'HEROIC';
  const boss = makeBoss('ultraxion', {
    id: 'ultraxion',
    name: '奥卓克希昂',
    maxHp: 50_000_000,
    hp: 50_000_000,
    position: { x: 500, y: 200 },
  });
  boss.unitKind = 'BOSS';
  boss.classId = 'BOSS';
  engine.addUnit(boss);

  const tank = makeTank('WARRIOR', {
    id: 'tank',
    hp: 65_000,
    maxHp: 65_000,
    position: { x: 200, y: 200 },
    isPlayer: true,
  });
  engine.addUnit(tank);

  const others = [];
  for (let i = 1; i < n; i++) {
    const u = makeUnit({
      id: `raid_${i}`,
      role: i === 1 ? 'HEALER' : 'DPS',
      classId: i === 1 ? 'SHAMAN' : 'MAGE',
      hp: 36_000,
      maxHp: 36_000,
      position: { x: 210 + i * 8, y: 200 + (i % 3) * 5 },
      isPlayer: false,
    });
    engine.addUnit(u);
    others.push(u);
  }
  const ai = createBossAI('ultraxion', 'dragon_soul');
  return { engine, boss, tank, others, ai };
}

describe('巨龙之魂：奥卓克希昂迭代 C', () => {
  it('1. 开战灌入暮光领域；英勇意志可离开并在结束后回进', () => {
    const { engine, boss, tank, ai } = setupRaid(5);
    ai.tick(50, boss, engine);
    assert.ok(isInTwilightRealm(tank), '坦克应在暮光领域');

    const ok = useHeroicWill(engine, ai as UltraxionAiState, tank, 2000);
    assert.equal(ok, true);
    assert.equal(isInTwilightRealm(tank), false, '英勇意志后应离开领域');

    // CD 中不可再放
    assert.equal(useHeroicWill(engine, ai as UltraxionAiState, tank), false);

    // 推进离开时长后自动回进
    for (let i = 0; i < 25; i++) ai.tick(100, boss, engine);
    assert.ok(isInTwilightRealm(tank), '离开结束后应自动回进暮光领域');
  });

  it('2. 不稳定的畸变：仅领域内分摊；CD 随战斗时长缩短', () => {
    const { engine, boss, tank, others, ai } = setupRaid(5);
    ai.tick(50, boss, engine);

    const mono = ai.skills.find(s => s.id === 'unstable_monstrosity')!;
    assert.equal(mono.cooldownMs, 6000);

    // 一人离开领域
    useHeroicWill(engine, ai as UltraxionAiState, tank, 10_000);
    const hpOutBefore = tank.hp;
    const inRealm = others.filter(u => isInTwilightRealm(u));
    const hpInBefore = inRealm.map(u => u.hp);

    mono.execute(boss, engine);

    assert.equal(tank.hp, hpOutBefore, '领域外不受畸变伤害');
    for (let i = 0; i < inRealm.length; i++) {
      assert.ok(inRealm[i].hp < hpInBefore[i], '领域内应吃到分摊伤害');
    }

    // 模拟战斗进行到 3 分钟 → 间隔应降到 3s
    (ai as UltraxionAiState).ultraxFightMs = 3 * 60_000;
    mono.execute(boss, engine);
    assert.equal(mono.cooldownMs, 3000);

    (ai as UltraxionAiState).ultraxFightMs = 10 * 60_000;
    mono.execute(boss, engine);
    assert.equal(mono.cooldownMs, 1000, '下限 1s');
  });

  it('3. 暮光时刻：无人分摊失败；有人分摊则非灭团', () => {
    const { engine, boss, tank, others, ai } = setupRaid(5);
    ai.tick(50, boss, engine);

    const hour = ai.skills.find(s => s.id === 'hour_of_twilight')!;

    // 全员离开 → 无人分摊
    for (const u of [tank, ...others]) {
      useHeroicWill(engine, ai as UltraxionAiState, u, 60_000);
    }
    (ai as UltraxionAiState).ultraxSoakIds = [tank.id];
    hour.execute(boss, engine);
    assert.equal((ai as UltraxionAiState).ultraxHourFail, true);
    assert.ok(tank.hp <= 0 || tank.isAlive === false || tank.alive === false || tank.hp < tank.maxHp * 0.05);

    // 重置一场：分摊者留下
    const s2 = setupRaid(5);
    s2.ai.tick(50, s2.boss, s2.engine);
    (s2.ai as UltraxionAiState).ultraxSoakIds = [s2.tank.id, s2.others[0].id];
    // 非分摊离开
    for (const u of s2.others.slice(1)) {
      useHeroicWill(s2.engine, s2.ai as UltraxionAiState, u, 60_000);
    }
    const soakHpBefore = s2.tank.hp;
    s2.ai.skills.find(s => s.id === 'hour_of_twilight')!.execute(s2.boss, s2.engine);
    assert.equal((s2.ai as UltraxionAiState).ultraxHourFail, undefined);
    assert.ok(s2.tank.hp < soakHpBefore && s2.tank.hp > 0, '分摊者受伤但存活');
    assert.ok(s2.tank.isAlive !== false && s2.tank.alive !== false);
  });

  it('4. 凋零之光到期仍在领域则秒杀；离开则安全', () => {
    const { engine, boss, tank, others, ai } = setupRaid(5);
    // 跳过随机点名：直接灌计时
    ai.tick(50, boss, engine);
    const state = ai as UltraxionAiState;
    state.ultraxFadingAcc = 0;
    state.ultraxFadingLeftMs = new Map([[tank.id, 500]]);
    engine.applyBuff(tank, {
      id: 'fl_test',
      spellId: 'fading_light',
      name: '凋零之光',
      kind: 'DEBUFF',
      tags: ['DEBUFF'],
      sourceUnitId: boss.id,
      targetUnitId: tank.id,
      durationMs: 500,
      remainingMs: 500,
      stacks: 1,
      maxStacks: 1,
      school: 'SHADOW',
    });

    for (let i = 0; i < 10; i++) ai.tick(100, boss, engine);
    assert.ok(tank.hp <= 0 || tank.isAlive === false || tank.alive === false, '领域内到期应死');

    // 离开后到期安全
    const s2 = setupRaid(5);
    s2.ai.tick(50, s2.boss, s2.engine);
    useHeroicWill(s2.engine, s2.ai as UltraxionAiState, s2.tank, 60_000);
    (s2.ai as UltraxionAiState).ultraxFadingLeftMs = new Map([[s2.tank.id, 300]]);
    const hp = s2.tank.hp;
    for (let i = 0; i < 8; i++) s2.ai.tick(100, s2.boss, s2.engine);
    assert.equal(s2.tank.hp, hp, '离开领域后凋零到期不应秒杀');
  });

  it('5. 6 分钟硬狂暴开始暮光爆发读条', () => {
    const { engine, boss, ai } = setupRaid(5);
    ai.tick(50, boss, engine);
    assert.notEqual(
      ai.currentCasting?.skill.id,
      'twilight_eruption',
      '开战初期不应提前释放暮光爆发',
    );
    (ai as UltraxionAiState).ultraxFightMs = TWILIGHT_ERUPTION_MS - 50;
    ai.currentCasting = null;
    ai.tick(100, boss, engine);
    assert.ok(ai.currentCasting?.skill.id === 'twilight_eruption', '应开始暮光爆发读条');
  });
});
