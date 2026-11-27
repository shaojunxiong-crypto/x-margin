/**
 * 换场骨架（sketch）：把「等待」画成一块不透明的雾面舞台。
 *
 * 三种形态，按「屏幕上该出现什么」选：
 *   · `list`   —— 回主页。用**进详情之前量到的那一屏**做主框架，位置与高度和刚才完全一致；
 *   · `detail` —— 直接从 URL 打开详情页（或没有主页几何时）。按详情页自己的结构画：
 *                 大头像 + 昵称 + 多行正文 + 大图块；
 *   · `base`   —— 有舞台但没有任何可参照的结构。只铺不透明底，至少不把 X 的重建抖动漏出来。
 *
 * 为什么不克隆 DOM / 不截图：
 *   · 克隆会复制出第二份 `article` / `li[data-index]`，我们自己的选择器和 X 都会误命中；
 *   · `captureVisibleTab` 要 30–80ms 才回来，且只能截视口，来不及在重建前挂上。
 *
 * 所以只量**几何**：离开那一刻每条格子的 top/height、里面配图的高度。同步、零延迟、零副作用。
 *
 * ⛔ 记录必须发生在 `pointerdown`：这是 X 自己开始导航的同一个事件。等到 click 或 popstate，
 *    主栏已经被拆了，量到的是骨架而不是内容。
 * ⛔ 骨架是纯装饰：不挂 id、不带 data-index、不进 `main`，任何选择器都扫不到它。
 * ⛔ 底色必须取自页面实测（`stageBg()`），不能按 `html.xm-dark` 猜 —— 真机实测过
 *    `xm-dark` 在、页面却是浅色，按它选色会画成「白底白块」，整块骨架隐形。
 */

import { cells as feedCells, column } from './sel';

interface CellGeom {
  /** 相对主栏顶部的偏移 */
  top: number;
  /** 真实格子高度 */
  h: number;
  /** 配图高度；0 表示这条没有配图 */
  media: number;
}

export type SketchKind = 'list' | 'detail' | 'base';

export interface Sketch {
  kind: SketchKind;
  l: number;
  t: number;
  w: number;
  h: number;
  cells: CellGeom[];
}

/** 最多画这么多条：再往下也不在视口里，白建 */
const MAX_CELLS = 14;
/** 缓存的几何多久之内还算数（用户可能停留在详情页很久） */
const KEEP_MS = 15 * 60_000;
/** 同时缓存几条：用路径做键，来回走几次也不会互相覆盖 */
const MAX_KEEP = 8;
/** 文本行基线与宽度比例，模仿「昵称 / 正文两行」的排布 */
const LINE_Y = [16, 39, 60];
const LINE_W = [0.4, 0.92, 0.66];

let el: HTMLElement | null = null;
/** 当前舞台的形态：决定它要不要跟着布局重算矩形 */
let curKind: SketchKind | null = null;
/** 路径 → 离开时的几何。回退到某个路径时按它画骨架 */
const kept = new Map<string, { s: Sketch; at: number }>();

/** 配图高度。头像 40px、emoji 20px 一律不算 */
function mediaHeight(cell: HTMLElement): number {
  let best = 0;
  for (const m of cell.querySelectorAll<HTMLElement>('img, video')) {
    const r = m.getBoundingClientRect();
    if (r.width < 120 || r.height < 60) continue;
    if (r.height > best) best = r.height;
  }
  return Math.round(best);
}

/**
 * 舞台矩形 = **推文流那一段**，不是整根主栏。
 *
 * ⛔ 不能直接拿 `main` 的矩形：新版 X 的 `main` 高度等于整个文档（实测 15108px），
 *    而 `position:fixed` 的元素按这个尺寸铺开，会把顶部 tab 栏一起盖成一块实底 ——
 *    看起来就是「整页被吃掉」。实测结构：
 *      main   [349, 0, 720, 15108]
 *      header [349, 0, 720, 57]     ← 页头（返回箭头 / 为你推荐·关注）
 *      ul     [349, 57, 720, 15051] ← 推文流
 *    所以起点取「列表上沿」，终点取视口下沿；页头保持原样可见，
 *    返回箭头仍然能点（预挂之后路径才会变，不能把它盖住）。
 */
