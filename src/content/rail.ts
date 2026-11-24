/**
 * 图标导航栏：把 X 的 header 压成 76px 宽的 fixed 竖列，只留图标。
 * 不改 X 的内层结构 —— 只压最外层宽度、藏文字、把导航项压成 52×52 的方块。
 */

import type { Theme } from './theming';

const PEN_SVG = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23fff' d='M21.1 2.9a2.9 2.9 0 0 0-4.1 0L5.5 14.4V18h3.6L20.6 6.5l.5-1.1v-.3z'/%3E%3Crect fill='%23fff' x='3' y='20' width='18' height='1.8' rx='.9'/%3E%3C/svg%3E\")";

/** 导航项可能是 a[href]，也可能是 role=button 的 div（More / Grok 那类），新版还有原生 button */
const ITEM_SEL = 'a[href], button, [role="button"]';
/** 这两个是按钮不是导航项：发帖由 hideCompose 单独管，账户头像不该被藏 */
const BTN_ONLY = '[data-testid="SideNav_NewTweet_Button"],[data-testid="SideNav_AccountSwitcher_Button"]';
/** 彩色源：位图与 emoji 字形（svg 跟 currentColor 走，不需要处理） */
const EMOJI = /\p{Extended_Pictographic}/u;

const RAIL_PAD = '76px';
let railHost: HTMLElement | null = null;
let railHostPrev = '';

/** 同值不写：applyRail 会被 scan 每 150ms 调一次，每写一次都是一次样式失效 */
function setHtmlVar(k: string, v: string): void {
  const s = document.documentElement.style;
  if (s.getPropertyValue(k) !== v) s.setProperty(k, v);
}

export interface RailItem {
  key: string;
  label: string;
}

/** 稳定标识：testid > href > aria-label > 序号，X 重排顺序也不会错位 */
function railKey(el: HTMLElement, index: number): string {
  const t = el.getAttribute('data-testid');
  if (t) return `t:${t}`;
  const h = el.getAttribute('href');
  if (h && h !== '/') return `h:${h}`;
  const a = el.getAttribute('aria-label');
  if (a) return `a:${a}`;
  return `i:${index}`;
}

/** 导航项的容器：旧版是 header[role=banner]（有的话先找 nav），新版只有 nav[aria-label="主要"] */
function railScope(): HTMLElement | null {
  const nav = document.querySelector<HTMLElement>('nav[aria-label="主要"]');
  if (nav) return nav;
  const header = document.querySelector<HTMLElement>('header[role="banner"]');
  if (!header) return null;
  return header.querySelector<HTMLElement>('nav') ?? header;
}

function railNodes(): HTMLElement[] {
  const scope = railScope();
  if (!scope) return [];
  const pool = [...scope.querySelectorAll<HTMLElement>(ITEM_SEL)]
    .filter((el) => !el.closest(BTN_ONLY) && !el.closest('.xm-fab'));
  // 只留最外层：a 里再套 role=button 时不会算成两项
  const outer = pool.filter((el) => !pool.some((o) => o !== el && o.contains(el)));
  if (outer.length) return outer;
  return [...scope.querySelectorAll<HTMLElement>('a[href]')].filter((a) => a.getAttribute('href') !== '/');
}

/** 枚举导航项供面板勾选：文字被 CSS 隐藏了，textContent 仍取得到 */
export function railItems(): RailItem[] {
  return railNodes().map((a, i) => {
    const raw = a.getAttribute('aria-label') || a.textContent || a.getAttribute('href') || '';
    const label = raw.replace(/\s+/g, ' ').trim().slice(0, 10) || `第 ${i + 1} 项`;
    return { key: railKey(a, i), label };
  });
}

