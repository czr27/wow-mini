import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import type { CombatEngine } from '../../engine/CombatEngine.js';
import type { Unit } from '../../types.js';

export const CRUSH_ARMOR_SPELL_ID = 'crush_armor';
export const RESONATING_CRYSTAL_SPELL_ID = 'resonating_crystal';
export const RESONATING_CRYSTAL_LINK_ID = 'resonating_crystal_link';
export const MORCHOK_PILLAR_SPELL_ID = 'morchok_pillar';

export type MorchokCrystal = {
  x: number;
  y: number;
  linkedIds: string[];
  explodeAtFightMs: number;
};

export type MorchokAiState = {
  morchokFightMs?: number;
  morchokPhase?: 'main' | 'black_blood';
  morchokPhaseAcc?: number;
  morchokPillars?: Array<{ x: number; y: number; radius: number }>;
  morchokBloodTickAcc?: number;
  morchokCrystals?: MorchokCrystal[];
  morchokFurious?: boolean;
  skills?: BossSkill[];
  currentCasting?: { skill: BossSkill; elapsedMs: number } | null;
};

function livingFriendlies(engine: CombatEngine): Unit[] {
  return engine.friendlyUnits.filter(u => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0));
}

function furiousMult(ai: MorchokAiState): number {
  return ai.morchokFurious ? 1.5 : 1;
}

/** 践踏：近距分摊；最近目标吃双份 */
export function resolveStompDamage(
  boss: Unit,
  living: Unit[],
  totalPool: number,
): Map<string, number> {
  const result = new Map<string, number>();
  if (living.length === 0) return result;
  const bPos = boss.position || { x: 500, y: 200 };
  // 近距：距 Boss ≤ 90px 参与分摊；若无人则全团分摊（容错）
  let near = living.filter(u => dist(u.position || { x: 0, y: 0 }, bPos) <= 90);
  if (near.length === 0) near = [...living];

  const sorted = [...near].sort(
    (a, b) => dist(a.position || { x: 0, y: 0 }, bPos) - dist(b.position || { x: 0, y: 0 }, bPos),
  );
  const closestId = sorted[0]?.id;

  // 份额：每人 1，最近目标额外 +1（双份）
  let shares = 0;
  const shareOf = new Map<string, number>();
  for (const u of near) {
    const s = u.id === closestId ? 2 : 1;
    shareOf.set(u.id, s);
    shares += s;
  }
  for (const u of near) {
    const s = shareOf.get(u.id) || 1;
    result.set(u.id, Math.max(1, Math.round((totalPool * s) / shares)));
  }
  return result;
}

/** 水晶爆炸：距离越近伤害越低（蓝好红差） */
export function crystalExplosionDamage(distancePx: number, baseFar = 36_000): number {
  // 0px → ~15% base；≥120px → full base
  const t = Math.min(1, Math.max(0, distancePx / 120));
  const mult = 0.15 + 0.85 * t;
  return Math.max(1, Math.round(baseFar * mult));
}

function isBehindPillar(
  u: Unit,
  pillars: Array<{ x: number; y: number; radius: number }>,
): boolean {
  const p = u.position || { x: 0, y: 0 };
  return pillars.some(pillar => dist(p, pillar) <= pillar.radius);
}

/**
 * 巨龙之魂 1号：莫卓克 (Morchok)
 * - 大地践踏：近距分摊，最近目标双份
 * - 共鸣水晶：连线若干人，12s 后按距离爆炸
 * - 击碎护甲：叠层换坦
 * - 黑血间歇：碎石柱安全区，未躲柱持续掉血
 * - ≤20% Furious 增伤
 */
