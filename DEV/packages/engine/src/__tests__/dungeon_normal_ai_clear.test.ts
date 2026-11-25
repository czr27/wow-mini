import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CombatEngine,
  BossAI,
  TankAI,
  HealerAI,
  DpsAI,
  tickEnemyAdds,
  getSpellByAnyId,
  createLevel80BaseStats,
  LEVEL_80_STATS,
  getEffectiveGcdMs,
  getHastedCastTimeMs,
  getUnitHaste,
  isPosInHazard,
  rollAiDamage,
  rollAiHeal,
} from '../index.js';
import type { ClassId, Unit } from '../types.js';

const TANK_POOL: Array<{ classId: ClassId; spec: string }> = [
  { classId: 'DK', spec: 'BLOOD' },
  { classId: 'WARRIOR', spec: 'PROTECTION' },
  { classId: 'PALADIN', spec: 'PROTECTION' },
  { classId: 'DRUID', spec: 'FERAL' },
];

const HEALER_POOL: Array<{ classId: ClassId; spec: string }> = [
  { classId: 'PRIEST', spec: 'HOLY' },
  { classId: 'PALADIN', spec: 'HOLY' },
  { classId: 'SHAMAN', spec: 'RESTORATION' },
  { classId: 'DRUID', spec: 'RESTORATION' },
];

const DPS_POOL: Array<{ classId: ClassId; spec: string }> = [
  { classId: 'MAGE', spec: 'FIRE' },
  { classId: 'WARLOCK', spec: 'AFFLICTION' },
  { classId: 'HUNTER', spec: 'MARKSMANSHIP' },
  { classId: 'ROGUE', spec: 'ASSASSINATION' },
  { classId: 'DK', spec: 'UNHOLY' },
  { classId: 'WARRIOR', spec: 'ARMS' },
  { classId: 'SHAMAN', spec: 'ELEMENTAL' },
  { classId: 'PRIEST', spec: 'SHADOW' },
];

function createSeededRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function makeAiMember(
  id: string,
  role: 'TANK' | 'HEALER' | 'DPS',
  classId: ClassId,
  spec: string,
  pos: { x: number; y: number }
): Unit {
  const maxHp =
    role === 'TANK' ? LEVEL_80_STATS.tankBaseHp : LEVEL_80_STATS.dpsHealerBaseHp;
  const maxMp =
    role === 'HEALER'
      ? LEVEL_80_STATS.healerBaseMp
      : ['MAGE', 'WARLOCK', 'PRIEST', 'SHAMAN', 'DRUID', 'PALADIN'].includes(classId)
        ? LEVEL_80_STATS.casterBaseMp
        : 0;
  return {
    id,
    name: `${classId}_${id}`,
    classId,
    spec,
    role,
    isPlayer: false,
    isAlive: true,
    alive: true,
    hp: maxHp,
    maxHp,
    mp: maxMp,
    maxMp,
    absorb: 0,
    buffs: [],
    threatTable: [],
    resources: maxMp > 0 ? [{ kind: 'MANA', current: maxMp, max: maxMp }] : [],
    stats: createLevel80BaseStats(role, classId),
    position: pos,
  };
}

