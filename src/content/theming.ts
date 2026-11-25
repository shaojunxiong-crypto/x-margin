/**
 * 换肤：X 的底色是多层 div 逐层画上去的（class 名是构建哈希，没有稳定选择器），
 * 所以沿线从主栏往上走祖先链，逐层把底色改成透明或半透明玻璃。
 * 每处改动都记在原值表里，关闭时原样还回去。
 */

import type { FontChoice, Glass } from '../shared/settings';
import { column, navRoot } from './sel';

export type Theme = 'light' | 'dark';

/** 玻璃三档的不透明度：厚≈原底色，中能见色，薄背景最明显 */
const ALPHA: Record<Glass, [dark: number, light: number]> = {
  thick: [0.86, 0.88],
  mid: [0.72, 0.78],
  thin: [0.58, 0.66],
};

export function surface(theme: Theme, glass: Glass = 'mid', strong = true): string {
  const [d, l] = ALPHA[glass];
  const a = strong ? (theme === 'dark' ? d : l) : Math.max(0.42, (theme === 'dark' ? d : l) - 0.1);
  return theme === 'dark' ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
}

const touched = new Map<HTMLElement, string>();

function paint(el: HTMLElement, color: string): void {
  if (!touched.has(el)) touched.set(el, el.style.getPropertyValue('background-color'));
  el.style.setProperty('background-color', color, 'important');
}

function restore(): void {
  for (const [el, prev] of touched) {
    if (prev) el.style.setProperty('background-color', prev);
    else el.style.removeProperty('background-color');
  }
  touched.clear();
}

/**
 * 面板底色随玻璃档位走：面板盖在页面内容上，比主栏实一点才能保证文字可读，
 * 但又必须跟着档位一起变 —— 固定 0.9 / 0.93 在浅色主题下就是「白底上的白板」，
 * 半透明完全看不出来（用户 2026-11-24 报的就是这个）。
 * 取 ALPHA + 约 0.14，四舍五入到两档：比主栏实一档，薄玻璃时仍明显透。
 */
const PANEL_A: Record<Glass, [dark: number, light: number]> = {
  thick: [0.88, 0.9],
  mid: [0.78, 0.82],
  thin: [0.68, 0.74],
};

/**
 * 推文卡片（xm-card 模式）的底色：比主栏实、比设置面板略透一点。
 * 卡片面积大、底下压着壁纸，太实就是一排白板；太透正文会跟壁纸打架。
 */
const CARD_A: Record<Glass, [dark: number, light: number]> = {
  thick: [0.86, 0.88],
  mid: [0.74, 0.78],
  thin: [0.62, 0.68],
};

/** 面板与卡片的配色变量，深浅各一套 */
const UI: Record<Theme, Record<string, string>> = {
  dark: {
    '--xm-ui-fg': '#e7e9ea',
    '--xm-ui-sub': '#8b98a5',
    '--xm-ui-dim': '#6b7480',
    '--xm-ui-card': 'rgba(255,255,255,.04)',
    '--xm-ui-line': 'rgba(255,255,255,.11)',
    '--xm-ui-hover': 'rgba(255,255,255,.07)',
    '--xm-ui-seg': 'rgba(255,255,255,.06)',
    '--xm-ui-on': 'rgba(255,255,255,.15)',
    '--xm-card-x': '0px',
    '--xm-card-gap': '15px',
    '--xm-card-pad': '19px',
  },
  light: {
    '--xm-ui-fg': '#0f1419',
    '--xm-ui-sub': '#536471',
    '--xm-ui-dim': '#75858f',
    '--xm-ui-card': 'rgba(0,0,0,.028)',
    '--xm-ui-line': 'rgba(0,0,0,.1)',
    '--xm-ui-hover': 'rgba(0,0,0,.045)',
    '--xm-ui-seg': 'rgba(0,0,0,.045)',
    '--xm-ui-on': '#ffffff',
    '--xm-card-x': '0px',
    '--xm-card-gap': '15px',
    '--xm-card-pad': '19px',
  },
};

