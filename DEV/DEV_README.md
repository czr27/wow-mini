# 🛠️ 开发环境搭建指南（DEV_README）

> AI接手时请先读此文件，确保开发环境正确配置。

## 1. 前置条件
- Node.js >= 18.x（推荐 LTS）
- npm >= 9.x
- 支持 TypeScript 5.x

## 2. Monorepo 结构（npm workspaces）

```
DEV/
├── package.json          ← 根（workspaces配置）
├── packages/
│   ├── engine/           ← 战斗引擎（纯TS，无浏览器API）
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── engine/   ← 核心引擎（tick/damage/threat/status）
│   │   │   ├── classes/  ← 职业技能定义
│   │   │   ├── bosses/   ← Boss数据与AI时间轴
│   │   │   └── ai/       ← AI行为状态机
│   │   └── tsconfig.json
│   ├── web/              ← React前端
│   │   ├── package.json
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx
│   │       ├── components/  ← React HUD组件
│   │       ├── canvas/      ← Canvas渲染层
│   │       └── store/       ← 游戏状态Store
│   └── server/           ← Node.js WebSocket（Phase 3）
│       ├── package.json
│       └── src/
│           └── index.ts
└── tsconfig.base.json    ← 共享TS配置
```

## 3. 安装与启动

```bash
# 进入DEV目录
cd DEV

# 安装所有依赖
npm install

# 开发模式启动前端
npm run dev -w packages/web

# 运行单元测试
npm run test -w packages/engine

# 构建
npm run build
```

## 4. 代码规范
- 文件命名：camelCase（ts文件）/ PascalCase（React组件）
- 类型：所有公共接口在`packages/engine/src/types.ts`定义
- 注释：中英文均可，核心算法必须注释
- 提交：每完成一个任务ID（如E-01）对应一次提交，提交信息格式：`[E-01] 核心数据结构定义`

## 5. 关键依赖版本（待初始化后锁定）
| 包 | 版本 | 用途 |
|----|------|------|
| react | ^18.x | 前端框架 |
| tailwindcss | ^3.x | 样式 |
| vite | ^5.x | 构建工具 |
| vitest | ^1.x | 单元测试 |
| playwright | ^1.x | E2E+视觉测试 |
| zustand | ^4.x | 游戏状态管理 |
| ws | ^8.x | WebSocket（server） |
