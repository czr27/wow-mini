import { registerShadowfangBosses } from './shadowfang/index.js';
import { registerDragonSoulBosses } from './dragonsoul/index.js';
import { BaseBossAI, BossAI } from './core/BaseBossAI.js';

export * from './core/BossTypes.js';
export * from './core/BossRegistry.js';
export * from './core/BaseBossAI.js';
export * from './shadowfang/index.js';
export * from './dragonsoul/index.js';

// 初始化默认注册所有内置副本首领特性
registerShadowfangBosses();
registerDragonSoulBosses();

/**
 * 工厂方法：按首领 ID 与可选副本 ID 创建 BossAI 实例
 */
export function createBossAI(bossId: string, dungeonId?: string): BaseBossAI {
  return new BaseBossAI(bossId, dungeonId);
}
