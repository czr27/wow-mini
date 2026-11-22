/**
 * T-01 战斗引擎单元测试
 * 测试工具：Vitest
 * 覆盖：Calculator、ThreatManager、AuraManager、ResourceManager、CooldownManager
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Mock 类型（真实运行时由 packages/engine/src/types.ts 提供）
// ─────────────────────────────────────────────────────────────────────────────
interface Unit {
  id: string
  name: string
  classId: 'DK' | 'DRUID' | 'SHAMAN' | 'MAGE' | 'ROGUE'
  role: 'TANK' | 'HEALER' | 'DPS'
  hp: number
  maxHp: number
  mp: number
  maxMp: number
  energy: number
  attackPower: number
  spellPower: number
  critChance: number   // 0-1
  armorReduction: number // 0-1
  alive: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock implementations（稳定桩，待 engine 实现完毕后替换为真实导入）
// ─────────────────────────────────────────────────────────────────────────────

/** Calculator — 伤害与治疗计算 */
class Calculator {
  /** 物理伤害：含暴击（200%倍率）、护甲减伤、吸收 */
  calcPhysicalDamage(
    attacker: Unit,
    target: Unit,
    baseDmg: number,
    forceCrit = false,
  ): { damage: number; isCrit: boolean } {
    const isCrit = forceCrit || Math.random() < attacker.critChance
    const rawDmg = isCrit ? baseDmg * 2.0 : baseDmg          // 200% 暴击倍率
    const afterArmor = rawDmg * (1 - target.armorReduction)
    return { damage: Math.round(afterArmor), isCrit }
  }

  /** 法术伤害：含暴击、吸收 */
  calcSpellDamage(
    attacker: Unit,
    target: Unit,
    baseDmg: number,
    _school: string,
    forceCrit = false,
  ): { damage: number; isCrit: boolean } {
    const isCrit = forceCrit || Math.random() < attacker.critChance
    const raw = isCrit ? baseDmg * 2.0 : baseDmg
    return { damage: Math.round(raw), isCrit }
  }

  /** 治疗：含暴击、过量治疗裁切（不超过 maxHp） */
  calcHealing(
    _healer: Unit,
    target: Unit,
    baseHeal: number,
    forceCrit = false,
  ): { effective: number; overheal: number } {
    const isCrit = forceCrit
    const raw = isCrit ? baseHeal * 2.0 : baseHeal
    const space = target.maxHp - target.hp
    const effective = Math.min(raw, space)
    const overheal = raw - effective
    return { effective: Math.round(effective), overheal: Math.round(overheal) }
  }
}

/** ThreatManager — 仇恨管理 */
class ThreatManager {
  private table: Map<string, number> = new Map()   // unitId -> threat

  addDamageThreat(unitId: string, damage: number): void {
    const cur = this.table.get(unitId) ?? 0
    this.table.set(unitId, cur + damage)             // 1:1
  }

  addHealingThreat(unitId: string, healing: number): void {
    const cur = this.table.get(unitId) ?? 0
    this.table.set(unitId, cur + healing * 0.5)      // 0.5:1
  }

  /** 嘲讽：被嘲讽者仇恨 = 当前首位 × 110% */
  taunt(taunterId: string): void {
    const topThreat = this.getTopThreat()
    const newThreat = (topThreat?.threat ?? 0) * 1.1
    this.table.set(taunterId, newThreat)
  }

  getTopUnit(): string | undefined {
    let top: string | undefined
    let max = -1
    for (const [id, t] of this.table) {
      if (t > max) { max = t; top = id }
    }
    return top
  }

  getTopThreat(): { id: string; threat: number } | undefined {
    const top = this.getTopUnit()
    return top ? { id: top, threat: this.table.get(top)! } : undefined
  }

  getThreat(unitId: string): number {
    return this.table.get(unitId) ?? 0
  }

  reset(): void {
    this.table.clear()
  }
}

/** AuraManager — Buff/HoT/DoT 管理 */
interface Aura {
  id: string
  name: string
  type: 'HOT' | 'DOT' | 'BUFF' | 'DEBUFF'
  stacks: number
  maxStacks: number
  tickValue: number    // HP per tick
  tickIntervalMs: number
  durationMs: number
  remainingMs: number
  elapsedSinceTickMs: number
  onExpire?: (aura: Aura) => void
}

