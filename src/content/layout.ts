/**
 * 页面布局：去右栏、加宽主栏、隐藏广告与浮动按钮、发推面板。
 * 全部是 html 上的 class 开关，不改 X 的内联样式，随时可逆。
 */

import type { Layout } from '../shared/settings';
import { cells as feedCells, column, hasTweet, isNewLayout } from './sel';

/** 浮动按钮白名单与 styles.ts 里那几条 CSS 规则保持同一份 */
const FLOAT_SEL_CHAT = '[data-testid="DMDrawer" i],[data-testid="DMDrawerButton" i],'
  + '[data-testid="chat-drawer-root" i],[data-testid="chat-drawer-main" i]';
const FLOAT_SEL_GROK = '[data-testid="GrokDrawer" i],[data-testid="GrokDrawerButton" i],'
  + '[data-slot="xds-dock-launcher"]';
/** 白名单失效时按可见名认：英文 Messages / Chat / Grok，中文私信 / 消息 / 聊天。
 *  ⛔ 不能加首尾锚点：新版按钮叫「展开 Grok」，精确匹配 grok 永远不中。 */
const FLOAT_LABEL = /(messages|direct messages?|chat|grok|私信|消息|聊天)/i;
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
  html.classList.toggle('xm-card', l.cardFeed);
  html.style.setProperty('--xm-feed-w', `${l.feedWidth}px`);
  const wide = l.feedWidth !== 600;
  html.classList.toggle('xm-wide', wide);
  if (!wide) {
    document.querySelectorAll('.xm-wide-el').forEach((el) => el.classList.remove('xm-wide-el'));
    syncWidthVar(null);
    return;
  }
  // 新版：宽度是 CSS 变量驱动的，直接覆写变量即可，不用逐层打 class
  if (isNewLayout()) {
    syncWidthVar(l.feedWidth);
    return;
  }
  widenInner();
}

/**
 * 新版主栏宽度。X 用 `--x-main-column-width` 喂 grid 轨道（实测 vw 1407、主栏 600）。
 * ⛔ 变量必须写回**定义它的那一层**（最外层 `div.mx-auto.flex`，class 里带 `[--x-main-column-width:600px]`）：
 *    写在 `main` 自己身上、或写在 `<html>` 上都不生效 —— 前者被 grid 轨道定死，
 *    后者被 shell 自己的声明盖掉。实测只有 shell 层写进去才 600→840。
 */
let widthHost: HTMLElement | null = null;
let widthHostPrev = '';

/** 同值不写：心跳每 4s 会再调一次，而每写一次自定义属性都会标脏一次样式 */
function setVar(el: HTMLElement, k: string, v: string): void {
  if (el.style.getPropertyValue(k) !== v) el.style.setProperty(k, v);
}

/**
 * 返回是否命中了新版结构（找到了声明变量的那层外壳）。
 * 调用方拿它当路由：命中 ⇒ 变量路线；未命中 ⇒ 旧版，退回去打 class。
 */
export function syncWidthVar(w: number | null): boolean {
  const main = document.querySelector<HTMLElement>('main');
  // 最外层优先：只有它同时管住 grid 轨道与内层 max-width
  let host: HTMLElement | null = null;
  for (let el = main?.parentElement ?? null; el && el !== document.documentElement; el = el.parentElement) {
    if ((el.getAttribute('class') || '').includes('--x-main-column-width')) host = el;
  }
  if (widthHost && widthHost !== host) {
    widthHost.style.setProperty('--x-main-column-width', widthHostPrev);
    widthHost = null;
  }
  if (!host) return false;
  if (widthHost !== host) {
    widthHost = host;
    widthHostPrev = host.style.getPropertyValue('--x-main-column-width');
  }
  if (w === null) {
    // 恢复原值（可能是空串，那就整条删掉）
    if (widthHostPrev) setVar(host, '--x-main-column-width', widthHostPrev);
    else host.style.removeProperty('--x-main-column-width');
    return true;
  }
  setVar(host, '--x-main-column-width', `${w}px`);
  // 时间线自己还有一层 max-w-[var(--x-timeline-max-width,600px)]，不同步就只加宽外壳、内容仍 600
  const list = main?.querySelector('ul');
  const wrap = list?.parentElement;
  if (wrap instanceof HTMLElement) setVar(wrap, '--x-timeline-max-width', `${w}px`);
  return true;
}

/**
 * X 有些内层容器把 600px 写死在 max-width 上，主栏放宽后它们成为瓶颈。
 * 只沿 cell 的祖先链上溯（限宽层必定是祖先），成本 O(链长)，可以跟着 DOM 变更即时跑。
 */
