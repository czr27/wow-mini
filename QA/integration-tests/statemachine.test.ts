/**
 * T-03 副本状态机集成测试
 * 测试工具：Vitest
 * 覆盖：LOBBY→TRAVEL→COMBAT→WIPE_VOTE→SUMMARY 全流程
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Mock 状态机实现
// ─────────────────────────────────────────────────────────────────────────────
type RunPhase = 'LOBBY' | 'TRAVEL_RECOVERY' | 'BOSS_COMBAT' | 'WIPE_VOTE' | 'SUMMARY'

interface PhaseHistory {
  phase: RunPhase
  enteredAt: number
}

class RunStateMachine {
  phase: RunPhase = 'LOBBY'
  timeMs = 0
  travelDurationMs: number    // 12000–15000ms
  wipeVoteDurationMs = 15_000
  wipeVoteRemainingMs = 0
  currentBossIndex = 0
  totalBosses = 5
  history: PhaseHistory[] = []
  onPhaseChange?: (from: RunPhase, to: RunPhase) => void

  // Party
  party: { id: string; hp: number; maxHp: number; mp: number; maxMp: number; alive: boolean }[] = []

  constructor(travelDurationMs = 13_000, totalBosses = 5) {
    this.travelDurationMs = travelDurationMs
    this.totalBosses = totalBosses
  }

  private setPhase(next: RunPhase) {
    const prev = this.phase
    this.onPhaseChange?.(prev, next)
    this.history.push({ phase: next, enteredAt: this.timeMs })
    this.phase = next
  }

  startDungeon() {
    this.setPhase('TRAVEL_RECOVERY')
    this._travelRemaining = this.travelDurationMs
  }

  private _travelRemaining = 0

  tick(deltaMs: number) {
    this.timeMs += deltaMs

    if (this.phase === 'TRAVEL_RECOVERY') {
      this._travelRemaining -= deltaMs
      if (this._travelRemaining <= 0) {
        // 恢复 HP/MP
        for (const member of this.party) {
          member.hp = member.maxHp
          member.mp = member.maxMp
          member.alive = true
        }
        this.setPhase('BOSS_COMBAT')
      }
    }

    if (this.phase === 'WIPE_VOTE') {
      this.wipeVoteRemainingMs -= deltaMs
      if (this.wipeVoteRemainingMs <= 0) {
        // 超时默认进入 SUMMARY
        this.setPhase('SUMMARY')
      }
    }
  }

  onBossDeath() {
    if (this.phase !== 'BOSS_COMBAT') return
    this.currentBossIndex++
    if (this.currentBossIndex >= this.totalBosses) {
      // 最终 Boss → SUMMARY
      this.setPhase('SUMMARY')
    } else {
      // 非最终 Boss → TRAVEL
      this.setPhase('TRAVEL_RECOVERY')
      this._travelRemaining = this.travelDurationMs
    }
  }

  onWipe() {
    if (this.phase !== 'BOSS_COMBAT') return
    this.setPhase('WIPE_VOTE')
    this.wipeVoteRemainingMs = this.wipeVoteDurationMs
  }

  voteRetry() {
    if (this.phase !== 'WIPE_VOTE') return
    // 重试：回到当前 Boss 的 TRAVEL 阶段
    this.setPhase('TRAVEL_RECOVERY')
    this._travelRemaining = this.travelDurationMs
    // HP/MP 在进入 BOSS_COMBAT 时回满（tick 触发）
  }

  voteSummary() {
    if (this.phase !== 'WIPE_VOTE') return
    this.setPhase('SUMMARY')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 测试用 party
// ─────────────────────────────────────────────────────────────────────────────
function makeParty() {
  return [
    { id: 'tank',    hp: 145_000, maxHp: 145_000, mp: 100_000, maxMp: 100_000, alive: true },
    { id: 'healer',  hp: 105_000, maxHp: 105_000, mp: 100_000, maxMp: 100_000, alive: true },
    { id: 'dps-1',   hp: 105_000, maxHp: 105_000, mp: 100_000, maxMp: 100_000, alive: true },
    { id: 'dps-2',   hp: 105_000, maxHp: 105_000, mp: 100_000, maxMp: 100_000, alive: true },
    { id: 'dps-3',   hp: 105_000, maxHp: 105_000, mp: 100_000, maxMp: 100_000, alive: true },
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// T-03-01  LOBBY → TRAVEL → COMBAT 转换
// ─────────────────────────────────────────────────────────────────────────────
describe('T-03-01  LOBBY → TRAVEL_RECOVERY → BOSS_COMBAT', () => {
  it('初始状态为 LOBBY', () => {
    const sm = new RunStateMachine()
    expect(sm.phase).toBe('LOBBY')
  })

  it('startDungeon() 触发 TRAVEL_RECOVERY', () => {
    const sm = new RunStateMachine()
    sm.startDungeon()
    expect(sm.phase).toBe('TRAVEL_RECOVERY')
  })

  it('TRAVEL_RECOVERY 持续 12-15s 后进入 BOSS_COMBAT', () => {
    // travelDuration = 13000ms
    const sm = new RunStateMachine(13_000)
    sm.startDungeon()
    sm.tick(12_999)
    expect(sm.phase).toBe('TRAVEL_RECOVERY')   // 还未到
    sm.tick(1)
    expect(sm.phase).toBe('BOSS_COMBAT')       // 13000ms 后进入战斗
  })

  it('travelDuration 在 12000-15000ms 范围内均有效', () => {
    for (const dur of [12_000, 13_500, 15_000]) {
      const sm = new RunStateMachine(dur)
      sm.startDungeon()
      sm.tick(dur)
      expect(sm.phase).toBe('BOSS_COMBAT')
    }
  })

  it('TRAVEL 阶段 tick HP/MP 回满', () => {
    const sm = new RunStateMachine(5_000)
    const party = makeParty()
    sm.party = party
    // 模拟战斗损耗
    party[0].hp = 50_000
    party[1].mp = 20_000

    sm.startDungeon()
    sm.tick(5_000)
    expect(sm.phase).toBe('BOSS_COMBAT')
    expect(party[0].hp).toBe(145_000)   // 坦克满血
    expect(party[1].mp).toBe(100_000)   // 奶妈满蓝
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T-03-02  Boss 死亡转换
// ─────────────────────────────────────────────────────────────────────────────
describe('T-03-02  Boss 死亡后转换', () => {
  it('非最终 Boss 死亡 → TRAVEL_RECOVERY', () => {
    const sm = new RunStateMachine(5_000, 5)
    sm.startDungeon()
    sm.tick(5_000)
    expect(sm.phase).toBe('BOSS_COMBAT')   // Boss 1 战斗中

    sm.onBossDeath()   // Boss 1 死亡
    expect(sm.phase).toBe('TRAVEL_RECOVERY')
    expect(sm.currentBossIndex).toBe(1)
  })

  it('最终 Boss（第5个）死亡 → SUMMARY', () => {
    const sm = new RunStateMachine(5_000, 5)
    sm.phase = 'BOSS_COMBAT'
    sm.currentBossIndex = 4   // 准备击杀最终 Boss

    sm.onBossDeath()
    expect(sm.phase).toBe('SUMMARY')
    expect(sm.currentBossIndex).toBe(5)
  })

  it('前4个 Boss 死亡后 currentBossIndex 递增', () => {
    const sm = new RunStateMachine(1, 5)
    sm.startDungeon()
    sm.tick(1)

    for (let i = 0; i < 4; i++) {
      sm.onBossDeath()
      if (i < 3) {
        expect(sm.phase).toBe('TRAVEL_RECOVERY')
        sm.tick(1)   // 进入下一个战斗
      }
    }
    expect(sm.currentBossIndex).toBe(4)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T-03-03  全团阵亡 → WIPE_VOTE
// ─────────────────────────────────────────────────────────────────────────────
describe('T-03-03  全团阵亡 → WIPE_VOTE 15s 计时', () => {
  it('onWipe() 触发 WIPE_VOTE 阶段', () => {
    const sm = new RunStateMachine(1, 5)
    sm.phase = 'BOSS_COMBAT'
    sm.onWipe()
    expect(sm.phase).toBe('WIPE_VOTE')
  })

  it('WIPE_VOTE 计时 15s 后超时进入 SUMMARY', () => {
    const sm = new RunStateMachine(1, 5)
    sm.phase = 'BOSS_COMBAT'
    sm.onWipe()
    expect(sm.wipeVoteRemainingMs).toBe(15_000)

    sm.tick(14_999)
    expect(sm.phase).toBe('WIPE_VOTE')   // 还在投票中
    sm.tick(1)
    expect(sm.phase).toBe('SUMMARY')    // 超时进入 SUMMARY
  })

  it('WIPE_VOTE 时间在 0-15s 内正确递减', () => {
    const sm = new RunStateMachine(1, 5)
    sm.phase = 'BOSS_COMBAT'
    sm.onWipe()
    sm.tick(5_000)
    expect(sm.wipeVoteRemainingMs).toBe(10_000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T-03-04  WIPE_VOTE 投票结果
// ─────────────────────────────────────────────────────────────────────────────
describe('T-03-04  WIPE_VOTE 投票处理', () => {
  it('投票 A（重试） → TRAVEL_RECOVERY 重置', () => {
    const sm = new RunStateMachine(5_000, 5)
    sm.phase = 'BOSS_COMBAT'
    sm.currentBossIndex = 2
    sm.onWipe()
    expect(sm.phase).toBe('WIPE_VOTE')

    sm.voteRetry()   // 投票重试
    expect(sm.phase).toBe('TRAVEL_RECOVERY')
    expect(sm.currentBossIndex).toBe(2)   // Boss index 未变（重试同一个 Boss）
  })

  it('投票 B（结算） → SUMMARY', () => {
    const sm = new RunStateMachine(5_000, 5)
    sm.phase = 'BOSS_COMBAT'
    sm.onWipe()

    sm.voteSummary()
    expect(sm.phase).toBe('SUMMARY')
  })

  it('重试后 TRAVEL 结束 HP/MP 回满（可再战）', () => {
    const sm = new RunStateMachine(1_000, 5)
    const party = makeParty()
    sm.party = party
    sm.phase = 'BOSS_COMBAT'

    // 模拟战斗损耗
    party[0].hp = 1
    party[0].alive = false

    sm.onWipe()
    sm.voteRetry()
    sm.tick(1_000)   // TRAVEL 结束

    expect(sm.phase).toBe('BOSS_COMBAT')
    expect(party[0].hp).toBe(145_000)
    expect(party[0].alive).toBe(true)
    expect(party[1].mp).toBe(100_000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T-03-05  SUMMARY 状态稳定
// ─────────────────────────────────────────────────────────────────────────────
describe('T-03-05  SUMMARY 状态', () => {
  it('进入 SUMMARY 后 tick 不改变状态', () => {
    const sm = new RunStateMachine(1, 1)
    sm.phase = 'BOSS_COMBAT'
    sm.currentBossIndex = 0
    sm.onBossDeath()
    expect(sm.phase).toBe('SUMMARY')

    sm.tick(100_000)   // 大量 tick
    expect(sm.phase).toBe('SUMMARY')
  })

  it('阶段历史记录正确', () => {
    const sm = new RunStateMachine(5_000, 1)
    sm.startDungeon()
    sm.tick(5_000)
    sm.onBossDeath()

    const phases = sm.history.map(h => h.phase)
    expect(phases).toContain('TRAVEL_RECOVERY')
    expect(phases).toContain('BOSS_COMBAT')
    expect(phases).toContain('SUMMARY')
  })
})