export const MorchokEncounter: BossEncounterModule = {
  id: 'morchok',
  name: '莫卓克',
  dungeonId: 'dragon_soul',
  tier: '20man',

  createSkills(bossAi: any): BossSkill[] {
    const ai = bossAi as MorchokAiState;
    return [
      {
        id: 'stomp',
        name: '大地践踏',
        castTimeMs: 2500,
        cooldownMs: 12_000,
        lastCastMs: -6000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 250,
        targetKind: 'AOE',
        description: '近距分摊物理践踏；最近目标承受双份伤害',
        dbm: {
          advice: '近距分摊，最近目标双倍伤害',
          voiceText: '近距分摊',
          severity: 'WARN',
          roleHint: 'ALL',
          preWarnMs: 0,
        },
        execute: (boss, engine) => {
          if (ai.morchokPhase === 'black_blood') return;
          const living = livingFriendlies(engine);
          const pool = Math.round((living.length >= 15 ? 160_000 : 70_000) * furiousMult(ai));
          const dmgMap = resolveStompDamage(boss, living, pool);
          for (const u of living) {
            const amt = dmgMap.get(u.id);
            if (amt) engine.dealDamage(boss, u, amt, 'PHYSICAL', false, '大地践踏');
          }
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '💥 大地践踏！近距分摊！',
            category: 'CRIT',
            isCrit: true,
          });
        },
      },
      {
        id: 'resonating_crystal',
        name: '共鸣水晶',
        castTimeMs: 1500,
        cooldownMs: 20_000,
        lastCastMs: -8000,
        interruptible: false,
        school: 'NATURE',
        range: 360,
        targetKind: 'AOE',
        description: '连线最近若干人，12s 后爆炸；贴水晶伤害更低',
        dbm: {
          advice: '靠近共鸣水晶减伤',
          voiceText: '靠近水晶',
          severity: 'WARN',
        },
        execute: (boss, engine) => {
          if (ai.morchokPhase === 'black_blood') return;
          const living = livingFriendlies(engine);
          if (living.length === 0) return;
          // 落在偏远程位置
          const ranged =
            living.find(u => u.role === 'HEALER' || u.role === 'DPS') || living[living.length - 1];
          const cx = (ranged.position?.x ?? 300) + 40;
          const cy = (ranged.position?.y ?? 220) - 20;
          const linkCount = living.length >= 15 ? 7 : Math.min(3, living.length);
          const sorted = [...living].sort(
            (a, b) =>
              dist(a.position || { x: 0, y: 0 }, { x: cx, y: cy }) -
              dist(b.position || { x: 0, y: 0 }, { x: cx, y: cy }),
          );
          const linked = sorted.slice(0, linkCount).map(u => u.id);
          if (!ai.morchokCrystals) ai.morchokCrystals = [];
          ai.morchokCrystals.push({
            x: cx,
            y: cy,
            linkedIds: linked,
            explodeAtFightMs: (ai.morchokFightMs || 0) + 12_000,
          });
          engine.effectsManager?.addGroundEffect({
            kind: 'DAMAGE_ZONE',
            spellId: RESONATING_CRYSTAL_SPELL_ID,
            ownerId: boss.id,
            x: cx,
            y: cy,
            radius: 28,
            colorHex: '#60A5FA',
            remainingMs: 12_000,
          });
          for (const id of linked) {
            const targetUnit = living.find(x => x.id === id);
            if (targetUnit) {
              engine.applyBuff(targetUnit, {
                id: `rc_link_${Date.now()}_${id}`,
                spellId: RESONATING_CRYSTAL_LINK_ID,
                name: '共鸣水晶连线',
                kind: 'DEBUFF',
                tags: ['DEBUFF'],
                sourceUnitId: boss.id,
                targetUnitId: id,
                durationMs: 12_000,
                remainingMs: 12_000,
                stacks: 1,
                maxStacks: 1,
                school: 'NATURE',
              });
            }
            engine.effectsManager?.addFloatingText({
              targetId: id,
              text: '💎 共鸣水晶连线！靠近吸收！',
              category: 'STATUS',
              isCrit: false,
            });
          }
        },
      },
      {
        id: 'crush_armor',
        name: '击碎护甲',
        castTimeMs: 0,
        cooldownMs: 12_000,
        lastCastMs: -4000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 80,
        targetKind: 'MELEE_TARGET',
        description: '击碎主坦护甲叠层（约 2–3 层换坦），并造成物理重击',
        execute: (boss, engine) => {
          if (ai.morchokPhase === 'black_blood') return;
          const tank = livingFriendlies(engine).find(u => u.role === 'TANK');
          if (!tank) return;
          const existing = tank.buffs?.find(b => b.spellId === CRUSH_ARMOR_SPELL_ID);
          const nextStacks = Math.min(10, (existing?.stacks || 0) + 1);
          if (existing) {
            existing.stacks = nextStacks;
            existing.remainingMs = 30_000;
            existing.durationMs = 30_000;
          } else {
            engine.applyBuff(tank, {
              id: `crush_armor_${Date.now()}`,
              spellId: CRUSH_ARMOR_SPELL_ID,
              name: '击碎护甲',
              kind: 'DEBUFF',
              tags: ['DEBUFF'],
              sourceUnitId: boss.id,
              targetUnitId: tank.id,
              durationMs: 30_000,
              remainingMs: 30_000,
              stacks: 1,
              maxStacks: 10,
              school: 'PHYSICAL',
              // 每层约 -10% 护甲（表现 + 后续物理增伤用 stacks）
              statModifiers: { armor: -0.1 },
            });
          }
          const stacks = tank.buffs?.find(b => b.spellId === CRUSH_ARMOR_SPELL_ID)?.stacks || 1;
          const base = Math.round(38_000 * furiousMult(ai) * (1 + 0.1 * (stacks - 1)));
          engine.dealDamage(boss, tank, base, 'PHYSICAL', false, '击碎护甲');
          if (stacks >= 3) {
            engine.effectsManager?.addFloatingText({
              targetId: tank.id,
              text: `🛡️ 击碎护甲 ${stacks} 层！换坦！`,
              category: 'STATUS',
              isCrit: true,
            });
          }
        },
      },
      {
        id: 'black_blood',
        name: '大地黑血沸腾',
        castTimeMs: 2000,
        cooldownMs: 55_000,
        lastCastMs: -40_000,
        interruptible: false,
        school: 'SHADOW',
        range: 360,
        targetKind: 'AOE',
        description: '间歇阶段：生成碎石柱，黑血期间须躲柱后，否则持续重伤',
        dbm: {
          advice: '黑血阶段，躲到碎石柱后方',
          voiceText: '躲柱子后',
          severity: 'CRITICAL',
          roleHint: 'ALL',
          preWarnMs: 0,
        },
        execute: (boss, engine) => {
          // 进入黑血阶段 ~12s
          ai.morchokPhase = 'black_blood';
          ai.morchokPhaseAcc = 12_000;
          ai.morchokBloodTickAcc = 0;
          const bPos = boss.position || { x: 500, y: 200 };
          ai.morchokPillars = [
            { x: bPos.x - 120, y: bPos.y + 40, radius: 55 },
            { x: bPos.x + 100, y: bPos.y - 50, radius: 55 },
            { x: bPos.x - 30, y: bPos.y + 130, radius: 55 },
          ];
          for (const p of ai.morchokPillars) {
            engine.effectsManager?.addGroundEffect({
              kind: 'HEAL_ZONE',
              spellId: MORCHOK_PILLAR_SPELL_ID,
              ownerId: boss.id,
              x: p.x,
              y: p.y,
              radius: p.radius,
              colorHex: '#A8A29E',
              remainingMs: 12_000,
            });
          }
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '🩸 大地黑血！躲到碎石柱后！',
            category: 'CRIT',
            isCrit: true,
          });
        },
      },
    ];
  },

  onTick(deltaMs, boss, engine, bossAiRaw) {
    const ai = bossAiRaw as MorchokAiState;
    ai.morchokFightMs = (ai.morchokFightMs || 0) + deltaMs;
    if (!ai.morchokPhase) ai.morchokPhase = 'main';
    if (!ai.morchokCrystals) ai.morchokCrystals = [];

    // ≤20% Furious
    if (!ai.morchokFurious && boss.maxHp > 0 && boss.hp / boss.maxHp <= 0.2) {
      ai.morchokFurious = true;
      for (const s of ai.skills || []) {
        if (s.id === 'stomp' || s.id === 'crush_armor') {
          s.cooldownMs = Math.round(s.cooldownMs * 0.75);
        }
      }
      engine.effectsManager?.addFloatingText({
        targetId: boss.id,
        text: '💢 莫卓克激怒！伤害与节奏提升！',
        category: 'CRIT',
        isCrit: true,
      });
    }

    // 共鸣水晶：连线 AI 主动靠近吸收 + 到期爆炸
    const fightMs = ai.morchokFightMs || 0;
    const living = livingFriendlies(engine);
    const pending: MorchokCrystal[] = [];
    for (const c of ai.morchokCrystals) {
      if (fightMs < c.explodeAtFightMs) {
        // AI 队友被点名共鸣水晶连线时主动向水晶移动
        for (const id of c.linkedIds) {
          const u = living.find(x => x.id === id);
          if (!u || u.isPlayer || u.isHumanControlled || !u.position) continue;
          const dx = c.x - u.position.x;
          const dy = c.y - u.position.y;
          const d = Math.hypot(dx, dy);
          if (d > 22) {
            const step = Math.min(d - 22, (115 * Math.max(0, deltaMs)) / 1000);
            u.position = {
              x: u.position.x + (dx / d) * step,
              y: u.position.y + (dy / d) * step,
            };
          }
        }
        pending.push(c);
        continue;
      }
      for (const id of c.linkedIds) {
        const u = living.find(x => x.id === id);
        if (!u) continue;
        u.buffs = (u.buffs || []).filter(b => b.spellId !== RESONATING_CRYSTAL_LINK_ID);
        const d = dist(u.position || { x: 0, y: 0 }, c);
        const baseFar = Math.round(
          Math.max(living.length >= 15 ? 95_000 : 75_000, (u.maxHp || 100_000) * 0.85) * furiousMult(ai)
        );
        const amt = crystalExplosionDamage(d, baseFar);
        engine.dealDamage(boss, u, amt, 'NATURE', d > 60, '共鸣水晶');
        engine.effectsManager?.addFloatingText({
          targetId: u.id,
          text: d <= 40 ? '💎 近距吸收（低伤）' : '💎 过远！高伤',
          category: 'STATUS',
          isCrit: d > 40,
        });
      }
    }
    ai.morchokCrystals = pending;

    // 黑血阶段：未躲柱持续掉血
    if (ai.morchokPhase === 'black_blood') {
      ai.morchokPhaseAcc = Math.max(0, (ai.morchokPhaseAcc || 0) - deltaMs);
      ai.morchokBloodTickAcc = (ai.morchokBloodTickAcc || 0) + deltaMs;
      const pillars = ai.morchokPillars || [];
      while ((ai.morchokBloodTickAcc || 0) >= 1000) {
        ai.morchokBloodTickAcc! -= 1000;
        const tickDmg = Math.round(32_000 * furiousMult(ai));
        for (const u of livingFriendlies(engine)) {
          if (isBehindPillar(u, pillars)) continue;
          engine.dealDamage(boss, u, tickDmg, 'SHADOW', true, '大地黑血(未躲柱子)');
        }
      }
      if ((ai.morchokPhaseAcc || 0) <= 0) {
        ai.morchokPhase = 'main';
        ai.morchokPillars = [];
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
          text: '黑血消退，继续输出！',
          category: 'STATUS',
          isCrit: false,
        });
      }
    }
  },

  isActionLocked(bossAi: any): boolean {
    return (bossAi as MorchokAiState).morchokPhase === 'black_blood';
  },
};