function markColored(header: HTMLElement): void {
  const want = new Set<Element>();
  header.querySelectorAll('img, [style*="background-image"]').forEach((el) => want.add(el));
  // 只标记「直接含 emoji 文本节点」的那层，避免整块祖先都吃 filter
  header.querySelectorAll<HTMLElement>('div, span').forEach((el) => {
    if (el.closest('svg')) return;
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.nodeValue ?? '')
      .join('');
    if (own && EMOJI.test(own)) want.add(el);
  });
  // 只改有差异的节点：稳态下零 class 变更
  header.querySelectorAll('.xm-mono').forEach((el) => { if (!want.has(el)) el.classList.remove('xm-mono'); });
  want.forEach((el) => el.classList.add('xm-mono'));
}

/**
 * 未读角标：上面两条隐藏规则会把它一起干掉，先给整棵子树打 .xm-badge 让 CSS 放行。
 * 判据只能用 position:absolute —— 图标栏开着时角标是 display:none，量不出尺寸；
 * sr-only 的 1px 取值线靠宽高排除。
 */
function markBadges(header: HTMLElement): void {
  const want = new Set<Element>();
  header.querySelectorAll<HTMLElement>('a[href] *').forEach((el) => {
    if (el.closest('svg')) return;
    const cs = getComputedStyle(el);
    if (cs.position !== 'absolute') return;
    if (cs.width === '1px' || cs.height === '1px') return;
    want.add(el);
    el.querySelectorAll('*').forEach((d) => want.add(d));
  });
  header.querySelectorAll('.xm-badge').forEach((el) => { if (!want.has(el)) el.classList.remove('xm-badge'); });
  want.forEach((el) => el.classList.add('xm-badge'));
}

/**
 * 新版（2026-11 Tailwind 重写版）没有 header[role=banner]，我们原来那套
 * 「压宽度 + 藏文字 + 打 .xm-hide」全部落空。
 * 但 X 自己就带折叠：外壳宽度是 calc(72px + 184px * var(--x-sidebar-expanded,0))，
 * 把变量拧到 0 就是 72px 的图标条，跟我们的目标一致，而且不用碰它任何节点。
 * ⛔ 变量必须写在**声明它的那一层**（class 里带 `[--x-sidebar-expanded:calc(...)]`）；
 *    写在 <html> 上会被它自己的声明盖掉（实测无效）。
 * ⛔ 折叠后那层宽度变成 72，按宽度就再也找不回来了 —— 所以解析一次就缓存住。
 */
let sideHost: HTMLElement | null = null;
let sideHostPrev = '';
let railLeft = -1;

/**
 * 齿轮与面板要跟随栏的**实际**左边界。
 * 新版外壳是 `mx-auto` 居中的，栏并不贴窗口左边（实测 vw 1407 时栏在 x=67~139），
 * 写死 `left:12px` 会把齿轮丢到栏外（2026-11-23 实测）。
 * 带值比较：同一数值重复设置也只是一次读 getBoundingClientRect，不写样式。
 */
function syncRailLeft(): void {
  const header = document.querySelector<HTMLElement>('header[role="banner"]');
  const el = header ?? (sideHost && sideHost.isConnected ? sideHost : railScope());
  if (!el) return;
  const left = Math.round(el.getBoundingClientRect().left);
  if (left === railLeft) return;
  railLeft = left;
  document.documentElement.style.setProperty('--xm-rail-left', `${left}px`);
}

function setNativeRail(on: boolean): void {
  // 齿轮在 72px 栏里的内缩 = (72 − 52) / 2
  if (on) setHtmlVar('--xm-rail-in', '10px');
  if (!sideHost || !sideHost.isConnected) {
    if (!on) return;
    const nav = document.querySelector<HTMLElement>('nav[aria-label="主要"]');
    let host: HTMLElement | null = null;
    for (let el = nav?.parentElement ?? null; el && el !== document.documentElement; el = el.parentElement) {
      if ((el.getAttribute('class') || '').includes('--x-sidebar-expanded')) host = el;
    }
    if (!host) return;
    sideHost = host;
    sideHostPrev = host.style.getPropertyValue('--x-sidebar-expanded');
  }
  // 背板挂在折叠外壳上：新版没有 header 那个可以 fixed 的竖列
  sideHost.classList.toggle('xm-rail-host', on);
  if (on) sideHost.style.setProperty('--x-sidebar-expanded', '0');
  else if (sideHostPrev) sideHost.style.setProperty('--x-sidebar-expanded', sideHostPrev);
  else sideHost.style.removeProperty('--x-sidebar-expanded');
}

