/**
 * 二级页的页头收起：通知、历史（书签 / 喜欢）这类「顶栏 + 标签栏」的页面。
 *
 * 目标：把最顶上那一行（返回箭头 + 标题 + 右侧搜索/信息/齿轮）整行去掉，
 * 保留它下面的标签栏与列表，与通知页的处理保持一致。
 *
 * 找法不依赖任何 testid（标题、返回、搜索的类名都是构建哈希，随版本变）：
 * 以「内容起点」= 标签栏或第一条 cell 为基准，沿祖先链逐层向上，
 * 把「排在内容前面、又不含内容」的小块收掉 —— 收到的正好是顶栏那一行。
 *
 * ⛔ 不用 h1 定位：X 的 h1 是给读屏用的隐藏标签（position:absolute + overflow:hidden），
 * 它所在的 section 里装着整条时间线，按它藏会把列表一起藏掉。
 * ⛔ 不写内联 display：React 重渲染会冲掉 style（v0.1.62 的留白就是这么失效的）。
 * 改成「打属性 + 样式表 `[data-xm-page-head]{display:none}`」，节点被重建后 scan 会补回来。
 * ⛔ 状态标记绝不能叫 dataset.xmPageHead —— 它落成的属性名就是 data-xm-page-head，
 * 与上面那条选择器同名，会把 <html> 一起隐藏（整页白屏）。故用 xmHeadState。
 */

/** 只在这些路由下动手，切走自动还原。历史页两种写法都要认 */
const ROUTES: RegExp[] = [/(^|\/)notifications(\/|$)/, /(^|\/)history(\/|$)/, /(^|\/)i\/history(\/|$)/];

/** 内容起点：标签栏，或列表里第一条 cell */
const CONTENT_SEL = '[role="tablist"], [data-testid="cellInnerDiv"]';
/** 顶栏约 53px；上限 140 挡住「整个主栏」这种误判 */
const BLOCK_LIMIT = 140;

const GEAR_SEL = 'a[href="/settings"], a[href^="/settings/"], a[href$="/settings"]';
const BACK_SEL = '[data-testid="app-bar-back"], [aria-label="返回"], [aria-label="Back"]';
/** 标记：这一层被我们藏起来了，离开页面时按属性还原 */
const HEAD_ATTR = 'data-xm-page-head';

let dirty = false;
let lastRun = -1e9;

const onTarget = (): boolean => ROUTES.some((re) => re.test(location.pathname));

function release(): void {
  if (!dirty) return;
  dirty = false;
  for (const el of document.querySelectorAll<HTMLElement>(`[${HEAD_ATTR}]`)) el.removeAttribute(HEAD_ATTR);
  document.documentElement.dataset.xmHeadState = 'off';
}

function mark(rows: HTMLElement[]): void {
  for (const r of rows) {
    if (r.hasAttribute(HEAD_ATTR)) continue;
    r.setAttribute(HEAD_ATTR, '');
    dirty = true;
  }
  document.documentElement.dataset.xmHead = String(rows.length);
}

/**
 * 主路径：从内容起点往上找「排在它前面、又不含它」的小块。
 * 逐层检查，第一层能收到就停 —— 再往上就会连标签栏一起收掉。
 *
 * ⛔ 必须排除绝对/固定定位的浮层：历史页的标签栏外层是 ScrollSnap-SwipeableList，
 * 它前面紧挨着的 `ScrollSnap-prevButtonWrapper` 是浮在标签上的「上一页」箭头，
 * 高度小、又不含内容，v0.1.65 就是把它当顶栏藏了，真正的页头反而没动。
 */
function chromeBefore(col: HTMLElement): HTMLElement[] {
  const content = col.querySelector<HTMLElement>(CONTENT_SEL);
  if (!content) return [];
  for (let el: HTMLElement | null = content; el && el !== col; el = el.parentElement) {
    const rows: HTMLElement[] = [];
    for (let s = el.previousElementSibling; s; s = s.previousElementSibling) {
      if (!(s instanceof HTMLElement)) continue;
      // 已经藏过的要放行：display:none 之后高度是 0，若在这里跳过，下一轮就认不出它了
      if (s.hasAttribute(HEAD_ATTR)) { rows.push(s); continue; }
      if (s.clientHeight === 0) continue; // 空占位
      if (s.clientHeight > BLOCK_LIMIT) continue; // 整段列表或整栏
      if (s.querySelector('[data-testid="cellInnerDiv"]')) continue;
      if (s.querySelector('[role="tablist"]')) continue;
      if (s.matches('[data-testid^="ScrollSnap-"]')) continue; // 标签栏两侧的箭头
      // 浮层按钮（上一页 / 下一页 / 关闭）都是窄条绝对定位；页头即使绝对定位也是满宽，
      // 所以只按「绝对定位且明显窄于主栏」排除，避免把真页头一起跳掉。
      const pos = getComputedStyle(s).position;
      if ((pos === 'absolute' || pos === 'fixed') && s.clientWidth < col.clientWidth * 0.6) continue;
      rows.push(s);
    }
    if (rows.length) return rows;
  }
  return [];
}

/**
 * 兜底：页面里没有标签栏时（如详情页），退回「锚点 + 往上走」。
 * 锚点优先级：可见标题（h2，带不带 role 都认）> 齿轮 > 返回键，
 * 一律排除 cellInnerDiv 里的 —— 时间线里也有 role="heading"。
 */
function chromeByAnchor(col: HTMLElement): HTMLElement[] {
  let anchor: HTMLElement | null = null;
  for (const el of col.querySelectorAll<HTMLElement>('h2[role="heading"], h2')) {
    if (!el.closest('[data-testid="cellInnerDiv"]')) { anchor = el; break; }
  }
  if (!anchor) {
    const gear = col.querySelector<HTMLElement>(GEAR_SEL);
    if (gear && !gear.closest('[data-testid="cellInnerDiv"]')) anchor = gear;
  }
  if (!anchor) anchor = col.querySelector<HTMLElement>(BACK_SEL);
  if (!anchor) return [];
  let row: HTMLElement | null = null;
  for (let el: HTMLElement | null = anchor.parentElement; el && el !== col; el = el.parentElement) {
    if (el.querySelector('[data-testid="cellInnerDiv"]')) break;
    if (el.querySelector('[role="tablist"]')) break;
    if (el.clientHeight > BLOCK_LIMIT) break;
    row = el;
    const pos = getComputedStyle(el).position;
    if (pos === 'sticky' || pos === 'fixed') break;
  }
  return row ? [row] : [];
}

/** 对外入口：按当前路由决定「收页头」还是「还回去」。节流 250ms，会被 scan 高频调用。 */
export function markPageHead(): void {
  if (!onTarget()) {
    release();
    return;
  }
  const now = performance.now();
  if (now - lastRun < 250) return;
  lastRun = now;
  const col = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]');
  if (!col) return;
  let rows = chromeBefore(col);
  if (!rows.length) rows = chromeByAnchor(col);
  if (!rows.length) {
    document.documentElement.dataset.xmHead = 'none';
    return;
  }
  mark(rows);
  document.documentElement.dataset.xmHeadState = 'head';
}
