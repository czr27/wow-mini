import { registerShadowfangBosses } from './shadowfang/index.js';
import { registerDragonSoulBosses } from './dragonsoul/index.js';
import { registerDeadminesBosses } from './deadmines/index.js';
import { registerScarletMonasteryBosses } from './scarlet_monastery/index.js';
import { registerStratholmeBosses } from './stratholme/index.js';
import { registerZulgurubBosses } from './zulgurub/index.js';
import { BaseBossAI, BossAI } from './core/BaseBossAI.js';

export * from './core/BossTypes.js';
export * from './core/BossRegistry.js';
export * from './core/BaseBossAI.js';
export * from './core/FiveManShell.js';
export * from './shadowfang/index.js';
export * from './dragonsoul/index.js';
export * from './deadmines/index.js';
export * from './scarlet_monastery/index.js';
export * from './stratholme/index.js';
export * from './zulgurub/index.js';

// 初始化默认注册所有内置副本首领特性
registerShadowfangBosses();
registerDragonSoulBosses();
registerDeadminesBosses();
registerScarletMonasteryBosses();
registerStratholmeBosses();
registerZulgurubBosses();

/**
 * 工厂方法：按首领 ID 与可选副本 ID 创建 BossAI 实例
 */
export function createBossAI(bossId: string, dungeonId?: string): BaseBossAI {
  return new BaseBossAI(bossId, dungeonId);
}
