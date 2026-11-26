import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import type { CombatEngine } from '../../engine/CombatEngine.js';
import type { Unit } from '../../types.js';
import { spawnCombatUnit } from '../../engine/UnitSpawn.js';
import { pickWeightedBossTarget } from '../core/BossTargetPicker.js';

export const SKYFIRE_DRAKE_SUMMON = 'blackhorn_twilight_drake';
export const SKYFIRE_ASSAULT_SUMMON = 'blackhorn_assault_troop';

export type BlackhornAiState = {
  blackhornFightMs?: number;
  blackhornPhase?: 'ship' | 'landed';
  blackhornShipHp?: number;
  blackhornShipMaxHp?: number;
  blackhornWaveAcc?: number;
  blackhornWave?: number;
  blackhornOnslaughtTarget?: {
    x: number;
    y: number;
    radius: number;
    resolveAtFightMs: number;
  };
  skills?: BossSkill[];
};

function living(engine: CombatEngine): Unit[] {
  return engine.friendlyUnits.filter(u => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

/**
 * 战争领主黑角：P1 护舰清龙潮 → P2 着陆冲击波
 */
export const BlackhornEncounter: BossEncounterModule = {
  id: 'blackhorn',
  name: '战争领主黑角',
  dungeonId: 'dragon_soul',
  tier: '20man',

  createSkills(bossAi: any): BossSkill[] {
    const ai = bossAi as BlackhornAiState;
    return [
      {
        id: 'deck_fire',
        name: '甲板燃烧',
        castTimeMs: 1200,
        cooldownMs: 16_000,
        lastCastMs: -6000,
        interruptible: false,
        school: 'FIRE',
        range: 360,
        targetKind: 'AOE',
        description: 'P1 甲板火焰落点',
        execute: (boss, engine) => {
          if (ai.blackhornPhase === 'landed') return;
          const fri = living(engine);
          const t = pickWeightedBossTarget(fri);
          const pos = t?.position || { x: 400, y: 220 };
          engine.effectsManager?.addGroundEffect({
            kind: 'DAMAGE_ZONE',
            spellId: 'blackhorn_deck_fire',
            ownerId: boss.id,
            x: pos.x,
            y: pos.y,
            radius: 50,
            colorHex: '#F97316',
            remainingMs: 8000,
            tickIntervalMs: 1000,
            tickValue: 9000,
          });
        },
      },
      {
        id: 'twilight_onslaught',
        name: '暮光猛攻',
        castTimeMs: 2000,
        cooldownMs: 22_000,
        lastCastMs: -8000,
        interruptible: false,
        school: 'SHADOW',
        range: 400,
        targetKind: 'AOE',
        description: 'P1 暮光猛攻落点：须集合分摊伤害，无人/少人分摊将重创或伤舰',
        dbm: {
          advice: '集合分摊暮光弹',
          voiceText: '集合分摊',
          severity: 'CRITICAL',
        },
        execute: (boss, engine) => {
          if (ai.blackhornPhase === 'landed') return;
          const fri = living(engine);
          const t = pickWeightedBossTarget(fri);
          const pos = t?.position || { x: 400, y: 220 };
          const radius = 75;
          ai.blackhornOnslaughtTarget = {
            x: pos.x,
            y: pos.y,
            radius,
            resolveAtFightMs: (ai.blackhornFightMs || 0) + 3000,
          };
          engine.effectsManager?.addGroundEffect({
            kind: 'HEAL_ZONE',
            spellId: 'twilight_onslaught_soak',
            ownerId: boss.id,
            x: pos.x,
            y: pos.y,
            radius,
            colorHex: '#A855F7',
            remainingMs: 3000,
          });
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '🟣 暮光猛攻落点！集合分摊！',
            category: 'CRIT',
            isCrit: true,
          });
        },
      },
      {
        id: 'shockwave',
        name: '冲击波',
        castTimeMs: 3000,
        cooldownMs: 18_000,
        lastCastMs: -100_000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 200,
        targetKind: 'AOE',
        description: 'P2 着陆后锥形冲击（简化为近距重创）',
        execute: (boss, engine) => {
          if (ai.blackhornPhase !== 'landed') return;
          const bPos = boss.position || { x: 500, y: 200 };
          for (const u of living(engine)) {
            const d = Math.hypot(
              (u.position?.x || 0) - bPos.x,
              (u.position?.y || 0) - bPos.y,
            );
            if (d <= 120) {
              engine.dealDamage(boss, u, 40_000, 'PHYSICAL', true, '冲击波');
            }
          }
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '💥 冲击波！远离正面！',
            category: 'CRIT',
            isCrit: true,
          });
        },
      },
      {
        id: 'devastate',
        name: '毁灭打击',
        castTimeMs: 0,
        cooldownMs: 10_000,
        lastCastMs: -100_000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 80,
        targetKind: 'MELEE_TARGET',
        description: 'P2 坦打',
        execute: (boss, engine) => {
          if (ai.blackhornPhase !== 'landed') return;
          const tank = living(engine).find(u => u.role === 'TANK');
          if (tank) engine.dealDamage(boss, tank, 38_000, 'PHYSICAL', false, '毁灭打击');
        },
      },
    ];
  },

  onTick(deltaMs, boss, engine, bossAiRaw) {
    const ai = bossAiRaw as BlackhornAiState;
    ai.blackhornFightMs = (ai.blackhornFightMs || 0) + deltaMs;
    if (!ai.blackhornPhase) {
      ai.blackhornPhase = 'ship';
      const raid = living(engine).length;
      ai.blackhornShipMaxHp = raid >= 15 ? 1_200_000 : 450_000;
      ai.blackhornShipHp = ai.blackhornShipMaxHp;
      ai.blackhornWave = 0;
      ai.blackhornWaveAcc = 0;
      // P1：Boss 尚未着陆，大幅减伤（用极高吸收表现“不可集火”）
      engine.effectsManager?.addFloatingText({
        targetId: boss.id,
        text: '🚢 P1：守卫天火号！舰船血量归零则失败',
        category: 'STATUS',
        isCrit: true,
      });
    }

    if (ai.blackhornPhase === 'ship') {
      // 结算暮光猛攻分摊落点
      const soak = ai.blackhornOnslaughtTarget;
      if (soak && (ai.blackhornFightMs || 0) >= soak.resolveAtFightMs) {
        ai.blackhornOnslaughtTarget = undefined;
        const fri = living(engine);
        const is20Man = fri.length >= 15;
        const soakers = fri.filter(
          u => Math.hypot((u.position?.x || 0) - soak.x, (u.position?.y || 0) - soak.y) <= soak.radius,
        );
        if (soakers.length === 0) {
          // 无人分摊：重创天火号并全团溅射
          const shipDmg = is20Man ? 200_000 : 110_000;
          ai.blackhornShipHp = Math.max(0, (ai.blackhornShipHp || 0) - shipDmg);
          for (const u of fri) {
            engine.dealDamage(boss, u, 55_000, 'SHADOW', true, '暮光猛攻(无人分摊)');
          }
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '💥 暮光猛攻无人分摊！舰船重创！',
            category: 'CRIT',
            isCrit: true,
          });
        } else {
          const totalPool = is20Man ? 240_000 : 120_000;
          const each = Math.max(1, Math.round(totalPool / soakers.length));
          for (const u of soakers) {
            engine.dealDamage(boss, u, each, 'SHADOW', soakers.length === 1, '暮光猛攻分摊');
          }
          const baseShipDmg = is20Man ? 80_000 : 45_000;
          const shipDmg = Math.max(10_000, Math.round(baseShipDmg / Math.max(1, soakers.length * 0.6)));
          ai.blackhornShipHp = Math.max(0, (ai.blackhornShipHp || 0) - shipDmg);
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: `🟣 暮光猛攻 ${soakers.length} 人分摊 (舰船 ${(ai.blackhornShipHp || 0).toLocaleString()})`,
            category: 'STATUS',
            isCrit: soakers.length === 1,
          });
        }
      }

      ai.blackhornWaveAcc = (ai.blackhornWaveAcc || 0) + deltaMs;
      if ((ai.blackhornWaveAcc || 0) >= 18_000) {
        ai.blackhornWaveAcc = 0;
        ai.blackhornWave = (ai.blackhornWave || 0) + 1;
        const bPos = boss.position || { x: 500, y: 200 };
        const hpScale = living(engine).length >= 15 ? 1 : 0.35;
        spawnCombatUnit(engine, {
          id: `drake_${Date.now()}`,
          name: '暮光龙',
          unitKind: 'ADD',
          role: 'ENEMY',
          classId: 'NPC',
          hp: Math.round(120_000 * hpScale),
          maxHp: Math.round(120_000 * hpScale),
          position: { x: bPos.x + 80, y: bPos.y - 60 },
          summonSpellId: SKYFIRE_DRAKE_SUMMON,
        });
        for (let i = 0; i < 2; i++) {
          spawnCombatUnit(engine, {
            id: `assault_${Date.now()}_${i}`,
            name: '龙喉强袭者',
            unitKind: 'ADD',
            role: 'ENEMY',
            classId: 'NPC',
            hp: Math.round(70_000 * hpScale),
            maxHp: Math.round(70_000 * hpScale),
            position: { x: bPos.x - 40 + i * 50, y: bPos.y + 70 },
            summonSpellId: SKYFIRE_ASSAULT_SUMMON,
          });
        }
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
          text: `🐉 第 ${ai.blackhornWave} 波增援！`,
          category: 'STATUS',
          isCrit: true,
        });
      }

      // 存活小怪持续削舰船
      const adds = engine.enemyUnits.filter(
        e =>
          (e.summonSpellId === SKYFIRE_DRAKE_SUMMON || e.summonSpellId === SKYFIRE_ASSAULT_SUMMON) &&
          (e.alive ?? e.isAlive) &&
          (e.hp ?? 0) > 0,
      );
      if (adds.length > 0 && Math.floor((ai.blackhornFightMs || 0) / 1000) !== Math.floor(((ai.blackhornFightMs || 0) - deltaMs) / 1000)) {
        ai.blackhornShipHp = Math.max(0, (ai.blackhornShipHp || 0) - adds.length * 4000);
      }

      if ((ai.blackhornShipHp || 0) <= 0) {
        for (const u of living(engine)) {
          engine.dealDamage(boss, u, 999_999, 'FIRE', true, '舰船坠毁');
        }
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
          text: '💀 天火号坠毁！灭团！',
          category: 'CRIT',
          isCrit: true,
        });
        ai.blackhornPhase = 'landed'; // stop ship logic
        return;
      }

      // 约 90s 或 4 波后着陆
      if ((ai.blackhornFightMs || 0) >= 90_000 || (ai.blackhornWave || 0) >= 4) {
        ai.blackhornPhase = 'landed';
        // 清场小怪
        for (const e of engine.enemyUnits) {
          if (e.summonSpellId === SKYFIRE_DRAKE_SUMMON || e.summonSpellId === SKYFIRE_ASSAULT_SUMMON) {
            e.hp = 0;
            e.alive = false;
            e.isAlive = false;
          }
        }
        // 解锁 P2 技能 CD
        for (const s of ai.skills || []) {
          if (s.id === 'shockwave' || s.id === 'devastate') s.lastCastMs = -999_999;
          if (s.id === 'deck_fire' || s.id === 'twilight_onslaught') s.lastCastMs = engine.nowMs;
        }
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
          text: '⚔️ 黑角着陆！P2 开始！',
          category: 'CRIT',
          isCrit: true,
        });
      }
    }
  },

  isActionLocked(bossAi: any) {
    // P1 仍可放甲板/猛攻；不锁
    return false;
  },
};