export function widenInner(): void {
  const col = column();
  if (!col) return;

  // 种子取前两个 cell（防第一条挂在别的子树里）；骨架期退化成主栏的第一条子链
  const seeds: HTMLElement[] = [];
  const cells = feedCells(col);
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
  const path = location.pathname;
  const routeChanged = path !== lastCompPath;
  lastCompPath = path;
  const now = performance.now();
  const alive = !!compTarget && compTarget.isConnected;

  // 稳态早退：同一路由、上一轮已判 ok、目标节点还活着 ⇒ 结论不可能变，本轮连几何都不读。
  // ⛔ 这不是「有标记就跳过」的旧写法：节点被 X 换掉（alive 为假）或路由变了都会重算，
  //    详情页主帖晚出现那一类问题仍然走下面的完整判定。
  // 仍要补一次 class：applyFlat 等别处会摘标记，只补不摘，不算写入抖动。
  if (!routeChanged && html.dataset.xmComp === 'ok' && alive) {
    if (!compTarget!.classList.contains(COMP_HIDE_CLS)) compTarget!.classList.add(COMP_HIDE_CLS);
    return;
  }

  // 还没藏过任何一层 ⇒ 本轮必算：让面板白站 400ms 就是「隐藏太晚」（v0.1.93 修）
  const fresh = !alive;
  if (!(fresh && !isDetail) && now - lastCompScan < 400) return;
  lastCompScan = now;

  /**
   * 判失败时**不立刻降级**。
   * 失败的最常见原因恰恰是我们自己把面板 display:none 了 —— 那层里的候选按钮量出来是
   * 0×0，重解析必然 miss。一判就摘 class，面板露出来；下一轮又量得到尺寸、判 ok、藏回去：
   * 实测 dataset.xmComp 每 ~700ms 在 miss⇄ok 之间翻，文档高度来回跳 109px（发帖面板高度）。
   * 所以 ok 状态下要连续两轮失败才认。真失效（X 把节点换掉）时 alive 为假，直接降级。
   */
  const degrade = (reason: 'miss' | 'col' | 'guard'): void => {
    if (html.dataset.xmComp === 'ok' && alive && ++compMiss < 2) return;
    compMiss = 0;
    html.dataset.xmComp = reason;
    setCompTarget(null);
  };

  const col = column();
  const btn = col ? composeButton(col) : null;
  if (!col || !btn) {
    degrade('miss');
    return;
  }
  let area: Element | null = null;
  for (const sel of ['[data-testid="tweetTextarea_0"]', '[data-testid="tweetTextarea_0RichTextInputContainer"]', '[contenteditable="true"]', '[role="textbox"]']) {
    const el = col?.querySelector(sel);
    if (el) { area = el; break; }
  }
  if (!area) area = btn;

  let best: Element | null = area;
  while (best && best !== col && !best.contains(btn)) best = best.parentElement;
  if (!best || best === col) {
    degrade('miss');
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
    const foreignCell = feedCells(p).some((c) => !best!.contains(c));
    if (foreignCell) break;
    const foreignTab = [...p.querySelectorAll('[role="tablist"]')].some((t) => !best!.contains(t));
    if (foreignTab) break;
    // 几何保险：再往上这层就遮住大半屏了
    if (p.getBoundingClientRect().height > cap) break;
    best = p;
  }
  if (best === col) {
    degrade('col');
    return;
  }
  // 宁可什么都不藏，也不能藏到推文
  if (hasTweetContent(best) || best.getBoundingClientRect().height > cap) {
    degrade('guard');
    return;
  }
  // 详情页的 LCA 若把推文 cell 整个包进来（主帖与回复框同 cell 的极端结构），仍然停手
  if (isDetail && feedCells(best).length > 0) {
    degrade('guard');
    return;
  }
  compMiss = 0;
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
/** 上一轮判定的路由：SPA 切页后结论必须重算，同路由内的结论可以直接复用 */
let lastCompPath = '';
/** ok 状态下连续判失败的轮数，攒到 2 才真降级（见 markComposer 里的 degrade） */
let compMiss = 0;

/** 这一层里已经有推文的实质内容 ⇒ 是推文的地盘，不是发帖面板 */
function hasTweetContent(el: Element): boolean {
  return hasTweet(el);
}

/**
 * 发帖按钮。
 * 旧版是 `[data-testid="tweetButtonInline"]`；新版没有 testid，只能按语义认：
 * 「只有文案、没有数字」的按钮 —— 互动按钮（回复/转帖/点赞/书签）都带计数，
 * 且都被包在 `[role="group"]` 里，先排除掉就不会误认。
 */
const COMPOSE_RE = /^(发帖|发布|回复|post|post all|tweet|reply)$/i;
/** 上次认出的发帖按钮。X 不会把它旁边的东西换掉，节点还在就一直用 */
let compBtn: Element | null = null;

function composeButton(col: Element): Element | null {
  // 缓存优先、不碰几何：面板一旦被我们藏起来，里面的候选按钮 rect 就是 0×0，
  // 每轮重新按尺寸筛都会筛空 → 判 miss → 摘 class → 面板露出 → 下轮又筛中。
  // 这条循环正是「推文流持续抖动」的第二个来源（v0.2.1 修）。
  if (compBtn && compBtn.isConnected && col.contains(compBtn)) return compBtn;
  compBtn = resolveComposeButton(col);
  return compBtn;
}

function resolveComposeButton(col: Element): Element | null {
  const old = col.querySelector('[data-testid="tweetButtonInline"]');
  if (old) return old;
  for (const b of col.querySelectorAll<HTMLElement>('button, [role="button"]')) {
    if (b.closest('[role="group"]')) continue;
    const label = (b.getAttribute('aria-label') || b.textContent || '').replace(/\s+/g, ' ').trim();
    if (!label || label.length > 12 || !COMPOSE_RE.test(label)) continue;
    // 落在自己藏起来的那层里 ⇒ 量不出尺寸是必然的，此时只靠语义认，不做几何校验
    if (!b.closest('.' + COMP_HIDE_CLS)) {
      const r = b.getBoundingClientRect();
      if (r.width < 16 || r.height < 16) continue;
    }
    return b;
  }
  return null;
}