/**
 * 新版的隐藏项。
 * ⛔ 旧版那套 `.xm-hide` 循环只在 header 存在时才跑，新版没有 header ⇒ 面板里勾掉的项
 *    一项都没生效（实测 xm-hide 计数恒为 0）。这里按 nav 内的节点重新走一遍。
 * ⛔ 只加 class，不删节点 —— X 折叠后仍保留图标，删了就没法还原。
 */
function applyNativeHide(on: boolean, hide: string[], hideCompose: boolean): void {
  const scope = railScope();
  if (!scope) return;
  if (!on) {
    scope.querySelectorAll('.xm-hide').forEach((el) => el.classList.remove('xm-hide'));
    // 发帖入口不在 scope 里（见下方注释），必须单独摘掉，否则关掉图标栏后标记留在节点上
    document.querySelectorAll<HTMLElement>('a[href="/compose/post"]').forEach((a) => a.classList.remove('xm-hide'));
    return;
  }
  railNodes().forEach((el, i) => el.classList.toggle('xm-hide', hide.includes(railKey(el, i))));
  if (hideCompose) {
    // 除了 html 类兜底，也直接给节点打标记：新版发帖入口是 a[href="/compose/post"]，
    // 不带头像也不带计数，靠 href 认最稳。
    // ⛔ 0.2.6：**不能从 nav 里找** —— 实测该按钮在 nav 之外（自有容器），
    //    scope 限定在 nav 时 querySelectorAll 返回 0 个，设置开着也没人藏它。
    document.querySelectorAll<HTMLElement>('a[href="/compose/post"]').forEach((a) => a.classList.add('xm-hide'));
  }
}

export function applyRail(on: boolean, theme: Theme, hide: string[] = [], hideCompose = false): void {
  const html = document.documentElement;
  html.classList.toggle('xm-rail', on);
  // 发帖按钮不跟图标栏走：不发推的人，图标栏关掉也不该冒出这个按钮
  html.classList.toggle('xm-hidecompose', hideCompose);
  setHtmlVar('--xm-rail-bg', theme === 'dark' ? 'rgba(0,0,0,.86)' : 'rgba(255,255,255,.9)');
  setHtmlVar('--xm-rail-fg', theme === 'dark' ? '#e7e9ea' : '#0f1419');
  setHtmlVar('--xm-pen', PEN_SVG);

  const header = document.querySelector<HTMLElement>('header[role="banner"]');
  // 新版：宽度折叠交给 X 自己，我们只补背板、位置、隐藏项与发帖入口
  if (!header) {
    setNativeRail(on);
    if (on) syncRailLeft();
    applyNativeHide(on, hide, hideCompose);
    return;
  }
  setHtmlVar('--xm-rail-in', '12px');
  syncRailLeft();
  const host = header.parentElement;
  const compose = header.querySelector<HTMLElement>('[data-testid="SideNav_NewTweet_Button"]') ?? null;

  if (railHost && railHost !== host) {
    railHost.style.paddingLeft = railHostPrev;
    railHost = null;
  }
  if (!on || !host) {
    if (railHost) { railHost.style.paddingLeft = railHostPrev; railHost = null; }
    if (!on && header) {
      for (const cls of ['xm-mono', 'xm-hide', 'xm-badge']) {
        header.querySelectorAll('.' + cls).forEach((el) => el.classList.remove(cls));
      }
    }
    return;
  }
  if (railHost !== host) {
    railHost = host;
    railHostPrev = host.style.paddingLeft;
  }
  if (host.style.paddingLeft !== RAIL_PAD) host.style.paddingLeft = RAIL_PAD;
  if (header) { markColored(header); markBadges(header); }
  railNodes().forEach((el, i) => el.classList.toggle('xm-hide', hide.includes(railKey(el, i))));
  compose?.classList.toggle('xm-hide', hideCompose);
}
