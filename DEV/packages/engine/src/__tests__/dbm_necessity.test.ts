import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BaseBossAI,
  BossRegistry,
  CombatEngine,
  spawnCombatUnit,
} from '../index.js';
import type { MorchokAiState } from '../bosses/dragonsoul/morchok.js';
import { resolveStompDamage, crystalExplosionDamage } from '../bosses/dragonsoul/morchok.js';
import { applySpineGrip } from '../bosses/dragonsoul/spine.js';
import type { UltraxionAiState } from '../bosses/dragonsoul/ultraxion.js';

function addHero(
  engine: CombatEngine,
  id: string,
  role: 'TANK' | 'HEALER' | 'DPS',
  pos: { x: number; y: number },
  hp = 120_000,
) {
  return spawnCombatUnit(engine, {
    id,
    name: `${role}_${id}`,
    classId: role === 'TANK' ? 'WARRIOR' : role === 'HEALER' ? 'PRIEST' : 'MAGE',
    role,
    unitKind: 'AI',
    hp,
    maxHp: hp,
    position: pos,
  });
}

describe('DBM 双向必要性校验（正向覆盖 + 反向反做惩罚）', () => {
  it('正向 1：全副本已配置的显式 DBM 均具备简短 4 字左右语音与非空建议', () => {
    const dungeonIds = ['shadowfang_keep', 'deadmines', 'scarlet_monastery', 'stratholme', 'zulgurub', 'dragon_soul'];
    let explicitCount = 0;
    for (const dungeonId of dungeonIds) {
      for (const bossCfg of BossRegistry.getByDungeon(dungeonId)) {
        const ai = new BaseBossAI(bossCfg.id, dungeonId);
        for (const skill of ai.skills) {
          if (!skill.dbm) continue;
          explicitCount++;
          assert.ok(
            skill.dbm.advice.trim().length > 0,
            `${dungeonId}/${bossCfg.id}/${skill.id} 缺少 dbm.advice`,
          );
          const vt = (skill.dbm.voiceText || '').trim();
          assert.ok(
            vt.length >= 2 && vt.length <= 6,
            `${dungeonId}/${bossCfg.id}/${skill.id} voiceText "${vt}" 应控制在 2~6 字`,
          );
        }
      }
    }
    assert.ok(explicitCount >= 12, `预期至少 12 个显式 DBM 机制，实际 ${explicitCount}`);
  });

  it('正向 2：AI 模拟产生严重效果的高威胁机制（窒息/魔药/暮光时刻/黑血/低语/旋风）均会触发 DBM', () => {
    const cases: Array<{ dungeonId: string; bossId: string; skillId: string; expectedVoice: string }> = [
      { dungeonId: 'shadowfang_keep', bossId: 'ashbury', skillId: 'asphyxiate', expectedVoice: '准备抬血' },
      { dungeonId: 'dragon_soul', bossId: 'morchok', skillId: 'black_blood', expectedVoice: '躲柱子后' },
      { dungeonId: 'dragon_soul', bossId: 'ultraxion', skillId: 'hour_of_twilight', expectedVoice: '暮光时刻' },
      { dungeonId: 'zulgurub', bossId: 'venoxis', skillId: 'whispers_of_hethiss', expectedVoice: '注意打断' },
      { dungeonId: 'scarlet_monastery', bossId: 'herod', skillId: 'whirlwind', expectedVoice: '注意远离' },
    ];
    for (const c of cases) {
      const ai = new BaseBossAI(c.bossId, c.dungeonId);
      const rule = (ai as any).dbmRulesMap.get(c.skillId);
      assert.ok(rule, `${c.bossId}.${c.skillId} 导致严重后果但未生成 DBM 规则`);
      assert.equal(rule.voiceText, c.expectedVoice);
    }
  });

  it('反向 1（沃登勋爵）：绿药不走动叠毒掉血；红药故意移动引爆重创', () => {
    const engine = new CombatEngine();
    const boss = engine.spawnBoss('walden', '沃登勋爵', 500_000);
    const dps = addHero(engine, 'dps1', 'DPS', { x: 300, y: 200 }, 100_000);
    const ai = new BaseBossAI('walden', 'shadowfang_keep');
    const potion = ai.skills.find((s) => s.id === 'potion_catalyst')!;

    // 第 1 次：绿药（DBM 提示：保持移动），故意静止 1600ms
    potion.execute(boss, engine);
    const greenAlerts = engine.drainDbmAlerts();
    assert.equal(greenAlerts[0]?.voiceText, '保持移动');
    const hpAfterGreenCast = dps.hp;
    ai.tick(800, boss, engine);
    ai.tick(800, boss, engine);
    assert.ok(dps.hp < hpAfterGreenCast, '绿药站立不动（反着做）必须导致掉血惩罚');

    // 第 2 次：红药（DBM 提示：站立不动），故意移动 30px
    potion.execute(boss, engine);
    const redAlerts = engine.drainDbmAlerts();
    assert.equal(redAlerts[0]?.voiceText, '站立不动');
    const hpAfterRedCast = dps.hp;
    dps.position = { x: 340, y: 200 };
    ai.tick(50, boss, engine);
    assert.ok(hpAfterRedCast - dps.hp >= 8_000, '红药故意移动（反着做）必须触发高额引爆伤害');
  });

  it('反向 2（奥卓克希昂）：暮光时刻无人分摊全团灭；凋零之光不离场直接秒杀', () => {
    const engine = new CombatEngine();
    const boss = engine.spawnBoss('ultraxion', '奥卓克希昂', 2_000_000);
    const tank = addHero(engine, 'tank1', 'TANK', { x: 450, y: 200 }, 150_000);
    const dps = addHero(engine, 'dps1', 'DPS', { x: 300, y: 200 }, 120_000);
    const ai = new BaseBossAI('ultraxion', 'dragon_soul') as unknown as BaseBossAI & UltraxionAiState;

    // 进场灌入暮光领域
    ai.tick(100, boss, engine);

    // 1) 凋零之光（DBM 提示：点离领域），故意不点英勇意志离开 → 到期秒杀
    ai.tick(40_000, boss, engine);
    const fadingAlerts = engine.drainDbmAlerts().filter((a) => a.spellId === 'fading_light');
    assert.equal(fadingAlerts[0]?.voiceText, '点离领域');
    // 让坦克（假设未用英勇意志）直接把剩余凋零时间走完
    ai.ultraxFadingLeftMs!.set(tank.id, 50);
    ai.tick(100, boss, engine);
    assert.equal(tank.hp, 0, '凋零之光未按 DBM 离开领域必须导致秒杀');

    // 2) 暮光时刻（DBM 提示：暮光时刻），故意无人留在领域分摊 → 灭团
    ai.ultraxSoakIds = [];
    const hour = ai.skills.find((s) => s.id === 'hour_of_twilight')!;
    hour.execute(boss, engine);
    assert.equal(ai.ultraxHourFail, true, '暮光时刻无人分摊必须判定失败');
    assert.equal(dps.hp, 0, '暮光时刻无人分摊必须击杀全员');
  });

  it('反向 3（温诺希斯）：赫希斯低语不打断吃全团重毒；毒性链接不拉开持续掉血', () => {
    const engine = new CombatEngine();
    const boss = engine.spawnBoss('venoxis', '高阶祭司温诺希斯', 800_000);
    const d1 = addHero(engine, 'd1', 'DPS', { x: 300, y: 200 }, 100_000);
    const d2 = addHero(engine, 'd2', 'DPS', { x: 305, y: 200 }, 100_000);
    const ai = new BaseBossAI('venoxis', 'zulgurub');

    // 1) 低语未打断 → 全团重毒伤
    const whisper = ai.skills.find((s) => s.id === 'whispers_of_hethiss')!;
    whisper.execute(boss, engine);
    assert.ok(d1.hp < 92_000, '低语未打断必须造成高额全团重毒伤');

    // 2) 毒性链接（DBM：拉开扯断），故意贴在一起 → 持续掉血
    const link = ai.skills.find((s) => s.id === 'toxic_link')!;
    link.execute(boss, engine);
    const hpBeforeTick = d1.hp;
    ai.tick(2000, boss, engine);
    assert.ok(d1.hp < hpBeforeTick, '毒性链接未按 DBM 拉开必须持续掉血');
  });

  it('反向 4（赫洛德 & 莫卓克）：旋风斩不远离 / 黑血不躲柱子均受严重伤害，按 DBM 走位则安全', () => {
    // 赫洛德旋风斩
    const e1 = new CombatEngine();
    const herod = e1.spawnBoss('herod', '赫洛德', 500_000);
    herod.position = { x: 500, y: 200 };
    const nearDps = addHero(e1, 'near', 'DPS', { x: 510, y: 200 }, 100_000);
    const farDps = addHero(e1, 'far', 'DPS', { x: 200, y: 200 }, 100_000);
    const herodAi = new BaseBossAI('herod', 'scarlet_monastery');
    herodAi.skills.find((s) => s.id === 'whirlwind')!.execute(herod, e1);
    e1.tick(600);
    assert.ok(nearDps.hp < 100_000, '旋风斩未远离必须受伤');
    assert.equal(farDps.hp, 100_000, '按 DBM 远离旋风斩必须安全');

    // 莫卓克黑血
    const e2 = new CombatEngine();
    const morchok = e2.spawnBoss('morchok', '莫卓克', 1_000_000);
    const outUnit = addHero(e2, 'out', 'DPS', { x: 100, y: 100 }, 100_000);
    const morAi = new BaseBossAI('morchok', 'dragon_soul') as unknown as BaseBossAI & MorchokAiState;
    morAi.skills.find((s) => s.id === 'black_blood')!.execute(morchok, e2);
    // 确保 outUnit 站在所有碎石柱安全半径外
    const pillars = morAi.morchokPillars || [];
    assert.ok(pillars.length > 0, '黑血阶段必须生成碎石柱');
    outUnit.position = { x: 50, y: 50 };
    const inUnit = addHero(e2, 'in', 'HEALER', { x: pillars[0].x, y: pillars[0].y }, 100_000);
    morAi.tick(2000, morchok, e2);
    assert.ok(outUnit.hp < 100_000, '黑血期间未按 DBM 躲柱子必须持续掉血');
    assert.equal(inUnit.hp, 100_000, '黑血期间躲在碎石柱后必须安全');
  });

  it('反向 5（影牙：亚什布里 / 斯普林瓦尔 / 高弗雷）：不按 DBM 躲正面或打断均受严重后果', () => {
    // 斯普林瓦尔 背信之盾（DBM：躲开正面）
    const e1 = new CombatEngine();
    const spr = e1.spawnBoss('springvale', '指挥官斯普林瓦尔', 500_000);
    spr.position = { x: 420, y: 220 };
    const tankFront = addHero(e1, 't1', 'TANK', { x: 350, y: 220 }, 150_000);
    const dpsBack = addHero(e1, 'd1', 'DPS', { x: 520, y: 220 }, 100_000);
    const sprAi = new BaseBossAI('springvale', 'shadowfang_keep');
    sprAi.skills.find((s) => s.id === 'shield_of_perfidious')!.execute(spr, e1);
    e1.elapsedMs += 1600;
    sprAi.tick(50, spr, e1);
    assert.ok(tankFront.hp < 150_000, '背信之盾站在正面（反着做）必须受伤');
    assert.equal(dpsBack.hp, 100_000, '站在背面必须安全');

    // 高弗雷 双枪弹幕（DBM：躲开正面）
    const e2 = new CombatEngine();
    const godfrey = e2.spawnBoss('godfrey', '高弗雷勋爵', 500_000);
    godfrey.position = { x: 530, y: 200 };
    const front = addHero(e2, 't2', 'TANK', { x: 450, y: 200 }, 150_000);
    const side = addHero(e2, 'd2', 'DPS', { x: 530, y: 350 }, 150_000);
    const godAi = new BaseBossAI('godfrey', 'shadowfang_keep');
    godAi.skills.find((s) => s.id === 'pistol_barrage')!.execute(godfrey, e2);
    e2.elapsedMs += 3100;
    godAi.tick(50, godfrey, e2);
    assert.ok(150_000 - front.hp > 150_000 - side.hp, '双枪弹幕站在正面扇形内必须比侧面受更重伤害');
  });

  it('反向 6（死亡矿井：格拉布托克 / 赫利克斯 / 死神5000）：火墙/胸弹/过载反着做均受重创', () => {
    // 1) 格拉布托克 P2 火墙（DBM：躲避火墙）
    const e1 = new CombatEngine();
    const glub = e1.spawnBoss('glubtok', '戈洛克托克', 500_000);
    glub.position = { x: 500, y: 200 };
    glub.hp = Math.round(glub.maxHp * 0.4);
    const inRing = addHero(e1, 'inRing', 'DPS', { x: 580, y: 200 }, 100_000);
    const safeOut = addHero(e1, 'safeOut', 'HEALER', { x: 100, y: 100 }, 100_000);
    const glubAi = new BaseBossAI('glubtok', 'deadmines');
    glubAi.tick(100, glub, e1); // 触发 P1 -> P2
    glub.position = { x: 500, y: 200 };
    glubAi.tick(8100, glub, e1); // 火墙：生成 4 个环绕 Boss 的火焰区域
    const wallZones = (e1.effectsManager.groundEffects || []).filter(
      (g: any) => g.kind === 'DAMAGE_ZONE' && g.tickValue === 12_000,
    );
    assert.ok(wallZones.length >= 1, '火墙必须生成可躲避的地面火焰区域');
    // 故意站进火墙区域（反着做）；另一人远离
    inRing.position = { x: wallZones[0].x, y: wallZones[0].y };
    e1.tick(1100);
    assert.ok(inRing.hp < 100_000, '站在火墙区域内（反着做）必须受伤');
    // 站进火墙的人伤害必须明显高于躲开者（P2 另有随机花瓣区域，故不要求躲开者零伤害）
    assert.ok(100_000 - inRing.hp > 100_000 - safeOut.hp, '躲在火墙区域外必须比站进火墙受伤更少');

    // 2) 赫利克斯 胸弹（DBM：注意分散）— 故意抱团 <55px 引爆全团
    const e2 = new CombatEngine();
    const helix = e2.spawnBoss('helix', '赫利克斯·碎轮', 500_000);
    const b1 = addHero(e2, 'b1', 'DPS', { x: 300, y: 200 }, 100_000);
    const b2 = addHero(e2, 'b2', 'HEALER', { x: 310, y: 200 }, 100_000);
    const helixAi = new BaseBossAI('helix', 'deadmines');
    helixAi.skills.find((s) => s.id === 'chest_bomb')!.execute(helix, e2);
    // 快进到剩 <=1s 且仍抱团
    e2.tick(4200);
    helixAi.tick(600, helix, e2);
    assert.ok(b1.hp < 100_000 && b2.hp < 100_000, '胸弹不按 DBM 分散必须波及全团掉血');

    // 3) 死神5000 过载（DBM：远离boss）
    const e3 = new CombatEngine();
    const foe = e3.spawnBoss('foe_reaper', '死神 5000', 500_000);
    foe.position = { x: 500, y: 200 };
    const melee = addHero(e3, 'm1', 'DPS', { x: 510, y: 200 }, 100_000);
    const ranged = addHero(e3, 'r1', 'DPS', { x: 250, y: 200 }, 100_000);
    const foeAi = new BaseBossAI('foe_reaper', 'deadmines');
    foeAi.skills.find((s) => s.id === 'overdrive')!.execute(foe, e3);
    e3.tick(1100);
    assert.ok(melee.hp < 100_000, '过载期间不远离 Boss 必须受伤');
    assert.equal(ranged.hp, 100_000, '远离 Boss 必须安全');
  });

  it('反向 7（血色 & 斯坦索姆：杜安 / 双王 / 巴纳扎尔）：奥爆不远离 / 复活不打断 / 心控不打断均触发严重后果', () => {
    // 杜安奥术爆炸（DBM：注意远离）
    const e1 = new CombatEngine();
    const doan = e1.spawnBoss('doan', '奥法师杜安', 500_000);
    doan.position = { x: 500, y: 200 };
    const near = addHero(e1, 'near', 'DPS', { x: 510, y: 200 }, 100_000);
    const far = addHero(e1, 'far', 'DPS', { x: 200, y: 200 }, 100_000);
    const doanAi = new BaseBossAI('doan', 'scarlet_monastery');
    doanAi.skills.find((s) => s.id === 'arcane_explosion')!.execute(doan, e1);
    assert.ok(near.hp < 100_000, '奥爆近距未远离必须受伤');
    assert.equal(far.hp, 100_000, '远离奥爆必须安全');

    // 莫格莱尼与怀特迈恩（DBM：先杀怀特 / 注意打断）— 不打断复活直接回 50% 血
    const e2 = new CombatEngine();
    const mog = e2.spawnBoss('mograine_whitemane', '莫格莱尼与怀特迈恩', 500_000);
    mog.hp = 5000;
    const mwAi = new BaseBossAI('mograine_whitemane', 'scarlet_monastery');
    mwAi.skills.find((s) => s.id === 'whitemane_resurrection')!.execute(mog, e2);
    assert.equal(mog.hp, 250_000, '未打断/未先杀怀特迈恩必须导致莫格莱尼复活至 50% 血');

    // 斯坦索姆 巴纳扎尔（DBM：注意打断 心灵控制）
    const e3 = new CombatEngine();
    const bal = e3.spawnBoss('balnazzar', '巴纳扎尔', 500_000);
    const victim = addHero(e3, 'v1', 'DPS', { x: 300, y: 200 }, 100_000);
    const balAi = new BaseBossAI('balnazzar', 'stratholme');
    balAi.skills.find((s) => s.id === 'mind_control')!.execute(bal, e3);
    assert.ok(victim.buffs?.some((b) => b.spellId === 'balnazzar_mind_control'), '心灵控制未打断必须施加心控减益');
  });

  it('反向 8（祖格赞吉尔/金度 & 巨龙佐诺兹/哈甲拉）：错锅反噬 / 黑光未撞 / 冰环站外均受严重惩罚', () => {
    // 赞吉尔（DBM：选对药锅）— 玩家不喝锅吃反噬
    const e1 = new CombatEngine();
    const zan = e1.spawnBoss('zanzil', '赞吉尔', 500_000);
    const player = spawnCombatUnit(e1, {
      id: 'p1',
      name: 'Player',
      classId: 'MAGE',
      role: 'DPS',
      unitKind: 'PLAYER',
      isPlayer: true,
      hp: 100_000,
      maxHp: 100_000,
    });
    const zanAi = new BaseBossAI('zanzil', 'zulgurub');
    zanAi.skills.find((s) => s.id === 'cast_elixir')!.execute(zan, e1);
    zanAi.tick(1100, zan, e1);
    assert.ok(player.hp < 100_000, '未按 DBM 喝对应药锅必须吃药剂反噬伤害');

    // 哈甲拉 冰霜阶段（DBM：躲冰壁垒）— 站在外圈持续掉血
    const e2 = new CombatEngine();
    const hag = e2.spawnBoss('hagara', '缚风者哈甲拉', 1_000_000);
    hag.position = { x: 500, y: 200 };
    const outIce = addHero(e2, 'outIce', 'TANK', { x: 350, y: 200 }, 150_000); // 坦克不会被冰墓点名，距 Boss 150px > 90px
    addHero(e2, 'dIce1', 'DPS', { x: 480, y: 200 }, 100_000);
    addHero(e2, 'dIce2', 'HEALER', { x: 480, y: 210 }, 100_000);
    const hagAi = new BaseBossAI('hagara', 'dragon_soul') as any;
    hagAi.hagaraNextSpecial = 'frost';
    hagAi.skills.find((s: any) => s.id === 'enter_frost_phase')!.execute(hag, e2);
    hagAi.tick(1200, hag, e2);
    assert.ok(outIce.hp < 150_000, '冰霜阶段未按 DBM 进入内圈躲避必须持续掉血');

    // 佐诺兹 黑光球（DBM：分摊撞球）— 持球者远离 Boss 未撞上导致全团重创
    const e3 = new CombatEngine();
    const zon = e3.spawnBoss('zonozz', '督军佐诺兹', 1_000_000);
    zon.position = { x: 500, y: 200 };
    const carrier = spawnCombatUnit(e3, {
      id: 'car',
      name: 'PlayerCarrier',
      classId: 'WARRIOR',
      role: 'DPS',
      unitKind: 'PLAYER',
      isPlayer: true,
      hp: 100_000,
      maxHp: 100_000,
      position: { x: 100, y: 200 },
    }); // 人类持球者故意站在 400px 外不撞 Boss
    const zonAi = new BaseBossAI('zonozz', 'dragon_soul');
    zonAi.skills.find((s) => s.id === 'black_blood_ball')!.execute(zon, e3);
    zonAi.tick(8200, zon, e3);
    assert.ok(carrier.hp < 100_000, '黑光球到期未撞回 Boss 必须导致全团重创');
  });

  it('反向 9（亚什布里）：窒息后不抬血 → 全团 1 血被灾厄脉冲秒杀；不打断修补烂肉 → Boss 回 25%', () => {
    const e = new CombatEngine();
    const boss = e.spawnBoss('ashbury', '亚什布里男爵', 800_000);
    const u1 = addHero(e, 'a1', 'DPS', { x: 300, y: 200 }, 80_000);
    const u2 = addHero(e, 'a2', 'HEALER', { x: 310, y: 200 }, 80_000);
    const ai = new BaseBossAI('ashbury', 'shadowfang_keep');
    // 窒息压血至 1 点
    e.drainHpTowardFloor(u1, 79_999, 1, '窒息术');
    e.drainHpTowardFloor(u2, 79_999, 1, '窒息术');
    assert.equal(u1.hp, 1);
    // 故意不抬血，直接吃灾厄脉冲（安全窗已过）
    e.bossHealingGraceRemainingMs = 0;
    ai.skills.find((s) => s.id === 'calamity')!.execute(boss, e);
    assert.equal(u1.hp, 0, '窒息后不抬血（反着做）必须被后续脉冲秒杀');
    assert.equal(u2.hp, 0);

    // 修补烂肉不打断
    boss.hp = 400_000;
    ai.skills.find((s) => s.id === 'mend_rotten_flesh')!.execute(boss, e);
    assert.ok(boss.hp >= 400_000 + 190_000, '修补烂肉未打断必须回复约 25% 最大生命');
  });

  it('反向 10（曲奇）：站进腐烂食物掉血，站在好食物回血', () => {
    const e = new CombatEngine();
    const boss = e.spawnBoss('cookie', '曲奇', 500_000);
    const bad = addHero(e, 'bad', 'DPS', { x: 100, y: 100 }, 100_000);
    const ai = new BaseBossAI('cookie', 'deadmines');
    const throwFood = ai.skills.find((s) => s.id === 'throw_food')!;
    let badZone: any;
    for (let i = 0; i < 40 && !badZone; i++) {
      throwFood.execute(boss, e);
      badZone = (e.effectsManager.groundEffects || []).find((g: any) => g.spellId === 'cookie_bad_food');
    }
    assert.ok(badZone, '抛掷食物必须生成腐烂食物区域');
    bad.position = { x: badZone.x, y: badZone.y };
    e.tick(1100);
    assert.ok(bad.hp < 100_000, '站进腐烂食物（反着做）必须掉血');
  });

  it('反向 11（金度）：屏障期无视 DBM 集火本体 → 血量被锁回满，毫无进展', () => {
    const e = new CombatEngine();
    const boss = e.spawnBoss('jindo', '碎神者金度', 800_000);
    addHero(e, 'j1', 'DPS', { x: 300, y: 200 }, 100_000);
    const ai = new BaseBossAI('jindo', 'zulgurub');
    ai.tick(50, boss, e);
    boss.hp = Math.round(boss.maxHp * 0.5);
    ai.tick(50, boss, e);
    assert.equal(boss.hp, boss.maxHp, '屏障期集火本体（反着做）必须无效');
  });

  it('反向 12（背脊）：滚转前不抓稳 → 摔死；抓稳则存活', () => {
    const e = new CombatEngine();
    const boss = e.spawnBoss('spine', '死亡之翼的背脊', 2_000_000);
    const noGrip = addHero(e, 'ng', 'DPS', { x: 300, y: 200 }, 100_000);
    const gripped = addHero(e, 'gr', 'DPS', { x: 310, y: 200 }, 100_000);
    applySpineGrip(e, gripped);
    const ai = new BaseBossAI('spine', 'dragon_soul') as any;
    ai.spineRollAt = 1;
    ai.tick(100, boss, e);
    assert.equal(noGrip.hp, 0, '滚转前不抓稳（反着做）必须摔死');
    assert.equal(gripped.hp, 100_000, '按 DBM 抓稳必须存活');
  });

  it('反向 13（莫卓克践踏/水晶）：不分摊→单人吃满池；水晶不贴近→高伤', () => {
    const boss = { id: 'b', position: { x: 500, y: 200 } } as any;
    const mk = (id: string, x: number) => ({ id, position: { x, y: 200 } }) as any;
    const alone = resolveStompDamage(boss, [mk('a', 510), mk('b', 100), mk('c', 120), mk('d', 140)], 70_000);
    const stacked = resolveStompDamage(boss, [mk('a', 510), mk('b', 515), mk('c', 520), mk('d', 525)], 70_000);
    assert.ok((alone.get('a') ?? 0) >= 3 * (stacked.get('b') ?? 1), '践踏不分摊（反着做）必须单人吃重伤');
    assert.ok(crystalExplosionDamage(200) >= 5 * crystalExplosionDamage(0), '共鸣水晶不贴近必须吃高伤');
  });

  it('反向 14（哈甲拉闪电）：不击杀传导水晶 → 全团每秒导电掉血；清水晶结束阶段', () => {
    const e = new CombatEngine();
    const boss = e.spawnBoss('hagara', '缚风者哈甲拉', 1_000_000);
    const u = addHero(e, 'h1', 'DPS', { x: 300, y: 200 }, 100_000);
    const ai = new BaseBossAI('hagara', 'dragon_soul') as any;
    ai.hagaraNextSpecial = 'lightning';
    ai.skills.find((s: any) => s.id === 'enter_lightning_phase')!.execute(boss, e);
    ai.tick(2100, boss, e);
    assert.ok(u.hp < 100_000, '不击杀水晶（反着做）必须持续导电掉血');
    for (const c of e.enemyUnits.filter((x) => x.summonSpellId === 'hagara_conductive_crystal')) {
      c.hp = 0;
      c.alive = false;
      c.isAlive = false;
    }
    ai.tick(100, boss, e);
    assert.equal(ai.hagaraPhase, 'main', '击杀水晶必须结束闪电阶段');
  });

  it('反向 15（席瓦莱恩诅咒）：不打断降受疗诅咒 → 目标被施加 cursed_veins', () => {
    const e = new CombatEngine();
    const boss = e.spawnBoss('silverlaine', '席瓦莱恩', 500_000);
    const tank = addHero(e, 'st', 'TANK', { x: 300, y: 200 }, 150_000);
    addHero(e, 'sd', 'DPS', { x: 310, y: 200 }, 100_000);
    const ai = new BaseBossAI('silverlaine', 'shadowfang_keep');
    ai.skills.find((s) => s.id === 'cursed_veins')!.execute(boss, e);
    const cursed = e.friendlyUnits.some((u) => u.buffs?.some((b) => b.spellId === 'cursed_veins'));
    assert.ok(cursed, '降受疗诅咒未打断必须施加 cursed_veins');
    assert.ok(tank);
  });

  it('反向 16（黑角 暮光猛攻）：单人/无人分摊重创，多人集合分摊显著减伤；无后果 DBM 清零', () => {
    // 1) 1 人站圈独吃 vs 4 人集合分摊
    const runSoak = (soakerCount: number) => {
      const e = new CombatEngine();
      const boss = e.spawnBoss('blackhorn', '战争领主黑角', 1_000_000);
      const units = [];
      for (let i = 0; i < 4; i++) {
        units.push(
          addHero(
            e,
            `u${i}`,
            'DPS',
            { x: i < soakerCount ? 400 : 100, y: 220 },
            200_000,
          ),
        );
      }
      const ai = new BaseBossAI('blackhorn', 'dragon_soul') as any;
      ai.blackhornPhase = 'ship';
      ai.blackhornShipHp = 450_000;
      ai.skills.find((s: any) => s.id === 'twilight_onslaught')!.execute(boss, e);
      // 把选中的落点对齐到 x=400,y=220 以稳定对比分摊人数
      ai.blackhornOnslaughtTarget = { x: 400, y: 220, radius: 75, resolveAtFightMs: 3000 };
      ai.tick(3100, boss, e);
      return { dmgFirst: 200_000 - units[0].hp, shipHp: ai.blackhornShipHp as number };
    };

    const solo = runSoak(1);
    const stacked = runSoak(4);
    assert.ok(solo.dmgFirst >= 3 * stacked.dmgFirst, '单人独吃暮光猛攻必须承受远高于 4 人分摊的伤害');
    assert.ok(stacked.shipHp > solo.shipHp, '多人分摊对天火号舰船的损伤也必须更低');
  });
});
