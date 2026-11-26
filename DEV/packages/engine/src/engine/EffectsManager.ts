import { GroundEffect, FloatingCombatText, Unit } from '../types.js';
import { isSeekableHealGroundEffect } from './AoeRingVisual.js';

/** Same-caster same-family totems: new placement instantly destroys the old one. */
export function resolveTotemFamilyId(spellId: string): string {
  const sid = (spellId || '').toLowerCase();
  if (sid.includes('lightwell') || sid.includes('light_well') || sid.includes('圣光井')) {
    return 'lightwell';
  }
  if (sid.includes('healing_tide') || sid.includes('治疗之潮')) return 'healing_tide';
  if (sid.includes('spirit_link') || sid.includes('灵魂链接')) return 'spirit_link';
  if (sid.includes('mana_tide') || sid.includes('法力之潮')) return 'mana_tide';
  if (sid.includes('windfury') || sid.includes('风怒')) return 'windfury';
  if (sid.includes('healing_stream')) return 'healing_stream';
  // Fallback: strip class prefix so priest_lightwell / lightwell share a family
  return sid.replace(/^(shaman_|priest_|mage_|dk_|druid_|warlock_|paladin_)/, '') || sid;
}

export class EffectsManager {
  public groundEffects: GroundEffect[] = [];
  public floatingTexts: FloatingCombatText[] = [];

  constructor(public engine?: any) {}

  public addGroundEffect(effect: Partial<GroundEffect> & Omit<GroundEffect, 'id'>): GroundEffect {
    const newEffect: GroundEffect = {
      id: effect.id || `effect_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      tickIntervalMs: effect.tickIntervalMs || 1000,
      tickElapsedMs: 0,
      ...effect,
    } as GroundEffect;
    // 同类图腾同一施法者只能有一个：新的出现则立刻销毁旧的
    if (newEffect.kind === 'TOTEM' && newEffect.ownerId) {
      const family = resolveTotemFamilyId(newEffect.spellId);
      this.groundEffects = this.groundEffects.filter(
        (e) =>
          !(
            e.kind === 'TOTEM' &&
            e.ownerId === newEffect.ownerId &&
            resolveTotemFamilyId(e.spellId) === family
          )
      );
    }
    this.groundEffects.push(newEffect);
    return newEffect;
  }

  public removeGroundEffect(id: string) {
    this.groundEffects = this.groundEffects.filter(e => e.id !== id);
  }

  public addFloatingText(text: Partial<FloatingCombatText> & Omit<FloatingCombatText, 'id' | 'createdAtMs'>): FloatingCombatText {
    const fct: FloatingCombatText = {
      id: text.id || `fct_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      createdAtMs: text.createdAtMs || Date.now(),
      ...text,
    } as FloatingCombatText;
    this.floatingTexts.push(fct);
    // Keep max 60 active combat texts to prevent memory accumulation
    if (this.floatingTexts.length > 60) {
      this.floatingTexts.shift();
    }
    return fct;
  }

  /**
   * Check if a coordinate position is inside a ground effect circle
   */
  public isPositionInEffect(pos: { x: number; y: number }, effect: GroundEffect): boolean {
    const dist = Math.hypot(pos.x - effect.x, pos.y - effect.y);
    return dist <= effect.radius;
  }