/** X 的顶部应用栏高度。页头还没渲染出来时的暂定下沿，避免先铺到 0 再往上跳 */
const HEADER_FALLBACK = 53;

function frame(): { l: number; t: number; w: number; h: number } {
  const col = column();
  const vh = innerHeight;
  if (!col) {
    const w = Math.min(720, Math.max(320, innerWidth - 88));
    return { l: Math.round((innerWidth - w) / 2), t: HEADER_FALLBACK, w, h: Math.max(0, vh - HEADER_FALLBACK) };
  }
  const cr = col.getBoundingClientRect();
  const first = feedCells(col)[0];
  const list = first?.closest('ul') ?? first?.parentElement ?? null;
  const lr = list?.getBoundingClientRect() ?? null;
  const hr = col.querySelector('header')?.getBoundingClientRect() ?? null;

  /**
   * 上沿：页头下沿优先。
   * ⛔ 页头是 sticky 的，页面滚动时 `hr.bottom` 仍然是 57（视口坐标），
   *    而 `ul.top` 可能被滚成负数 —— 拿 ul 当准会连页头一起盖掉。
   * 页头还没渲染（详情页直开的首帧）就用列表顶，再没有就用 53 这个暂定值。
   */
  let top = Math.max(0, cr.top);
  if (hr) top = Math.max(top, hr.bottom);
  else if (lr) top = Math.max(top, lr.top);
  else top = Math.max(top, HEADER_FALLBACK);

  const t = Math.round(Math.max(0, Math.min(top, vh)));
  const bottom = Math.round(Math.min(vh, Math.max(cr.top, cr.bottom)));
  return { l: Math.round(cr.left), t, w: Math.round(cr.width), h: Math.max(0, bottom - t) };
}

/** 量当前这一屏。返回 null 表示没有可量的东西（不是时间线页面） */
export function recordSketch(): Sketch | null {
  const col = column();
  if (!col) return null;
  // 以**舞台**顶为原点，不是主栏顶：舞台现在从页头下沿开始，
  // 若仍按主栏顶记，所有格子会整体下移 57px，和刚才那一屏错开。
  const f = frame();
  const vh = innerHeight;
  const out: CellGeom[] = [];
  for (const cell of feedCells(col)) {
    const r = cell.getBoundingClientRect();
    // 只要和「推文流可见区」有交集的格子；被虚拟列表卸载后残留的零高节点跳过
    if (r.height < 24 || r.bottom < f.t || r.top > vh) continue;
    out.push({ top: Math.round(r.top - f.t), h: Math.round(r.height), media: mediaHeight(cell) });
    if (out.length >= MAX_CELLS) break;
  }
  if (!out.length) return null;
  return { kind: 'list', ...f, cells: out };
}

/**
 * 详情页结构的舞台。
 *
 * 用在「没有主页几何」的场合：直接从 URL 打开 `/status/...`，或从别处跳进来。
 * 此时屏幕上要出现的是**一条**推文，拿主页的列表形状去盖就是错位的，所以按详情页
 * 自己的排布画：大圆头像 + 昵称两行 + 正文若干行 + 一块大媒体。
 */
export function detailSketch(): Sketch {
  return { kind: 'detail', ...frame(), cells: [] };
}

/** 只有不透明底：连结构都无从参照时的兜底，至少不让底下的重建透出来 */
export function baseSketch(): Sketch {
  return { kind: 'base', ...frame(), cells: [] };
}

type RGBA = [number, number, number, number];