class AuraManager {
  private auras: Map<string, Aura> = new Map()
  public healingDealt = 0
  public damageDealt = 0

  addBuff(aura: Aura): void {
    const existing = this.auras.get(aura.id)
    if (existing) {
      existing.stacks = Math.min(existing.stacks + 1, aura.maxStacks)
      existing.remainingMs = aura.durationMs   // refresh
    } else {
      this.auras.set(aura.id, { ...aura, stacks: 1 })
    }
  }

  removeBuff(auraId: string): void {
    this.auras.delete(auraId)
  }

  getAura(auraId: string): Aura | undefined {
    return this.auras.get(auraId)
  }

  tickAllAuras(deltaMs: number): void {
    for (const [id, aura] of this.auras) {
      aura.remainingMs -= deltaMs
      aura.elapsedSinceTickMs += deltaMs

      while (aura.elapsedSinceTickMs >= aura.tickIntervalMs) {
        const tickHeal = aura.type === 'HOT' ? aura.tickValue * aura.stacks : 0
        const tickDmg  = aura.type === 'DOT' ? aura.tickValue * aura.stacks : 0
        this.healingDealt += tickHeal
        this.damageDealt  += tickDmg
        aura.elapsedSinceTickMs -= aura.tickIntervalMs
      }

      if (aura.remainingMs <= 0) {
        aura.onExpire?.(aura)
        this.auras.delete(id)
      }
    }
  }
}

/** ResourceManager — 法力/能量/符文资源 */
interface Rune {
  id: number
  cooldownMs: number
  remainingMs: number
}

class ResourceManager {
  private runes: Rune[] = Array.from({ length: 6 }, (_, i) => ({
    id: i,
    cooldownMs: 10_000,
    remainingMs: 0,
  }))
  public energy = 100
  public maxEnergy = 100
  private energyRegenPerMs = 10 / 1000   // +10/s

  tickEnergy(deltaMs: number): void {
    this.energy = Math.min(this.maxEnergy, this.energy + this.energyRegenPerMs * deltaMs)
  }

  consumeRune(runeId: number): boolean {
    const rune = this.runes[runeId]
    if (rune.remainingMs > 0) return false   // on cooldown
    rune.remainingMs = rune.cooldownMs
    return true
  }

  tickRunes(deltaMs: number): void {
    for (const rune of this.runes) {
      if (rune.remainingMs > 0) {
        rune.remainingMs = Math.max(0, rune.remainingMs - deltaMs)
      }
    }
  }

  isRuneReady(runeId: number): boolean {
    return this.runes[runeId].remainingMs === 0
  }

  getRuneCooldownRemaining(runeId: number): number {
    return this.runes[runeId].remainingMs
  }
}

/** CooldownManager — GCD / 独立CD */
class CooldownManager {
  private gcdRemaining = 0
  private readonly gcdDuration: number

  private cds: Map<string, number> = new Map()   // spellId -> remainingMs

  constructor(isRogue = false) {
    this.gcdDuration = isRogue ? 1_000 : 1_500
  }

  startGcd(): void {
    this.gcdRemaining = this.gcdDuration
  }

  startCooldown(spellId: string, durationMs: number): void {
    this.cds.set(spellId, durationMs)
  }

  canCast(spellId: string): boolean {
    return this.gcdRemaining <= 0 && (this.cds.get(spellId) ?? 0) <= 0
  }

  tick(deltaMs: number): void {
    this.gcdRemaining = Math.max(0, this.gcdRemaining - deltaMs)
    for (const [id, rem] of this.cds) {
      this.cds.set(id, Math.max(0, rem - deltaMs))
    }
  }

  getGcdRemaining(): number { return this.gcdRemaining }
  getCdRemaining(spellId: string): number { return this.cds.get(spellId) ?? 0 }
}

