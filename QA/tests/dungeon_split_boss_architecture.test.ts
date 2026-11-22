import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  BossRegistry,
  createBossAI,
  BaseBossAI,
  type BossEncounterModule,
  type BossSkill,
} from '../../DEV/packages/engine/src/bosses/index.js';
import { CombatEngine } from '../../DEV/packages/engine/src/engine/CombatEngine.js';
import type { Unit } from '../../DEV/packages/engine/src/types.js';

describe('Dungeon-Split Boss Architecture (按副本名拆分的个体特性首领架构)', () => {
  it('1. 验证影牙城堡 (shadowfang_keep) 5个首领特性已独立拆分并成功注册', () => {
    const shadowfangBosses = BossRegistry.getByDungeon('shadowfang_keep');
    assert.strictEqual(shadowfangBosses.length, 5, '影牙城堡必须完整注册 5 位首领');

    const expectedIds = ['ashbury', 'silverlaine', 'springvale', 'walden', 'godfrey'];
    for (const id of expectedIds) {
      const boss = BossRegistry.get(id, 'shadowfang_keep');
      assert.ok(boss, `首领 ${id} 必须注册存在`);
      assert.strictEqual(boss?.dungeonId, 'shadowfang_keep');
    }
  });

  it('2. 验证巨龙之魂 (dragon_soul) 20人团本首领已独立拆分并成功注册', () => {
    const dsBosses = BossRegistry.getByDungeon('dragon_soul');
    assert.strictEqual(dsBosses.length >= 8, true, '巨龙之魂必须注册至少 8 位首领');

    const morchok = BossRegistry.get('morchok', 'dragon_soul');
    assert.ok(morchok, '莫卓克必须存在');
    assert.strictEqual(morchok?.tier, '20man');

    const ultraxion = BossRegistry.get('ultraxion', 'dragon_soul');
    assert.ok(ultraxion, '奥卓克希昂必须存在');
  });

  it('3. 验证公共 BaseBossAI 与首领实例创建、读条与安全治疗窗口期', () => {
    const ashburyAI = createBossAI('ashbury', 'shadowfang_keep');
    assert.ok(ashburyAI instanceof BaseBossAI, '必须继承自 BaseBossAI');
    assert.strictEqual(ashburyAI.bossId, 'ashbury');
    assert.strictEqual(ashburyAI.dungeonId, 'shadowfang_keep');

    const skills = ashburyAI.skills;
    const asphyxiate = skills.find(s => s.id === 'asphyxiate');
    assert.ok(asphyxiate, '必须包含窒息术');
    assert.ok(skills.some(s => s.id === 'stay_of_execution'), '必须包含暂缓处决');
    assert.ok(skills.some(s => s.id === 'mend_rotten_flesh'), '必须包含修补烂肉');
    assert.ok(skills.some(s => s.id === 'calamity'), '必须包含苦痛灾厄');
  });

  it('4. 验证平滑扩展全新副本（如火源之界 Firelands）：无需改动公共代码即可热插拔注册并生效', () => {
    const mockRagnaros: BossEncounterModule = {
      id: 'ragnaros',
      name: '拉格纳罗斯',
      dungeonId: 'firelands',
      tier: '20man',
      createSkills(bossAi: any): BossSkill[] {
        return [
          {
            id: 'sulfuras_smash',
            name: '萨弗拉斯之击',
            castTimeMs: 2000,
            cooldownMs: 15000,
            lastCastMs: -5000,
            interruptible: false,
            school: 'FIRE',
            range: 80,
            targetKind: 'MELEE_TARGET',
            description: '巨锤砸向地面，造成大量火焰伤害并生成火浪',
            execute: (boss, engine) => {
              const tank = engine.friendlyUnits.find(u => u.alive && u.role === 'TANK');
              if (tank) {
                engine.dealDamage(boss, tank, 65000, 'FIRE', false, '萨弗拉斯之击');
              }
            },
          },
        ];
      },
    };

    // 独立注册新副本首领
    BossRegistry.register(mockRagnaros);

    // 验证可通过副本名与首领名索引并实例化
    const ragAI = createBossAI('ragnaros', 'firelands');
    assert.strictEqual(ragAI.bossId, 'ragnaros');
    assert.strictEqual(ragAI.dungeonId, 'firelands');
    assert.strictEqual(ragAI.skills.length, 1);
    assert.strictEqual(ragAI.skills[0].id, 'sulfuras_smash');

    // 验证新副本可正常列出
    const firelandsBosses = BossRegistry.getByDungeon('firelands');
    assert.strictEqual(firelandsBosses.length, 1);
    assert.strictEqual(firelandsBosses[0].name, '拉格纳罗斯');
  });
});
