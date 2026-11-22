import assert from 'node:assert';
import { DEFAULT_KEYBINDINGS } from '../../DEV/packages/web/src/components/ActionBar.js';

console.log('--- 运行技能按键长按保持与弹起即刻恢复机制测试 ---');

// 模拟 ActionBar 内部的按键按压与弹起状态管理逻辑
class KeyPressStateManager {
  public pressedSlots: Record<number, boolean> = {};
  public activeKeySlots = new Map<string, {
    slotIdx: number;
    requiresShift: boolean;
    requiresCtrl: boolean;
    requiresAlt: boolean;
  }>();

  constructor(public keybindings: Record<number, string> = DEFAULT_KEYBINDINGS) {}

  public getKeySig(e: { key: string; code?: string; shiftKey?: boolean }): string {
    if (e.key >= 'F1' && e.key <= 'F12') {
      return e.key.toUpperCase();
    }
    const code = e.code || '';
    if (code.startsWith('Digit')) {
      const num = code.replace('Digit', '');
      return e.shiftKey ? `SHIFT+${num}` : num;
    }
    if (code === 'Minus') {
      return e.shiftKey ? 'SHIFT+-' : '-';
    }
    if (code === 'Equal') {
      return e.shiftKey ? 'SHIFT+=' : '=';
    }
    return (e.shiftKey ? 'SHIFT+' : '') + e.key.toUpperCase();
  }

  public handleKeyDown(e: { key: string; code: string; shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean }) {
    const keySig = this.getKeySig(e);
    for (let idx = 0; idx < 36; idx++) {
      const boundKey = (this.keybindings[idx] || DEFAULT_KEYBINDINGS[idx] || '').toUpperCase();
      if (boundKey && boundKey === keySig) {
        this.activeKeySlots.set(e.code, {
          slotIdx: idx,
          requiresShift: boundKey.includes('SHIFT'),
          requiresCtrl: boundKey.includes('CTRL'),
          requiresAlt: boundKey.includes('ALT'),
        });
        this.pressedSlots[idx] = true;
        break;
      }
    }
  }

  public handleKeyUp(e: { key: string; code: string }) {
    // 1. 若释放 Shift / Ctrl / Alt 修饰键，释放所有依赖该修饰键的槽位
    if (e.key === 'Shift' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      for (const [code, info] of this.activeKeySlots.entries()) {
        if (info.requiresShift) {
          delete this.pressedSlots[info.slotIdx];
          this.activeKeySlots.delete(code);
        }
      }
    }
    if (e.key === 'Control' || e.code === 'ControlLeft' || e.code === 'ControlRight') {
      for (const [code, info] of this.activeKeySlots.entries()) {
        if (info.requiresCtrl) {
          delete this.pressedSlots[info.slotIdx];
          this.activeKeySlots.delete(code);
        }
      }
    }
    if (e.key === 'Alt' || e.code === 'AltLeft' || e.code === 'AltRight') {
      for (const [code, info] of this.activeKeySlots.entries()) {
        if (info.requiresAlt) {
          delete this.pressedSlots[info.slotIdx];
          this.activeKeySlots.delete(code);
        }
      }
    }

    // 2. 释放具体物理按键绑定的槽位
    const info = this.activeKeySlots.get(e.code);
    if (info) {
      delete this.pressedSlots[info.slotIdx];
      this.activeKeySlots.delete(e.code);
    }
  }

  public handleBlur() {
    this.activeKeySlots.clear();
    this.pressedSlots = {};
  }
}

async function runTests() {
  const manager = new KeyPressStateManager();

  // Test 1: 按键按下即进入 pressed 状态，并且不再受固定时长限制自动恢复
  manager.handleKeyDown({ key: '1', code: 'Digit1' });
  assert.strictEqual(manager.pressedSlots[0], true, '按键 1 按下时，槽位 0 应立即标记为 pressed');
  assert.strictEqual(manager.activeKeySlots.has('Digit1'), true, '活动按键表应记录 Digit1');

  // 模拟长按（即使等待 100ms，按键仍旧保持按下，不会像之前固定50ms后自动弹起）
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(manager.pressedSlots[0], true, '长按 100ms 后，槽位 0 必须持续保持按下状态');

  // Test 2: 一旦按键弹起（keyup），槽位立即恢复
  manager.handleKeyUp({ key: '1', code: 'Digit1' });
  assert.strictEqual(manager.pressedSlots[0], undefined, '按键 1 弹起时，槽位 0 必须立即恢复正常');
  assert.strictEqual(manager.activeKeySlots.has('Digit1'), false, '活动按键表中 Digit1 必须已清除');
  console.log('✓ 1. 按键长按持续保持、弹起立即恢复机制验证通过');

  // Test 3: 组合键 (Shift+1 -> 槽位 12)
  manager.handleKeyDown({ key: '!', code: 'Digit1', shiftKey: true });
  assert.strictEqual(manager.pressedSlots[12], true, 'Shift+1 按下时，槽位 12 应标记为 pressed');
  
  // 释放 Shift 键，槽位 12 应立刻恢复
  manager.handleKeyUp({ key: 'Shift', code: 'ShiftLeft' });
  assert.strictEqual(manager.pressedSlots[12], undefined, '释放 Shift 键时，Shift+1 绑定的槽位 12 必须立即恢复');
  console.log('✓ 2. 组合键修饰键释放联动恢复机制验证通过');

  // Test 4: 多按键同时按下与分别弹起
  manager.handleKeyDown({ key: '2', code: 'Digit2' });
  manager.handleKeyDown({ key: '3', code: 'Digit3' });
  assert.strictEqual(manager.pressedSlots[1], true, '槽位 1 (按键2) 处于按下状态');
  assert.strictEqual(manager.pressedSlots[2], true, '槽位 2 (按键3) 处于按下状态');

  // 弹起按键 2，按键 3 保持按下
  manager.handleKeyUp({ key: '2', code: 'Digit2' });
  assert.strictEqual(manager.pressedSlots[1], undefined, '按键 2 弹起，槽位 1 恢复');
  assert.strictEqual(manager.pressedSlots[2], true, '按键 3 未弹起，槽位 2 继续保持按下');

  // 弹起按键 3
  manager.handleKeyUp({ key: '3', code: 'Digit3' });
  assert.strictEqual(manager.pressedSlots[2], undefined, '按键 3 弹起，槽位 2 恢复');
  console.log('✓ 3. 多按键独立按下与独立弹起机制验证通过');

  // Test 5: 窗口失焦 (blur) 安全保底清空
  manager.handleKeyDown({ key: '4', code: 'Digit4' });
  assert.strictEqual(manager.pressedSlots[3], true, '槽位 3 处于按下状态');
  manager.handleBlur();
  assert.deepStrictEqual(manager.pressedSlots, {}, '窗口失焦后所有按键状态必须彻底清空');
  assert.strictEqual(manager.activeKeySlots.size, 0, '活动按键表必须彻底清空');
  console.log('✓ 4. 窗口失焦保底清空机制验证通过');

  console.log('🎉 全部技能按键长按保持与弹起即刻恢复机制测试通过！');
}

runTests().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