/** 计算样式里的 `rgb()` / `rgba()` → 数组。其它写法（color(display-p3 …)、`transparent`）一律 null */
function parseColor(c: string): RGBA | null {
  const m = /^rgba?\(([^)]+)\)$/.exec(c.trim());
  if (!m) return null;
  const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  if (p.length < 3 || p.some((v, i) => i < 3 && Number.isNaN(v))) return null;
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
}

/** `src` 叠在 `dst` 之上（普通 source-over） */
function over(src: RGBA, dst: RGBA): RGBA {
  const a = src[3] + dst[3] * (1 - src[3]);
  if (a <= 0) return [0, 0, 0, 0];
  const f = (i: number): number => (src[i] * src[3] + dst[i] * dst[3] * (1 - src[3])) / a;
  return [f(0), f(1), f(2), a];
}

/**
 * 舞台底色 = **推文面板实际呈现的颜色**，不是 body 的底色。
 *
 * ⛔ 之前直接取 body → html 的计算底色，于是面板是「底色 + 卡片色」的场合（卡片模式、
 *    玻璃档位、X 自己的浅色面板）舞台就和面板差一档明度，并排看像贴了块补丁。
 *
 * 分两步算：
 *   ① **页面基色**：html / body 的底色叠加，都没有就用主题色（`color-scheme`）兜底；
 *   ② **面板层**：从第一条推文的格子往上找第一层有底色的节点（卡片模式下就是 `--xm-card-bg`），
 *      再叠到基色上。找不到就用扩展自己的 `--xm-card-bg`，再没有就保持基色。
 *
 * 好处是不判断深浅色、不判断卡片开关、不判断玻璃档位 —— 全部问计算样式，
 * 换主题、换壁纸、改卡片色都自动跟上。
 */
function stageBg(): string {
  const html = document.documentElement;

  // ① 页面基色
  let base: RGBA = [0, 0, 0, 0];
  for (const n of [html, document.body]) {
    if (!n) continue;
    const c = parseColor(getComputedStyle(n).backgroundColor);
    if (c && c[3] > 0) base = over(c, base);
  }
  if (base[3] < 0.999) {
    // 有壁纸时 html 只有 background-image，合成不出实色 —— 退到主题基色
    const dark = (getComputedStyle(html).colorScheme || '').includes('dark');
    base = over(base, dark ? [0, 0, 0, 1] : [255, 255, 255, 1]);
  }

  // ② 面板层：从格子往上找第一层真正上色的节点
  const col = column();
  const cell = col ? feedCells(col)[0] : null;
  let panel: RGBA | null = null;
  for (let n: Element | null = cell ?? col; n; n = n.parentElement) {
    const c = parseColor(getComputedStyle(n).backgroundColor);
    if (c && c[3] > 0) { panel = c; break; }
  }
  // 当前页没有格子（详情页预挂、页面还没画完）：用扩展自己的卡片色 —— 那才是回到主页时看到的面板色
  if (!panel) {
    const v = getComputedStyle(html).getPropertyValue('--xm-card-bg').trim();
    panel = parseColor(v);
  }
  if (panel && panel[3] > 0) base = over(panel, base);

  return `rgb(${Math.round(base[0])}, ${Math.round(base[1])}, ${Math.round(base[2])})`;
}

function mk(cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}

function place(d: HTMLElement, css: Record<string, string>): void {
  for (const k in css) d.style.setProperty(k, css[k]);
}

function bar(root: HTMLElement, x: number, y: number, w: number, h: number, cls = 'xm-sk-ln'): void {
  const ln = mk(cls);
  place(ln, { left: x + 'px', top: y + 'px', width: Math.max(8, Math.round(w)) + 'px', height: h + 'px' });
  root.append(ln);
}

