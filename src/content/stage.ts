/**
 * 回退换场的幕布。
 *
 * 回退时 X 把主栏整棵重建：新节点自带 inline max-width:600px，加宽要等下一轮 MutationObserver，
 * 中间露 1–2 帧窄布局；随后定位校正把滚动挪几百像素；260ms 后线程分组落定又会改一批 class，
 * 高度差 15px、整列再重排一次。前两下在首帧内，第三下在 300ms 之后 —— 这就是
 * 「动画结束了页面还在重排」的来源。
 *
 * 所以揭幕不能看「几帧没变」，要看三件事同时成立：
 *   ① 主栏连续 QUIET_MS 没有任何 DOM 变动、scrollHeight 与首条位置都没动；
 *   ② 线程分组已落定（feed.ts 的 260ms 稳定闸门走完，pendingSig 清空）；
 *   ③ 定位校正已收敛（anchor.ts 最近 500ms 没再跳）。
 *
 * 半透明 + 3px 模糊是有意的：网络慢时内容可能几百毫秒才铺开，全不透明就成了「死屏」。
 * ⛔ 幕布必须瞬时出现（CSS 里 data-on 的 transition:none），淡入会让头几帧透出重排。
 * ⛔ 幕布在 boot 期挂好，回退时才 createElement 等于用一次闪烁去盖另一次闪烁。
 * ⛔ 只在「往回走」时 arm：前进（点开推文）不盖，否则每次点推文都暗一下。
 */

import { anchorSettled } from './anchor';
import { feedSettled } from './feed';

/** 最短显示：低于这个值像闪了一下，反而更显眼 */
const MIN_MS = 260;
/** 连续这么久没有任何变化，才算真的安静 */
const QUIET_MS = 180;
/** 绝对上限：X 迟迟不铺内容也必须揭，不能一直盖着 */
const HARD_MS = 1800;
/** 揭幕淡出刚开始的这段时间里若又重排，允许把幕布按回去一次（此时不透明度还高，看不出回跳） */
const RECOAT_MS = 140;

let el: HTMLElement | null = null;
let armed = false;
let raf = 0;
let startedAt = 0;
let hardAt = 0;
let lastDirty = 0;
let sig = '';
let mo: MutationObserver | null = null;
let moCol: HTMLElement | null = null;
let moTimer = 0;
let releasedAt = 0;
let recoatUsed = false;
/** 上一次见过的路径，用来判断这次 popstate 是往回走还是往前走 */
let lastPath = location.pathname;

const segs = (p: string): number => p.split('/').filter(Boolean).length;

function column(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="primaryColumn"]');
}

/** 布局指纹：数量 + 总高 + 首条位置。首条位置能抓到「高度没变但整体平移」的重排 */
function sample(col: HTMLElement): string {
  const cells = col.querySelectorAll<HTMLElement>('[data-testid="cellInnerDiv"]');
  const top = cells.length ? Math.round(cells[0].getBoundingClientRect().top) : 0;
  return `${cells.length}|${Math.round(col.scrollHeight)}|${top}`;
}

function observe(col: HTMLElement): void {
  if (!mo) mo = new MutationObserver(onMutate);
  moCol = col;
  mo.observe(col, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
}

function onMutate(): void {
  lastDirty = performance.now();
  if (armed || recoatUsed) return;
  // 淡出才刚开始（幕布还基本不透明）：把幕布按回去，避免用户看着内容在透明化的过程中跳
  if (lastDirty - releasedAt <= RECOAT_MS) {
    recoatUsed = true;
    armStage();
  }
}

function stopObserving(delay: number): void {
  if (moTimer) clearTimeout(moTimer);
  moTimer = window.setTimeout(() => {
    moTimer = 0;
    mo?.disconnect();
    mo = null;
    moCol = null;
  }, delay);
}

function mount(): void {
  if (el || !document.documentElement) return;
  const d = document.createElement('div');
  d.className = 'xm-stage';
  d.setAttribute('aria-hidden', 'true');
  (document.body ?? document.documentElement).append(d);
  el = d;
}

/** 揭幕：撤掉开关，由 CSS 走 130ms 淡出 */
function release(user: boolean): void {
  if (!armed) return;
  armed = false;
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  if (el) delete el.dataset.on;
  releasedAt = performance.now();
  // 用户自己动了：立刻收工，不留尾巴观察
  stopObserving(user ? 0 : RECOAT_MS);
}

function frame(): void {
  raf = 0;
  if (!armed) return;
  const col = column();
  const now = performance.now();

  if (col) {
    if (col !== moCol) observe(col);
    const s = sample(col);
    if (s !== sig) { sig = s; lastDirty = now; }
  }

  const ready = !!col
    && col.querySelector('[data-testid="cellInnerDiv"]') !== null
    && now - lastDirty >= QUIET_MS
    && now - startedAt >= MIN_MS
    && anchorSettled()
    && feedSettled();

  if (ready || now >= hardAt) { release(false); return; }
  raf = requestAnimationFrame(frame);
}

/** 挂幕布（同一个任务内生效，保证重建后的第一帧就已经被盖住） */
export function armStage(): void {
  mount();
  if (!el) return;
  // 上一轮揭幕排的「延时断观察」必须撤掉，否则会在回盖后把观察器摘掉
  if (moTimer) { clearTimeout(moTimer); moTimer = 0; }
  const now = performance.now();
  if (!armed) {
    armed = true;
    recoatUsed = false;
    startedAt = now;
    hardAt = now + HARD_MS;
    raf = requestAnimationFrame(frame);
  }
  // 回盖时要重新计时：安静期从这一刻重新数
  lastDirty = now;
  sig = '';
  const col = column();
  if (col) {
    observe(col);
    sig = sample(col);
  }
  el.dataset.on = '1';
}

export function initStage(): void {
  mount();

  addEventListener('popstate', () => {
    const to = location.pathname;
    // 只在路径层数变少时盖（详情页 → 时间线）；前进、横向切页不盖
    if (segs(to) < segs(lastPath) && !document.hidden) armStage();
    lastPath = to;
  });

  // bfcache 原样恢复：DOM 是旧的，一般不会抖，但 X 常会重排一次，盖一下成本为零
  addEventListener('pageshow', (e) => {
    if ((e as PageTransitionEvent).persisted) armStage();
  });

  // 用户一动立即揭幕 —— 宁可露出来，也不跟手指抢
  const bail = (): void => release(true);
  for (const t of ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const) {
    addEventListener(t, bail, { passive: true, capture: true });
  }

  // lastPath 靠轮询更新：pushState 在隔离世界拦不到页面自己的 history 调用。
  // 400ms 足够（正常使用中点开推文不会立刻回退），漏掉的后果只是「这次不盖」，不会出错。
  setInterval(() => {
    if (!armed) lastPath = location.pathname;
  }, 400);

  // 整页回退：content script 全新注入，popstate 一个都没等到，只能看导航类型
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav?.type === 'back_forward') armStage();
  } catch {
    /* 拿不到导航类型就当普通打开 */
  }
}
