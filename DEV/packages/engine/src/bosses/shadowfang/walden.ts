import type { BossEncounterModule, BossSkill } from '../core/BossTypes.js';

type WaldenAiState = {
  waldenLastPos?: Map<string, { x: number; y: number }>;
  waldenStillMs?: Map<string, number>;
  waldenMovedMs?: Map<string, number>;
  /** 红药引爆内置 CD，避免每帧重复爆炸 */
  waldenRedIcdMs?: Map<string, number>;
  waldenTickAcc?: number;
};

/**
 * 影牙城堡 4号：沃登勋爵 (Lord Walden)
 * 特性机制：
 * - 绿药「剧毒催化剂」：必须保持移动；停步超过约 1.5s 则叠毒掉血
 * - 红药「凝固毒素」：必须静止；移动则引爆额外伤害
 * - 寒冰碎片：点名落点圈（踩中受伤）
 */
export const WaldenEncounter: BossEncounterModule = {
  id: 'walden',
  name: '沃登勋爵',
  dungeonId: 'shadowfang_keep',
  tier: '5man',

  createSkills(): BossSkill[] {
    let potionIndex = 0;
    return [
      {
        id: 'potion_catalyst',
        name: '三色魔药投掷',
        castTimeMs: 1500,
        cooldownMs: 14000,
        lastCastMs: -4000,
        interruptible: false,
        school: 'NATURE',
        range: 320,
        targetKind: 'AOE',
        description: '绿药必须走动消层；红药必须静止，移动则引爆',
        execute: (boss, engine) => {
          const isGreen = potionIndex % 2 === 0;
          potionIndex++;
          const spellId = isGreen ? 'walden_green_toxin' : 'walden_red_toxin';
          const name = isGreen ? '剧毒催化剂(绿药-必须走动)' : '凝固毒素(红药-必须静止)';
          engine.emitDbmAlert?.({
            title: isGreen ? '绿色剧毒魔药' : '红色致死魔药',
            advice: isGreen ? '持续移动消层！' : '立刻停手静止！',
            voiceText: isGreen ? '保持移动' : '站立不动',
            replaceKey: 'walden_potion',
            severity: 'WARN',
            spellId,
            bossId: boss.id,
            source: 'ENCOUNTER',
          });
          for (const u of engine.friendlyUnits) {
            if (!(u.alive ?? u.isAlive)) continue;
            // Strip previous color toxin so move/stop rules stay exclusive
            u.buffs = (u.buffs || []).filter(
              b => b.spellId !== 'walden_green_toxin' && b.spellId !== 'walden_red_toxin' && b.spellId !== 'potion_catalyst'
            );
            engine.applyBuff(u, {
              id: `potion_${Date.now()}_${u.id}`,
              spellId,
              name,
              kind: 'DEBUFF',
              tags: ['DEBUFF'],
              sourceUnitId: boss.id,
              targetUnitId: u.id,
              durationMs: 10000,
              remainingMs: 10000,
              stacks: 1,
              maxStacks: 5,
              school: isGreen ? 'NATURE' : 'FIRE',
            });
            engine.dealDamage(boss, u, 8000, 'NATURE', false, '三色魔药');
            engine.effectsManager?.addFloatingText({
              targetId: u.id,
              text: isGreen ? '🟢 绿药：保持移动！' : '🔴 红药：站住别动！',
              category: 'STATUS',
              isCrit: false,
            });
          }
        },
      },
      {
        id: 'ice_shards',
        name: '寒冰碎片',
        castTimeMs: 1500,
        cooldownMs: 16000,
        lastCastMs: -8000,
        interruptible: false,
        school: 'FROST',
        range: 320,
        targetKind: 'RANGED_TARGET',
        description: '在随机目标脚下落下冰霜碎裂圈，踩中持续受伤',
        execute: (boss, engine) => {
          const living = engine.friendlyUnits.filter(u => u.alive ?? u.isAlive);
          const target = living[Math.floor(Math.random() * living.length)] || engine.friendlyUnits[0];
          const pos = target?.position || { x: 420, y: 220 };
          engine.effectsManager?.addGroundEffect({
            kind: 'DAMAGE_ZONE',
            spellId: 'ice_shards',
            ownerId: boss.id,
            x: pos.x,
            y: pos.y,
            radius: 45,
            colorHex: '#7DD3FC',
            remainingMs: 6000,
            tickIntervalMs: 1000,
            tickValue: 9000,
          });
          engine.effectsManager?.addFloatingText({
            targetId: boss.id,
            text: '❄️ 寒冰碎片落点！',
            category: 'STATUS',
            isCrit: false,
          });
        },
      },
    ];
  },

  onTick(deltaMs, boss, engine, bossAi) {
    const ai = bossAi as WaldenAiState;
    if (!ai.waldenLastPos) ai.waldenLastPos = new Map();
    if (!ai.waldenStillMs) ai.waldenStillMs = new Map();
    if (!ai.waldenMovedMs) ai.waldenMovedMs = new Map();
    if (!ai.waldenRedIcdMs) ai.waldenRedIcdMs = new Map();
    ai.waldenTickAcc = (ai.waldenTickAcc || 0) + deltaMs;

    const MOVE_EPS = 2.5;
    for (const u of engine.friendlyUnits) {
      if (!(u.alive ?? u.isAlive) || u.hp <= 0) continue;
      const pos = u.position || { x: 0, y: 0 };
      const prev = ai.waldenLastPos.get(u.id) || { x: pos.x, y: pos.y };
      const dist = Math.hypot(pos.x - prev.x, pos.y - prev.y);
      const moved = dist >= MOVE_EPS;
      if (moved) {
        ai.waldenStillMs.set(u.id, 0);
        ai.waldenMovedMs.set(u.id, (ai.waldenMovedMs.get(u.id) || 0) + deltaMs);
      } else {
        ai.waldenStillMs.set(u.id, (ai.waldenStillMs.get(u.id) || 0) + deltaMs);
        ai.waldenMovedMs.set(u.id, 0);
      }
      ai.waldenLastPos.set(u.id, { x: pos.x, y: pos.y });

      const redIcd = Math.max(0, (ai.waldenRedIcdMs.get(u.id) || 0) - deltaMs);
      ai.waldenRedIcdMs.set(u.id, redIcd);

      const green = u.buffs?.find(b => b.spellId === 'walden_green_toxin');
      const red = u.buffs?.find(b => b.spellId === 'walden_red_toxin');

      // 绿：走动消层；停步 ≥1.5s 则叠层并掉血
      if (green) {
        if (moved && (green.stacks || 1) > 0) {
          green.stacks = Math.max(0, (green.stacks || 1) - 1);
          if (green.stacks <= 0) {
            u.buffs = u.buffs.filter(b => b.id !== green.id);
            engine.effectsManager?.addFloatingText({
              targetId: u.id,
              text: '🟢 毒层已消除',
              category: 'STATUS',
              isCrit: false,
            });
          }
        } else if ((ai.waldenStillMs.get(u.id) || 0) >= 1500) {
          ai.waldenStillMs.set(u.id, 0);
          green.stacks = Math.min(green.maxStacks || 5, (green.stacks || 1) + 1);
          const dmg = 4500 * (green.stacks || 1);
          engine.dealDamage(boss, u, dmg, 'NATURE', false, '剧毒催化剂');
        }
      }

      // 红：站住安全；任意位移即引爆（短 ICD，避免每帧重复）
      if (red && moved && redIcd <= 0) {
        ai.waldenRedIcdMs.set(u.id, 800);
        engine.dealDamage(boss, u, 16000, 'FIRE', true, '凝固毒素引爆');
        engine.effectsManager?.addFloatingText({
          targetId: u.id,
          text: '🔴 红药引爆！站住！',
          category: 'CRIT',
          isCrit: true,
        });
      }
    }
  },
};
