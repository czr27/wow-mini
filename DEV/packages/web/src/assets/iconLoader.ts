// ============================================================
// Cata Raid Sim — 外部美术资源 (\ART\resources\) 技能/Buff 图标加载器
// 规范：优先从 \ART\resources\ 寻找技能图标（如 Tranquility.jpg），未找到则使用自绘 SVG
// ============================================================

export interface ArtResourceMatch {
  spellId: string;
  filename: string;
  url: string;
  displayName: string;
}

// 常见图片扩展名
const VALID_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.svg', '.gif', '.bmp'];

// 职业前缀集合
const CLASS_PREFIXES = ['druid_', 'dk_', 'shaman_', 'mage_', 'rogue_'];

/**
 * 字符串键名归一化（去除下划线、空格、横杠、大小写），以便模糊匹配
 * 例如 "Tranquility" -> "tranquility", "Death_Strike" -> "deathstrike"
 */
export function normalizeKey(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/[\s_\-\.\(\)\[\]]/g, '');
}

/**
 * 获取已知运行环境下的初始文件列表：
 * 1. Node.js 环境（测试或脚本）：直接通过 fs 读取 \ART\resources\
 * 2. 浏览器环境：默认包含已发现文件，后续在加载游戏时通过 /api/art-resources 或 manifest 动态补全
 */
export function getInitialArtFiles(): string[] {
  // Node.js / QA 测试环境探测
  if (typeof window === 'undefined' && typeof process !== 'undefined' && process.versions?.node) {
    try {
      const req = typeof require !== 'undefined' ? require : null;
      if (req) {
        const fs = req('fs');
        const path = req('path');
        // 尝试从几个常见工作区根路径探测 ART/resources
        const candidates = [
          path.resolve(process.cwd(), 'ART/resources'),
          path.resolve(process.cwd(), '../../ART/resources'),
          path.resolve(process.cwd(), '../../../ART/resources'),
        ];
        for (const dir of candidates) {
          if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir).filter((f: string) => !f.startsWith('.'));
            if (files.length > 0) return files;
          }
        }
      }
    } catch {
      // 忽略 Node require 异常
    }
  }

  // 默认已知文件（当前物理已存在的 Tranquility.jpg）
  return ['Tranquility.jpg'];
}

/**
 * 格式化图标 HTML：
 * 如果存在自绘 SVG，嵌入在后置隐藏容器中作为 onerror 回退保护；
 * 确保即使图片加载偶发异常，UI 也能平滑 fallback 自绘图标。
 */
export function formatArtIconHtml(url: string, displayName: string, fallbackSvg?: string): string {
  if (fallbackSvg) {
    return `<img src="${url}" alt="${displayName}" class="w-full h-full object-cover rounded pointer-events-none" onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='block';" /><div style="display:none;width:100%;height:100%;" class="w-full h-full">${fallbackSvg}</div>`;
  }
  return `<img src="${url}" alt="${displayName}" class="w-full h-full object-cover rounded pointer-events-none" />`;
}

/**
 * 针对指定技能 ID 和名称，匹配 ART/resources 目录中的候选文件
 * 规则优先级：
 * 1. 文件名与 spellId 匹配（如 tranquility.jpg -> tranquility）
 * 2. 文件名与去前缀 spellId 匹配（如 Tranquility.jpg -> druid_tranquility）
 * 3. 文件名与技能中文名匹配（如 宁静.jpg -> tranquility / 宁静）
 * 4. 文件名与技能英文规范名匹配（如 Tranquility.jpg -> tranquility）
 */
export function findMatchingArtFile(
  spellId: string,
  spellName: string | undefined,
  availableFiles: string[]
): string | null {
  const normId = normalizeKey(spellId);
  const normName = spellName ? normalizeKey(spellName) : '';

  // 剔除职业前缀后的核心 ID
  let strippedId = spellId;
  for (const prefix of CLASS_PREFIXES) {
    if (strippedId.startsWith(prefix)) {
      strippedId = strippedId.slice(prefix.length);
      break;
    }
  }
  const normStrippedId = normalizeKey(strippedId);

  for (const file of availableFiles) {
    const lastDotIdx = file.lastIndexOf('.');
    if (lastDotIdx === -1) continue;

    const ext = file.slice(lastDotIdx).toLowerCase();
    if (!VALID_EXTENSIONS.includes(ext)) continue;

    const baseName = file.slice(0, lastDotIdx);
    const normBase = normalizeKey(baseName);

    // 1. 完全相同或无特殊符号相同 (如 Tranquility -> tranquility)
    if (normBase === normId) return file;

    // 2. 匹配剥除职业前缀后的核心技能名 (如 Tranquility -> druid_tranquility)
    if (normBase === normStrippedId) return file;

    // 3. 匹配中文技能名 (如 宁静 -> 宁静.jpg)
    if (normName && normBase === normName) return file;

    // 4. 反向包含匹配（如 druid_tranquility 包含 tranquility）
    if (normId.includes(normBase) && normBase.length >= 4) return file;
  }

  return null;
}

