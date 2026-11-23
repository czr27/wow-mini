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

/** Boot / download progress for the game loading screen. */
export interface ArtLoadProgress {
  phase: 'listing' | 'mapping' | 'downloading' | 'done';
  loaded: number;
  total: number;
  /** 0..100 */
  percent: number;
  label: string;
}

export type ArtLoadProgressCallback = (progress: ArtLoadProgress) => void;

function reportProgress(
  onProgress: ArtLoadProgressCallback | undefined,
  partial: ArtLoadProgress
): void {
  if (!onProgress) return;
  try {
    onProgress(partial);
  } catch {
    // ignore UI listener errors
  }
}

function preloadImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      resolve();
      return;
    }
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
}

/** Preload unique URLs with limited concurrency; reports download progress. */
async function preloadArtUrls(
  urls: string[],
  onProgress?: ArtLoadProgressCallback,
  concurrency = 10
): Promise<void> {
  const unique = Array.from(new Set(urls.filter(Boolean)));
  const total = unique.length;
  if (total === 0) {
    reportProgress(onProgress, {
      phase: 'downloading',
      loaded: 0,
      total: 0,
      percent: 90,
      label: '资源列表为空，使用内置图标',
    });
    return;
  }

  let loaded = 0;
  reportProgress(onProgress, {
    phase: 'downloading',
    loaded: 0,
    total,
    percent: 35,
    label: `下载图标 0 / ${total}`,
  });

  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
    while (cursor < unique.length) {
      const i = cursor++;
      const url = unique[i];
      await preloadImage(url);
      loaded += 1;
      const pct = 35 + Math.round((loaded / total) * 60);
      reportProgress(onProgress, {
        phase: 'downloading',
        loaded,
        total,
        percent: Math.min(95, pct),
        label: `下载图标 ${loaded} / ${total}`,
      });
    }
  });
  await Promise.all(workers);
}

// 常见图片扩展名
const VALID_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.svg', '.gif', '.bmp'];

// 职业前缀集合
const CLASS_PREFIXES = [
  'druid_',
  'dk_',
  'shaman_',
  'mage_',
  'rogue_',
  'paladin_',
  'warrior_',
  'hunter_',
  'priest_',
  'warlock_',
];

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

/** classId -> /ART/resources/... URL */
export const CUSTOM_CLASS_ART_URLS: Record<string, string> = {};

/**
 * 各 ClassId 在资源目录中的候选文件名（去扩展名，归一化前）。
 * 优先 class_{id}（fill_class_icons.py 产出），其次 Wowhead classicon_*。
 */
export const CLASS_ART_FILE_CANDIDATES: Record<string, string[]> = {
  DK: ['class_dk', 'dk', 'classicon_deathknight', 'deathknight'],
  DRUID: ['class_druid', 'druid', 'classicon_druid'],
  SHAMAN: ['class_shaman', 'shaman', 'classicon_shaman'],
  MAGE: ['class_mage', 'mage', 'classicon_mage'],
  ROGUE: ['class_rogue', 'rogue', 'classicon_rogue'],
  WARRIOR: ['class_warrior', 'warrior', 'classicon_warrior'],
  PALADIN: ['class_paladin', 'paladin', 'classicon_paladin'],
  HUNTER: ['class_hunter', 'hunter', 'classicon_hunter'],
  PRIEST: ['class_priest', 'priest', 'classicon_priest'],
  WARLOCK: ['class_warlock', 'warlock', 'classicon_warlock'],
};

export function findMatchingClassArtFile(classId: string, availableFiles: string[]): string | null {
  const candidates = CLASS_ART_FILE_CANDIDATES[classId] || [`class_${classId.toLowerCase()}`, classId.toLowerCase()];
  const normCandidates = candidates.map((c) => normalizeKey(c));
  for (const file of availableFiles) {
    const lastDotIdx = file.lastIndexOf('.');
    if (lastDotIdx === -1) continue;
    const ext = file.slice(lastDotIdx).toLowerCase();
    if (!VALID_EXTENSIONS.includes(ext)) continue;
    const normBase = normalizeKey(file.slice(0, lastDotIdx));
    if (normCandidates.includes(normBase)) return file;
  }
  return null;
}

/**
 * 将 ART/resources 职业图标覆盖到 classAvatars（手绘 SVG 作 onerror 回退）。
 */
export function applyArtResourcesToClassAvatars(
  files: string[],
  classAvatars: Record<string, string>,
  defaultAvatars: Record<string, string>
): Record<string, ArtResourceMatch> {
  const matched: Record<string, ArtResourceMatch> = {};
  const classIds = new Set<string>([
    ...Object.keys(defaultAvatars),
    ...Object.keys(classAvatars),
    ...Object.keys(CLASS_ART_FILE_CANDIDATES),
  ]);

  for (const classId of classIds) {
    const matchFile = findMatchingClassArtFile(classId, files);
    if (matchFile) {
      const url = `/ART/resources/${matchFile}`;
      CUSTOM_CLASS_ART_URLS[classId] = url;
      const fallbackSvg = defaultAvatars[classId] || classAvatars[classId];
      classAvatars[classId] = formatArtIconHtml(url, classId, fallbackSvg);
      matched[classId] = {
        spellId: classId,
        filename: matchFile,
        url,
        displayName: classId,
      };
    } else {
      delete CUSTOM_CLASS_ART_URLS[classId];
      if (defaultAvatars[classId]) {
        classAvatars[classId] = defaultAvatars[classId];
      }
    }
  }
  return matched;
}

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

