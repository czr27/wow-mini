import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';
import type { CombatEngine } from '../../engine/CombatEngine.js';
import type { Unit } from '../../types.js';

export type GlubtokAiState = {
  glubtokFightMs?: number;
  glubtokPhase?: 'p1' | 'p2';
  glubtokFist?: 'flame' | 'frost';
  glubtokBlossomAcc?: number;
  glubtokFirewallAcc?: number;
  skills?: BossSkill[];
};

function living(engine: CombatEngine): Unit[] {
  return engine.friendlyUnits.filter(u => (u.alive ?? u.isAlive) && (u.hp ?? 0) > 0);
}

export const GlubtokEncounter: BossEncounterModule = {
  id: 'glubtok',
  name: '戈洛克托克',
  dungeonId: 'deadmines',
  tier: '5man',

  createSkills(bossAi: any): BossSkill[] {
    const ai = bossAi as GlubtokAiState;
    return [
      {
        id: 'fists_of_flame',
        name: '火焰之拳',
        castTimeMs: 0,
        cooldownMs: 8000,
        lastCastMs: -2000,
        interruptible: false,
        school: 'FIRE',
        range: 80,
        targetKind: 'MELEE_TARGET',
        description: '火焰之拳；换拳时闪现清仇',
        execute: (boss, engine) => {
          if (ai.glubtokFist === 'frost') return;
          const tank = living(engine).find(u => u.role === 'TANK') || living(engine)[0];
          if (!tank) return;
          engine.dealDamage(boss, tank, 26_000, 'FIRE', false, '火焰之拳');
          // 旁侧溅射
          for (const u of living(engine)) {
            if (u.id === tank.id) continue;
            const dx = (u.position?.x || 0) - (tank.position?.x || 0);
            const dy = (u.position?.y || 0) - (tank.position?.y || 0);
            if (Math.hypot(dx, dy) < 40) {
              engine.dealDamage(boss, u, 12_000, 'FIRE', false, '火焰之拳溅射');
            }
          }
          ai.glubtokFist = 'frost';
          // 闪现：重置威胁表现
          for (const u of living(engine)) u.threatTable = [];
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '🔥→❄️ 换拳闪现！坦克接怪！',
            category: 'STATUS',
            isCrit: true,
          });
        },
      },
      {
        id: 'fists_of_frost',
        name: '冰霜之拳',
        castTimeMs: 0,
        cooldownMs: 8000,
        lastCastMs: -6000,
        interruptible: false,
        school: 'FROST',
        range: 80,
        targetKind: 'MELEE_TARGET',
        description: '冰霜之拳；换拳时闪现清仇',
        execute: (boss, engine) => {
          if (ai.glubtokFist === 'flame') return;
          const tank = living(engine).find(u => u.role === 'TANK') || living(engine)[0];
          if (!tank) return;
          engine.dealDamage(boss, tank, 26_000, 'FROST', false, '冰霜之拳');
          for (const u of living(engine)) {
            if (u.id === tank.id) continue;
            const dx = (u.position?.x || 0) - (tank.position?.x || 0);
            const dy = (u.position?.y || 0) - (tank.position?.y || 0);
            if (Math.hypot(dx, dy) < 40) {
              engine.dealDamage(boss, u, 12_000, 'FROST', false, '冰霜之拳溅射');
            }
          }
          ai.glubtokFist = 'flame';
          for (const u of living(engine)) u.threatTable = [];
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '❄️→🔥 换拳闪现！坦克接怪！',
            category: 'STATUS',
            isCrit: true,
          });
        },
      },
    ];
  },

  onTick(deltaMs, boss, engine, bossAiRaw) {
    const ai = bossAiRaw as GlubtokAiState;
    ai.glubtokFightMs = (ai.glubtokFightMs || 0) + deltaMs;
    if (!ai.glubtokFist) ai.glubtokFist = 'flame';
    if (!ai.glubtokPhase) ai.glubtokPhase = 'p1';

    if (ai.glubtokPhase === 'p1' && boss.maxHp > 0 && boss.hp / boss.maxHp <= 0.5) {
      ai.glubtokPhase = 'p2';
      engine.emitDbmAlert?.({
        title: '转阶段：双元素之怒',
        advice: '避开火焰壁垒扫射',
        voiceText: '躲避火墙',
        replaceKey: 'glubtok_p2',
        severity: 'WARN',
        spellId: 'glubtok_p2',
        bossId: boss.id,
        source: 'ENCOUNTER',
      });
      engine.effectsManager?.addFloatingText({
        targetId: boss.id,
        text: '💥 半血！火焰/冰霜花瓣与火墙！',
        category: 'CRIT',
        isCrit: true,
      });
    }

    if (ai.glubtokPhase === 'p2') {
      ai.glubtokBlossomAcc = (ai.glubtokBlossomAcc || 0) + deltaMs;
      if ((ai.glubtokBlossomAcc || 0) >= 5000) {
        ai.glubtokBlossomAcc = 0;
        const fri = living(engine);
        const t = fri[Math.floor(Math.random() * Math.max(1, fri.length))];
        const pos = t?.position || boss.position || { x: 400, y: 200 };
        const isFire = Math.random() < 0.5;
        engine.effectsManager?.addGroundEffect({
          kind: 'DAMAGE_ZONE',
          spellId: isFire ? 'fire_blossom' : 'frost_blossom',
          ownerId: boss.id,
          x: pos.x,
          y: pos.y,
          radius: 45,
          colorHex: isFire ? '#F97316' : '#7DD3FC',
          remainingMs: 6000,
          tickIntervalMs: 1000,
          tickValue: 9000,
        });
      }

      ai.glubtokFirewallAcc = (ai.glubtokFirewallAcc || 0) + deltaMs;
      if ((ai.glubtokFirewallAcc || 0) >= 8000) {
        ai.glubtokFirewallAcc = 0;
        const bPos = boss.position || { x: 500, y: 200 };
        // 火墙：环形采样点伤害 — 距 Boss 约 70–100 的环带
        for (const u of living(engine)) {
          const d = Math.hypot(
            (u.position?.x || 0) - bPos.x,
            (u.position?.y || 0) - bPos.y,
          );
          if (d >= 65 && d <= 105) {
            engine.dealDamage(boss, u, 18_000, 'FIRE', true, '火墙');
          }
        }
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
          text: '🔥 火墙！绕圈移动，勿穿墙！',
          category: 'STATUS',
          isCrit: true,
        });
      }
    }
  },
};
