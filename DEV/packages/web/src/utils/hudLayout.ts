/**
 * hudLayout — 可拖拽 HUD 面板默认锚点、视口边界钳制与重置纯工具（零 DOM/React 依赖）
 *
 * 核心契约：
 * - `null / undefined` 代表“使用语义默认停靠位”（例如动作条停靠在窗体下方中部）。
 * - 历史版本曾把重置误存为 `{ x: 0, y: 0 }` 导致动作条贴左上角，`sanitizeSavedActionBarPos`
 *   会自动清洗该脏数据并恢复底部居中默认锚点。
 */

export interface HudPos {
  x: number;
  y: number;
}

export const DEFAULT_ACTION_BAR_BOTTOM_MARGIN_PX = 16;

/**
 * 识别无效坐标或历史遗留的 `{ x: 0, y: 0 }` 重置哨兵脏数据
 */
export function isLegacyResetSentinelPos(pos: HudPos | null | undefined): boolean {
  if (!pos) return true;
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return true;
  return pos.x === 0 && pos.y === 0;
}

/**
 * 清洗从角色持久化中读取的动作条坐标：
 * 若为空、非法或历史 `{ x: 0, y: 0 }` 坏值，返回 `null`（回归窗体下方中部默认位置）。
 */
export function sanitizeSavedActionBarPos(pos: HudPos | null | undefined): HudPos | null {
  if (isLegacyResetSentinelPos(pos)) {
    return null;
  }
  return { x: pos!.x, y: pos!.y };
}

/**
 * 计算元素在视口“下方中部”的精确像素坐标（用于显式锚点定位或自动化断言）
 */
export function computeBottomCenterPos(
  viewportWidth: number,
  viewportHeight: number,
  elementWidth: number,
  elementHeight: number,
  bottomMarginPx: number = DEFAULT_ACTION_BAR_BOTTOM_MARGIN_PX
): HudPos {
  const safeVw = Math.max(0, viewportWidth);
  const safeVh = Math.max(0, viewportHeight);
  const safeEw = Math.max(0, elementWidth);
  const safeEh = Math.max(0, elementHeight);
  const x = Math.max(0, Math.round((safeVw - safeEw) / 2));
  const y = Math.max(0, Math.round(safeVh - safeEh - bottomMarginPx));
  return { x, y };
}

/**
 * 将拖拽中的 HUD 坐标钳制在可视视口内，防止拖出屏幕丢失
 */
export function clampHudPosToViewport(
  pos: HudPos,
  viewportWidth: number,
  viewportHeight: number,
  elementWidth: number,
  elementHeight: number
): HudPos {
  const maxX = Math.max(0, viewportWidth - elementWidth);
  const maxY = Math.max(0, viewportHeight - elementHeight);
  return {
    x: Math.max(0, Math.min(maxX, Math.round(pos.x))),
    y: Math.max(0, Math.min(maxY, Math.round(pos.y))),
  };
}
