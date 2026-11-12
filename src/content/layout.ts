/**
 * 页面布局：去右栏、加宽主栏、隐藏广告与浮动按钮、发推面板。
 * 全部是 html 上的 class 开关，不改 X 的内联样式，随时可逆。
 */

import type { Layout } from '../shared/settings';

/** 浮动按钮白名单与 styles.ts 里那几条 CSS 规则保持同一份 */
const FLOAT_SEL_CHAT = '[data-testid="DMDrawer" i],[data-testid="DMDrawerButton" i],'
  + '[data-testid="chat-drawer-root" i],[data-testid="chat-drawer-main" i]';
const FLOAT_SEL_GROK = '[data-testid="GrokDrawer" i],[data-testid="GrokDrawerButton" i]';
/** 白名单失效时按可见名认：英文 Messages / Chat / Grok，中文私信 / 消息 / 聊天 */
const FLOAT_LABEL = /^(messages|direct messages?|chat|grok|私信|消息|聊天)$/i;
/** 兜底扫描的上次时间。初值必须是过去 —— 用 0 会把加载后的前 5 秒全挡掉。 */
let lastFloatScan = -1e9;

/**
 * 浮动按钮的兜底标记。
 * 主路径是 CSS 白名单；X 换 testid 时白名单静默失效，这里按「语义 + 右下角位置」补标记。
 * 只看语义会误伤图标栏的同名导航项，所以两条判据必须同时成立。
 */
export function markFloats(on: boolean): void {
  if (!on) {
    const marked = document.querySelectorAll('.xm-float-hide');
    if (marked.length) marked.forEach((n) => n.classList.remove('xm-float-hide'));
    return;
  }
  // 两个族都命中才跳过扫描：只命中一个说明另一个已经换了 testid
  if (document.querySelector(FLOAT_SEL_CHAT) && document.querySelector(FLOAT_SEL_GROK)) return;
  const now = performance.now();
  if (now - lastFloatScan < 5000) return;
  lastFloatScan = now;
  const vw = innerWidth;
  const vh = innerHeight;
  // 候选含 div[role="button"]：X 有不少「按钮」是 div + role
  document.querySelectorAll<HTMLElement>('a[aria-label],button[aria-label],[role="button"][aria-label]').forEach((n) => {
    const label = (n.getAttribute('aria-label') ?? '').trim();
    if (!FLOAT_LABEL.test(label)) return;
    if (n.closest('header[role="banner"]')) return;
    const r = n.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) return;
    if (r.right < vw * 0.75 || r.top < vh * 0.5) return;
    n.classList.add('xm-float-hide');
  });
}

export function applyLayout(l: Layout): void {
  const html = document.documentElement;
  html.classList.toggle('xm-noside', l.hideSidebar);
  html.classList.toggle('xm-noscroll', l.noScrollbar);
  html.classList.toggle('xm-nofloat', l.hideFloats);
  html.classList.toggle('xm-noads', l.hideAds);
  html.classList.toggle('xm-card', l.cardFeed);
  html.style.setProperty('--xm-feed-w', `${l.feedWidth}px`);
  const wide = l.feedWidth !== 600;
  html.classList.toggle('xm-wide', wide);
  if (!wide) {
    document.querySelectorAll('.xm-wide-el').forEach((el) => el.classList.remove('xm-wide-el'));
    return;
  }
  widenInner();
}

/**
 * X 有些内层容器把 600px 写死在 max-width 上，主栏放宽后它们成为瓶颈。
 * 只沿 cell 的祖先链上溯（限宽层必定是祖先），成本 O(链长)，可以跟着 DOM 变更即时跑。
 */
export function widenInner(): void {
  const col = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]');
  if (!col) return;

  // 种子取前两个 cell（防第一条挂在别的子树里）；骨架期退化成主栏的第一条子链
  const seeds: HTMLElement[] = [];
  const cells = col.querySelectorAll<HTMLElement>('[data-testid="cellInnerDiv"]');
  for (let i = 0; i < Math.min(2, cells.length); i++) seeds.push(cells[i]);
  if (!seeds.length) {
    let el = col.firstElementChild as HTMLElement | null;
    for (let i = 0; i < 4 && el; i++) {
      seeds.push(el);
      el = el.firstElementChild as HTMLElement | null;
    }
  }

  const chain = new Set<HTMLElement>();
  for (const seed of seeds) {
    let el: HTMLElement | null = seed;
    for (let i = 0; el && el !== col && i < 12; i++, el = el.parentElement) {
      if (el.tagName === 'ARTICLE') break;
      chain.add(el);
    }
  }

  const want = new Set<Element>();
  chain.forEach((el) => {
    // 已标记的不能再读计算值：标记后 max-width 变成 720，会被判成越界而摘掉，来回跳
    if (el.classList.contains('xm-wide-el')) { want.add(el); return; }
    const mw = parseFloat(getComputedStyle(el).maxWidth);
    if (mw >= 520 && mw <= 660) want.add(el);
  });

  document.querySelectorAll('.xm-wide-el').forEach((el) => {
    if (!want.has(el) && col.contains(el)) el.classList.remove('xm-wide-el');
  });
  want.forEach((el) => { if (!el.classList.contains('xm-wide-el')) el.classList.add('xm-wide-el'); });
}

/**
 * 发推面板：从「输入框 + 发帖按钮」的公共父层往上爬，取只属于面板的最大容器。
 * 硬边界：一旦这层开始包含推文 article、外来的 cell 或外来的 tablist 就停 ——
 * 详情页的主帖与回复框同容器，靠这条边界才不会把原推文一起藏掉。
 */
export function markComposer(hide: boolean): void {
  document.querySelectorAll('.xm-comp-hide').forEach((el) => el.classList.remove('xm-comp-hide'));
  const html = document.documentElement;
  html.classList.toggle('xm-nocompose', hide);
  delete html.dataset.xmComp;
  if (!hide) return;

  const col = document.querySelector('[data-testid="primaryColumn"]');
  const btn = col?.querySelector<Element>('[data-testid="tweetButtonInline"]');
  let area: Element | null = null;
  for (const sel of ['[data-testid="tweetTextarea_0"]', '[data-testid="tweetTextarea_0RichTextInputContainer"]']) {
    const el = col?.querySelector(sel);
    if (el) { area = el; break; }
  }
  if (!col || !btn) return;
  if (!area) area = btn;

  let best: Element | null = area;
  while (best && best !== col && !best.contains(btn)) best = best.parentElement;
  if (!best || best === col) { html.dataset.xmComp = 'miss'; return; }

  for (let i = 0; i < 14; i++) {
    const p: Element | null = best.parentElement;
    if (!p || p === col) break;
    if (!p.contains(btn)) break;
    if (p.querySelector('article[data-testid="tweet"]')) break;
    const foreignCell = [...p.querySelectorAll('[data-testid="cellInnerDiv"]')].some((c) => !best!.contains(c));
    if (foreignCell) break;
    const foreignTab = [...p.querySelectorAll('[role="tablist"]')].some((t) => !best!.contains(t));
    if (foreignTab) break;
    best = p;
  }
  if (best === col) { html.dataset.xmComp = 'col'; return; }
  // 宁可什么都不藏，也不能藏到推文
  if (best.querySelector('article[data-testid="tweet"]')) { html.dataset.xmComp = 'guard'; return; }
  best.classList.add('xm-comp-hide');
  html.dataset.xmComp = 'ok';
}