function paintUI(theme: Theme, withBg = true, glass: Glass = 'mid'): void {
  const html = document.documentElement;
  for (const [k, v] of Object.entries(UI[theme])) html.style.setProperty(k, v);
  // 面板底色跟玻璃档位联动（见 PANEL_A）
  const [pd, pl] = PANEL_A[glass];
  html.style.setProperty(
    '--xm-ui-bg',
    theme === 'dark' ? `rgba(17,17,19,${pd})` : `rgba(252,252,253,${pl})`,
  );
  // 有壁纸时卡片是玻璃块：底色同样跟档位联动，比主栏略实一档，保证正文压得住壁纸。
  // 固定 .88/.90 时薄玻璃档只有主栏变透、卡片仍是白板，肉眼就是「半透明没了」。
  // 没壁纸时页面是纯色，实体块会与底色同色，只留一点明度差。
  const [cd, cl] = CARD_A[glass];
  html.style.setProperty(
    '--xm-card-bg',
    withBg
      ? theme === 'dark' ? `rgba(18,20,24,${cd})` : `rgba(255,255,255,${cl})`
      : theme === 'dark' ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.03)',
  );
  html.classList.toggle('xm-dark', theme === 'dark');
}

/** #rrggbb → rgba() */
function alpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** 强调色挂在 html 上，派生两个半透明色给选中态与光晕用 */
export function applyAccent(hex: string): void {
  accentHex = hex;
  const st = document.documentElement.style;
  st.setProperty('--xm-acc', hex);
  st.setProperty('--xm-acc-soft', alpha(hex, 0.16));
  st.setProperty('--xm-acc-glow', alpha(hex, 0.45));
}

/** 当前设置里的强调色；paintBrand 用它改写 X 的内联品牌色 */
let accentHex = '';

/**
 * 把 X 自己写进**内联样式**的品牌色换成设置里的强调色（0.2.15）。
 *
 * 0.2.14 之前靠 `[class~="text-brand"]` 一类的类名覆盖，新版这些类名一个都没有了
 * （2026-11-25 实测 `text-brand` / `bg-brand` 各 0 个），改法换成「JS 先把颜色算好、
 * 再以字面量写进 style」——实测 tab 下划线是 `background-color: rgb(29,155,240)`，
 * 覆盖 `--x-fg-brand` / `--x-btn-brand` 之后这个内联值**一字不变**，所以变量那条路也断。
 * ⇒ 只能按值改写内联样式，回到「设置什么色，页面就是什么色」。
 *
 * ⛔ 只认品牌色：like 红、repost 绿、金标都是语义色，跟强调色无关，不能一起铲。
 * ⛔ 值比较后再写；X 重渲染会把内联值刷回去，所以由 1.5 秒心跳补拍，不是一次性。
 */
const BRAND_ATTR = ['--x-fg-brand', '--x-btn-brand', '--x-blue-500'];
let brandAt = -1e9;

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
}

export function paintBrand(): void {
  if (!accentHex) return;
  const now = performance.now();
  if (now - brandAt < 1500) return;
  brandAt = now;

  const cs = getComputedStyle(document.documentElement);
  const want = hexToRgb(accentHex);
  if (!want) return;
  // 取 X 自己的品牌色：跳过等于设置色的那一个，否则会「自己改自己」永远空转
  let from: [number, number, number] | null = null;
  for (const name of BRAND_ATTR) {
    const rgb = hexToRgb(cs.getPropertyValue(name));
    if (rgb && (rgb[0] !== want[0] || rgb[1] !== want[1] || rgb[2] !== want[2])) { from = rgb; break; }
  }
  if (!from) return;

  const [fr, fg, fb] = from;
  const [tr, tg, tb] = want;
  const re = new RegExp(`rgba?\\(\\s*${fr}\\s*,\\s*${fg}\\s*,\\s*${fb}\\s*(?:,\\s*([\\d.]+)\\s*)?\\)`, 'gi');
  const sel = `[style*="${fr}, ${fg}, ${fb}"],[style*="${fr},${fg},${fb}"]`;
  for (const el of document.querySelectorAll<HTMLElement>(sel)) {
    const s = el.getAttribute('style') || '';
    const next = s.replace(re, (_m, a?: string) => (a ? `rgba(${tr},${tg},${tb},${a})` : `rgb(${tr}, ${tg}, ${tb})`));
    if (next !== s) el.setAttribute('style', next);
  }
}

/**
 * 页面自己的强调色。
 *
 * 扩展设置里的 accent 是面板的可选项（默认蓝，用户可能改成紫），它和服务对象
 * 不一定一致：X 的「显示 N 帖子」「选中页签下划线」「发帖按钮」用的是 **X 主题的强调色**，
 * 可能是粉、绿、黄。浮条这类贴在页面里的元素跟着设置走就会和周围撞色
 * （实测：页面选中页签是 #f91880 粉，浮条文字却是设置里的 #7856ff 紫）。
 * ⇒ 从页面里现采，采不到才退回 --xm-acc。
 */
