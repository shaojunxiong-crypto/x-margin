/**
 * 图标导航栏：把 X 的 header 压成 76px 宽的 fixed 竖列，只留图标。
 * 不改 X 的内层结构 —— 只压最外层宽度、藏文字、把导航项压成 52×52 的方块。
 */

import type { Theme } from './theming';

const PEN_SVG = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23fff' d='M21.1 2.9a2.9 2.9 0 0 0-4.1 0L5.5 14.4V18h3.6L20.6 6.5l.5-1.1v-.3z'/%3E%3Crect fill='%23fff' x='3' y='20' width='18' height='1.8' rx='.9'/%3E%3C/svg%3E\")";

/** 导航项可能是 a[href]，也可能是 role=button 的 div（More / Grok 那类） */
const ITEM_SEL = 'a[href], [role="button"]';
/** 这两个是按钮不是导航项：发帖由 hideCompose 单独管，账户头像不该被藏 */
const BTN_ONLY = '[data-testid="SideNav_NewTweet_Button"],[data-testid="SideNav_AccountSwitcher_Button"]';
/** 彩色源：位图与 emoji 字形（svg 跟 currentColor 走，不需要处理） */
const EMOJI = /\p{Extended_Pictographic}/u;

const RAIL_PAD = '76px';
let railHost: HTMLElement | null = null;
let railHostPrev = '';

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

function railNodes(): HTMLElement[] {
  const header = document.querySelector<HTMLElement>('header[role="banner"]');
  if (!header) return [];
  const scope = header.querySelector('nav') ?? header;
  const pool = [...scope.querySelectorAll<HTMLElement>(ITEM_SEL)]
    .filter((el) => !el.closest(BTN_ONLY) && !el.closest('.xm-fab'));
  // 只留最外层：a 里再套 role=button 时不会算成两项
  const outer = pool.filter((el) => !pool.some((o) => o !== el && o.contains(el)));
  if (outer.length) return outer;
  return [...header.querySelectorAll<HTMLElement>('a[href]')].filter((a) => a.getAttribute('href') !== '/');
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

export function applyRail(on: boolean, theme: Theme, hide: string[] = [], hideCompose = false): void {
  const html = document.documentElement;
  html.classList.toggle('xm-rail', on);
  // 发帖按钮不跟图标栏走：不发推的人，图标栏关掉也不该冒出这个按钮
  html.classList.toggle('xm-hidecompose', hideCompose);
  html.style.setProperty('--xm-rail-bg', theme === 'dark' ? 'rgba(0,0,0,.86)' : 'rgba(255,255,255,.9)');
  html.style.setProperty('--xm-rail-fg', theme === 'dark' ? '#e7e9ea' : '#0f1419');
  html.style.setProperty('--xm-pen', PEN_SVG);

  const header = document.querySelector<HTMLElement>('header[role="banner"]');
  const host = header?.parentElement ?? null;
  const compose = header?.querySelector<HTMLElement>('[data-testid="SideNav_NewTweet_Button"]') ?? null;

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