/**
 * 当前已加载的外部美术资源映射缓存 (spellId -> URL)
 */
export const CUSTOM_ART_URLS: Record<string, string> = {};

// 订阅监听器（用于在热更新或动态加载时通知 UI 重新渲染）
const iconChangeListeners: Set<() => void> = new Set();

export function subscribeToIconChanges(fn: () => void): () => void {
  iconChangeListeners.add(fn);
  return () => iconChangeListeners.delete(fn);
}

function notifyIconChangeListeners(): void {
  iconChangeListeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.warn('[ArtResourceManager] Listener error:', e);
    }
  });
}

/**
 * 将外部资源文件列表同步应用到目标图标字典
 */
export function applyArtResourcesToIcons(
  files: string[],
  spellIcons: Record<string, string>,
  defaultIcons: Record<string, string>,
  spellTooltips: Record<string, { name?: string }> = {}
): Record<string, ArtResourceMatch> {
  const matchedSpells: Record<string, ArtResourceMatch> = {};

  // 收集所有需要寻找图标的技能/Buff ID
  const allSpellIds = new Set<string>([
    ...Object.keys(defaultIcons),
    ...Object.keys(spellIcons),
    ...Object.keys(spellTooltips),
    'tranquility',
    'druid_tranquility',
  ]);

  for (const spellId of allSpellIds) {
    const spellName = spellTooltips[spellId]?.name;
    const matchFile = findMatchingArtFile(spellId, spellName, files);

    if (matchFile) {
      const url = `/ART/resources/${matchFile}`;
      CUSTOM_ART_URLS[spellId] = url;
      const fallbackSvg = defaultIcons[spellId] || spellIcons[spellId];
      spellIcons[spellId] = formatArtIconHtml(url, spellName || spellId, fallbackSvg);

      matchedSpells[spellId] = {
        spellId,
        filename: matchFile,
        url,
        displayName: spellName || spellId,
      };
    } else {
      // 未在 \ART\resources\ 找到，使用自绘画（保留或回滚至默认自绘 SVG）
      delete CUSTOM_ART_URLS[spellId];
      if (defaultIcons[spellId]) {
        spellIcons[spellId] = defaultIcons[spellId];
      }
    }
  }

  return matchedSpells;
}

/**
 * 游戏加载时执行的资源扫描与加载函数
 * 优先从 \ART\resources\ 寻找，存在则覆盖自绘画，否则回退
 */
export async function initArtResourceIcons(
  spellIcons: Record<string, string>,
  defaultIcons: Record<string, string>,
  spellTooltips: Record<string, { name?: string }> = {}
): Promise<Record<string, ArtResourceMatch>> {
  console.log('[ArtResources] 🎮 游戏加载时扫描 \\ART\\resources\\ 寻找技能与 Buff 图标...');

  let files: string[] = getInitialArtFiles();

  // 若处于浏览器环境，向服务器请求最新的 \ART\resources\ 实际文件清单
  if (typeof window !== 'undefined' && typeof fetch === 'function') {
    try {
      const res = await fetch('/api/art-resources', { cache: 'no-cache' });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.files) && data.files.length > 0) {
          files = data.files;
        }
      }
    } catch {
      // 若 /api/art-resources 无法连接（例如离线或静态托管），尝试读取静态 manifest
      try {
        const manifestRes = await fetch('/ART/resources/manifest.json', { cache: 'no-cache' });
        if (manifestRes.ok) {
          const data = await manifestRes.json();
          if (data && Array.isArray(data.files) && data.files.length > 0) {
            files = data.files;
          }
        }
      } catch {
        // 使用初始文件列表
      }
    }
  }

  const matches = applyArtResourcesToIcons(files, spellIcons, defaultIcons, spellTooltips);
  const matchCount = Object.keys(matches).length;

  console.log(
    `[ArtResources] ✅ 扫描完成：从 \\ART\\resources\\ 优先加载了 ${matchCount} 个图标 (例如: Tranquility.jpg -> 宁静)，其余技能使用自绘像素图标。`
  );

  notifyIconChangeListeners();
  return matches;
}
