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
export declare const DEFAULT_ACTION_BAR_BOTTOM_MARGIN_PX = 16;
/**
 * 识别无效坐标或历史遗留的 `{ x: 0, y: 0 }` 重置哨兵脏数据
 */
export declare function isLegacyResetSentinelPos(pos: HudPos | null | undefined): boolean;
/**
 * 清洗从角色持久化中读取的动作条坐标：
 * 若为空、非法或历史 `{ x: 0, y: 0 }` 坏值，返回 `null`（回归窗体下方中部默认位置）。
 */
export declare function sanitizeSavedActionBarPos(pos: HudPos | null | undefined): HudPos | null;
/**
 * 计算元素在视口“下方中部”的精确像素坐标（用于显式锚点定位或自动化断言）
 */
export declare function computeBottomCenterPos(viewportWidth: number, viewportHeight: number, elementWidth: number, elementHeight: number, bottomMarginPx?: number): HudPos;
/**
 * 将拖拽中的 HUD 坐标钳制在可视视口内，防止拖出屏幕丢失
 */
export declare function clampHudPosToViewport(pos: HudPos, viewportWidth: number, viewportHeight: number, elementWidth: number, elementHeight: number): HudPos;
//# sourceMappingURL=hudLayout.d.ts.map