import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import type { CombatEngine } from '../../engine/CombatEngine.js';
import type { Unit } from '../../types.js';
import { spawnCombatUnit } from '../../engine/UnitSpawn.js';

export type ZanzilElixir = 'frost' | 'fire' | 'toxic';
export const ZANZILI_ZOMBIE_SUMMON = 'zanzil_zanzili_zombie';
export const GURUBASHI_BERSERKER_SUMMON = 'zanzil_gurubashi_berserker';

export const CAULDRON_BUFF: Record<ZanzilElixir, string> = {
  frost: 'zanzil_cauldron_frost',
  fire: 'zanzil_cauldron_fire',
  toxic: 'zanzil_cauldron_toxic',
};

export type ZanzilAiState = {
  zanzilFightMs?: number;
  zanzilNextElixir?: ZanzilElixir;
  zanzilElixirAcc?: number;
  zanzilActiveElixir?: ZanzilElixir;
  zanzilElixirLeftMs?: number;
  zanzilPotsSeeded?: boolean;
  skills?: BossSkill[];
};

function living(engine: CombatEngine): Unit[] {
  return engine.friendlyUnits.filter(u => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

/** 玩家/AI 饮用对应大锅（测试与 UI 可调） */
export function drinkZanzilCauldron(engine: CombatEngine, unit: Unit, kind: ZanzilElixir) {
  const spellId = CAULDRON_BUFF[kind];
  unit.buffs = (unit.buffs || []).filter(
    b =>
      b.spellId !== CAULDRON_BUFF.frost &&
      b.spellId !== CAULDRON_BUFF.fire &&
      b.spellId !== CAULDRON_BUFF.toxic,
  );
  engine.applyBuff(unit, {
    id: `cauldron_${kind}_${Date.now()}_${unit.id}`,
    spellId,
    name:
      kind === 'frost' ? '冰釜抗性' : kind === 'fire' ? '火釜抗性' : '毒釜抗性',
    kind: 'BUFF',
    tags: ['STAT'],
    sourceUnitId: unit.id,
    targetUnitId: unit.id,
    durationMs: 30_000,
    remainingMs: 30_000,
    stacks: 1,
    maxStacks: 1,
  });
}

function hasCorrectCauldron(u: Unit, elixir: ZanzilElixir): boolean {
  return !!u.buffs?.some(b => b.spellId === CAULDRON_BUFF[elixir]);
}

const ELIXIR_ORDER: ZanzilElixir[] = ['frost', 'fire', 'toxic'];
const ELIXIR_LABEL: Record<ZanzilElixir, string> = {
  frost: '冰霜药剂 → 喝冰釜',
  fire: '火焰药剂 → 喝火釜',
  toxic: '剧毒药剂 → 喝毒釜',
};

export const ZanzilEncounter: BossEncounterModule = {
  id: 'zanzil',
  name: '赞吉尔',
  dungeonId: 'zulgurub',
  tier: '5man',

  createSkills(bossAi: any): BossSkill[] {
    const ai = bossAi as ZanzilAiState;
    return [
      {
        id: 'zanzil_strike',
        name: '巫毒打击',
        castTimeMs: 0,
        cooldownMs: 10_000,
        lastCastMs: -3000,
        interruptible: false,
        school: 'SHADOW',
        range: 80,
        targetKind: 'MELEE_TARGET',
        description: '坦打',
        execute: (boss, engine) => {
          const tank = living(engine).find(u => u.role === 'TANK');
          if (tank) engine.dealDamage(boss, tank, 28_000, 'SHADOW', false, '巫毒打击');
        },
      },
      {
        id: 'cast_elixir',
        name: '抛掷药剂',
        castTimeMs: 1500,
        cooldownMs: 20_000,
        lastCastMs: -5_000,
        interruptible: false,
        school: 'NATURE',
        range: 400,
        targetKind: 'AOE',
        description: '按药剂类型饮用对应大锅，否则重伤',
        execute: (boss, engine) => {
          const kind = ai.zanzilNextElixir || 'frost';
          ai.zanzilActiveElixir = kind;
          ai.zanzilElixirLeftMs = 8000;
          // 轮换下一种
          const idx = ELIXIR_ORDER.indexOf(kind);
          ai.zanzilNextElixir = ELIXIR_ORDER[(idx + 1) % ELIXIR_ORDER.length];

          // AI 自动喝对的锅；玩家需自行
          for (const u of living(engine)) {
            if (!u.isPlayer) drinkZanzilCauldron(engine, u, kind);
          }

          // 原版复活药剂：冰霜召唤赞吉利僵尸群，火焰召唤古拉巴什狂战士
          const bPos = boss.position || { x: 500, y: 200 };
          if (kind === 'frost') {
            for (let i = 0; i < 3; i++) {
              spawnCombatUnit(engine, {
                id: `zanzil_zombie_${Date.now()}_${i}`,
                name: `赞吉利僵尸 ${i + 1}`,
                unitKind: 'ADD',
                role: 'ENEMY',
                classId: 'NPC',
                hp: 32_000,
                maxHp: 32_000,
                position: { x: bPos.x - 80 + i * 50, y: bPos.y + 60 },
                summonSpellId: ZANZILI_ZOMBIE_SUMMON,
                despawnAtElapsedMs: (engine.elapsed || 0) + 60_000,
              });
            }
          } else if (kind === 'fire') {
            spawnCombatUnit(engine, {
              id: `zanzil_berserker_${Date.now()}`,
              name: '古拉巴什狂战士',
              unitKind: 'ADD',
              role: 'ENEMY',
              classId: 'NPC',
              hp: 95_000,
              maxHp: 95_000,
              position: { x: bPos.x + 65, y: bPos.y + 45 },
              summonSpellId: GURUBASHI_BERSERKER_SUMMON,
              despawnAtElapsedMs: (engine.elapsed || 0) + 60_000,
            });
          }

          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: `🧪 ${ELIXIR_LABEL[kind]}`,
            category: 'CRIT',
            isCrit: true,
          });
        },
      },
    ];
  },

  onTick(deltaMs, boss, engine, bossAiRaw) {
    const ai = bossAiRaw as ZanzilAiState;
    ai.zanzilFightMs = (ai.zanzilFightMs || 0) + deltaMs;
    if (!ai.zanzilNextElixir) ai.zanzilNextElixir = 'frost';

    // 开战摆三口锅视觉
    if (!ai.zanzilPotsSeeded) {
      ai.zanzilPotsSeeded = true;
      const bPos = boss.position || { x: 500, y: 200 };
      const pots: Array<{ kind: ZanzilElixir; x: number; color: string }> = [
        { kind: 'frost', x: bPos.x - 100, color: '#7DD3FC' },
        { kind: 'fire', x: bPos.x, color: '#F97316' },
        { kind: 'toxic', x: bPos.x + 100, color: '#84CC16' },
      ];
      for (const p of pots) {
        engine.effectsManager?.addGroundEffect({
          kind: 'HEAL_ZONE',
          spellId: `cauldron_marker_${p.kind}`,
          ownerId: boss.id,
          x: p.x,
          y: bPos.y + 100,
          radius: 30,
          colorHex: p.color,
          remainingMs: 999_000,
        });
      }
      engine.effectsManager?.addFloatingText({
        targetId: boss.id,
        text: '🍲 三口大锅就位（冰/火/毒）',
        category: 'STATUS',
        isCrit: false,
      });
    }

    if (ai.zanzilActiveElixir && (ai.zanzilElixirLeftMs || 0) > 0) {
      ai.zanzilElixirLeftMs = Math.max(0, (ai.zanzilElixirLeftMs || 0) - deltaMs);
      const kind = ai.zanzilActiveElixir;
      const school = kind === 'frost' ? 'FROST' : kind === 'fire' ? 'FIRE' : 'NATURE';
      if (Math.floor((ai.zanzilFightMs || 0) / 1000) !== Math.floor(((ai.zanzilFightMs || 0) - deltaMs) / 1000)) {
        for (const u of living(engine)) {
          if (hasCorrectCauldron(u, kind)) continue;
          engine.dealDamage(boss, u, 16_000, school as any, false, '药剂反噬');
        }
      }
      if ((ai.zanzilElixirLeftMs || 0) <= 0) {
        ai.zanzilActiveElixir = undefined;
      }
    }
  },
};
