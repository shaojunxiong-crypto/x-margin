/**
 * 「显示 N 帖子」提示行。
 *
 * 做法：原生那条整条压成 0 高藏掉（见 styles.ts 的 [data-xm-pill] 段），
 * 另在 body 上挂一条 fixed 窄带 .xm-pillbar，贴在顶栏下沿；点它就把点击
 * 转发给原生按钮 —— 刷新由 X 自己跑，我们只做入口。
 *
 * ⛔ 认行为什么不用 [data-testid="pillLabel"]：
 *   真机页面里同时存在一个 display:none 的 pillLabel（X 自己的「查看新帖子」浮层），
 *   按它认行会把 [data-xm-pill] 打到那个隐藏节点上 —— v0.1.70 就是这样失效的：
 *   改造条出现在隐藏节点处，真正的「显示 70 帖子」仍是品牌粉、仍是原样。
 *   所以这里只按 **按钮文案 + 可见性** 认，且认到的是 cell 里的那条。
 *
 * ⛔ 状态标记不能叫 dataset.xmPill：它落成的属性名就是 data-xm-pill，
 *   与钩子同名会把 <html> 一起标成提示行。故状态用 dataset.xmPillState。
 */

/** 打在原生提示行上的钩子：样式表据此把它压成 0 高 */
const PILL_ATTR = 'data-xm-pill';

/** 中文「显示 70 帖子」/「展示 12 条帖子」，英文 "Show 70 posts" / "70 posts" */
const CN_RE = /(显示|展示)\s*\d+\s*条?\s*帖子/;
const EN_RE = /^(show\s+)?\d+\s+posts?$/i;

/** 文案长度上限：超过这个长度必然是正文，不是提示行 */
const LABEL_MAX = 24;
/** 时间线头部先扫几条 cell：提示行永远在最前面 */
const HEAD_CELLS = 8;
/** 全列兜底扫描的最小间隔（前面的定向扫描每轮都跑，这个只在都落空时才用） */
const FULL_SCAN_GAP = 400;
/** 点击后闭嘴这个时长：等 X 把这一行收走，避免点了没反应时条自己又冒出来 */
const MUZZLE_MS = 2000;
/** 原生按钮从 DOM 里消失（虚拟列表回收）后，浮条最多再撑这么久 */
const STALE_MS = 60000;
/** 位置更新的最小间隔，避免每轮都量一次布局 */
const PLACE_GAP = 120;

interface Hit {
  btn: HTMLElement;
  row: HTMLElement;
  label: string;
}

let bar: HTMLButtonElement | null = null;
let barLabel = '';
let nativeRow: HTMLElement | null = null;
let nativeBtn: HTMLElement | null = null;
let lastFullScan = -1e9;
let lastHitAt = 0;
let lastPlace = -1e9;
let dismissedAt = -1e9;
let dismissedLabel = '';

/** 按钮文案是否就是提示行；顺手把连续空白压成一个空格 */
function labelOf(btn: HTMLElement): string {
  const t = (btn.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > LABEL_MAX) return '';
  return CN_RE.test(t) || EN_RE.test(t) ? t : '';
}

/** 从按钮上溯到「这一行」：cell 内就取 cell，浮层形态取 role=status */
function rowOf(el: HTMLElement): HTMLElement {
  const cell = el.closest<HTMLElement>('[data-testid="cellInnerDiv"]');
  if (cell) return cell;
  const status = el.closest<HTMLElement>('[role="status"]');
  return status ?? el;
}

function hitIn(scope: HTMLElement): Hit | null {
  const btns = scope.matches('button,[role="button"]')
    ? [scope]
    : Array.from(scope.querySelectorAll<HTMLElement>('button,[role="button"]'));
  for (const btn of btns) {
    const label = labelOf(btn);
    if (!label) continue;
    const row = rowOf(btn);
    // 已接管的那一行高度已被压成 0，放行；没接管的要求肉眼可见
    if (!row.hasAttribute(PILL_ATTR) && row.getBoundingClientRect().height < 1) continue;
    return { btn, row, label };
  }
  return null;
}

/**
 * 认这一行。
 * 顺序：时间线头部 cell → role=status 浮层 → 全列按钮（限频兜底）。
 * 头部 cell 是主路径：真机上「显示 N 帖子」就是时间线的第 0 条 cell。
 */