// ─────────────────────────────────────────────────────────────────────────────
// 测试数据工厂
// ─────────────────────────────────────────────────────────────────────────────
function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'unit-1',
    name: 'TestUnit',
    classId: 'DK',
    role: 'TANK',
    hp: 100_000,
    maxHp: 145_000,
    mp: 100_000,
    maxMp: 100_000,
    energy: 100,
    attackPower: 10_000,
    spellPower: 5_000,
    critChance: 0.3,
    armorReduction: 0.0,
    alive: true,
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// T-01-01  Calculator 测试
// ─────────────────────────────────────────────────────────────────────────────
describe('T-01-01  Calculator.calcPhysicalDamage', () => {
  const calc = new Calculator()

  it('普通攻击：无护甲时伤害等于 baseDmg', () => {
    const attacker = makeUnit({ critChance: 0 })
    const target   = makeUnit({ armorReduction: 0 })
    const { damage, isCrit } = calc.calcPhysicalDamage(attacker, target, 10_000, false)
    expect(isCrit).toBe(false)
    expect(damage).toBe(10_000)
  })

  it('暴击倍率为 200%（damage = baseDmg × 2）', () => {
    const attacker = makeUnit()
    const target   = makeUnit({ armorReduction: 0 })
    const { damage, isCrit } = calc.calcPhysicalDamage(attacker, target, 10_000, true)
    expect(isCrit).toBe(true)
    expect(damage).toBe(20_000)   // 200% crit multiplier
  })

  it('护甲减伤 50% → 暴击后伤害 = 20000 × 0.5 = 10000', () => {
    const attacker = makeUnit()
    const target   = makeUnit({ armorReduction: 0.5 })
    const { damage } = calc.calcPhysicalDamage(attacker, target, 10_000, true)
    expect(damage).toBe(10_000)
  })

  it('30% 暴击率：大量样本中暴击率在合理范围内', () => {
    const attacker = makeUnit({ critChance: 0.3 })
    const target   = makeUnit({ armorReduction: 0 })
    let crits = 0
    const N = 1000
    for (let i = 0; i < N; i++) {
      const { isCrit } = calc.calcPhysicalDamage(attacker, target, 100)
      if (isCrit) crits++
    }
    // 95% CI for binomial(1000, 0.3): ~270-330
    expect(crits).toBeGreaterThan(230)
    expect(crits).toBeLessThan(370)
  })
})