/** 主页时间线：一行一条卡片，头像 + 三行文字 + 可选配图 */
function renderList(root: HTMLElement, s: Sketch): void {
  const textX = 72;
  const avail = Math.max(80, s.w - textX - 16);

  for (const c of s.cells) {
    const item = mk('xm-sk-item');
    // 让出 8px 间隙：卡片模式下格子之间本来就有缝，连成一片反而假
    place(item, { top: c.top + 'px', height: Math.max(28, c.h - 8) + 'px' });

    const av = mk('xm-sk-av');
    item.append(av);

    LINE_Y.forEach((y, i) => {
      if (y + 13 > c.h - 12) return;
      const ln = mk('xm-sk-ln');
      place(ln, {
        left: textX + 'px',
        top: y + 'px',
        width: Math.round(avail * LINE_W[i]) + 'px',
      });
      item.append(ln);
    });

    if (c.media >= 60) {
      const room = c.h - 110;
      const mh = Math.min(c.media, room);
      if (mh >= 60) {
        const md = mk('xm-sk-media');
        place(md, { top: LINE_Y[2] + 30 + 'px', height: mh + 'px' });
        item.append(md);
      }
    }
    root.append(item);
  }
}

/**
 * 详情页：一条推文的骨架。
 *
 * 版式按 X 详情页的实际排布：左侧 48px 头像，右侧昵称一行 + handle 一行，
 * 正文 3 行，下面一块大媒体，最后是互动条（四个小圆点）。
 */
function renderDetail(root: HTMLElement, s: Sketch): void {
  const pad = 16;
  const av = 48;
  const textX = pad + av + 12;
  const avail = Math.max(80, s.w - textX - pad);

  const item = mk('xm-sk-item');
  place(item, { top: '0px', height: Math.max(120, s.h) + 'px' });
  // 详情页是一整块，不要卡片圆角与卡片底
  place(item, { 'border-radius': '0px', background: 'transparent' });

  const avEl = mk('xm-sk-av');
  place(avEl, { left: pad + 'px', top: '16px', width: av + 'px', height: av + 'px' });
  item.append(avEl);

  bar(item, textX, 22, Math.min(avail * 0.42, 180), 14);
  bar(item, textX, 44, Math.min(avail * 0.28, 120), 12);

  // 正文：从 84 起，行距 24
  const bodyTop = 84;
  const lines = [0.96, 0.99, 0.72];
  lines.forEach((r, i) => bar(item, pad, bodyTop + i * 24, s.w - pad * 2 - (i === 2 ? 60 : 0), 14));

  // 媒体块：正文下 24px，高度取剩余空间的三分之二，最多 320
  const mediaTop = bodyTop + lines.length * 24 + 20;
  const room = s.h - mediaTop - 90;
  const mh = Math.max(0, Math.min(320, room));
  if (mh >= 80) {
    const md = mk('xm-sk-media');
    place(md, { left: pad + 'px', top: mediaTop + 'px', width: s.w - pad * 2 + 'px', height: mh + 'px' });
    item.append(md);
  }

  // 互动条：媒体下 22px 处四个小圆点
  const metaTop = mediaTop + (mh >= 80 ? mh : 0) + 22;
  if (metaTop + 16 < s.h) {
    [0.12, 0.3, 0.48, 0.66].forEach((fx) => {
      const dot = mk('xm-sk-dot');
      place(dot, { left: Math.round(s.w * fx) + 'px', top: metaTop + 'px' });
      item.append(dot);
    });
  }

  root.append(item);
}

/** 画骨架。返回根节点，交给 stage 决定何时撤 */
export function showSketch(s: Sketch): HTMLElement {
  hideSketch(0, true);
  const root = mk('xm-sketch');
  root.setAttribute('aria-hidden', 'true');
  curKind = s.kind;
  // 不透明底：底下不管是什么都看不见了，糊的只有骨架自己的形
  root.style.setProperty('--xm-stage-bg', stageBg());
  place(root, {
    left: s.l + 'px',
    top: s.t + 'px',
    width: s.w + 'px',
    height: s.h + 'px',
  });

  if (s.kind === 'list') renderList(root, s);
  else if (s.kind === 'detail') renderDetail(root, s);
  // base：什么都不画，只留下不透明底

  (document.body ?? document.documentElement).append(root);
  el = root;
  return root;
}

