import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import { spawnCombatUnit } from '../../engine/UnitSpawn.js';

type GodfreyAiState = {
  _barrageResolveAt?: number;
  skills: BossSkill[];
};

/**
 * 影牙城堡 5号尾王：高弗雷勋爵 (Lord Godfrey)
 * 特性机制：
 * - 重伤 (Mortal Wound)：主坦致死打击，降低受疗且叠层最多6层
 * - 诅咒之弹 (Cursed Bullets)：随机2名后排成员强力诅咒与高额DOT，可打断与驱散
 * - 双枪弹幕 (Pistol Barrage)：60°红色扇形危险预警后扫射（引擎时钟，非 setTimeout）
 * - 召唤嗜血食尸鬼：弹幕前薄血小怪，可被弹幕清掉
 */
export const GodfreyEncounter: BossEncounterModule = {
  id: 'godfrey',
  name: '高弗雷勋爵',
  dungeonId: 'shadowfang_keep',
  tier: '5man',

  createSkills(bossAi: any): BossSkill[] {
    const ai = bossAi as GodfreyAiState;
    return [
      {
        id: 'mortal_wound',
        name: '重伤',
        castTimeMs: 0,
        cooldownMs: 15000,
        lastCastMs: -5000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 80,
        targetKind: 'MELEE_TARGET',
        description: '降低主坦受疗叠层',
        execute: (boss, engine) => {
          const tank = engine.friendlyUnits.find(u => u.alive && u.role === 'TANK');
          if (tank) {
            const existing = tank.buffs?.find(b => b.spellId === 'mortal_wound');
            const nextStacks = Math.min(6, (existing?.stacks || 0) + 1);
            if (existing) {
              existing.stacks = nextStacks;
              existing.remainingMs = 20000;
              existing.durationMs = 20000;
            } else {
              engine.applyBuff(tank, {
                id: `debuff_mw_${Date.now()}`,
                spellId: 'mortal_wound',
                name: '重伤',
                kind: 'DEBUFF',
                tags: ['DEBUFF'],
                sourceUnitId: boss.id,
                targetUnitId: tank.id,
                durationMs: 20000,
                remainingMs: 20000,
                stacks: 1,
                maxStacks: 6,
                // stacks drive reduction in CombatEngine.getHealingReceivedMultiplier
              });
            }
          }
        },
      },
      {
        id: 'cursed_bullets',
        name: '诅咒之弹',
        castTimeMs: 2000,
        cooldownMs: 16000,
        lastCastMs: -8000,
        interruptible: true,
        school: 'SHADOW',
        range: 320,
        targetKind: 'RANGED_TARGET',
        description: '强力多目标点名诅咒，造成22,000暗影伤害并附加每3秒6,500高额DOT，可打断与驱散',
        execute: (boss, engine) => {
          const nonTank = engine.friendlyUnits.filter(u => u.alive && u.role !== 'TANK');
          const pool = nonTank.length >= 2 ? nonTank : engine.friendlyUnits.filter(u => u.alive);
          const shuffled = [...pool].sort(() => Math.random() - 0.5);
          const targets = shuffled.slice(0, 2);

          for (const target of targets) {
            engine.dealDamage(boss, target, 22000, 'SHADOW', false, '诅咒之弹');
            engine.applyBuff(target, {
              id: `debuff_cb_${Date.now()}_${target.id}`,
              spellId: 'cursed_bullets',
              name: '诅咒之弹 (DoT)',
              kind: 'DEBUFF',
              tags: ['DOT'],
              sourceUnitId: boss.id,
              targetUnitId: target.id,
              durationMs: 15000,
              remainingMs: 15000,
              stacks: 1,
              maxStacks: 1,
              school: 'SHADOW',
              tickIntervalMs: 3000,
              tickValue: 6500,
            });
          }
        },
      },
      {
        id: 'summon_ghouls',
        name: '召唤嗜血食尸鬼',
        castTimeMs: 1500,
        cooldownMs: 30000,
        lastCastMs: -5000,
        interruptible: false,
        school: 'SHADOW',
        range: 320,
        targetKind: 'AOE',
        description: '召唤多只薄血嗜血食尸鬼；可用双枪弹幕清场',
        execute: (boss, engine) => {
          const bPos = boss.position || { x: 530, y: 200 };
          for (let i = 0; i < 4; i++) {
            spawnCombatUnit(engine, {
              id: `sfk_ghoul_${engine.nowMs}_${i}`,
              name: '嗜血食尸鬼',
              unitKind: 'ADD',
              role: 'ENEMY',
              classId: 'NPC',
              hp: 18_000,
              maxHp: 18_000,
              position: {
                x: bPos.x + (i - 1.5) * 28,
                y: bPos.y + 35 + (i % 2) * 16,
              },
              summonSpellId: 'bloodthirsty_ghoul',
              despawnAtElapsedMs: (engine.elapsed || 0) + 60_000,
            });
          }
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '🧟 嗜血食尸鬼出现！',
            category: 'STATUS',
            isCrit: true,
          });
        },
      },
      {
        id: 'pistol_barrage',
        name: '双枪弹幕',
        castTimeMs: 1500,
        cooldownMs: 32000,
        lastCastMs: -15000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 320,
        targetKind: 'RANGED_TARGET',
        description: '60°红色扇形预警后扫射；扇形内重伤，流弹波及全场；可清食尸鬼',
        execute: (boss, engine) => {
          const bPos = boss.position || { x: 530, y: 200 };
          const tank = engine.friendlyUnits.find(u => (u.alive ?? u.isAlive) && u.role === 'TANK');
          const tPos = tank?.position || { x: bPos.x - 80, y: bPos.y };
          const facing = Math.atan2(tPos.y - bPos.y, tPos.x - bPos.x);
          engine.effectsManager?.addGroundEffect({
            kind: 'CONE_WARNING',
            spellId: 'pistol_barrage',
            ownerId: boss.id,
            x: bPos.x,
            y: bPos.y,
            radius: 130,
            colorHex: '#EF4444',
            remainingMs: 3000,
            facingRad: facing,
            coneAngleRad: Math.PI / 3, // 60°
          });
          ai._barrageResolveAt = engine.nowMs + 3000;
        },
      },
    ];
  },

  onTick(_deltaMs, boss, engine, bossAiRaw) {
    const ai = bossAiRaw as GodfreyAiState;
    if (ai._barrageResolveAt == null || engine.nowMs < ai._barrageResolveAt) return;
    ai._barrageResolveAt = undefined;
    if (!boss.alive || !boss.isAlive || boss.hp <= 0) return;

    for (const u of engine.friendlyUnits) {
      if (!(u.alive && u.isAlive)) continue;
      const isInCone = engine.effectsManager?.isPositionInHazard?.(u.position);
      if (isInCone) {
        engine.dealDamage(boss, u, 32000, 'PHYSICAL', true, '双枪弹幕');
      } else {
        engine.dealDamage(boss, u, 11000, 'PHYSICAL', false, '弹幕流弹飞溅');
      }
    }
    // Barrage also shreds bloodthirsty ghouls in the room (Bullet Time fantasy)
    for (const e of engine.enemyUnits) {
      if (!(e.isAlive ?? e.alive)) continue;
      if (e.summonSpellId !== 'bloodthirsty_ghoul') continue;
      engine.dealDamage(boss, e, 50_000, 'PHYSICAL', true, '双枪弹幕');
    }
  },
};
