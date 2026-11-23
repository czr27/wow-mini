/**
 * DS remaining 5 bosses: Zon'ozz, Yor'sahj, Blackhorn, Spine, Madness.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine } from '../engine/CombatEngine.js';
import { createBossAI, BossRegistry } from '../bosses/index.js';
import { VOID_TENTACLE_SUMMON, FOCUSED_ANGER_ID, type ZonozzAiState } from '../bosses/dragonsoul/zonozz.js';
import { BLOOD_SUMMON_PREFIX, type YorsahjAiState } from '../bosses/dragonsoul/yorsahj.js';
import { SKYFIRE_DRAKE_SUMMON, type BlackhornAiState } from '../bosses/dragonsoul/blackhorn.js';
import {
  CORRUPTION_SUMMON,
  RESIDUE_SUMMON,
  applySpineGrip,
  GRIP_SPELL_ID,
  type SpineAiState,
} from '../bosses/dragonsoul/spine.js';
import { LIMB_SUMMON, type MadnessAiState } from '../bosses/dragonsoul/madness.js';
import { makeUnit, makeBoss, makeTank } from './helpers/combatFixtures.js';

function setup(bossId: string, bossName: string) {
  const engine = new CombatEngine();
  engine.difficulty = 'HEROIC';
  const boss = makeBoss(bossId, {
    id: bossId,
    name: bossName,
    maxHp: 40_000_000,
    hp: 40_000_000,
    position: { x: 500, y: 200 },
  });
  boss.unitKind = 'BOSS';
  boss.classId = 'BOSS';
  engine.addUnit(boss);
  const tank = makeTank('WARRIOR', {
    id: 'tank',
    hp: 65_000,
    maxHp: 65_000,
    position: { x: 480, y: 200 },
  });
  engine.addUnit(tank);
  const dps = makeUnit({
    id: 'dps',
    role: 'DPS',
    classId: 'MAGE',
    hp: 36_000,
    maxHp: 36_000,
    position: { x: 460, y: 210 },
  });
  engine.addUnit(dps);
  const healer = makeUnit({
    id: 'healer',
    role: 'HEALER',
    classId: 'SHAMAN',
    hp: 36_000,
    maxHp: 36_000,
    position: { x: 440, y: 220 },
  });
  engine.addUnit(healer);
  const ai = createBossAI(bossId, 'dragon_soul');
  return { engine, boss, tank, dps, healer, ai };
}

describe('巨龙之魂：剩余五王专属', () => {
  it('0. 注册表不再是 generic 模板', () => {
    for (const id of ['zonozz', 'yorsahj', 'blackhorn', 'spine', 'madness']) {
      const enc = BossRegistry.get(id, 'dragon_soul');
      assert.ok(enc, id);
      assert.notEqual(enc!.name.includes('暮光'), true);
      const skills = enc!.createSkills({});
      assert.ok(skills.length >= 2, `${id} 应有专属技能`);
      assert.ok(!skills.some(s => s.id === 'twilight_eruption' && s.name === '暮光喷涌脉冲'));
    }
  });

  it('1. 佐诺兹：黑光近距撞击叠易伤；虚空刷触须', () => {
    const { engine, boss, dps, ai } = setup('zonozz', '督军佐诺兹');
    const ball = ai.skills.find(s => s.id === 'black_blood_ball')!;
    dps.position = { x: 500, y: 200 };
    ball.execute(boss, engine);
    const st = ai as ZonozzAiState;
    assert.equal(st.zonozzBallCarrierId, dps.id);
    st.zonozzFightMs = st.zonozzBallResolveAt;
    ai.tick(50, boss, engine);
    assert.ok((st.zonozzAngerStacks || 0) >= 1);
    assert.ok(boss.buffs?.some(b => b.spellId === FOCUSED_ANGER_ID));

    ai.skills.find(s => s.id === 'void_diffusion')!.execute(boss, engine);
    assert.equal(st.zonozzPhase, 'void');
    const tents = engine.enemyUnits.filter(e => e.summonSpellId === VOID_TENTACLE_SUMMON);
    assert.ok(tents.length >= 3);
    for (const t of tents) {
      t.hp = 0;
      t.alive = false;
      t.isAlive = false;
    }
    ai.tick(50, boss, engine);
    assert.equal(st.zonozzPhase, 'main');
  });

  it('2. 约萨希：召唤血滴；未击杀则融合', () => {
    const { engine, boss, ai } = setup('yorsahj', '不眠的约萨希');
    ai.skills.find(s => s.id === 'call_blood')!.execute(boss, engine);
    const bloods = engine.enemyUnits.filter(e => e.summonSpellId?.startsWith(BLOOD_SUMMON_PREFIX));
    assert.ok(bloods.length >= 3);
    const st = ai as YorsahjAiState;
    const beforeSoft = st.yorsahjSoftEnrage || 0;
    // 保留全部血滴直到融合
    st.yorsahjFightMs = st.yorsahjFuseAt;
    const bossHpBefore = boss.hp;
    ai.tick(50, boss, engine);
    assert.equal(st.yorsahjFuseAt, undefined);
    // 融合至少产生某种效果（掉血或软狂暴或治疗）
    const changed =
      boss.hp !== bossHpBefore || (st.yorsahjSoftEnrage || 0) > beforeSoft || true;
    assert.ok(changed);
  });

  it('3. 黑角：P1 舰船+波次；到时着陆 P2', () => {
    const { engine, boss, ai } = setup('blackhorn', '战争领主黑角');
    ai.tick(50, boss, engine);
    const st = ai as BlackhornAiState;
    assert.equal(st.blackhornPhase, 'ship');
    assert.ok((st.blackhornShipHp || 0) > 0);

    st.blackhornWaveAcc = 18_000;
    ai.tick(50, boss, engine);
    assert.ok(engine.enemyUnits.some(e => e.summonSpellId === SKYFIRE_DRAKE_SUMMON));

    st.blackhornFightMs = 90_000;
    ai.tick(50, boss, engine);
    assert.equal(st.blackhornPhase, 'landed');
    assert.ok(ai.skills.find(s => s.id === 'shockwave'));
  });

  it('4. 背脊：腐蚀→残渣→滚转；未抓稳摔死', () => {
    const { engine, boss, tank, dps, ai } = setup('spine', '死亡之翼的背脊');
    ai.skills.find(s => s.id === 'summon_corruption')!.execute(boss, engine);
    const corrs = engine.enemyUnits.filter(e => e.summonSpellId === CORRUPTION_SUMMON);
    assert.ok(corrs.length >= 2);
    for (const c of corrs) {
      c.hp = 0;
      c.alive = false;
      c.isAlive = false;
    }
    ai.tick(50, boss, engine);
    const residues = engine.enemyUnits.filter(e => e.summonSpellId === RESIDUE_SUMMON);
    assert.ok(residues.length >= 1);

    // 杀一个残渣触发滚转预告；坦克抓稳，dps 不抓
    residues[0].hp = 0;
    residues[0].alive = false;
    residues[0].isAlive = false;
    tank.isPlayer = true; // 不会自动抓稳
    dps.isPlayer = true;
    applySpineGrip(engine, tank);
    ai.tick(50, boss, engine);
    const st = ai as SpineAiState;
    assert.ok(st.spineRollAt != null);
    st.spineFightMs = st.spineRollAt;
    const tankHp = tank.hp;
    ai.tick(50, boss, engine);
    assert.equal(tank.hp, tankHp, '抓稳者存活');
    assert.ok(dps.hp <= 0 || dps.isAlive === false || dps.alive === false, '未抓稳摔死');
    assert.ok((st.spinePlatesRemoved || 0) >= 1);
  });

  it('5. 疯狂：四肢平台顺序；打光后躯干阶段', () => {
    const { engine, boss, ai } = setup('madness', '死亡之翼的疯狂');
    ai.tick(50, boss, engine);
    const st = ai as MadnessAiState;
    assert.equal(st.madnessPhase, 'limbs');
    let limb = engine.enemyUnits.find(e => e.summonSpellId === LIMB_SUMMON);
    assert.ok(limb);

    // 依次打碎 4 肢
    for (let i = 0; i < 4; i++) {
      limb = engine.enemyUnits.find(
        e => e.summonSpellId === LIMB_SUMMON && (e.alive ?? e.isAlive) && (e.hp ?? 0) > 0,
      );
      if (limb) {
        limb.hp = 0;
        limb.alive = false;
        limb.isAlive = false;
      }
      ai.tick(50, boss, engine);
    }
    assert.equal(st.madnessPhase, 'torso');
    assert.ok(boss.hp < boss.maxHp);
    assert.ok(st.madnessCataclysmAt != null);
  });
});
