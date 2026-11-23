/**
 * Iteration E (partial): Hagara frost/lightning two-phase.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine } from '../engine/CombatEngine.js';
import { createBossAI } from '../bosses/index.js';
import {
  ICE_TOMB_SPELL_ID,
  ICE_TOMB_ADD_SUMMON,
  CONDUCTIVE_CRYSTAL_SUMMON,
  type HagaraAiState,
} from '../bosses/dragonsoul/hagara.js';
import { makeUnit, makeBoss, makeTank } from './helpers/combatFixtures.js';

function setup() {
  const engine = new CombatEngine();
  engine.difficulty = 'HEROIC';
  const boss = makeBoss('hagara', {
    id: 'hagara',
    name: '缚风者哈甲拉',
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

  const healer = makeUnit({
    id: 'healer',
    role: 'HEALER',
    classId: 'SHAMAN',
    hp: 36_000,
    maxHp: 36_000,
    position: { x: 450, y: 210 },
  });
  const dps = makeUnit({
    id: 'dps',
    role: 'DPS',
    classId: 'MAGE',
    hp: 36_000,
    maxHp: 36_000,
    position: { x: 430, y: 220 },
  });
  engine.addUnit(healer);
  engine.addUnit(dps);
  const ai = createBossAI('hagara', 'dragon_soul');
  return { engine, boss, tank, healer, dps, ai };
}

describe('巨龙之魂：哈甲拉迭代 E', () => {
  it('1. 冰霜阶段：刷冰墓 ADD + 冰墓 debuff；打破后解除', () => {
    const { engine, boss, healer, ai } = setup();
    (ai as HagaraAiState).hagaraNextSpecial = 'frost';
    const frost = ai.skills.find(s => s.id === 'enter_frost_phase')!;
    frost.execute(boss, engine);

    assert.equal((ai as HagaraAiState).hagaraPhase, 'frost');
    const tombs = engine.enemyUnits.filter(e => e.summonSpellId === ICE_TOMB_ADD_SUMMON);
    assert.ok(tombs.length >= 1);
    const entombed = engine.friendlyUnits.filter(u =>
      u.buffs?.some(b => b.spellId === ICE_TOMB_SPELL_ID),
    );
    assert.ok(entombed.length >= 1);

    // 打碎所有冰墓
    for (const t of tombs) {
      t.hp = 0;
      t.alive = false;
      t.isAlive = false;
    }
    ai.tick(50, boss, engine);
    assert.equal(
      engine.friendlyUnits.some(u => u.buffs?.some(b => b.spellId === ICE_TOMB_SPELL_ID)),
      false,
    );
    assert.equal((ai as HagaraAiState).hagaraPhase, 'main');
  });

  it('2. 冰环：远离 Boss 掉血，贴身安全', () => {
    const { engine, boss, tank, dps, ai } = setup();
    (ai as HagaraAiState).hagaraNextSpecial = 'frost';
    ai.skills.find(s => s.id === 'enter_frost_phase')!.execute(boss, engine);

    tank.position = { x: 500, y: 200 }; // near
    dps.position = { x: 200, y: 200 }; // far
    // 清掉可能在 dps 上的冰墓以免跳过伤害
    dps.buffs = (dps.buffs || []).filter(b => b.spellId !== ICE_TOMB_SPELL_ID);
    tank.buffs = (tank.buffs || []).filter(b => b.spellId !== ICE_TOMB_SPELL_ID);

    const tankHp = tank.hp;
    const dpsHp = dps.hp;
    for (let i = 0; i < 12; i++) ai.tick(100, boss, engine);
    assert.equal(tank.hp, tankHp, '内圈不受冰环');
    assert.ok(dps.hp < dpsHp, '外圈吃冰环');
  });

  it('3. 闪电阶段：刷传导水晶；打光后回主阶段', () => {
    const { engine, boss, ai } = setup();
    (ai as HagaraAiState).hagaraNextSpecial = 'lightning';
    ai.skills.find(s => s.id === 'enter_lightning_phase')!.execute(boss, engine);
    assert.equal((ai as HagaraAiState).hagaraPhase, 'lightning');
    const crystals = engine.enemyUnits.filter(e => e.summonSpellId === CONDUCTIVE_CRYSTAL_SUMMON);
    assert.equal(crystals.length, 4);

    for (const c of crystals) {
      c.hp = 0;
      c.alive = false;
      c.isAlive = false;
    }
    ai.tick(50, boss, engine);
    assert.equal((ai as HagaraAiState).hagaraPhase, 'main');
  });

  it('4. 专属阶段 isActionLocked', () => {
    const { engine, boss, ai } = setup();
    (ai as HagaraAiState).hagaraNextSpecial = 'frost';
    ai.skills.find(s => s.id === 'enter_frost_phase')!.execute(boss, engine);
    assert.equal(ai.isActionLocked(), true);
    (ai as HagaraAiState).hagaraPhase = 'main';
    assert.equal(ai.isActionLocked(), false);
  });
});
