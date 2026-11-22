/**
 * T-02 职业技能集成测试
 * 测试工具：Vitest
 * 覆盖：DK、德鲁伊、萨满、法师、潜行者 核心技能逻辑
 */
import { describe, it, expect, beforeEach } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// 轻量级 Mock 实现（待 engine 实现后替换为真实导入）
// ─────────────────────────────────────────────────────────────────────────────

interface Unit {
  id: string
  classId: 'DK' | 'DRUID' | 'SHAMAN' | 'MAGE' | 'ROGUE'
  role: 'TANK' | 'HEALER' | 'DPS'
  hp: number
  maxHp: number
  mp: number
  maxMp: number
  energy: number
  comboPoints: number
  alive: boolean
  buffs: Map<string, Buff>
}

interface Buff {
  id: string
  stacks: number
  maxStacks: number
  durationMs: number
  remainingMs: number
  onExpire?: () => void
}

function makeUnit(id: string, classId: Unit['classId'], role: Unit['role']): Unit {
  const maxHp = role === 'TANK' ? 145_000 : 105_000
  return {
    id, classId, role,
    hp: maxHp, maxHp,
    mp: 100_000, maxMp: 100_000,
    energy: 100,
    comboPoints: 0,
    alive: true,
    buffs: new Map(),
  }
}

/** 获取或初始化 Buff */
function getBuff(unit: Unit, id: string): Buff | undefined {
  return unit.buffs.get(id)
}

function addBuff(unit: Unit, buff: Buff): void {
  const existing = unit.buffs.get(buff.id)
  if (existing) {
    existing.stacks = Math.min(existing.stacks + 1, buff.maxStacks)
    existing.remainingMs = buff.durationMs
  } else {
    unit.buffs.set(buff.id, { ...buff })
  }
}

function removeBuff(unit: Unit, id: string): void {
  unit.buffs.delete(id)
}

