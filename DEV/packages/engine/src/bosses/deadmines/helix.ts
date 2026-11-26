import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import type { CombatEngine } from '../../engine/CombatEngine.js';
import type { Unit } from '../../types.js';
import { spawnCombatUnit } from '../../engine/UnitSpawn.js';
import { pickWeightedBossTarget } from '../core/BossTargetPicker.js';

export const OAF_SUMMON = 'helix_lumbering_oaf';

export type HelixAiState = {
  helixFightMs?: number;
  helixPhase?: 'oaf' | 'leap';
  helixLeapAcc?: number;
  helixBombAcc?: number;
  helixMountedId?: string;
  skills?: BossSkill[];
};

function living(engine: CombatEngine): Unit[] {
  return engine.friendlyUnits.filter(u => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

export const HelixEncounter: BossEncounterModule = {
  id: 'helix',
  name: '赫利克斯·碎轮',
  dungeonId: 'deadmines',
  tier: '5man',

  createSkills(bossAi: any): BossSkill[] {
    const ai = bossAi as HelixAiState;
    return [
      {
        id: 'sticky_bomb',
        name: '粘性炸弹',
        castTimeMs: 1000,
        cooldownMs: 10_000,
        lastCastMs: -2000,
        interruptible: false,
        school: 'FIRE',
        range: 320,
        targetKind: 'AOE',
        description: '脚下铺粘性炸弹，定时爆炸',
        execute: (boss, engine) => {
          const fri = living(engine);
          const t = pickWeightedBossTarget(fri);
          const pos = t?.position || { x: 400, y: 220 };
          engine.effectsManager?.addGroundEffect({
            kind: 'DAMAGE_ZONE',
            spellId: 'sticky_bomb',
            ownerId: boss.id,
            x: pos.x,
            y: pos.y,
            radius: 40,
            colorHex: '#FACC15',
            remainingMs: 4000,
            tickIntervalMs: 4000,
            tickValue: 22_000,
          });
        },
      },
      {
        id: 'chest_bomb',
        name: '胸弹',
        castTimeMs: 1500,
        cooldownMs: 16_000,
        lastCastMs: -8000,
        interruptible: false,
        school: 'FIRE',
        range: 320,
        targetKind: 'RANGED_TARGET',
        description: '点名胸弹：靠近队友则全团击飞伤',
        dbm: {
          advice: '点名炸弹，注意分散',
          voiceText: '注意分散',
          severity: 'WARN',
        },
        execute: (boss, engine) => {
          const pool = living(engine).filter(u => u.role !== 'TANK');
          const t = pickWeightedBossTarget(pool) || pickWeightedBossTarget(living(engine));
          if (!t) return;
          engine.applyBuff(t, {
            id: `chest_bomb_${Date.now()}`,
            spellId: 'chest_bomb',
            name: '胸弹',
            kind: 'DEBUFF',
            tags: ['DEBUFF'],
            sourceUnitId: boss.id,
            targetUnitId: t.id,
            durationMs: 5000,
            remainingMs: 5000,
            stacks: 1,
            maxStacks: 1,
            school: 'FIRE',
          });
          engine.effectsManager?.addFloatingText({
            targetId: t.id,
            text: '💣 胸弹！远离队友！',
            category: 'CRIT',
            isCrit: true,
          });
        },
      },
      {
        id: 'oaf_smash',
        name: '木虱砸击',
        castTimeMs: 2000,
        cooldownMs: 14_000,
        lastCastMs: -4000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 120,
        targetKind: 'RANGED_TARGET',
        description: 'P1 木虱抓人砸墙',
        execute: (boss, engine) => {
          if (ai.helixPhase === 'leap') return;
          const pool = living(engine);
          const t = pickWeightedBossTarget(pool);
          if (t) engine.dealDamage(boss, t, 30_000, 'PHYSICAL', true, '木虱砸击');
        },
      },
    ];
  },

  onTick(deltaMs, boss, engine, bossAiRaw) {
    const ai = bossAiRaw as HelixAiState;
    ai.helixFightMs = (ai.helixFightMs || 0) + deltaMs;

    if (!ai.helixPhase) {
      ai.helixPhase = 'oaf';
      const bPos = boss.position || { x: 500, y: 200 };
      spawnCombatUnit(engine, {
        id: `oaf_${Date.now()}`,
        name: '笨拙木虱',
        unitKind: 'ADD',
        role: 'ENEMY',
        classId: 'NPC',
        hp: 180_000,
        maxHp: 180_000,
        position: { x: bPos.x + 40, y: bPos.y },
        summonSpellId: OAF_SUMMON,
      });
      engine.effectsManager?.addFloatingText({
        targetId: boss.id,
        text: '🪲 先击杀笨拙木虱！',
        category: 'STATUS',
        isCrit: true,
      });
    }

    // 胸弹爆炸：若附近有队友则打团
    for (const u of living(engine)) {
      const bomb = u.buffs?.find(b => b.spellId === 'chest_bomb');
      if (!bomb) continue;
      if ((bomb.remainingMs || 0) > 200) continue;
      // 即将到期 — 用 fight 计时不太准；改：每 tick 检查附近
    }
    ai.helixBombAcc = (ai.helixBombAcc || 0) + deltaMs;
    if ((ai.helixBombAcc || 0) >= 500) {
      ai.helixBombAcc = 0;
      for (const u of living(engine)) {
        const bomb = u.buffs?.find(b => b.spellId === 'chest_bomb');
        if (!bomb) continue;
        let nearAlly = false;
        for (const o of living(engine)) {
          if (o.id === u.id) continue;
          const d = Math.hypot(
            (o.position?.x || 0) - (u.position?.x || 0),
            (o.position?.y || 0) - (u.position?.y || 0),
          );
          if (d < 55) {
            nearAlly = true;
            break;
          }
        }
        if (nearAlly && (bomb.remainingMs || 0) <= 1000) {
          for (const o of living(engine)) {
            engine.dealDamage(boss, o, 42_000, 'FIRE', true, '胸弹爆炸(未分散)');
          }
          engine.auraManager.removeBuff(u, 'chest_bomb');
          engine.effectsManager?.addFloatingText({
            targetId: u.id,
            text: '💥 胸弹波及全团！',
            category: 'CRIT',
            isCrit: true,
          });
        }
      }
    }

    const oafAlive = engine.enemyUnits.some(
      e => e.summonSpellId === OAF_SUMMON && (e.alive ?? e.isAlive) && (e.hp ?? 0) > 0,
    );
    if (ai.helixPhase === 'oaf' && !oafAlive) {
      ai.helixPhase = 'leap';
      engine.effectsManager?.addFloatingText({
        targetId: boss.id,
        text: '👺 赫利克斯跳背阶段！',
        category: 'CRIT',
        isCrit: true,
      });
    }

    if (ai.helixPhase === 'leap') {
      ai.helixLeapAcc = (ai.helixLeapAcc || 0) + deltaMs;
      if ((ai.helixLeapAcc || 0) >= 10_000) {
        ai.helixLeapAcc = 0;
        // 清除旧骑乘
        for (const u of living(engine)) {
          u.buffs = (u.buffs || []).filter(b => b.spellId !== 'helix_leap');
        }
        const pool = living(engine);
        const t = pickWeightedBossTarget(pool);
        if (!t) return;
        ai.helixMountedId = t.id;
        engine.applyBuff(t, {
          id: `leap_${Date.now()}`,
          spellId: 'helix_leap',
          name: '赫利克斯骑乘',
          kind: 'DEBUFF',
          tags: ['DEBUFF'],
          sourceUnitId: boss.id,
          targetUnitId: t.id,
          durationMs: 9000,
          remainingMs: 9000,
          stacks: 1,
          maxStacks: 1,
          school: 'PHYSICAL',
          tickIntervalMs: 1000,
          tickValue: 8000,
        });
        engine.effectsManager?.addFloatingText({
          targetId: t.id,
          text: '⬆️ 被骑乘！注意抬血！',
          category: 'STATUS',
          isCrit: true,
        });
      }
    }
  },
};
