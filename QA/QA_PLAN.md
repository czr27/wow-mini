# 🧪 测试计划（QA_PLAN）

> **测试目标**：确保每个功能模块开发后单独测试通过，整个游戏开发完成后系统集成测试，包含画面视觉验证。

---

## 1. 测试分层策略

```
单元测试（Vitest）→ 集成测试（Vitest + 引擎全流程）→ E2E+视觉测试（Playwright）
```

| 层次 | 工具 | 覆盖范围 | 自动化 |
|------|------|----------|--------|
| 单元测试 | Vitest | engine核心逻辑（计算/状态机/AI） | ✅ CI自动 |
| 功能集成测试 | Vitest | 副本全流程（无UI） | ✅ CI自动 |
| E2E测试 | Playwright | 浏览器全交互流程 | ✅ CI自动 |
| 视觉截图测试 | Playwright | 画面像素级截图对比 | ✅ 基线比对 |
| 手动探索测试 | 人工 | 游戏感体验/打击感 | 手动 |

---

## 2. Phase 1 测试用例清单

### T-01 战斗引擎单元测试
- [ ] `calcDamage()` 普通/暴击/减伤/吸收结果正确
- [ ] `calcHealing()` 过量治疗裁切正确
- [ ] `threatTable` 嘲讽后仇恨首位切换
- [ ] `HoTManager` 叠层HoT正确tick扣血/回血
- [ ] `DoTManager` DoT刷新不重置旧层
- [ ] `ResourceManager` 符文10s CD冷却正确；能量每秒+10
- [ ] `CooldownManager` GCD/独立CD互不干扰
- [ ] `RunStateMachine` 状态转换：LOBBY→TRAVEL→COMBAT→WIPE_VOTE→SUMMARY

### T-02 职业技能测试
- [ ] DK：灵界打击生成鲜血护盾（吸收量正确）
- [ ] 德鲁伊：生命绽放3层叠满后结束触发大绽放
- [ ] 萨满：嗜血不能在疲惫状态下再次释放
- [ ] 法师：时间扭曲与嗜血疲惫共享
- [ ] 潜行者：连击点1-5生成，终结技消耗全部

### T-03 副本状态机集成测试
- [ ] 进入副本 → TRAVEL阶段12-15s自动结束 → COMBAT开始
- [ ] Boss死亡 → TRAVEL阶段（非最终Boss）
- [ ] 全团阵亡 → WIPE_VOTE 15s计时正确
- [ ] 投票重试 → 状态重置退回当前Boss TRAVEL阶段
- [ ] 投票结算 → SUMMARY页数据正确
- [ ] 最终Boss击败 → SUMMARY自动触发

### T-04 影牙5Boss端到端测试
- [ ] 亚什布里：暂缓处决可被打断（DK心灵冰冻/萨满风剪测试）
- [ ] 席瓦莱恩：降受疗诅咒可被驱散（德鲁伊净化测试）
- [ ] 斯普林瓦尔：亵渎毒圈在正确位置生成并持续
- [ ] 沃登：三色魔药AOE按时序正确触发
- [ ] 高弗雷：双枪弹幕扇形预警60°正确，5s后造成伤害

### T-05 画面视觉验证（Playwright截图）
- [ ] 团队框架：5职业颜色正确（DK红/德橙/萨蓝/法浅蓝/贼黄）
- [ ] SCT暴击：金色+1.5×放大效果
- [ ] SCT治疗：翠绿上飘
- [ ] 萨满图腾：青绿扩散光环像素效果
- [ ] 百花齐放：绿色法阵花纹
- [ ] 亵渎毒圈：暗绿毒雾圈
- [ ] 双枪弹幕：红色60°扇形预警
- [ ] Boss血条：全宽红色渐变顶部居中
- [ ] 战报页：表格数据与预期DPS/HPS一致

### T-06 战报导出测试
- [ ] CSV导出：字段名/数据类型/编码正确（Excel可打开）
- [ ] JSON导出：结构符合 `DungeonRunExport` Schema
- [ ] 文件名格式：`ShadowfangKeep_Report_YYYYMMDD.csv`

---

## 3. 测试报告模板

报告存放路径：`QA/reports/report_YYYYMMDD_PHASEX.md`

```markdown
# 测试报告 — [阶段名] — [日期]

## 测试环境
- 浏览器：Chrome xxx
- Node：xxx
- 测试工具：Vitest vx.x / Playwright vx.x

## 测试结果汇总
| 测试集 | 总用例 | 通过 | 失败 | 跳过 |
|--------|--------|------|------|------|
| 单元测试 | - | - | - | - |
| 集成测试 | - | - | - | - |
| E2E测试 | - | - | - | - |
| 视觉截图 | - | - | - | - |

## 失败用例列表
（无则填"全部通过"）

## 视觉截图对比
（附截图路径）

## 结论与遗留问题
```

---

## 4. 视觉测试基线管理

- 基线截图存放：`QA/visual-tests/baselines/`
- 实际截图存放：`QA/visual-tests/actual/`
- Diff图存放：`QA/visual-tests/diff/`
- 更新基线命令：`npx playwright test --update-snapshots`