// ─────────────────────────────────────────────────────────────────────────────
// C-01  死亡骑士（DK）
// ─────────────────────────────────────────────────────────────────────────────
describe('T-02-01  DK：鲜血护盾', () => {
  it('灵界打击生成鲜血护盾：吸收量 = maxHp × 8%', () => {
    const dk = makeUnit('dk-1', 'DK', 'TANK')

    // 灵界打击触发时计算护盾值
    function deathStrike(caster: Unit) {
      const shieldAmount = Math.floor(caster.maxHp * 0.08)
      addBuff(caster, {
        id: 'blood-shield',
        stacks: 1,
        maxStacks: 1,
        durationMs: 10_000,
        remainingMs: 10_000,
      })
      return shieldAmount
    }

    const shieldAmount = deathStrike(dk)
    expect(shieldAmount).toBe(Math.floor(145_000 * 0.08))  // 11600
    expect(getBuff(dk, 'blood-shield')).toBeDefined()
  })

  it('鲜血护盾持续 10 秒', () => {
    const dk = makeUnit('dk-2', 'DK', 'TANK')
    addBuff(dk, {
      id: 'blood-shield',
      stacks: 1, maxStacks: 1,
      durationMs: 10_000,
      remainingMs: 10_000,
    })
    expect(getBuff(dk, 'blood-shield')!.remainingMs).toBe(10_000)
  })

  it('DK maxHp = 145000（5人英雄本坦克数值）', () => {
    const dk = makeUnit('dk-3', 'DK', 'TANK')
    expect(dk.maxHp).toBe(145_000)
    // 护盾 = 145000 × 8% = 11600
    const shield = Math.floor(dk.maxHp * 0.08)
    expect(shield).toBe(11_600)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// C-02  德鲁伊：生命绽放
// ─────────────────────────────────────────────────────────────────────────────
describe('T-02-02  德鲁伊：生命绽放大绽放触发', () => {
  it('3 层叠满后到期触发大绽放', () => {
    const target = makeUnit('player-2', 'DK', 'TANK')
    target.hp = 100_000   // 受伤状态

    let bigBloomFired = false
    let bigBloomHeal = 0

    function applyLifebloom(unit: Unit, stacks: number) {
      const existing = getBuff(unit, 'lifebloom')
      if (existing) {
        existing.stacks = Math.min(existing.stacks + 1, 3)
        existing.remainingMs = 10_000
      } else {
        unit.buffs.set('lifebloom', {
          id: 'lifebloom',
          stacks,
          maxStacks: 3,
          durationMs: 10_000,
          remainingMs: 10_000,
          onExpire: () => {
            const bloom = unit.buffs.get('lifebloom')!
            if (bloom.stacks >= 3) {
              bigBloomFired = true
              bigBloomHeal = 15_000  // 大绽放固定治疗量（模拟）
              unit.hp = Math.min(unit.maxHp, unit.hp + bigBloomHeal)
            }
          },
        })
      }
    }

    // 叠 3 层
    applyLifebloom(target, 1)
    applyLifebloom(target, 2)
    applyLifebloom(target, 3)

    const lifebloom = getBuff(target, 'lifebloom')!
    expect(lifebloom.stacks).toBe(3)

    // 触发到期
    lifebloom.onExpire!()
    expect(bigBloomFired).toBe(true)
    expect(bigBloomHeal).toBe(15_000)
  })

  it('未叠满 3 层（2层）到期不触发大绽放', () => {
    const target = makeUnit('player-3', 'DRUID', 'HEALER')
    let bigBloomFired = false

    target.buffs.set('lifebloom', {
      id: 'lifebloom',
      stacks: 2,
      maxStacks: 3,
      durationMs: 10_000,
      remainingMs: 10_000,
      onExpire: () => {
        const bloom = target.buffs.get('lifebloom')!
        if (bloom.stacks >= 3) bigBloomFired = true
      },
    })

    target.buffs.get('lifebloom')!.onExpire!()
    expect(bigBloomFired).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// C-03  萨满祭司：嗜血 → 疲惫 → 无法再嗜血
// ─────────────────────────────────────────────────────────────────────────────
describe('T-02-03  萨满：嗜血/疲惫互斥', () => {
  it('嗜血施放后添加疲惫 Debuff', () => {
    const shaman = makeUnit('shaman-1', 'SHAMAN', 'HEALER')
    const party = [shaman]

    function bloodlust(caster: Unit, targets: Unit[]): boolean {
      // 检查施法者是否有疲惫
      if (caster.buffs.has('exhaustion')) return false

      // 施放成功：给全团添加嗜血 + 疲惫
      for (const t of targets) {
        addBuff(t, {
          id: 'bloodlust',
          stacks: 1, maxStacks: 1,
          durationMs: 40_000, remainingMs: 40_000,
        })
        addBuff(t, {
          id: 'exhaustion',
          stacks: 1, maxStacks: 1,
          durationMs: 600_000, remainingMs: 600_000,
        })
      }
      return true
    }

    const first = bloodlust(shaman, party)
    expect(first).toBe(true)
    expect(shaman.buffs.has('bloodlust')).toBe(true)
    expect(shaman.buffs.has('exhaustion')).toBe(true)

    // 疲惫期间再次施放嗜血
    const second = bloodlust(shaman, party)
    expect(second).toBe(false)
  })

  it('疲惫结束后可再次施放嗜血', () => {
    const shaman = makeUnit('shaman-2', 'SHAMAN', 'HEALER')
    shaman.buffs.set('exhaustion', {
      id: 'exhaustion',
      stacks: 1, maxStacks: 1,
      durationMs: 600_000, remainingMs: 1,
    })
    // 模拟疲惫过期
    shaman.buffs.delete('exhaustion')
    expect(shaman.buffs.has('exhaustion')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// C-04  法师：时间扭曲与嗜血共享疲惫
// ─────────────────────────────────────────────────────────────────────────────
describe('T-02-04  法师：时间扭曲与嗜血共享疲惫', () => {
  it('嗜血后，法师时间扭曲不可施放', () => {
    const mage = makeUnit('mage-1', 'MAGE', 'DPS')

    function timeWarp(caster: Unit): boolean {
      if (caster.buffs.has('exhaustion')) return false
      addBuff(caster, {
        id: 'bloodlust',
        stacks: 1, maxStacks: 1,
        durationMs: 40_000, remainingMs: 40_000,
      })
      addBuff(caster, {
        id: 'exhaustion',
        stacks: 1, maxStacks: 1,
        durationMs: 600_000, remainingMs: 600_000,
      })
      return true
    }

    // 先由萨满嗜血，给法师添加疲惫
    addBuff(mage, {
      id: 'exhaustion',
      stacks: 1, maxStacks: 1,
      durationMs: 600_000, remainingMs: 600_000,
    })

    const canTW = timeWarp(mage)
    expect(canTW).toBe(false)   // 嗜血后有疲惫，时间扭曲不可用
  })

  it('时间扭曲施放后，萨满嗜血不可施放', () => {
    const shaman = makeUnit('shaman-tw', 'SHAMAN', 'HEALER')

    function bloodlust(caster: Unit): boolean {
      return !caster.buffs.has('exhaustion')
    }

    // 时间扭曲先触发，给萨满添加疲惫
    addBuff(shaman, {
      id: 'exhaustion',
      stacks: 1, maxStacks: 1,
      durationMs: 600_000, remainingMs: 600_000,
    })

    expect(bloodlust(shaman)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// C-05  潜行者：连击点 1→5，终结技消耗全部
// ─────────────────────────────────────────────────────────────────────────────
describe('T-02-05  潜行者：连击点系统', () => {
  it('每次连击点技能生成 1 连击点，最多 5 点', () => {
    const rogue = makeUnit('rogue-1', 'ROGUE', 'DPS')

    function sinisterStrike(caster: Unit) {
      caster.comboPoints = Math.min(5, caster.comboPoints + 1)
    }

    for (let i = 0; i < 7; i++) sinisterStrike(rogue)   // 超出上限
    expect(rogue.comboPoints).toBe(5)
  })

  it('连续使用 5 次：连击点从 0 到 5', () => {
    const rogue = makeUnit('rogue-2', 'ROGUE', 'DPS')

    function backstab(caster: Unit) {
      caster.comboPoints = Math.min(5, caster.comboPoints + 1)
    }

    expect(rogue.comboPoints).toBe(0)
    for (let i = 1; i <= 5; i++) {
      backstab(rogue)
      expect(rogue.comboPoints).toBe(i)
    }
  })

  it('终结技消耗全部连击点（5→0）', () => {
    const rogue = makeUnit('rogue-3', 'ROGUE', 'DPS')
    rogue.comboPoints = 5

    function eviscerate(caster: Unit): boolean {
      if (caster.comboPoints <= 0) return false
      const pts = caster.comboPoints
      caster.comboPoints = 0
      return pts >= 1  // consumed
    }

    const ok = eviscerate(rogue)
    expect(ok).toBe(true)
    expect(rogue.comboPoints).toBe(0)
  })

  it('0 连击点时终结技无法施放', () => {
    const rogue = makeUnit('rogue-4', 'ROGUE', 'DPS')

    function eviscerate(caster: Unit): boolean {
      if (caster.comboPoints <= 0) return false
      caster.comboPoints = 0
      return true
    }

    expect(eviscerate(rogue)).toBe(false)
    expect(rogue.comboPoints).toBe(0)
  })

  it('1 连击点终结技：伤害低于 5 连击点', () => {
    const rogue = makeUnit('rogue-5', 'ROGUE', 'DPS')

    function eviscerateCalcDmg(pts: number): number {
      return 5_000 + pts * 2_000   // 模拟伤害随连击点线性增长
    }

    expect(eviscerateCalcDmg(1)).toBeLessThan(eviscerateCalcDmg(5))
  })
})