let accentAt = -1e9;
let pageAcc = '';

/** 取元素的不透明底色，近黑近白视为「不是强调色」返回空 */
function solidBg(el: Element): string {
  const c = getComputedStyle(el).backgroundColor;
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(c);
  if (!m) return '';
  if (m[4] !== undefined && Number(m[4]) < 0.9) return '';
  const [r, g, b] = [+m[1], +m[2], +m[3]];
  const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
  if (lum < 0.12 || lum > 0.92) return '';
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** 采样页面强调色（限频 1.2s）。采样点按可靠性排序，都不中就不写变量。 */
export function syncPageAccent(): void {
  const now = performance.now();
  if (now - accentAt < 1200) return;
  accentAt = now;

  let hex = '';
  // ① 发帖按钮的底色就是强调色，面积大、最稳
  const compose = document.querySelector<HTMLElement>('[data-testid="SideNav_NewTweet_Button"]');
  if (compose) hex = solidBg(compose);
  // ② 选中页签的下划线：只认又矮又宽的那条，避免把页签里的头像/图标当强调色
  if (!hex) {
    const tab = document.querySelector<HTMLElement>('[role="tablist"] [role="tab"][aria-selected="true"]');
    if (tab) {
      for (const el of Array.from(tab.querySelectorAll<HTMLElement>('*'))) {
        const r = el.getBoundingClientRect();
        if (r.height > 6 || r.width < 12) continue;
        hex = solidBg(el);
        if (hex) break;
      }
    }
  }
  if (!hex || hex === pageAcc) return;
  pageAcc = hex;
  const st = document.documentElement.style;
  st.setProperty('--xm-page-acc', hex);
  st.setProperty('--xm-page-soft', alpha(hex, 0.18));
  st.setProperty('--xm-page-glow', alpha(hex, 0.5));
}

/**
 * @param on         背景层是否开启
 * @param bareColumn 主栏不刷底板（推文独立成块时需要）
 */
export function applySkin(theme: Theme, on: boolean, glass: Glass = 'mid', softText = true, bareColumn = false): void {
  const html = document.documentElement;
  html.classList.toggle('xm-skin', on);
  html.classList.toggle('xm-soft', softText);
  html.dataset.glass = glass;
  html.style.setProperty('--xm-scrim', theme === 'dark' ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.22)');
  // 面板配色与背景开关无关；卡片底色要看有没有壁纸
  paintUI(theme, on, glass);
  restore();
  if (!on) return;

  const col = column();
  if (col) {
    for (let el = col.parentElement; el && el !== document.documentElement; el = el.parentElement) paint(el, 'transparent');
    paint(col, bareColumn ? 'transparent' : surface(theme, glass));
  }
  const side = document.querySelector<HTMLElement>('[data-testid="sidebarColumn"], aside');
  if (side) {
    for (let el = side.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      if (!touched.has(el)) paint(el, 'transparent');
    }
    paint(side, surface(theme, glass, false));
  }
  const bar = navRoot()?.closest<HTMLElement>('header') ?? navRoot();
  if (bar) paint(bar, surface(theme, glass, false));
}

export function applyFont(choice: FontChoice, custom: string): void {
  const html = document.documentElement;
  const stacks: Record<'sans' | 'serif', string> = {
    sans: '"Geist","Margin Sans SC",system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
    serif: '"Instrument Serif","Margin Serif SC",Georgia,"Songti SC",serif',
  };
  let stack = '';
  if (choice === 'sans') stack = stacks.sans;
  else if (choice === 'serif') stack = stacks.serif;
  else if (choice === 'custom' && custom) stack = `"${custom}",system-ui,sans-serif`;

  html.classList.toggle('xm-font', Boolean(stack));
  if (stack) html.style.setProperty('--xm-font', stack);
  else html.style.removeProperty('--xm-font');
}

/** 读 X 实际渲染的底色判断明暗，比 meta / prefers-color-scheme 准 */
export function detectTheme(): Theme {
  const probe = (el: Element | null): number | null => {
    if (!el) return null;
    const c = getComputedStyle(el).backgroundColor;
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c);
    if (!m) return null;
    const [r, g, b, a] = [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
    if (a < 0.1) return null;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };
  const col = column();
  const l = probe(col) ?? probe(document.body) ?? 0;
  return l < 0.5 ? 'dark' : 'light';
}
