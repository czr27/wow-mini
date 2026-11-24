import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createAIPersonality,
  resolveRepositionReactionDelayMs,
} from '../ai/SkillMetricEvaluator.js';

describe('AI smartness (聪慧指数)', () => {
  it('同名同 id 稳定；不同名通常不同', () => {
    const a = createAIPersonality('瓦里安', 'tank_1');
    const b = createAIPersonality('瓦里安', 'tank_1');
    const c = createAIPersonality('吉安娜', 'mage_1');
    assert.equal(a.smartness, b.smartness);
    assert.equal(a.seed, b.seed);
    assert.ok(a.smartness >= 0 && a.smartness <= 1);
    assert.notEqual(a.smartness, c.smartness);
  });

  it('反应延迟：聪明≈0，笨常态≤2s，极笨可>3s', () => {
    const smart = { ...createAIPersonality('smart', 's'), smartness: 1 };
    const mid = { ...createAIPersonality('mid', 'm'), smartness: 0.5 };
    const dumb = { ...createAIPersonality('dumb', 'd'), smartness: 0 };
    const veryDumb = { ...createAIPersonality('vdumb', 'v'), smartness: 0.05 };

    assert.equal(resolveRepositionReactionDelayMs(smart), 0);
    assert.ok(resolveRepositionReactionDelayMs(mid) <= 2000);
    assert.ok(Math.abs(resolveRepositionReactionDelayMs(mid) - 1000) < 1e-6);

    // 常态（不触发额外 roll）
    assert.equal(resolveRepositionReactionDelayMs(dumb, 0.99), 2000);
    // 极笨触发超 3s
    const slow = resolveRepositionReactionDelayMs(veryDumb, 0);
    assert.ok(slow >= 3000, `expected >=3000 got ${slow}`);
  });
});