  /**
   * Check if a position is in any dangerous ground effect (Desecration, Red Cone, etc.)
   */
  public isPositionInHazard(pos: { x: number; y: number }): boolean {
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return false;
    for (const eff of this.groundEffects) {
      if (eff.remainingMs <= 0) continue;
      if (eff.kind === 'DAMAGE_ZONE') {
        const owner = eff.ownerId ? this.engine.units.get(eff.ownerId) : undefined;
        if (owner && owner.role !== 'ENEMY') continue;
        if (this.isPositionInEffect(pos, eff)) return true;
      } else if (eff.kind === 'CONE_WARNING') {
        const facing = eff.facingRad ?? Math.PI;
        const coneAngle = eff.coneAngleRad ?? Math.PI / 3;
        const dx = pos.x - eff.x;
        const dy = pos.y - eff.y;
        const dist = Math.hypot(dx, dy);
        if (dist > eff.radius) continue;
        const angle = Math.atan2(dy, dx);
        let diff = Math.abs(angle - facing);
        while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);
        if (diff <= coneAngle / 2) return true;
      }
    }
    return false;
  }

  /**
   * Get all active healing zones (Efflorescence, Healing Rain, healing/support totems)
   */
  public getActiveHealZones(): GroundEffect[] {
    return this.groundEffects.filter((e) => isSeekableHealGroundEffect(e));
  }

  public tick(deltaMsOrUnits: any, deltaMs?: number) {
    const actualDelta = typeof deltaMs === 'number' ? deltaMs : (typeof deltaMsOrUnits === 'number' ? deltaMsOrUnits : 50);
    const unitsMapOrList = typeof deltaMs === 'number' ? deltaMsOrUnits : undefined;

    // 1. Tick down ground effects and process range-based ticks
    for (let i = this.groundEffects.length - 1; i >= 0; i--) {
      const eff = this.groundEffects[i];
      eff.remainingMs -= actualDelta;
      eff.tickElapsedMs = (eff.tickElapsedMs || 0) + actualDelta;

      const interval = eff.tickIntervalMs || 1000;
      if (eff.tickElapsedMs >= interval) {
        eff.tickElapsedMs -= interval;

        // If units are available, evaluate range-based AoE!
        if (this.engine) {
          this.evaluateGroundEffectTick(eff);
        }
      }

      if (eff.remainingMs <= 0) {
        this.groundEffects.splice(i, 1);
      }
    }

    // 2. Clear expired floating texts (> 1500ms)
    const now = Date.now();
    this.floatingTexts = this.floatingTexts.filter(f => now - f.createdAtMs < 1500);
  }

  private alliesInRadius(eff: GroundEffect): any[] {
    return this.engine.friendlyUnits.filter(
      (u: any) => (u.isAlive ?? u.alive) && u.hp > 0 && u.position && this.isPositionInEffect(u.position, eff)
    );
  }

  private evaluateGroundEffectTick(eff: GroundEffect): void {
    if (!this.engine) return;
    const value = eff.tickValue ?? (eff.kind === 'HEAL_ZONE' ? 4500 : 3800);
    if (eff.kind === 'DAMAGE_ZONE' && value <= 0) return;
    const spellId = (eff.spellId || '').toLowerCase();
    const isHealingTide =
      spellId === 'healing_tide' ||
      spellId === 'healing_tide_totem' ||
      spellId === 'shaman_healing_tide_totem' ||
      spellId === '治疗之潮' ||
      spellId === '治疗之潮图腾';
    const isLightwell =
      spellId.includes('lightwell') || spellId.includes('light_well') || spellId.includes('圣光井');
    const isSpiritLink = spellId.includes('spirit_link');
    const isManaTide = spellId.includes('mana_tide');
    const isWindfury = spellId.includes('windfury');

    if (eff.kind === 'HEAL_ZONE' || (eff.kind === 'TOTEM' && (isHealingTide || isLightwell))) {
      // Heal friendly units standing inside radius (Healing Rain / Healing Tide / Lightwell)
      const owner = (this.engine.units.get(eff.ownerId) || this.engine.friendlyUnits.find((f: any) => f.id === eff.ownerId) || this.engine.friendlyUnits[0]) as any;
      const living = this.alliesInRadius(eff);
      const targets = isHealingTide
        ? [...living].sort((a: any, b: any) => a.hp / a.maxHp - b.hp / b.maxHp).slice(0, 5)
        : living;
      const isHealingRain = spellId === 'healing_rain' || spellId === 'shaman_healing_rain' || spellId === '治疗之雨';
      const healName = isLightwell
        ? '圣光井'
        : isHealingTide
        ? '治疗之潮图腾'
        : (isHealingRain ? '治疗之雨' : '百花齐放');

      // 生命释放：下一次治疗之雨效果 +30%（仅首跳消耗 buff，与技能描述一致）
      let tickHeal = value;
      if (
        isHealingRain &&
        owner?.buffs?.some(
          (b: any) => b.spellId === 'unleash_life' || b.spellId === 'shaman_unleash_life'
        )
      ) {
        tickHeal = Math.round(value * 1.30);
        const ulIdx = owner.buffs.findIndex(
          (b: any) => b.spellId === 'unleash_life' || b.spellId === 'shaman_unleash_life'
        );
        if (ulIdx !== -1) owner.buffs.splice(ulIdx, 1);
        (eff as any)._unleashLifeBoosted = true;
      } else if ((eff as any)._unleashLifeBoosted) {
        tickHeal = Math.round(value * 1.30);
      }

      for (const u of targets) {
        // Periodic ground ticks: not "direct heal" for Unleash Life / Ancestral Guidance
        this.engine.healUnit(owner, u, tickHeal, false, healName, true);
      }
    } else if (eff.kind === 'TOTEM' && isSpiritLink) {
      // 灵魂链接：仅图腾半径内友方 — 每秒均摊生命百分比 + 维持 10% 减伤 buff
      const inRange = this.alliesInRadius(eff);
      if (inRange.length === 0) return;
      const avgPct =
        inRange.reduce((s: number, u: any) => s + u.hp / Math.max(1, u.maxHp), 0) / inRange.length;
      for (const u of inRange) {
        const desired = Math.round(u.maxHp * avgPct);
        u.hp = Math.max(1, Math.min(u.maxHp, desired));
        const existing = u.buffs?.find(
          (b: any) => b.spellId === 'spirit_link' || b.spellId === 'spirit_link_totem'
        );
        if (existing) {
          existing.remainingMs = Math.max(existing.remainingMs, 1500);
        } else {
          this.engine.applyBuff(u, {
            id: `spirit_link_${eff.id}_${u.id}`,
            spellId: 'spirit_link',
            name: '灵魂链接',
            kind: 'BUFF',
            tags: ['STAT'],
            sourceUnitId: eff.ownerId,
            targetUnitId: u.id,
            stacks: 1,
            maxStacks: 1,
            durationMs: 1500,
            remainingMs: 1500,
            school: 'NATURE',
          });
        }
      }
    } else if (eff.kind === 'TOTEM' && isManaTide) {
      // 法力之潮：仅半径内友方获得回蓝 buff（战斗 tick 读 buff 加速回蓝）
      const inRange = this.alliesInRadius(eff);
      for (const u of inRange) {
        const existing = u.buffs?.find(
          (b: any) => b.spellId === 'mana_tide' || b.spellId === 'mana_tide_totem'
        );
        if (existing) {
          existing.remainingMs = Math.max(existing.remainingMs, 5500);
        } else {
          this.engine.applyBuff(u, {
            id: `mana_tide_${eff.id}_${u.id}`,
            spellId: 'mana_tide',
            name: '法力之潮',
            kind: 'BUFF',
            tags: ['STAT'],
            sourceUnitId: eff.ownerId,
            targetUnitId: u.id,
            stacks: 1,
            maxStacks: 1,
            durationMs: 5500,
            remainingMs: 5500,
            school: 'NATURE',
          });
        }
      }
    } else if (eff.kind === 'TOTEM' && isWindfury) {
      // 风怒图腾：半径内近战急速 +16%（haste buff）
      const inRange = this.alliesInRadius(eff);
      for (const u of inRange) {
        const existing = u.buffs?.find(
          (b: any) => b.spellId === 'windfury' || b.spellId === 'windfury_totem'
        );
        if (existing) {
          existing.remainingMs = Math.max(existing.remainingMs, 2000);
        } else {
          this.engine.applyBuff(u, {
            id: `windfury_${eff.id}_${u.id}`,
            spellId: 'windfury_totem',
            name: '风怒图腾',
            kind: 'BUFF',
            tags: ['STAT'],
            sourceUnitId: eff.ownerId,
            targetUnitId: u.id,
            stacks: 1,
            maxStacks: 1,
            durationMs: 2000,
            remainingMs: 2000,
            school: 'PHYSICAL',
            statModifiers: { haste: 0.16 },
          });
        }
      }
    } else if (eff.kind === 'DAMAGE_ZONE') {
      // tickValue === 0：仅光圈预警，不跳伤（如杜安气泡）
      if (eff.tickValue === 0) return;
      const boss = this.engine.bossUnit;
      if (eff.ownerId === boss?.id) {
        const spellName =
          ({
            death_and_decay: '凋零凋落',
            frozen_orb: '寒冰宝珠',
            desecration: '亵渎',
            whirlwind: '旋风斩',
            overdrive: '过载碾压',
            fire_blossom: '火焰花瓣',
            frost_blossom: '冰霜花瓣',
            arcane_bubble: '奥术气泡',
          } as Record<string, string>)[eff.spellId] || eff.spellId || '地面伤害';
        const school =
          eff.spellId === 'fire_blossom' || eff.spellId === 'overdrive'
            ? 'FIRE'
            : eff.spellId === 'frost_blossom'
              ? 'FROST'
              : eff.spellId === 'whirlwind'
                ? 'PHYSICAL'
                : 'SHADOW';
        for (const u of this.engine.friendlyUnits) {
          if ((u.isAlive ?? u.alive) && u.position && this.isPositionInEffect(u.position, eff)) {
            this.engine.dealDamage(boss, u, value, school, false, spellName);
          }
        }
      } else {
        const owner = this.engine.units.get(eff.ownerId) || this.engine.friendlyUnits[0];
        const school =
          spellId.includes('blizzard') || spellId.includes('frozen') || spellId.includes('frost')
            ? 'FROST'
            : spellId.includes('fire') || spellId.includes('flamestrike')
              ? 'FIRE'
              : 'SHADOW';
        const spellName =
          spellId.includes('blizzard')
            ? '暴风雪'
            : spellId === 'death_and_decay' || spellId === 'dnd' || spellId === 'dk_dnd'
              ? '枯萎凋零'
              : spellId === 'frozen_orb'
                ? '寒冰宝珠'
                : '地面伤害';
        if (boss && (boss.isAlive ?? boss.alive) && this.isPositionInEffect(boss.position, eff)) {
          this.engine.dealDamage(owner, boss, value, school, false, spellName);
        }
        // Multi-add ready: damage all enemies in radius (boss + adds)
        for (const enemy of this.engine.enemyUnits) {
          if (enemy.id === boss?.id) continue;
          if ((enemy.isAlive ?? enemy.alive) && this.isPositionInEffect(enemy.position, eff)) {
            this.engine.dealDamage(owner, enemy, value, school, false, spellName);
          }
        }
      }
    }
  }

  public clearAll() {
    this.groundEffects = [];
    this.floatingTexts = [];
  }
}
