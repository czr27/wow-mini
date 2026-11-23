/**
 * Deadmines F1: six-boss mechanics + config registration.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine } from '../engine/CombatEngine.js';
import { DEADMINES_CONFIG, getDungeonConfig } from '../engine/RunStateMachine.js';
import {
  createBossAI,
  BossRegistry,
  OAF_SUMMON,
  MOLTEN_SLAG_SUMMON,
  VAPOR_SUMMON,
  NIGHTMARE_WORGEN_SUMMON,
  type GlubtokAiState,
  type HelixAiState,
  type FoeReaperAiState,
  type RipsnarlAiState,
  type VanessaAiState,
} from '../bosses/index.js';
import { makeUnit, makeBoss, makeTank } from './helpers/combatFixtures.js';

function setup(bossId: string, bossName: string) {
  const engine = new CombatEngine();
  engine.difficulty = 'HEROIC';
  const boss = makeBoss(bossId, {
    id: bossId,
    name: bossName,
    maxHp: 2_000_000,
    hp: 2_000_000,
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
    position: { x: 450, y: 210 },
  });
  engine.addUnit(dps);
  const healer = makeUnit({
    id: 'healer',
    role: 'HEALER',
    classId: 'SHAMAN',
    hp: 36_000,
    maxHp: 36_000,
    position: { x: 430, y: 220 },
  });
  engine.addUnit(healer);
  const ai = createBossAI(bossId, 'deadmines');
  return { engine, boss, tank, dps, healer, ai };
}

describe('死亡矿井：F0/F1 机制', () => {
  it('0. Config / 注册 / 普通无梵妮莎', () => {
    assert.equal(DEADMINES_CONFIG.bosses.length, 6);
    assert.ok(DEADMINES_CONFIG.bosses.some(b => b.id === 'vanessa'));
    const normal = getDungeonConfig('deadmines', 'NORMAL');
    assert.equal(normal.bosses.some(b => b.id === 'vanessa'), false);
    for (const id of ['glubtok', 'helix', 'foe_reaper', 'ripsnarl', 'cookie', 'vanessa']) {
      assert.ok(BossRegistry.get(id, 'deadmines'), id);
    }
    // F0 shells for other three dungeons
    assert.ok(BossRegistry.get('doan', 'scarlet_monastery'));
    assert.ok(BossRegistry.get('rivendare', 'stratholme'));
    assert.ok(BossRegistry.get('jindo', 'zulgurub'));
    assert.equal(getDungeonConfig('scarlet_monastery').tier, '5man');
    assert.equal(getDungeonConfig('stratholme').bosses.length, 4);
    assert.equal(getDungeonConfig('zulgurub').bosses.length, 5);
  });

  it('1. 戈洛克：半血进入 P2', () => {
    const { engine, boss, ai } = setup('glubtok', '戈洛克托克');
    ai.tick(50, boss, engine);
    assert.equal((ai as GlubtokAiState).glubtokPhase, 'p1');
    boss.hp = Math.round(boss.maxHp * 0.45);
    ai.tick(50, boss, engine);
    assert.equal((ai as GlubtokAiState).glubtokPhase, 'p2');
  });

  it('2. 赫利克斯：开战刷木虱；死后进入跳背', () => {
    const { engine, boss, ai } = setup('helix', '赫利克斯·碎轮');
    ai.tick(50, boss, engine);
    const oafs = engine.enemyUnits.filter(e => e.summonSpellId === OAF_SUMMON);
    assert.equal(oafs.length, 1);
    assert.equal((ai as HelixAiState).helixPhase, 'oaf');
    oafs[0].hp = 0;
    oafs[0].alive = false;
    oafs[0].isAlive = false;
    ai.tick(50, boss, engine);
    assert.equal((ai as HelixAiState).helixPhase, 'leap');
  });

  it('3. 死神5000：≤30% 解除限制；可刷熔渣', () => {
    const { engine, boss, ai } = setup('foe_reaper', '死神 5000');
    ai.tick(50, boss, engine);
    boss.hp = Math.round(boss.maxHp * 0.25);
    ai.tick(50, boss, engine);
    assert.equal((ai as FoeReaperAiState).foeEnraged, true);
    (ai as FoeReaperAiState).foeSlagAcc = 20_000;
    ai.tick(50, boss, engine);
    assert.ok(engine.enemyUnits.some(e => e.summonSpellId === MOLTEN_SLAG_SUMMON));
  });

  it('4. 撕心：迷雾刷蒸汽', () => {
    const { engine, boss, ai } = setup('ripsnarl', '撕心船长利普斯纳尔');
    ai.skills.find(s => s.id === 'swirling_vapors')!.execute(boss, engine);
    assert.equal((ai as RipsnarlAiState).ripPhase, 'fog');
    (ai as RipsnarlAiState).ripVaporAcc = 5000;
    ai.tick(50, boss, engine);
    assert.ok(engine.enemyUnits.some(e => e.summonSpellId === VAPOR_SUMMON));
  });

  it('5. 曲奇：抛掷食物生成地面效果', () => {
    const { engine, boss, ai } = setup('cookie', '曲奇');
    const before = engine.effectsManager?.groundEffects?.length ?? 0;
    ai.skills.find(s => s.id === 'throw_food')!.execute(boss, engine);
    const after = engine.effectsManager?.groundEffects?.length ?? 0;
    assert.ok(after > before, '应生成食物落点');
  });

  it('6. 梵妮莎英雄：梦魇刷狼人；普通软跳过', () => {
    const { engine, boss, ai } = setup('vanessa', '梵妮莎·范克里夫');
    ai.tick(50, boss, engine);
    assert.equal((ai as VanessaAiState).vanessaPhase, 'nightmare');
    assert.ok(engine.enemyUnits.some(e => e.summonSpellId === NIGHTMARE_WORGEN_SUMMON));

    const s2 = setup('vanessa', '梵妮莎·范克里夫');
    s2.engine.difficulty = 'NORMAL';
    s2.ai.tick(50, s2.boss, s2.engine);
    assert.equal((s2.ai as VanessaAiState).vanessaPhase, 'skip');
  });
});
