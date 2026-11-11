/** 设置：背景（模式 / 着色器 / 强度 / 随机池）+ 字体（字体族 / 自定义名 / 字号缩放） */

export type ShaderId =
  | 'aurora' | 'silk' | 'mesh' | 'grain' | 'ice' | 'veil'
  | 'smoke' | 'neuro' | 'flow' | 'rays' | 'blend' | 'flux';

export type BgMode = 'off' | 'fixed' | 'random' | 'image';
export type FontChoice = 'x' | 'sans' | 'serif' | 'custom';
export type Scale = 100 | 110 | 120;
/** 玻璃浓度：厚 = 更接近原底色，薄 = 背景更明显 */
export type Glass = 'thick' | 'mid' | 'thin';
/** 推文流（主栏）宽度：X 原生 600，加宽到 720 / 840 */
export type FeedWidth = 600 | 720 | 840;

export interface Background {
  mode: BgMode;
  shader: ShaderId;
  /** 背景强度 0–1，映射成叠加层的透明度 */
  intensity: number;
  /** 随机模式的候选池；空 = 全部 */
  pool?: ShaderId[];
  /** 主栏玻璃浓度 */
  glass: Glass;
}

export interface Layout {
  /** 去掉右侧栏（搜索 / 订阅 / 新鲜事 / 推荐关注），主栏居中 */
  hideSidebar: boolean;
  /** 左侧导航收成图标竖排，贴窗口左边缘固定 */
  railNav: boolean;
  /** 要隐藏的导航项（key 形如 h:/messages、t:AppTabBar_...）。空数组 = 全部显示 */
  railHide: string[];
  /** 预置版本：0 = 没预置过，1 = 旧版（只认 a[href]），2 = 含按钮型导航项。涨版本会重跑一次预置 */
  railSeedV: number;
  /** 隐藏所有发推入口：左侧栏的圆形发帖按钮 + 时间线顶部的发推面板（不发推的人用不上） */
  hideCompose: boolean;
  /** 推文流宽度 */
  feedWidth: FeedWidth;
  /** 隐藏推文流里的推广 / 广告推文 */
  hideAds: boolean;
  /** 推文浮起：主栏底色透明、去栏框与分割线，每条推文之间空一个行高（推文本身不加装饰） */
  floatCards: boolean;
  /** 每条推文独立成块：主栏不铺底板，推文之间留缝隙（clip-path 裁，不动 X 的定位） */
  cardFeed: boolean;
  /** 隐藏页面（根滚动容器）的滚动条：只去掉绘制，滚轮 / 键盘 / 触控板照常；弹窗与列表内部的滚动条不动 */
  noScrollbar: boolean;
}

export interface Settings {
  bg: Background;
  font: { choice: FontChoice; custom: string; scale: Scale };
  layout: Layout;
  /** 外观：white / black / 跟随系统。写的是 X 自己的 night_mode cookie */
  theme: 'auto' | 'light' | 'dark';
  /** 强调色（#rrggbb）：面板开关、滑块、选中态、齿轮图标共用 */
  accent: string;
  /** 深色模式下柔化主文字白（#f7f9f9 → #c8ced3）；浅色主题自动忽略 */
  softText: boolean;
}

const KEY = 'xm:settings';
export const BG_IMAGE_KEY = 'xm:bg-image';

export const SHADERS: ShaderId[] = ['aurora', 'silk', 'mesh', 'grain', 'ice', 'veil', 'smoke', 'neuro', 'flow', 'rays', 'blend', 'flux'];

export const DEFAULTS: Settings = {
  bg: { mode: 'off', shader: 'aurora', intensity: 0.85, pool: [], glass: 'mid' },
  font: { choice: 'x', custom: '', scale: 100 },
  layout: { hideSidebar: true, railNav: true, railHide: [], railSeedV: 0, hideCompose: true, feedWidth: 720, hideAds: true, floatCards: false, cardFeed: true, noScrollbar: true },
  theme: 'auto',
  accent: '#1d9bf0',
  softText: true,
};

/** 强调色预设：前六个别太扎眼，又能和深/浅两套底都拉开对比 */
export const ACCENTS: { hex: string; name: string }[] = [
  { hex: '#1d9bf0', name: 'X 蓝' },
  { hex: '#7856ff', name: '靛紫' },
  { hex: '#f91880', name: '玫红' },
  { hex: '#00ba7c', name: '翠绿' },
  { hex: '#ff7a00', name: '橘橙' },
  { hex: '#ffd400', name: '明黄' },
];