/**
 * 让「无几何」的舞台跟着布局走。
 *
 * `detail` / `base` 是在页面还没排好时估出来的（直开详情页的首帧里连 main 都没有），
 * 等真正的页头、主栏出现后，矩形必须跟着修正 —— 否则舞台会一直停在错误的宽度上，
 * 或者停在 53px 这个暂定上沿，露出半截。
 * ⛔ `list` 不参与：它的全部意义就是「和刚才那一屏严丝合缝」，跟着重算反而会错位。
 */
export function syncSketchFrame(): void {
  if (!el || curKind === 'list') return;
  const f = frame();
  place(el, { left: f.l + 'px', top: f.t + 'px', width: f.w + 'px', height: f.h + 'px' });
}

/** 撤骨架。`ms=0` 是硬撤（用户自己开始操作了，不能留尾巴） */
export function hideSketch(ms = 160, instant = false): void {
  if (!el) return;
  const node = el;
  el = null;
  curKind = null;
  if (instant || ms <= 0) {
    node.remove();
    return;
  }
  node.dataset.out = '1';
  setTimeout(() => node.remove(), ms + 60);
}

function remember(s: Sketch): void {
  kept.set(location.pathname, { s, at: Date.now() });
  if (kept.size <= MAX_KEEP) return;
  // 超量就丢最早的那条（Map 保持插入序）
  const first = kept.keys().next().value;
  if (first !== undefined) kept.delete(first);
}

/**
 * 取某个路径离开时量到的几何。一次性：用完即删，
 * 免得某次过期的几何在之后每一次回退里反复盖上来。
 */
export function recallSketch(path: string): Sketch | null {
  const hit = kept.get(path);
  if (!hit) return null;
  kept.delete(path);
  if (Date.now() - hit.at > KEEP_MS) return null;
  return hit.s;
}

/**
 * 取最近一次记录的几何，**不消耗**。
 *
 * 给「点返回箭头那一刻预挂骨架」用：那时还不知道会退回哪条路径（SPA 里拿不到 history 上一项），
 * 但用户绝大多数是从主页点进来的，最近一条记录就是主页。
 */
export function peekSketch(): Sketch | null {
  let best: { s: Sketch; at: number } | null = null;
  for (const v of kept.values()) if (!best || v.at > best.at) best = v;
  if (!best) return null;
  if (Date.now() - best.at > KEEP_MS) return null;
  return best.s;
}

/**
 * 挂「离开前量一屏」的钩子。
 *
 * 只在点击推文链接时记录 —— 那是唯一会让主栏被拆掉、又可能被回退回来的场合。
 * 记录本身不进 DOM、不发消息，纯读取，几毫秒。
 */
export function initSketchCache(): void {
  addEventListener(
    'pointerdown',
    (ev) => {
      const e = ev as PointerEvent;
      // 只认左键单击；带修饰键是「新标签打开」，不会在本文档里换页
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const t = e.target as Element | null;
      // 新版格子的可点层是 div[role=link][data-href]，旧版是 a[href]；两种都认
      const link = t?.closest?.('a[href*="/status/"], [data-href*="/status/"]');
      if (!link) return;
      const col = column();
      if (!col || !col.contains(link)) return;
      const s = recordSketch();
      if (s) remember(s);
    },
    true,
  );
}

/**
 * 这个路径有没有「离开时的几何」。不消耗缓存 —— stage.ts 用它判断这次是不是往回走
 * （同层回退：路径层数不变，只有缓存能证明我们是从那一屏点进来的）。
 */
export function hasSketch(path: string): boolean {
  const hit = kept.get(path);
  return !!hit && Date.now() - hit.at <= KEEP_MS;
}
