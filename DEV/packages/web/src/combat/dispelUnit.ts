import type { ClassId, CombatEngine, Unit } from '@cata-raid-sim/engine';
import { getPlayerDispelCapabilities, DEBUFF_REGISTRY } from '../components/RaidFrames.js';
import { SPELL_MANA_COSTS } from './spellCosts.js';

export type DispelUnitCtx = {
  engine: CombatEngine;
  player: Unit;
  classId: ClassId | undefined;
  lastSpec: string | undefined;
  playerGcdRemainingMs: number;
  playerCooldowns: Record<string, { cdRemainingMs: number; totalCdMs: number }>;
  selectedTargetId: string | null;
  targetUnitId?: string | null;
  skipResourceCost?: boolean;
  triggerCooldown: (spellId: string, totalCdMs: number) => void;
  triggerGcd: (spellId?: string) => void;
};

function resolveDispelSpellId(classId: ClassId | undefined, lastSpec: string | undefined): string {
  if (classId === 'DRUID') {
    const sp = (lastSpec || '').toUpperCase();
    const isResto = sp === 'RESTORATION' || sp === 'RESTO' || sp === 'RESTO_HEAL';
    return isResto ? 'natures_cure' : 'remove_corruption';
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

  const isDruidDispelOnCd =
    classId === 'DRUID' &&
    ((playerCooldowns['remove_corruption']?.cdRemainingMs || 0) > 0 ||
      (playerCooldowns['natures_cure']?.cdRemainingMs || 0) > 0);

  if ((playerCooldowns[dispelSpellId]?.cdRemainingMs || 0) > 0 || isDruidDispelOnCd) {
    engine.effectsManager?.addFloatingText({
      targetId: player.id,
      text: '驱散法术还在冷却中！',
      category: 'STATUS',
      isCrit: false,
    });
    return;
  }

  const manaCost = SPELL_MANA_COSTS[dispelSpellId] ?? 1000;
  const manaRes = player.resources?.find((r) => r.kind === 'MANA');
  const currentMana = manaRes ? manaRes.current : (player.mp ?? 0);
  if (!ctx.skipResourceCost && currentMana < manaCost) {
    engine.effectsManager?.addFloatingText({
      targetId: player.id,
      text: '法力不足！',
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
    const dispelType = b.dispelType || meta?.dispelType || (
      (b.school === 'SHADOW' || b.school === 'ARCANE') && (b.name.includes('诅咒') || b.spellId.includes('curse')) ? 'CURSE' :
      (b.school === 'NATURE' && (b.name.includes('毒') || b.spellId.includes('poison') || b.spellId.includes('toxic'))) ? 'POISON' :
      (b.school === 'SHADOW' && (b.name.includes('疾病') || b.name.includes('疫') || b.spellId.includes('disease') || b.spellId.includes('plague'))) ? 'DISEASE' :
      (b.school === 'FIRE' || b.school === 'FROST' || b.school === 'ARCANE' || b.school === 'HOLY' || b.name.includes('魔')) ? 'MAGIC' :
      undefined
    );
    return dispelType && allowedDispels.includes(dispelType as any);
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

  if (!ctx.skipResourceCost) {
    if (manaRes) {
      manaRes.current = Math.max(0, manaRes.current - manaCost);
    }
    if (player.mp != null) {
      player.mp = Math.max(0, player.mp - manaCost);
    }
  }

  const removed = target.buffs[debuffIdx];
  target.buffs.splice(debuffIdx, 1);

  triggerCooldown(dispelSpellId, 8000);
  if (classId === 'DRUID') {
    triggerCooldown('remove_corruption', 8000);
    triggerCooldown('natures_cure', 8000);
  }
  triggerGcd();

  engine.effectsManager?.addFloatingText({
    targetId: target.id,
    text: `✨ 驱散成功: ${removed.name}`,
    category: 'HEAL',
    isCrit: true,
  });
}
