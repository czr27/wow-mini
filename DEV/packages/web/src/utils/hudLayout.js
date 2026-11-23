/**
 * hudLayout — 可拖拽 HUD 面板默认锚点、视口边界钳制与重置纯工具（零 DOM/React 依赖）
 *
 * 核心契约：
 * - `null / undefined` 代表“使用语义默认停靠位”（例如动作条停靠在窗体下方中部）。
 * - 历史版本曾把重置误存为 `{ x: 0, y: 0 }` 导致动作条贴左上角，`sanitizeSavedActionBarPos`
 *   会自动清洗该脏数据并恢复底部居中默认锚点。
 * - 所有可拖悬浮框不得进入顶部「魔兽大灾变」标题区（App header h-14），也不得拖出视口。
 */
export const DEFAULT_ACTION_BAR_BOTTOM_MARGIN_PX = 16;
/** App 顶栏 `h-14`：悬浮 HUD 不得覆盖标题区 */
export const HUD_TOP_INSET_PX = 56;
/**
 * 识别无效坐标或历史遗留的 `{ x: 0, y: 0 }` 重置哨兵脏数据
 */
export function isLegacyResetSentinelPos(pos) {
    if (!pos)
        return true;
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y))
        return true;
    return pos.x === 0 && pos.y === 0;
}
/**
 * 清洗从角色持久化中读取的动作条坐标：
 * 若为空、非法或历史 `{ x: 0, y: 0 }` 坏值，返回 `null`（回归窗体下方中部默认位置）。
 */
export function sanitizeSavedActionBarPos(pos) {
    if (isLegacyResetSentinelPos(pos)) {
        return null;
    }
    return { x: pos.x, y: pos.y };
}
/**
 * 计算元素在视口“下方中部”的精确像素坐标（用于显式锚点定位或自动化断言）
 */
export function computeBottomCenterPos(viewportWidth, viewportHeight, elementWidth, elementHeight, bottomMarginPx = DEFAULT_ACTION_BAR_BOTTOM_MARGIN_PX) {
    const safeVw = Math.max(0, viewportWidth);
    const safeVh = Math.max(0, viewportHeight);
    const safeEw = Math.max(0, elementWidth);
    const safeEh = Math.max(0, elementHeight);
    const x = Math.max(0, Math.round((safeVw - safeEw) / 2));
    const y = Math.max(HUD_TOP_INSET_PX, Math.round(safeVh - safeEh - bottomMarginPx));
    return { x, y };
}
/**
 * 将 HUD 坐标钳制在可视区内：不得覆盖标题栏，不得拖出屏幕。
 * 已出界的旧存档坐标调用一次即可拉回限制区。
 */
export function clampHudPosToViewport(pos, viewportWidth, viewportHeight, elementWidth, elementHeight, opts) {
    const topInset = (opts && opts.topInsetPx != null) ? opts.topInsetPx : HUD_TOP_INSET_PX;
    const edge = (opts && opts.edgeInsetPx != null) ? opts.edgeInsetPx : 0;
    const safeVw = Math.max(0, viewportWidth);
    const safeVh = Math.max(0, viewportHeight);
    const safeEw = Math.max(0, elementWidth);
    const safeEh = Math.max(0, elementHeight);
    const minX = edge;
    const minY = Math.max(edge, topInset);
    const maxX = Math.max(minX, safeVw - safeEw - edge);
    const maxY = Math.max(minY, safeVh - safeEh - edge);
    const x = Number.isFinite(pos?.x) ? pos.x : minX;
    const y = Number.isFinite(pos?.y) ? pos.y : minY;
    return {
        x: Math.max(minX, Math.min(maxX, Math.round(x))),
        y: Math.max(minY, Math.min(maxY, Math.round(y))),
    };
}
//# sourceMappingURL=hudLayout.js.map