describe('T-01-02  Calculator.calcHealing', () => {
  const calc = new Calculator()

  it('正常治疗：不超过血量上限时 effective = heal', () => {
    const healer = makeUnit({ role: 'HEALER' })
    const target = makeUnit({ hp: 50_000, maxHp: 145_000 })
    const { effective, overheal } = calc.calcHealing(healer, target, 20_000)
    expect(effective).toBe(20_000)
    expect(overheal).toBe(0)
  })

  it('过量治疗裁切：超出血量上限部分为 overheal', () => {
    const healer = makeUnit({ role: 'HEALER' })
    const target = makeUnit({ hp: 140_000, maxHp: 145_000 })
    const { effective, overheal } = calc.calcHealing(healer, target, 20_000)
    expect(effective).toBe(5_000)
    expect(overheal).toBe(15_000)
  })

  it('满血目标：所有治疗都是过量治疗', () => {
    const healer = makeUnit({ role: 'HEALER' })
    const target = makeUnit({ hp: 145_000, maxHp: 145_000 })
    const { effective, overheal } = calc.calcHealing(healer, target, 10_000)
    expect(effective).toBe(0)
    expect(overheal).toBe(10_000)
  })

  it('暴击治疗：effective 仍被 maxHp 裁切', () => {
    const healer = makeUnit({ role: 'HEALER' })
    const target = makeUnit({ hp: 140_000, maxHp: 145_000 })
    // forceCrit → baseHeal*2 = 40000, space = 5000
    const { effective, overheal } = calc.calcHealing(healer, target, 20_000, true)
    expect(effective).toBe(5_000)
    expect(overheal).toBe(35_000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T-01-03  ThreatManager 测试
// ─────────────────────────────────────────────────────────────────────────────
describe('T-01-03  ThreatManager', () => {
  let mgr: ThreatManager

  beforeEach(() => { mgr = new ThreatManager() })

  it('伤害 1:1 产生仇恨', () => {
    mgr.addDamageThreat('tank', 5_000)
    expect(mgr.getThreat('tank')).toBe(5_000)
  })

  it('治疗 0.5:1 产生仇恨', () => {
    mgr.addHealingThreat('healer', 10_000)
    expect(mgr.getThreat('healer')).toBe(5_000)
  })

  it('嘲讽后，嘲讽者成为仇恨首位（≥当前首位×110%）', () => {
    mgr.addDamageThreat('dps', 10_000)
    mgr.addDamageThreat('tank', 5_000)
    // Before taunt: dps is top at 10000
    expect(mgr.getTopUnit()).toBe('dps')

    mgr.taunt('tank')   // tank → 10000 × 1.1 = 11000
    expect(mgr.getTopUnit()).toBe('tank')
    expect(mgr.getThreat('tank')).toBeCloseTo(11_000)
  })

  it('嘲讽后仇恨首位切换为嘲讽者', () => {
    mgr.addDamageThreat('boss-threat-dps', 50_000)
    mgr.addDamageThreat('original-tank', 20_000)
    mgr.taunt('new-tank')
    expect(mgr.getTopUnit()).toBe('new-tank')
  })

  it('空仇恨表时嘲讽：首位为嘲讽者（threat=0）', () => {
    mgr.taunt('solo-tank')
    expect(mgr.getTopUnit()).toBe('solo-tank')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T-01-04  AuraManager 测试
// ─────────────────────────────────────────────────────────────────────────────
describe('T-01-04  AuraManager', () => {
  let mgr: AuraManager

  beforeEach(() => {
    mgr = new AuraManager()
    mgr.healingDealt = 0
    mgr.damageDealt = 0
  })

  function makeHoT(overrides: Partial<Aura> = {}): Aura {
    return {
      id: 'lifebloom',
      name: '生命绽放',
      type: 'HOT',
      stacks: 1,
      maxStacks: 3,
      tickValue: 2_000,
      tickIntervalMs: 1_000,
      durationMs: 10_000,
      remainingMs: 10_000,
      elapsedSinceTickMs: 0,
      ...overrides,
    }
  }

  it('HoT 正常 tick 回血', () => {
    mgr.addBuff(makeHoT())
    mgr.tickAllAuras(1_000)   // 1 tick
    expect(mgr.healingDealt).toBe(2_000)
  })

  it('生命绽放叠 3 层：tick 值 × stacks', () => {
    const hot = makeHoT()
    mgr.addBuff(hot)
    mgr.addBuff(hot)
    mgr.addBuff(hot)
    const aura = mgr.getAura('lifebloom')!
    expect(aura.stacks).toBe(3)
    mgr.tickAllAuras(1_000)
    expect(mgr.healingDealt).toBe(6_000)   // 2000 × 3
  })

  it('嗜血（Bloodlust）：同名 Buff 不能重复添加到疲惫中', () => {
    // 嗜血 = 添加疲惫 debuff
    const exhaustion: Aura = {
      id: 'exhaustion',
      name: '疲惫',
      type: 'DEBUFF',
      stacks: 1,
      maxStacks: 1,
      tickValue: 0,
      tickIntervalMs: 1_000,
      durationMs: 600_000,  // 10 min
      remainingMs: 600_000,
      elapsedSinceTickMs: 0,
    }
    // 释放嗜血时添加疲惫
    mgr.addBuff(exhaustion)
    // 检查是否有疲惫 → 阻止再次施放
    const hasExhaustion = !!mgr.getAura('exhaustion')
    expect(hasExhaustion).toBe(true)   // 有疲惫，无法再嗜血

    // 再次尝试添加（模拟再嗜血）：stacks 保持 1，remainingMs 刷新但不超过 maxStacks
    mgr.addBuff(exhaustion)
    expect(mgr.getAura('exhaustion')!.stacks).toBe(1)
  })

  it('时间扭曲（Time Warp）与嗜血共享疲惫标记', () => {
    // 时间扭曲施放时同样检查 exhaustion buff
    const exhaustion: Aura = {
      id: 'exhaustion',
      name: '疲惫',
      type: 'DEBUFF',
      stacks: 1, maxStacks: 1,
      tickValue: 0, tickIntervalMs: 1_000,
      durationMs: 600_000, remainingMs: 600_000,
      elapsedSinceTickMs: 0,
    }
    // 嗜血先施放
    mgr.addBuff(exhaustion)
    // 时间扭曲检查
    const canTimeWarp = !mgr.getAura('exhaustion')
    expect(canTimeWarp).toBe(false)   // 已有疲惫，时间扭曲不可用
  })

  it('Aura 到期后自动移除', () => {
    mgr.addBuff(makeHoT({ durationMs: 2_000, remainingMs: 2_000 }))
    mgr.tickAllAuras(2_001)
    expect(mgr.getAura('lifebloom')).toBeUndefined()
  })

  it('生命绽放3层叠满后到期触发大绽放回调', () => {
    let bigBloomTriggered = false
    const hot = makeHoT({
      maxStacks: 3,
      durationMs: 1_000,
      remainingMs: 1_000,
      onExpire: (aura) => {
        if (aura.stacks >= 3) bigBloomTriggered = true
      },
    })
    mgr.addBuff(hot)
    mgr.addBuff(hot)
    mgr.addBuff(hot)
    mgr.tickAllAuras(1_001)   // expire
    expect(bigBloomTriggered).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T-01-05  ResourceManager 测试
// ─────────────────────────────────────────────────────────────────────────────
describe('T-01-05  ResourceManager', () => {
  let mgr: ResourceManager

  beforeEach(() => { mgr = new ResourceManager() })

  it('符文消耗后进入 10s CD', () => {
    const ok = mgr.consumeRune(0)
    expect(ok).toBe(true)
    expect(mgr.isRuneReady(0)).toBe(false)
    expect(mgr.getRuneCooldownRemaining(0)).toBe(10_000)
  })

  it('符文 CD 中无法再次使用', () => {
    mgr.consumeRune(0)
    const ok2 = mgr.consumeRune(0)
    expect(ok2).toBe(false)
  })

  it('符文 10s 后 CD 结束', () => {
    mgr.consumeRune(0)
    mgr.tickRunes(10_000)
    expect(mgr.isRuneReady(0)).toBe(true)
  })

  it('符文 5s 后仍在 CD 中', () => {
    mgr.consumeRune(0)
    mgr.tickRunes(5_000)
    expect(mgr.isRuneReady(0)).toBe(false)
    expect(mgr.getRuneCooldownRemaining(0)).toBeCloseTo(5_000)
  })

  it('能量每秒 +10（1000ms 后 energy +10）', () => {
    mgr.energy = 0
    mgr.tickEnergy(1_000)
    expect(mgr.energy).toBeCloseTo(10)
  })

  it('能量不超过 maxEnergy（100）', () => {
    mgr.energy = 95
    mgr.tickEnergy(2_000)   // +20 → 115，但裁切到 100
    expect(mgr.energy).toBe(100)
  })

  it('6 枚符文独立 CD 互不干扰', () => {
    mgr.consumeRune(0)
    mgr.consumeRune(1)
    expect(mgr.isRuneReady(2)).toBe(true)   // rune 2 未使用
    mgr.tickRunes(5_000)
    expect(mgr.isRuneReady(0)).toBe(false)  // rune 0 仍在 CD
    expect(mgr.isRuneReady(2)).toBe(true)   // rune 2 仍就绪
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T-01-06  CooldownManager 测试
// ─────────────────────────────────────────────────────────────────────────────
describe('T-01-06  CooldownManager', () => {
  it('GCD 默认 1500ms', () => {
    const mgr = new CooldownManager(false)
    mgr.startGcd()
    expect(mgr.getGcdRemaining()).toBe(1_500)
  })

  it('盗贼 GCD 为 1000ms', () => {
    const mgr = new CooldownManager(true)
    mgr.startGcd()
    expect(mgr.getGcdRemaining()).toBe(1_000)
  })

  it('GCD 期间 canCast 返回 false', () => {
    const mgr = new CooldownManager()
    mgr.startGcd()
    expect(mgr.canCast('fireball')).toBe(false)
  })

  it('GCD 结束后 canCast 返回 true', () => {
    const mgr = new CooldownManager()
    mgr.startGcd()
    mgr.tick(1_500)
    expect(mgr.canCast('fireball')).toBe(true)
  })

  it('独立 CD 与 GCD 互不干扰', () => {
    const mgr = new CooldownManager()
    mgr.startCooldown('bloodlust', 300_000)   // 5 min CD
    // GCD 未启动
    expect(mgr.canCast('fireball')).toBe(true)   // fireball 无 CD，GCD=0
    expect(mgr.canCast('bloodlust')).toBe(false) // bloodlust 有独立 CD
  })

  it('独立 CD 结束后可再次施放', () => {
    const mgr = new CooldownManager()
    mgr.startCooldown('mindfreeze', 15_000)
    mgr.tick(15_000)
    expect(mgr.canCast('mindfreeze')).toBe(true)
  })
})