/** 只收 #rgb / #rrggbb，统一展开成小写六位 */
export function cleanHex(v: unknown): string {
  if (typeof v !== 'string') return DEFAULTS.accent;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return DEFAULTS.accent;
  const h = m[1].toLowerCase();
  return h.length === 3 ? `#${h.split('').map((c) => c + c).join('')}` : `#${h}`;
}

/** 字体名只留字母、数字、中日韩文字、空格和 - _ .，最长 64 字：会拼进 CSS font-family，不能带引号分号 */
export function cleanFont(v: unknown): string {
  return typeof v === 'string' ? v.replace(/[^\p{L}\p{N} .\-_]/gu, '').trim().slice(0, 64) : '';
}

const isId = (v: unknown): v is ShaderId => typeof v === 'string' && (SHADERS as string[]).includes(v);

export function sanitize(raw: unknown): Settings {
  const r = (raw ?? {}) as Partial<Settings>;
  const b = (r.bg ?? {}) as Partial<Background>;
  const f = (r.font ?? {}) as Partial<Settings['font']>;
  const l = (r.layout ?? {}) as Partial<Layout> & { railSeeded?: unknown };
  const mode: BgMode = b.mode === 'fixed' || b.mode === 'random' || b.mode === 'image' ? b.mode : 'off';
  const pool = Array.isArray(b.pool) ? b.pool.filter(isId) : [];
  return {
    bg: {
      mode,
      shader: isId(b.shader) ? b.shader : DEFAULTS.bg.shader,
      intensity: typeof b.intensity === 'number' && b.intensity >= 0 && b.intensity <= 1 ? b.intensity : DEFAULTS.bg.intensity,
      pool,
      glass: b.glass === 'thick' || b.glass === 'thin' ? b.glass : 'mid',
    },
    font: {
      choice: f.choice === 'sans' || f.choice === 'serif' || f.choice === 'custom' ? f.choice : 'x',
      custom: cleanFont(f.custom),
      scale: f.scale === 110 || f.scale === 120 ? f.scale : 100,
    },
    layout: {
      hideSidebar: typeof l.hideSidebar === 'boolean' ? l.hideSidebar : DEFAULTS.layout.hideSidebar,
      railNav: typeof l.railNav === 'boolean' ? l.railNav : DEFAULTS.layout.railNav,
      railHide: Array.isArray(l.railHide)
        ? l.railHide.filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length < 120).slice(0, 40)
        : [],
      railSeedV:
        typeof l.railSeedV === 'number' && l.railSeedV >= 0 && l.railSeedV <= 99
          ? Math.floor(l.railSeedV)
          : l.railSeeded === true
            ? 1
            : 0,
      hideCompose: typeof l.hideCompose === 'boolean' ? l.hideCompose : DEFAULTS.layout.hideCompose,
      feedWidth: l.feedWidth === 600 || l.feedWidth === 840 ? l.feedWidth : 720,
      hideAds: typeof l.hideAds === 'boolean' ? l.hideAds : DEFAULTS.layout.hideAds,
      // 推文浮起已下线（2026-11-11 主人裁定「排版修改全部回退」）。
      // 字段留着只为兼容旧配置，一律强制 false —— 老配置里存的是 true，不强制就会继续生效。
      floatCards: false,
      // 推文独立成块：效果尚未定稿，先常开；面板开关等主人确认视觉后再加。
      // 走 sanitize 强制 true，避免旧配置（没有这个字段）落到 false。
      cardFeed: true,
      // 旧配置（没有这个字段）要落到 DEFAULTS（true），不能落 false —— 否则升级后滚动条又冒出来
      noScrollbar: typeof l.noScrollbar === 'boolean' ? l.noScrollbar : DEFAULTS.layout.noScrollbar,
    },
    theme: r.theme === 'light' || r.theme === 'dark' ? r.theme : 'auto',
    accent: cleanHex(r.accent),
    softText: typeof r.softText === 'boolean' ? r.softText : DEFAULTS.softText,
  };
}

export async function loadSettings(): Promise<Settings> {
  const r = await chrome.storage.sync.get(KEY).catch(() => ({}));
  return sanitize((r as Record<string, unknown>)[KEY]);
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const cur = await loadSettings();
  const next = sanitize({
    bg: { ...cur.bg, ...(patch.bg ?? {}) },
    font: { ...cur.font, ...(patch.font ?? {}) },
    layout: { ...cur.layout, ...(patch.layout ?? {}) },
    theme: patch.theme ?? cur.theme,
    accent: patch.accent ?? cur.accent,
    softText: patch.softText ?? cur.softText,
  });
  await chrome.storage.sync.set({ [KEY]: next });
}

/** 设置变化订阅（其他标签页 / 设置面板都会触发） */
export function onSettings(fn: (s: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes[KEY]) return;
    fn(sanitize(changes[KEY].newValue));
  });
}