function simulateNormalBossEncounter(
  bossId: string,
  dungeonId: string,
  bossName: string,
  roundSeed: number,
  tier: '5man' | '20man' = '5man'
): { cleared: boolean; elapsedMs: number; aliveCount: number } {
  const rng = createSeededRng(roundSeed);
  const engine = new CombatEngine();

  const tankCount = tier === '20man' ? 2 : 1;
  const healerCount = tier === '20man' ? 4 : 1;
  const dpsCount = tier === '20man' ? 14 : 3;

  const tanks: Unit[] = [];
  for (let i = 0; i < tankCount; i++) {
    const tankPick = TANK_POOL[Math.floor(rng() * TANK_POOL.length)];
    const t = makeAiMember(`tank_${i}`, 'TANK', tankPick.classId, tankPick.spec, { x: 260, y: 190 + i * 20 });
    tanks.push(t);
    engine.addUnit(t);
  }
  const tank = tanks[0];

  for (let i = 0; i < healerCount; i++) {
    const healPick = HEALER_POOL[Math.floor(rng() * HEALER_POOL.length)];
    engine.addUnit(
      makeAiMember(`healer_${i}`, 'HEALER', healPick.classId, healPick.spec, { x: 140, y: 170 + i * 20 })
    );
  }

  for (let i = 0; i < dpsCount; i++) {
    const dpsPick = DPS_POOL[Math.floor(rng() * DPS_POOL.length)];
    engine.addUnit(
      makeAiMember(`dps_${i}`, 'DPS', dpsPick.classId, dpsPick.spec, {
        x: 180 + (i % 4) * 20,
        y: 160 + Math.floor(i / 4) * 25,
      })
    );
  }

  // Normal mode boss HP (5-man ~550k, 20-man ~2.4M)
  const normalHp = tier === '20man' ? 2_400_000 : 550_000;
  const boss = engine.spawnBoss(bossId, bossName, normalHp, false);
  boss.position = { x: 320, y: 200 };
  const bossAi = new BossAI(bossId, dungeonId);

  const tankAi = new TankAI();
  const healerAi = new HealerAI();
  const dpsAi = new DpsAI(0);
  const addTimers = new Map<string, number>();

  const STEP_MS = 250;
  const MAX_MS = 180_000;
  let lastBossAaMs = 0;
  let lastPartyAaMs = 0;
  const unitNextReadyAtMs = new Map<string, number>();

  for (let t = 0; t < MAX_MS; t += STEP_MS) {
    engine.tick(STEP_MS);
    if (!(boss.isAlive ?? boss.alive) || boss.hp <= 0) {
      const aliveCount = engine.friendlyUnits.filter((u) => (u.isAlive ?? u.alive) && u.hp > 0).length;
      return { cleared: true, elapsedMs: t, aliveCount };
    }

    const livingAllies = engine.friendlyUnits.filter((u) => (u.isAlive ?? u.alive) && u.hp > 0);
    if (livingAllies.length === 0) {
      return { cleared: false, elapsedMs: t, aliveCount: 0 };
    }

    bossAi.tick(STEP_MS, boss, engine);

    // Boss melee auto-attack every 2s
    if (t - lastBossAaMs >= 2000 && !engine.isBossHealingGraceActive() && !bossAi.isActionLocked()) {
      lastBossAaMs = t;
      const targetId = engine.getBossTargetId() || tank.id;
      const target = livingAllies.find((u) => u.id === targetId) || livingAllies[0];
      if (target) {
        engine.resolveAttackHit(boss, target, target.role === 'TANK' ? 12_000 : 22_000, 'PHYSICAL', false, '首领普攻');
      }
    }

    tickEnemyAdds(engine, boss, STEP_MS, addTimers);

    // 友军白字普攻（每 2s）
    if (t - lastPartyAaMs >= 2000) {
      lastPartyAaMs = t;
      const firstEnemy =
        engine.enemyUnits.find((e) => e.id !== boss.id && (e.isAlive ?? e.alive) && e.hp > 0) ||
        boss;
      for (const u of livingAllies) {
        if (u.role === 'HEALER') continue;
        const isMelee = ['DK', 'ROGUE', 'WARRIOR', 'PALADIN'].includes(u.classId);
        const isCrit = Math.random() < (u.stats.critChance || 0.25);
        const baseAuto = isMelee ? (isCrit ? 9000 : 4500) : (isCrit ? 4000 : 2000);
        engine.resolveAttackHit(u, firstEnemy, baseAuto, 'PHYSICAL', isCrit, '普通攻击');
      }
    }

    // 真实躲圈与沃登绿药走动模拟
    const hazards = (engine.effectsManager?.groundEffects || []).filter(
      (g) => (g.kind === 'DAMAGE_ZONE' || g.kind === 'CONE_WARNING') && g.remainingMs > 0
    );
    for (const u of livingAllies) {
      const pos = u.position || { x: 200, y: 200 };
      const hitHz = hazards.find((h) => isPosInHazard(pos, h));
      if (hitHz) {
        const dx = pos.x - hitHz.x;
        const dy = pos.y - hitHz.y;
        const len = Math.hypot(dx, dy) || 1;
        const safeR = (hitHz.radius || 45) + 16;
        u.position = {
          x: hitHz.x + (dx / len) * safeR,
          y: hitHz.y + (dy / len) * safeR,
        };
      } else if (u.buffs?.some((b) => b.spellId === 'walden_green_toxin')) {
        u.position = {
          x: pos.x + ((t / STEP_MS) % 2 === 0 ? 8 : -8),
          y: pos.y,
        };
      }
    }

    const gs = {
      units: [...engine.friendlyUnits, ...engine.enemyUnits],
      bossId: boss.id,
      elapsedMs: t,
      bossChannelSpellId: bossAi.currentCasting?.skill?.id ?? null,
    };

    for (const u of livingAllies) {
      // 真实 GCD 与读条间隔约束（不再每 250ms 瞬发）
      const nextReady = unitNextReadyAtMs.get(u.id) ?? 0;
      if (t < nextReady) continue;

      const roleAi = u.role === 'TANK' ? tankAi : u.role === 'HEALER' ? healerAi : dpsAi;
      const actions = roleAi.decide(u, gs);
      const top = actions[0];
      if (!top) continue;
      const sp = getSpellByAnyId(top.action.spellId, u.classId);
      const target =
        engine.getUnit(top.action.targetId) ||
        (u.role === 'HEALER' ? livingAllies[0] : boss);
      if (!sp || !target) continue;

      const haste = getUnitHaste(u, LEVEL_80_STATS.haste);
      const gcdMs = getEffectiveGcdMs(
        u.classId === 'ROGUE' || u.classId === 'HUNTER' ? 'ROGUE' : 'NORMAL',
        haste
      );
      const castMs = sp.castTimeMs > 0 ? getHastedCastTimeMs(sp.castTimeMs, haste) : 0;
      unitNextReadyAtMs.set(u.id, t + Math.max(gcdMs, castMs));

      const isCrit = Math.random() < (u.stats.critChance || 0.25);
      if (sp.isInterrupt) {
        bossAi.interruptCurrentCast();
      } else if (sp.isTaunt) {
        engine.threatManager.applyTaunt(target.id, u.id);
      } else if (sp.isHeal || sp.isShield) {
        const baseH = sp.directHeal || sp.hotTotalHeal || sp.shieldValue || 10_000;
        const amt = rollAiHeal(u, Math.max(8_000, baseH), isCrit);
        engine.healUnit(u, target, amt, isCrit, sp.name);
      } else if (sp.isDamage || sp.isDot) {
        const baseD = sp.directDamage || Math.round((sp.dotTotalDamage || 12_000) * 0.75);
        const amt = rollAiDamage(u, Math.max(8_500, baseD), sp.school || 'PHYSICAL', isCrit);
        if (sp.isAOE) {
          const aoeTargets = engine.enemyUnits
            .filter((e) => (e.isAlive ?? e.alive) && e.hp > 0)
            .slice(0, sp.maxAoeTargets || 5);
          for (const et of aoeTargets) {
            engine.dealDamage(u, et, amt, sp.school || 'PHYSICAL', isCrit, sp.name);
          }
        } else {
          engine.dealDamage(u, target, amt, sp.school || 'PHYSICAL', isCrit, sp.name);
        }
      }
    }
  }

  const aliveCount = engine.friendlyUnits.filter((u) => (u.isAlive ?? u.alive) && u.hp > 0).length;
  return { cleared: !(boss.isAlive ?? boss.alive) || boss.hp <= 0, elapsedMs: MAX_MS, aliveCount };
}

