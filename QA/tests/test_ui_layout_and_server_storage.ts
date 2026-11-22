import assert from 'node:assert';
import http from 'node:http';
import { AccountManager, DEFAULT_CUSTOM_DIFFICULTY } from '../../DEV/packages/engine/dist/index.js';
import { server, stopServer, accountsMap } from '../../DEV/packages/server/dist/index.js';

console.log('--- 运行 UI 布局角色记录与服务端持久化测试 ---');

async function runTests() {
  // 1. 启动测试服务端
  let testPort = 3105;
  if (!server.listening) {
    await new Promise<void>((resolve) => {
      server.listen(testPort, () => resolve());
    });
  } else {
    const addr = server.address();
    if (addr && typeof addr === 'object') {
      testPort = addr.port;
    }
  }
  console.log(`✓ 1. 本地存储测试服务端成功运行于端口 :${testPort}`);

  try {
    // 2. 测试角色 uiLayout 记录与恢复
    const accountMgr = new AccountManager();
    const testUser = accountMgr.register('LayoutTester', 'pwd123');
    assert(testUser, 'User registration should succeed');
    
    const char = accountMgr.createCharacter('雷克萨', 'DRUID', 'BALANCE');
    assert(char, 'Character creation should succeed');

    // 初始 uiLayout 应该存在且为空对象
    assert.deepStrictEqual(char.uiLayout, {}, 'Initial uiLayout should be an empty object');

    // 保存团队框架与动作条位置
    const layoutToSave = {
      raidFrames: { x: 50, y: 120, width: 320, height: 260 },
      actionBar: { x: 420, y: 780 },
      statsPanel: { x: 1100, y: 550 },
    };
    const saved = accountMgr.saveCharacterUiLayout(char.id, layoutToSave);
    assert.strictEqual(saved, true, 'saveCharacterUiLayout should return true');

    // 验证内存与角色对象中已实时记录
    const fetchedLayout = accountMgr.getCharacterUiLayout(char.id);
    assert.deepStrictEqual(fetchedLayout?.actionBar, { x: 420, y: 780 }, 'ActionBar position should be saved in character');
    assert.deepStrictEqual(fetchedLayout?.raidFrames, { x: 50, y: 120, width: 320, height: 260 }, 'RaidFrames layout should be saved in character');
    assert.deepStrictEqual(fetchedLayout?.statsPanel, { x: 1100, y: 550 }, 'StatsPanel position should be saved in character');
    console.log('✓ 2. 战斗界面布局 (团队框架/可拖拽动作条/统计面板) 成功记录在角色数据中');

    // 3. 测试通过 HTTP 同步至服务端并落盘持久化
    await new Promise((r) => setTimeout(r, 200)); // 等待防抖同步
    const serverUrl = `http://localhost:${testPort}`;
    
    // 手动调用一次全量同步确保网络层通信
    const syncRes = await fetch(`${serverUrl}/api/accounts/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([accountMgr.getCurrentAccount()]),
    });
    assert.strictEqual(syncRes.ok, true, 'Server sync endpoint should respond 200 OK');
    const syncJson = await syncRes.json();
    assert.strictEqual(syncJson.success, true, 'Server sync should report success');

    // 4. 从服务端拉取指定账号，验证服务器中持久化的角色数据包含完整 uiLayout
    const getRes = await fetch(`${serverUrl}/api/accounts/layouttester`);
    assert.strictEqual(getRes.ok, true, 'Server GET /api/accounts/:username should succeed');
    const serverAccount = await getRes.json();
    assert.strictEqual(serverAccount.username, 'LayoutTester');
    const serverChar = serverAccount.characters.find((c: any) => c.id === char.id);
    assert(serverChar, 'Server account must contain the character');
    assert.deepStrictEqual(serverChar.uiLayout.actionBar, { x: 420, y: 780 }, 'Server persisted character must preserve actionBar position');
    assert.deepStrictEqual(serverChar.uiLayout.raidFrames.width, 320, 'Server persisted character must preserve raidFrames dimensions');
    console.log('✓ 3. 服务端持久化接口与角色 uiLayout 跨端查询校验通过');

    // 5. 测试独立更新角色 uiLayout 端点 POST /api/characters/layout
    const updateLayoutRes = await fetch(`${serverUrl}/api/characters/layout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'LayoutTester',
        charId: char.id,
        layout: {
          actionBar: { x: 500, y: 820 },
        },
      }),
    });
    assert.strictEqual(updateLayoutRes.ok, true, 'POST /api/characters/layout should succeed');
    const updateJson = await updateLayoutRes.json();
    assert.deepStrictEqual(updateJson.uiLayout.actionBar, { x: 500, y: 820 }, 'Updated actionBar position returned');
    console.log('✓ 4. 服务端独立角色布局更新接口 POST /api/characters/layout 校验通过');

    // 6. 验证新客户端登录账号后从服务端加载权威数据 (未来联机登录流程)
    const freshClientAccountMgr = new AccountManager();
    const loadSuccess = await freshClientAccountMgr.loadFromServer(serverUrl);
    assert.strictEqual(loadSuccess, true, 'fresh client loadFromServer should succeed');
    const freshLogin = freshClientAccountMgr.login('LayoutTester', 'pwd123');
    assert(freshLogin, 'fresh login should find account from server');
    const freshChar = freshLogin.characters.find((c) => c.id === char.id);
    assert.deepStrictEqual(freshChar?.uiLayout?.actionBar, { x: 500, y: 820 }, 'Client loaded fresh layout from authoritative server');
    console.log('✓ 5. 未来联机跨设备/重登账号自动从服务器端拉取角色布局流程验证通过');

  } finally {
    await stopServer();
    console.log('✓ 测试服务端安全停止');
  }

  console.log('🎉 全部 UI 布局角色记录与服务端持久化测试项通过！');
}

runTests().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
