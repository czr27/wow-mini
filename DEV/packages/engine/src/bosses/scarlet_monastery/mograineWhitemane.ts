import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import { spawnCombatUnit } from '../../engine/UnitSpawn.js';
import { pickWeightedBossTarget } from '../core/BossTargetPicker.js';

export const WHITEMANE_SUMMON = 'whitemane';
export const MOGRAINE_FAKE_DEATH_HP = 0.01;

export type MograineWhitemaneAiState = {
  mwFightMs?: number;
  mwPhase?: 'mograine' | 'whitemane_cast' | 'duo';
  mwFakeDeath?: boolean;
  skills?: BossSkill[];
  currentCasting?: { skill: BossSkill; elapsedMs: number } | null;
};

function living(engine: any) {
  return engine.friendlyUnits.filter((u: any) => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

function getWhitemane(engine: any) {
  return engine.enemyUnits.find(
    (e: any) => e.summonSpellId === WHITEMANE_SUMMON && (e.alive ?? e.isAlive) && (e.hp ?? 0) > 0,
  );
}

export const MograineWhitemaneEncounter: BossEncounterModule = {
  id: 'mograine_whitemane',
  name: '莫格莱尼与怀特迈恩',
  dungeonId: 'scarlet_monastery',
  tier: '5man',

  createSkills(bossAi: any): BossSkill[] {
    const ai = bossAi as MograineWhitemaneAiState;
    return [
      {
        id: 'crusader_strike',
        name: '十字军打击',
        castTimeMs: 0,
        cooldownMs: 8000,
        lastCastMs: -2000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 80,
        targetKind: 'MELEE_TARGET',
        description: '莫格莱尼坦打',
        execute: (boss, engine) => {
          if (ai.mwPhase === 'whitemane_cast') return;
          const tank = living(engine).find((u: any) => u.role === 'TANK');
          if (tank) engine.dealDamage(boss, tank, 28_000, 'PHYSICAL', false, '十字军打击');
        },
      },
      {
        id: 'hammer_of_justice',
        name: '制裁之锤',
        castTimeMs: 0,
        cooldownMs: 20_000,
        lastCastMs: -10_000,
        interruptible: false,
        school: 'PHYSICAL',
        range: 120,
        targetKind: 'RANGED_TARGET',
        description: '晕眩随机目标',
        execute: (boss, engine) => {
          if (ai.mwPhase === 'whitemane_cast') return;
          const pool = living(engine);
          const t = pickWeightedBossTarget(pool);
          if (!t) return;
          engine.applyBuff(t, {
            id: `hoj_${Date.now()}`,
            spellId: 'hammer_of_justice',
            name: '制裁之锤',
            kind: 'DEBUFF',
            tags: ['STUN', 'DEBUFF'],
            moveSpeedMod: 0,
            sourceUnitId: boss.id,
            targetUnitId: t.id,
            durationMs: 3000,
            remainingMs: 3000,
            stacks: 1,
            maxStacks: 1,
          });
        },
      },
      {
        id: 'whitemane_resurrection',
        name: '怀特迈恩·复活',
        castTimeMs: 5000,
        cooldownMs: 999_999_999,
        lastCastMs: -999_999_999,
        interruptible: true,
        school: 'SHADOW',
        range: 400,
        targetKind: 'SELF',
        description: '复活莫格莱尼；必须打断或集火怀特迈恩',
        execute: (boss, engine) => {
          // 读放成功：复活莫格莱尼进入双王
          boss.hp = Math.round(boss.maxHp * 0.5);
          boss.alive = true;
          boss.isAlive = true;
          ai.mwFakeDeath = false;
          ai.mwPhase = 'duo';
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '✝️ 莫格莱尼被复活！双王阶段！',
            category: 'CRIT',
            isCrit: true,
          });
        },
      },
    ];
  },

  onTick(deltaMs, boss, engine, bossAiRaw) {
    const ai = bossAiRaw as MograineWhitemaneAiState;
    ai.mwFightMs = (ai.mwFightMs || 0) + deltaMs;
    if (!ai.mwPhase) ai.mwPhase = 'mograine';

    // 假死触发
    if (ai.mwPhase === 'mograine' && !ai.mwFakeDeath && boss.maxHp > 0 && boss.hp / boss.maxHp <= 0.05) {
      ai.mwFakeDeath = true;
      ai.mwPhase = 'whitemane_cast';
      boss.hp = Math.max(1, Math.round(boss.maxHp * MOGRAINE_FAKE_DEATH_HP));
      // 锁血表现：暂时不可击杀
      const bPos = boss.position || { x: 500, y: 200 };
      spawnCombatUnit(engine, {
        id: `whitemane_${Date.now()}`,
        name: '大检察官怀特迈恩',
        unitKind: 'ADD',
        role: 'ENEMY',
        classId: 'NPC',
        hp: 280_000,
        maxHp: 280_000,
        position: { x: bPos.x + 80, y: bPos.y - 30 },
        summonSpellId: WHITEMANE_SUMMON,
      });
      const res = ai.skills?.find(s => s.id === 'whitemane_resurrection');
      if (res && !ai.currentCasting) {
        ai.currentCasting = { skill: res, elapsedMs: 0 };
      }
      engine.emitDbmAlert?.({
        title: '大检察官怀特迈恩进场',
        advice: '打断复活并先杀怀特迈恩',
        voiceText: '先杀怀特',
        replaceKey: 'mw_whitemane_phase',
        severity: 'CRITICAL',
        spellId: 'whitemane_resurrection',
        bossId: boss.id,
        source: 'ENCOUNTER',
      });
      engine.effectsManager?.addFloatingText({
        targetId: boss.id,
        text: '⛪ 怀特迈恩进场！打断复活 / 集火她！',
        category: 'CRIT',
        isCrit: true,
      });
    }

    if (ai.mwPhase === 'whitemane_cast') {
      // 假死锁血
      boss.hp = Math.max(1, Math.round(boss.maxHp * MOGRAINE_FAKE_DEATH_HP));
      const whit = getWhitemane(engine);
      // 怀特迈恩死后若复活条未完成 → 莫格莱尼保持假死可收尾
      if (!whit) {
        ai.currentCasting = null;
        ai.mwPhase = 'duo';
        // 不再复活：莫格莱尼可被击杀
        ai.mwFakeDeath = false;
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
          text: '怀特迈恩倒下！收掉莫格莱尼！',
          category: 'STATUS',
          isCrit: true,
        });
      } else if (Math.floor((ai.mwFightMs || 0) / 2000) !== Math.floor(((ai.mwFightMs || 0) - deltaMs) / 2000)) {
        // 怀特迈恩神圣打击压力
        for (const u of living(engine)) {
          engine.dealDamage(whit, u, 8000, 'SHADOW', false, '神圣惩击');
        }
      }
    }

    if (ai.mwPhase === 'duo') {
      const whit = getWhitemane(engine);
      if (whit && Math.floor((ai.mwFightMs || 0) / 2500) !== Math.floor(((ai.mwFightMs || 0) - deltaMs) / 2500)) {
        const tank = living(engine).find((u: any) => u.role === 'TANK');
        if (tank) engine.dealDamage(whit, tank, 12_000, 'SHADOW', false, '怀特迈恩打击');
      }
    }
  },

  isActionLocked(bossAi: any) {
    return (bossAi as MograineWhitemaneAiState).mwPhase === 'whitemane_cast';
  },
};
