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
 * 硬边界（任一命中就停，宁可少藏）：
 *   ① 这层开始包含推文内容（article / 正文 / 头像）—— detail 页主帖与回复框同容器；
 *   ② 这层含外来的 cell 或外来的 tablist；
 *   ③ 几何保险：候选层高过主栏 55% —— 发帖面板不可能占大半屏，主帖可以。
 * ⛔ 调用方必须每轮都调（不能「已经有 .xm-comp-hide 就跳过」）—— 详情页主帖的
 *    article 往往晚于面板出现，跳过重判会把主帖永久锁进 display:none（v0.1.91 修）。
 * ⛔ 但「每轮重判」不等于「每轮先摘再打」：v0.1.91 那样写，函数中段的限频提前返回时
 *    标记已被摘掉、还没加回去，发帖面板就每 400ms 闪一次（v0.1.92 修）。
 *    所以改成「先算结论 → 和上一轮的目标元素比对 → 只在变化时切换 class」，
 *    同结论时一个 class 都不碰，DOM 不动、不触发重排。
 * ⛔ 详情页有两种需求要同时满足（v0.1.93 修）：
 *    ① 回复框要藏（原先整段跳过 ⇒ 详情页面板又露出来了）；
 *    ② 主帖绝不能藏（v0.1.91 的 P0）。
 *    做法：详情页**只藏「输入框与发帖按钮的最近公共父层」，一层都不往上扩**。
 *    那一层天然只含 avatar / 输入区 / 工具栏，不含 article，无论主帖有没有渲染完，
 *    都不可能把主帖包进来 —— 不需要靠「猜层级」或「连续两轮确认」，一次判定即定。
 *    高度上限再收到主栏 45%（420px 封顶）兜底。
 */
export function markComposer(hide: boolean): void {
  const html = document.documentElement;
  html.classList.toggle('xm-nocompose', hide);
  if (!hide) {
    html.dataset.xmComp = 'off';
    setCompTarget(null);
    return;
  }

  const isDetail = location.pathname.includes('/status/');
  const now = performance.now();
  // 还没藏过任何一层 ⇒ 本轮必算：让面板白站 400ms 就是「隐藏太晚」（v0.1.93 修）
  const fresh = !compTarget || !compTarget.isConnected;
  if (!(fresh && !isDetail) && now - lastCompScan < 400) return;
  lastCompScan = now;

  const col = document.querySelector('[data-testid="primaryColumn"]');
  const btn = col?.querySelector<Element>('[data-testid="tweetButtonInline"]');
  if (!col || !btn) {
    html.dataset.xmComp = 'miss';
    setCompTarget(null);
    return;
  }
  let area: Element | null = null;
  for (const sel of ['[data-testid="tweetTextarea_0"]', '[data-testid="tweetTextarea_0RichTextInputContainer"]']) {
    const el = col?.querySelector(sel);
    if (el) { area = el; break; }
  }
  if (!area) area = btn;

  let best: Element | null = area;
  while (best && best !== col && !best.contains(btn)) best = best.parentElement;
  if (!best || best === col) {
    html.dataset.xmComp = 'miss';
    setCompTarget(null);
    return;
  }

  const colH = col.getBoundingClientRect().height || 1;
  // 详情页：0 层（就用输入框+按钮的 LCA）；首页：一直爬到「只属于面板的最大层」
  const maxLayers = isDetail ? 0 : 14;
  const cap = isDetail ? Math.min(colH * 0.45, 420) : colH * 0.55;
  for (let i = 0; i < maxLayers; i++) {
    const p: Element | null = best.parentElement;
    if (!p || p === col) break;
    if (!p.contains(btn)) break;
    if (hasTweetContent(p)) break;
    const foreignCell = [...p.querySelectorAll('[data-testid="cellInnerDiv"]')].some((c) => !best!.contains(c));
    if (foreignCell) break;
    const foreignTab = [...p.querySelectorAll('[role="tablist"]')].some((t) => !best!.contains(t));
    if (foreignTab) break;
    // 几何保险：再往上这层就遮住大半屏了
    if (p.getBoundingClientRect().height > cap) break;
    best = p;
  }
  if (best === col) {
    html.dataset.xmComp = 'col';
    setCompTarget(null);
    return;
  }
  // 宁可什么都不藏，也不能藏到推文
  if (hasTweetContent(best) || best.getBoundingClientRect().height > cap) {
    html.dataset.xmComp = 'guard';
    setCompTarget(null);
    return;
  }
  // 详情页的 LCA 若把推文 cell 整个包进来（主帖与回复框同 cell 的极端结构），仍然停手
  if (isDetail && best.querySelector('[data-testid="cellInnerDiv"]')) {
    html.dataset.xmComp = 'guard';
    setCompTarget(null);
    return;
  }
  html.dataset.xmComp = 'ok';
  setCompTarget(best);
}

/** 上一轮真正被藏的那一层 */
let compTarget: Element | null = null;

/** 只在目标变化时切 class —— 同结论时完全不碰 DOM，杜绝闪现 */
function setCompTarget(el: Element | null): void {
  const cur = compTarget && compTarget.isConnected ? compTarget : null;
  if (cur === el) {
    // 同目标，但 class 可能被别处摘掉过（applyFlat 等），补回来
    if (el && !el.classList.contains(COMP_HIDE_CLS)) el.classList.add(COMP_HIDE_CLS);
    compTarget = el;
    return;
  }
  if (cur) cur.classList.remove(COMP_HIDE_CLS);
  if (el) el.classList.add(COMP_HIDE_CLS);
  compTarget = el;
}

const COMP_HIDE_CLS = 'xm-comp-hide';

let lastCompScan = -1e9;

/** 这一层里已经有推文的实质内容 ⇒ 是推文的地盘，不是发帖面板 */
function hasTweetContent(el: Element): boolean {
  return !!(
    el.querySelector('article[data-testid="tweet"]')
    || el.querySelector('[data-testid="tweetText"]')
    || el.querySelector('[data-testid="Tweet-User-Avatar"]')
  );
}
