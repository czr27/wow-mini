import type { ClassId, CombatEngine, Unit } from '@cata-raid-sim/engine';
import { getPlayerDispelCapabilities, DEBUFF_REGISTRY } from '../components/RaidFrames.js';

export type DispelUnitCtx = {
  engine: CombatEngine;
  player: Unit;
  classId: ClassId | undefined;
  lastSpec: string | undefined;
  playerGcdRemainingMs: number;
  playerCooldowns: Record<string, { cdRemainingMs: number; totalCdMs: number }>;
  selectedTargetId: string | null;
  targetUnitId?: string | null;
  triggerCooldown: (spellId: string, totalCdMs: number) => void;
  triggerGcd: (spellId?: string) => void;
};

function resolveDispelSpellId(classId: ClassId | undefined, lastSpec: string | undefined): string {
  if (classId === 'DRUID') {
    return lastSpec === 'RESTORATION' ? 'natures_cure' : 'remove_corruption';
  }
  if (classId === 'SHAMAN') return 'cleanse_spirit';
  if (classId === 'PALADIN') return 'cleanse';
  if (classId === 'PRIEST') return 'dispel_magic';
  if (classId === 'WARLOCK') return 'devour_magic';
  return 'remove_curse';
}

/** Dispel one matching debuff on a friendly target (Cata matrix). */
export function dispelUnit(ctx: DispelUnitCtx): void {
  const {
    engine,
    player,
    classId,
    lastSpec,
    playerGcdRemainingMs,
    playerCooldowns,
    selectedTargetId,
    targetUnitId,
    triggerCooldown,
    triggerGcd,
  } = ctx;

  if (!player.isAlive && !player.alive) return;

  if (playerGcdRemainingMs > 0) {
    engine.effectsManager?.addFloatingText({
      targetId: player.id,
      text: '公共冷却中！',
      category: 'STATUS',
      isCrit: false,
    });
    return;
  }

  const allowedDispels = getPlayerDispelCapabilities(classId, lastSpec);
  if (allowedDispels.length === 0) {
    engine.effectsManager?.addFloatingText({
      targetId: player.id,
      text: '❌ 当前职业/专精无驱散技能',
      category: 'STATUS',
      isCrit: false,
    });
    return;
  }

  const dispelSpellId = resolveDispelSpellId(classId, lastSpec);

  if ((playerCooldowns[dispelSpellId]?.cdRemainingMs || 0) > 0) {
    engine.effectsManager?.addFloatingText({
      targetId: player.id,
      text: '驱散法术还在冷却中！',
      category: 'STATUS',
      isCrit: false,
    });
    return;
  }

  const target =
    (targetUnitId ? engine.friendlyUnits.find((u) => u.id === targetUnitId) : null) ||
    (selectedTargetId ? engine.friendlyUnits.find((u) => u.id === selectedTargetId) : null) ||
    player;

  if (!target) return;

  if (player.position && target.position) {
    const dist = Math.hypot(
      player.position.x - target.position.x,
      player.position.y - target.position.y
    );
    if (dist > 340) {
      engine.effectsManager?.addFloatingText({
        targetId: player.id,
        text: '距离过远，无法驱散！',
        category: 'STATUS',
        isCrit: false,
      });
      return;
    }
  }

  const debuffIdx = target.buffs.findIndex((b) => {
    if (b.kind !== 'DEBUFF') return false;
    const meta = DEBUFF_REGISTRY[b.spellId];
    return meta?.dispelType && allowedDispels.includes(meta.dispelType);
  });

  if (debuffIdx === -1) {
    engine.effectsManager?.addFloatingText({
      targetId: player.id,
      text: '目标身上无可驱散的负面状态',
      category: 'STATUS',
      isCrit: false,
    });
    return;
  }

  const removed = target.buffs[debuffIdx];
  target.buffs.splice(debuffIdx, 1);

  triggerCooldown(dispelSpellId, 8000);
  triggerGcd();

  engine.effectsManager?.addFloatingText({
    targetId: target.id,
    text: `✨ 驱散成功: ${removed.name}`,
    category: 'HEAL',
    isCrit: true,
  });
}