describe('普通模式全随机 AI 通关测试（全副本 × 3 轮多职业覆盖）', () => {
  const ENCOUNTERS: Array<{
    bossId: string;
    dungeonId: string;
    name: string;
    tier?: '5man' | '20man';
  }> = [
    // 影牙城堡 (Shadowfang Keep) 5 王
    { bossId: 'ashbury', dungeonId: 'shadowfang_keep', name: '影牙1号-亚什布里男爵' },
    { bossId: 'silverlaine', dungeonId: 'shadowfang_keep', name: '影牙2号-席瓦莱恩男爵' },
    { bossId: 'springvale', dungeonId: 'shadowfang_keep', name: '影牙3号-指挥官斯普林瓦尔' },
    { bossId: 'walden', dungeonId: 'shadowfang_keep', name: '影牙4号-沃登勋爵' },
    { bossId: 'godfrey', dungeonId: 'shadowfang_keep', name: '影牙5号-高弗雷勋爵' },
    // 死亡矿井 (Deadmines) 普通模式 5 王
    { bossId: 'glubtok', dungeonId: 'deadmines', name: '死矿1号-戈洛克托克' },
    { bossId: 'helix', dungeonId: 'deadmines', name: '死矿2号-赫利克斯·碎轮' },
    { bossId: 'foe_reaper', dungeonId: 'deadmines', name: '死矿3号-死神5000' },
    { bossId: 'ripsnarl', dungeonId: 'deadmines', name: '死矿4号-撕心船长' },
    { bossId: 'cookie', dungeonId: 'deadmines', name: '死矿5号-曲奇' },
    // 血色修道院 (Scarlet Monastery) 6 王
    { bossId: 'vishas', dungeonId: 'scarlet_monastery', name: '血色1号-韦沙斯' },
    { bossId: 'loksey', dungeonId: 'scarlet_monastery', name: '血色2号-洛克希' },
    { bossId: 'doan', dungeonId: 'scarlet_monastery', name: '血色3号-杜安' },
    { bossId: 'herod', dungeonId: 'scarlet_monastery', name: '血色4号-赫洛德' },
    { bossId: 'mograine_whitemane', dungeonId: 'scarlet_monastery', name: '血色5号-莫格莱尼与怀特迈恩' },
    { bossId: 'thalnoren', dungeonId: 'scarlet_monastery', name: '血色6号-萨尔诺斯' },
    // 斯坦索姆 (Stratholme) 4 王
    { bossId: 'willey', dungeonId: 'stratholme', name: 'STSM1号-炮手威利' },
    { bossId: 'ramstein', dungeonId: 'stratholme', name: 'STSM2号-拉姆斯登' },
    { bossId: 'balnazzar', dungeonId: 'stratholme', name: 'STSM3号-巴纳扎尔' },
    { bossId: 'rivendare', dungeonId: 'stratholme', name: 'STSM4号-瑞文戴尔男爵' },
    // 祖尔格拉布 (Zul'Gurub) 5 王
    { bossId: 'venoxis', dungeonId: 'zulgurub', name: 'ZUG1号-温诺希斯' },
    { bossId: 'mandokir', dungeonId: 'zulgurub', name: 'ZUG2号-曼多基尔' },
    { bossId: 'kilnara', dungeonId: 'zulgurub', name: 'ZUG3号-基尔娜拉' },
    { bossId: 'zanzil', dungeonId: 'zulgurub', name: 'ZUG4号-赞吉尔' },
    { bossId: 'jindo', dungeonId: 'zulgurub', name: 'ZUG5号-碎神者金度' },
    // 巨龙之魂 (Dragon Soul) 8 王 (20人)
    { bossId: 'morchok', dungeonId: 'dragon_soul', name: 'DS1号-莫卓克', tier: '20man' },
    { bossId: 'zonozz', dungeonId: 'dragon_soul', name: 'DS2号-佐诺兹', tier: '20man' },
    { bossId: 'yorsahj', dungeonId: 'dragon_soul', name: 'DS3号-约萨希', tier: '20man' },
    { bossId: 'hagara', dungeonId: 'dragon_soul', name: 'DS4号-哈加拉', tier: '20man' },
    { bossId: 'ultraxion', dungeonId: 'dragon_soul', name: 'DS5号-奥卓克希昂', tier: '20man' },
    { bossId: 'blackhorn', dungeonId: 'dragon_soul', name: 'DS6号-黑角', tier: '20man' },
    { bossId: 'spine', dungeonId: 'dragon_soul', name: 'DS7号-背脊', tier: '20man' },
    { bossId: 'madness', dungeonId: 'dragon_soul', name: 'DS8号-狂乱', tier: '20man' },
  ];

  for (let round = 1; round <= 3; round++) {
    it(`第 ${round} 轮：随机职业组合填满 AI 队伍通关全部 6 个副本普通模式`, () => {
      for (let i = 0; i < ENCOUNTERS.length; i++) {
        const enc = ENCOUNTERS[i];
        const res = simulateNormalBossEncounter(
          enc.bossId,
          enc.dungeonId,
          enc.name,
          round * 1000 + i * 77,
          enc.tier ?? '5man'
        );
        assert.equal(
          res.cleared,
          true,
          `第 ${round} 轮 ${enc.name} 未能通关普通模式 (elapsed=${res.elapsedMs}ms, alive=${res.aliveCount})`
        );
      }
    });
  }
});