function scan(col: HTMLElement, now: number): Hit | null {
  const cells = col.querySelectorAll<HTMLElement>('[data-testid="cellInnerDiv"]');
  const head = Math.min(cells.length, HEAD_CELLS);
  for (let i = 0; i < head; i++) {
    const hit = hitIn(cells[i]);
    if (hit) return hit;
  }
  for (const st of Array.from(col.querySelectorAll<HTMLElement>('[role="status"]'))) {
    const hit = hitIn(st);
    if (hit) return hit;
  }
  if (now - lastFullScan < FULL_SCAN_GAP) return null;
  lastFullScan = now;
  return hitIn(col);
}

function ensureBar(): HTMLButtonElement {
  if (bar?.isConnected) return bar;
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'xm-pillbar';
  el.dataset.on = '0';
  el.addEventListener('click', onClick);
  document.body.appendChild(el);
  bar = el;
  barLabel = '';
  return el;
}

/** 点击：只转发给原生按钮，刷新逻辑完全交回 X */
function onClick(e: MouseEvent): void {
  e.preventDefault();
  e.stopPropagation();
  const label = barLabel;
  const btn = nativeBtn;
  hideBar();
  dismissedAt = performance.now();
  dismissedLabel = label;
  if (btn?.isConnected) {
    btn.click();
    return;
  }
  // 原生按钮已被虚拟列表回收：退回顶部，下一轮扫描会重新认出它
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function showBar(label: string): void {
  const el = ensureBar();
  if (barLabel !== label) {
    el.textContent = label;
    barLabel = label;
  }
  if (el.dataset.on !== '1') el.dataset.on = '1';
}

function hideBar(): void {
  if (bar && bar.dataset.on !== '0') bar.dataset.on = '0';
}

function takeRow(row: HTMLElement): void {
  if (nativeRow === row) return;
  nativeRow?.removeAttribute(PILL_ATTR);
  nativeRow = row;
  if (!row.hasAttribute(PILL_ATTR)) row.setAttribute(PILL_ATTR, '');
}

function clearRow(): void {
  nativeRow?.removeAttribute(PILL_ATTR);
  nativeRow = null;
}

/** 把浮条钉在主栏左沿、顶栏（tablist）下沿；没有 tablist 就退回主栏顶 */
function place(col: HTMLElement, now: number): void {
  if (!bar || bar.dataset.on !== '1') return;
  if (now - lastPlace < PLACE_GAP) return;
  lastPlace = now;
  const r = col.getBoundingClientRect();
  const tabs = col.querySelector<HTMLElement>('[role="tablist"]');
  const top = tabs ? tabs.getBoundingClientRect().bottom : Math.max(r.top, 0);
  bar.style.left = Math.round(r.left) + 'px';
  bar.style.width = Math.round(r.width) + 'px';
  bar.style.top = Math.round(top) + 'px';
}

function teardown(): void {
  clearRow();
  nativeBtn = null;
  hideBar();
  document.documentElement.dataset.xmPillState = 'off';
}

/**
 * 每轮补扫调用。命中就接管原生行、显示浮条；没命中就让浮条再撑一会
 * （原生按钮可能只是被虚拟列表回收，用户没点之前不该自己消失）。
 */
export function markPill(): void {
  // 只在卡片模式下做：非卡片时这行本来就和页面同色，接管没有意义
  if (!document.documentElement.classList.contains('xm-card')) {
    if (nativeRow || bar) teardown();
    return;
  }
  const col = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]');
  if (!col) {
    if (nativeRow || bar) teardown();
    return;
  }

  const now = performance.now();
  const hit = scan(col, now);

  if (hit) {
    takeRow(hit.row);
    nativeBtn = hit.btn;
    lastHitAt = now;
    const muzzled = hit.label === dismissedLabel && now - dismissedAt < MUZZLE_MS;
    if (muzzled) hideBar();
    else showBar(hit.label);
    document.documentElement.dataset.xmPillState = 'ok';
  } else if (bar?.dataset.on === '1' && now - lastHitAt < STALE_MS) {
    // 按钮暂时不在 DOM：浮条继续挂着，用户点了会滚回顶部重新认
    document.documentElement.dataset.xmPillState = 'hold';
  } else {
    hideBar();
    clearRow();
    nativeBtn = null;
    document.documentElement.dataset.xmPillState = 'miss';
  }

  place(col, now);
}
