import {
  spawnGmWildPack,
  type BossAI,
  type CombatEngine,
  type GmCommandPayload,
  type RunStateMachine,
} from '@cata-raid-sim/engine';
import {
  buildLocalOwnerSnapshot,
  getCombatAuthorityContext,
  publishOwnerSnapshot,
} from './networkCombatAuthority.js';

export interface GmCommandExecCtx {
  engine: CombatEngine;
  bossAi: BossAI | null;
  rsm: RunStateMachine | null;
  onEnemyDmgMultChange?: (mult: number) => void;
  onSyncHud: () => void;
}

/**
 * 执行 GM 指令：
 * - 联机模式下使用 `withNetworkVitals(engine, ...)` 包裹，对非房主权威（客人的角色）会自动发出
 *   `COMBAT_EFFECT`（伤害/治疗/复活/Buff 效果信息），由各自权威端结算并回传 `OWNER_SNAPSHOT`，
 *   不会出现房主直接改写客人本地血量被覆盖或无效的问题。
 */
export function executeGmCommand(cmd: GmCommandPayload, ctx: GmCommandExecCtx): string {
  const { engine, bossAi, rsm, onEnemyDmgMultChange, onSyncHud } = ctx;

  const getActiveEnemies = () => [
    ...(engine.bossUnit && (engine.bossUnit.alive ?? engine.bossUnit.isAlive) && engine.bossUnit.hp > 0
      ? [engine.bossUnit]
      : []),
    ...engine.enemyUnits.filter(
      (e) => e.id !== engine.bossUnit?.id && (e.alive ?? e.isAlive) && e.hp > 0
    ),
  ];

  let note = '已执行 GM 指令';
  const auth = getCombatAuthorityContext();
  const isNetworked = Boolean(auth.activeRoomId && (auth.isNetworkHost || auth.isNetworkGuest));
  const canMutateUnit = (unitId: string) =>
    !isNetworked || auth.isUnitLocalAuthority(unitId);
  const canMutateWorld = !isNetworked || auth.isNetworkHost;

  const caster =
    engine.bossUnit ||
    engine.friendlyUnits.find((u) => u.isPlayer) ||
    engine.friendlyUnits[0];

  switch (cmd.kind) {
    case 'FRIENDLY_HP_PCT': {
      const pct = cmd.deltaPct ?? 0;
      const units = engine.friendlyUnits.filter(
        (u) => (u.alive ?? u.isAlive) && u.hp > 0 && canMutateUnit(u.id)
      );
      for (const u of units) {
        const amt = Math.max(1, Math.round(u.maxHp * Math.abs(pct)));
        if (pct > 0) {
          engine.healUnit(caster || u, u, amt, false, 'GM治疗');
        } else if (pct < 0) {
          engine.drainHpTowardFloor(u, amt, 1, 'GM扣血');
        }
      }
      note = `己方血量 ${pct > 0 ? '+' : ''}${Math.round(pct * 100)}%`;
      break;
    }

    case 'FRIENDLY_FULL_RESTORE': {
      for (const u of engine.friendlyUnits) {
        if (!canMutateUnit(u.id)) continue;
        if (!(u.alive ?? u.isAlive) || u.hp <= 0) {
          engine.resurrectUnit(u.id, 1);
        }
        engine.healUnit(caster || u, u, u.maxHp, false, 'GM满血');
        if (typeof u.maxMp === 'number' && u.maxMp > 0) u.mp = u.maxMp;
      }
      note = '己方全团已满血满蓝复活';
      break;
    }

    case 'ENEMY_HP_PCT': {
      if (canMutateWorld) {
        const pct = cmd.deltaPct ?? 0;
        for (const e of getActiveEnemies()) {
          const delta = Math.round(e.maxHp * pct);
          e.hp = Math.max(1, Math.min(e.maxHp, e.hp + delta));
        }
      }
      note = `敌方血量 ${(cmd.deltaPct ?? 0) > 0 ? '+' : ''}${Math.round((cmd.deltaPct ?? 0) * 100)}%`;
      break;
    }

    case 'ENEMY_SET_HP_ONE': {
      if (canMutateWorld) {
        for (const e of getActiveEnemies()) e.hp = 1;
      }
      note = '敌方血量已压至 1 点';
      break;
    }

    case 'ENEMY_KILL_ALL': {
      if (canMutateWorld) {
        for (const e of getActiveEnemies()) {
          e.hp = 0;
          e.alive = false;
          e.isAlive = false;
        }
      }
      note = '已秒杀当前敌方';
      break;
    }

    case 'ENEMY_DMG_MULT': {
      const next = Math.round(Math.max(0.1, Math.min(5.0, cmd.mult ?? 1.0)) * 10) / 10;
      engine.gmEnemyDamageMult = next;
      onEnemyDmgMultChange?.(next);
      note = `敌方伤害倍率：${Math.round(next * 100)}%`;
      break;
    }

    case 'TRIGGER_BOSS_SKILL': {
      if (canMutateWorld) {
        const boss = engine.bossUnit;
        const skill = bossAi?.skills?.find((s) => s.id === cmd.skillId);
        if (!boss || !(boss.alive ?? boss.isAlive) || boss.hp <= 0 || !skill) {
          note = '未找到可触发的首领技能';
          break;
        }
        skill.execute(boss, engine);
        skill.lastCastMs = engine.nowMs;
        if (bossAi) {
          (bossAi as any).lastSkillName = skill.name;
          (bossAi as any).lastSkillAtMs = engine.nowMs;
          (bossAi as any).emitSkillDbmAlert?.(engine, skill, 'INSTANT');
        }
        engine.effectsManager?.addFloatingText({
          targetId: boss.id,
          text: `🛠️ GM触发：${skill.name}`,
          category: 'STATUS',
          isCrit: true,
        });
        note = `已触发：${skill.name}`;
      } else {
        note = '已请求服务器触发首领技能';
      }
      break;
    }

    case 'RESET_COOLDOWNS': {
      engine.cooldownManager?.reset?.();
      if (canMutateWorld && bossAi?.skills) {
        for (const s of bossAi.skills) s.lastCastMs = -999_999;
      }
      note = '已重置技能冷却';
      break;
    }

    case 'CLEAR_GROUND_HAZARDS': {
      if (engine.effectsManager?.groundEffects) {
        engine.effectsManager.groundEffects.length = 0;
      }
      note = '已清除地面危险区';
      break;
    }

    case 'FAST_FORWARD_10S': {
      if (canMutateWorld) {
        const boss = engine.bossUnit;
        if (boss && bossAi) {
          bossAi.tick(10_000, boss, engine);
        }
      }
      note = '已推进首领机制 +10 秒';
      break;
    }

    case 'SKIP_TRAVEL': {
      if (canMutateWorld) {
        rsm?.fastForwardTravel?.();
      }
      note = '已跳过跑路';
      break;
    }

    case 'SPAWN_WILD_PACK': {
      if (canMutateWorld) {
        const spawned = spawnGmWildPack(engine, cmd.count);
        if (spawned.length > 0 && engine.bossUnit) {
          engine.effectsManager?.addFloatingText({
            targetId: engine.bossUnit.id,
            text: `🐺 GM 召唤 ${spawned.length} 只野怪！`,
            category: 'STATUS',
            isCrit: true,
          });
        }
        note = `已召唤 ${spawned.length} 只野怪 (1/30血 · 1/10攻)`;
      } else {
        note = '已请求服务器召唤野怪';
      }
      break;
    }

    case 'TOGGLE_FRIENDLY_INVINCIBLE': {
      engine.gmFriendlyInvincible =
        cmd.enabled !== undefined ? !!cmd.enabled : !engine.gmFriendlyInvincible;
      note = engine.gmFriendlyInvincible ? '🛡️ 己方无敌：已开启' : '🛡️ 己方无敌：已关闭';
      break;
    }

    case 'TOGGLE_ENEMY_INVINCIBLE': {
      engine.gmEnemyInvincible =
        cmd.enabled !== undefined ? !!cmd.enabled : !engine.gmEnemyInvincible;
      note = engine.gmEnemyInvincible ? '👹 敌方无敌：已开启' : '👹 敌方无敌：已关闭';
      break;
    }
  }

  // 联机下由各权威端结算自身后立刻上报 OWNER_SNAPSHOT
  if (isNetworked && auth.localPlayerId) {
    publishOwnerSnapshot(buildLocalOwnerSnapshot(engine, auth.localPlayerId));
  }

  onSyncHud();
  return note;
}