function applyOneArtIcon(
  spellId: string,
  matchFile: string,
  spellIcons: Record<string, string>,
  defaultIcons: Record<string, string>,
  spellTooltips: Record<string, { name?: string }>,
  matchedSpells: Record<string, ArtResourceMatch>
) {
  const spellName = spellTooltips[spellId]?.name;
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
}

/**
 * 将外部资源文件列表同步应用到目标图标字典。
 * 以下载文件名为准：`rake.jpg` → spellId `rake`，即使引擎/tooltip 尚未登记也会挂上。
 * 同时为已知的 `druid_rake` 等带职业前缀 id 建立别名。
 */
export function applyArtResourcesToIcons(
  files: string[],
  spellIcons: Record<string, string>,
  defaultIcons: Record<string, string>,
  spellTooltips: Record<string, { name?: string }> = {}
): Record<string, ArtResourceMatch> {
  const matchedSpells: Record<string, ArtResourceMatch> = {};
  const imageFiles = files.filter((f) => {
    const dot = f.lastIndexOf('.');
    if (dot < 0) return false;
    const ext = f.slice(dot).toLowerCase();
    return VALID_EXTENSIONS.includes(ext) && !f.toLowerCase().includes('manifest');
  });

  // 1) 文件驱动：basename 即 spellId（下载命名为权威）
  for (const file of imageFiles) {
    const baseName = file.slice(0, file.lastIndexOf('.'));
    // 跳过职业头像等非技能资源
    if (/^class[_-]/i.test(baseName)) continue;
    applyOneArtIcon(baseName, file, spellIcons, defaultIcons, spellTooltips, matchedSpells);

    // 为已登记的职业前缀 id 建别名（druid_rake / shaman_riptide …）
    for (const prefix of CLASS_PREFIXES) {
      const prefixed = `${prefix}${baseName}`;
      if (defaultIcons[prefixed] || spellIcons[prefixed] || spellTooltips[prefixed]) {
        applyOneArtIcon(prefixed, file, spellIcons, defaultIcons, spellTooltips, matchedSpells);
      }
    }
  }

  // 2) 已知 spellId 再扫一遍：覆盖中文文件名、大小写变体、仅有前缀 id 等情况
  const allSpellIds = new Set<string>([
    ...Object.keys(defaultIcons),
    ...Object.keys(spellIcons),
    ...Object.keys(spellTooltips),
  ]);

  for (const spellId of allSpellIds) {
    if (matchedSpells[spellId]) continue;
    const spellName = spellTooltips[spellId]?.name;
    const matchFile = findMatchingArtFile(spellId, spellName, imageFiles);
    if (matchFile) {
      applyOneArtIcon(spellId, matchFile, spellIcons, defaultIcons, spellTooltips, matchedSpells);
    } else if (defaultIcons[spellId]) {
      delete CUSTOM_ART_URLS[spellId];
      spellIcons[spellId] = defaultIcons[spellId];
    }
  }

  return matchedSpells;
}

async function resolveArtResourceFiles(): Promise<string[]> {
  let files: string[] = getInitialArtFiles();

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
      try {
        const manifestRes = await fetch('/ART/resources/manifest.json', { cache: 'no-cache' });
        if (manifestRes.ok) {
          const data = await manifestRes.json();
          if (data && Array.isArray(data.files) && data.files.length > 0) {
            files = data.files;
          }
        }
      } catch {
        // keep initial list
      }
    }
  }
  return files;
}

/**
 * 游戏加载时执行的资源扫描与加载函数
 * 优先从 \ART\resources\ 寻找，存在则覆盖自绘画，否则回退；并预下载图片供加载进度界面使用。
 */
export async function initArtResourceIcons(
  spellIcons: Record<string, string>,
  defaultIcons: Record<string, string>,
  spellTooltips: Record<string, { name?: string }> = {},
  classAvatars?: Record<string, string>,
  defaultClassAvatars?: Record<string, string>,
  onProgress?: ArtLoadProgressCallback
): Promise<Record<string, ArtResourceMatch>> {
  console.log('[ArtResources] 游戏加载时扫描 ART/resources 寻找技能 / Buff / 职业图标...');

  reportProgress(onProgress, {
    phase: 'listing',
    loaded: 0,
    total: 0,
    percent: 5,
    label: '正在获取资源清单…',
  });

  const files = await resolveArtResourceFiles();

  reportProgress(onProgress, {
    phase: 'mapping',
    loaded: 0,
    total: files.length,
    percent: 20,
    label: `匹配图标（清单 ${files.length} 个文件）…`,
  });

  const matches = applyArtResourcesToIcons(files, spellIcons, defaultIcons, spellTooltips);
  const matchCount = Object.keys(matches).length;

  let classCount = 0;
  if (classAvatars && defaultClassAvatars) {
    classCount = Object.keys(
      applyArtResourcesToClassAvatars(files, classAvatars, defaultClassAvatars)
    ).length;
  }

  reportProgress(onProgress, {
    phase: 'mapping',
    loaded: matchCount + classCount,
    total: files.length,
    percent: 35,
    label: `已匹配技能 ${matchCount} · 职业头像 ${classCount}`,
  });

  const preloadUrls = [
    ...Object.values(CUSTOM_ART_URLS),
    ...Object.values(CUSTOM_CLASS_ART_URLS),
  ];
  await preloadArtUrls(preloadUrls, onProgress);

  console.log(
    `[ArtResources] 扫描完成：技能/Buff ${matchCount} 个，职业头像 ${classCount} 个；缺失回退自绘。`
  );

  reportProgress(onProgress, {
    phase: 'done',
    loaded: preloadUrls.length,
    total: preloadUrls.length,
    percent: 100,
    label: '资源就绪',
  });

  notifyIconChangeListeners();
  return matches;
}
