/**
 * 回退换场的遮罩。
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
 * 遮罩本身**不画任何东西**：只给 html 挂 `xm-stage-on`，由样式表把推文格子
 * `visibility:hidden`。等待期看到的是 X 自己的骨架与页面底色，和它的加载态一致；
 * 以前那层全屏半透明 + 3px 模糊在有壁纸时就是一层蓝雾（2026-11-26 用户裁定换掉）。
 * ⛔ 遮罩必须瞬时生效（class 在同一任务内挂上），不能做淡入：淡入的头几帧抖动会原样透出来。
 * ⛔ 只在「往回走」时 arm：前进（点开推文）不盖，否则每次点推文都空一下。
 */

import { anchorSettled } from './anchor';
import { cells as feedCells, column } from './sel';
import { feedSettled } from './feed';
import {
  baseSketch,
  detailSketch,
  hideSketch,
  peekSketch,
  recallSketch,
  showSketch,
  syncSketchFrame,
  type Sketch,
} from './sketch';

/** 最短显示：低于这个值像闪了一下，反而更显眼 */
const MIN_MS = 260;
/** 连续这么久没有任何变化，才算真的安静 */
const QUIET_MS = 180;
/** 绝对上限：X 迟迟不铺内容也必须揭，不能一直盖着 */
const HARD_MS = 1800;
/**
 * 带骨架时的绝对上限。
 * 骨架只在「主栏还没有铺好的内容」时才画，所以盖着的时候底下本来就是空的 ——
 * 可以放心等久一点（揭幕的真正扳机是内容铺好，见 frame()）。
 * 超过这个上限说明主栏一直没内容（网络慢/报错），再盖下去就是骗人，交给 X 自己的加载态。
 */
const HARD_SKETCH_MS = 1400;
/**
 * 预挂的寿命。点返回箭头就挂骨架，但用户也可能只是误点（X 有时点箭头只关弹层）。
 * 900ms 内路径没变就自己撤 —— 误点看到灰块 0.9 秒，比看到 1.4 秒好。
 */
const PREARM_MS = 900;
/**
 * 详情页结构与列表结构的天花板不同：
 * 直接打开 `/status/...` 要等文档 + 数据，比「回退时列表已在内存」慢得多，
 * 给到 2200ms；真正的揭幕扳机仍是「内容铺好」（frame 里的 laidOut）。
 */
const DETAIL_MS = 2200;
/** 揭幕刚开始的这段时间里若又重排，允许把遮罩按回去一次（此刻格子刚显形，回盖几乎看不出） */
const RECOAT_MS = 140;

/** 遮罩的开关：挂在 html 上，样式表据此把格子隐身（见 styles.ts 的 xm-stage-on 段） */
const STAGE_CLS = 'xm-stage-on';
/** 返回箭头。新版是 aria-label，旧版是 testid —— 两种都认 */
const BACK_SEL =
  '[data-testid="app-bar-back"], [data-testid="app-bar-back-button"], [aria-label="返回"], [aria-label="Back"]';

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
/** 当前挂着的骨架节点（没有骨架时为 null） */
let snapEl: HTMLElement | null = null;
/** 这一轮是否用过骨架；用过就不再回盖（见 onMutate） */
let usedSnap = false;
/** 上一次见过的路径，用来判断这次 popstate 是往回走还是往前走 */
let lastPath = location.pathname;
/**
 * 预挂时记下的路径。`waitMove` 为真时，必须等路径真的变了才开始判揭幕 ——
 * 否则主栏里还是详情页的内容，`laidOut` 必然为真，骨架一挂上就被判「已有内容」而立刻撤掉。
 * 实测（2026-11-27）：预挂后 100ms 就揭，用户看到的是「一闪就没」。
 */
let armedPath = '';
let waitMove = false;
/** 矩形跟随的节流计数（只在 detail/base 形态下有用） */
let syncTick = 0;

const segs = (p: string): number => p.split('/').filter(Boolean).length;

/**
 * 主栏里是否已经有「真的铺好了」的推文：有实际高度、且和视口有交集。
 *
 * 这是骨架的生死线。这台机器上 X 的回退经常在同一帧内就把列表铺回来（80ms 轮询反而落在后面），
 * 于是骨架会压在**已经能读的内容**上 —— 「有什么新鲜事」编辑器被灰块压住就是这么来的。
 * 有内容就不该再等，也就没有骨架存在的理由。
 */
function laidOut(col: HTMLElement): boolean {
  const vh = innerHeight;
  for (const c of feedCells(col)) {
    const r = c.getBoundingClientRect();
    if (r.height < 40) continue;
    if (r.bottom < 0 || r.top > vh) continue;
    return true;
  }
  return false;
}

/** 布局指纹：数量 + 总高 + 首条位置。首条位置能抓到「高度没变但整体平移」的重排 */
function sample(col: HTMLElement): string {
  const cells = feedCells(col);
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
  // 用过骨架（回退）就不再回盖：骨架已经把重建那段盖住了，揭幕后再藏一次只会闪出空白
  if (usedSnap) return;
  // 刚揭幕就又动了：把遮罩按回去，别让用户看着半截内容在跳
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

/** 揭幕：摘 class，格子立刻回到可见；有骨架的让它盖在上面淡出 */
function release(user: boolean): void {
  if (!armed) return;
  armed = false;
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  document.documentElement.classList.remove(STAGE_CLS);
  releasedAt = performance.now();
  // 骨架必须和遮罩同一个任务里撤掉：这一帧真实内容正好显形，
  // 淡出会留下 160ms 的灰影盖在字上（「被压住」的观感就是它造成的）。硬切才是此刻的正确观感。
  if (snapEl) {
    snapEl = null;
    hideSketch(0, true);
  }
  // 用户自己动了：立刻收工，不留尾巴观察
  stopObserving(user ? 0 : RECOAT_MS);
}

function frame(): void {
  raf = 0;
  if (!armed) return;
  const col = column();
  const now = performance.now();

  // `detail` / `base` 的矩形是估出来的（首帧连 main 都还没排好），要跟着布局修正。
  // 每 3 帧一次（≈50ms）足够，`list` 在 syncSketchFrame 内部直接跳过。
  if (++syncTick % 3 === 0) syncSketchFrame();

  if (col) {
    if (col !== moCol) observe(col);
    const s = sample(col);
    if (s !== sig) { sig = s; lastDirty = now; }
  }

  // 带骨架时安静期拉长到 240ms：详情页首帧可能还是 600px 窄布局，
  // 180ms 就揭会让用户看到「先窄后宽」。多等 60ms 换来一次到位。
  const quietMs = usedSnap ? 240 : QUIET_MS;

  /**
   * 预挂（点返回箭头 / 侧键 / Alt+←）之后，导航还没发生，主栏里仍是详情页。
   * 这一段绝不能走揭幕判据 —— 详情页的格子同样 `laidOut` 为真，一判就等于立刻撤幕。
   * 只等路径真的变了再开始，误点由 `PREARM_MS` 兜底。
   */
  if (waitMove && location.pathname === armedPath) {
    if (now >= hardAt) { release(false); return; }
    raf = requestAnimationFrame(frame);
    return;
  }

  // 骨架的专职是「盖住空的那一段」。内容一旦真铺好，它必须立刻退场 ——
  // 再等安静期就是拿灰块压着能读的字。100ms 的下限只为避开首帧的假高度。
  if (usedSnap && col && now - startedAt >= 100 && laidOut(col)) { release(false); return; }

  const ready = !!col
    && feedCells(col).length > 0
    && now - lastDirty >= quietMs
    && now - startedAt >= MIN_MS
    && anchorSettled()
    && feedSettled();

  if (ready || now >= hardAt) { release(false); return; }
  raf = requestAnimationFrame(frame);
}

/**
 * 挂遮罩（同一个任务内生效，保证重建后的第一帧格子就已经隐身）。
 * `snap` 存在时额外画一层骨架：回主页时用它顶住整块主栏，
 * 等待期看到的是「刚才那一屏的轮廓」，而不是空白或一帧一帧长出来的骨架。
 * ⛔ 主栏若已经有铺好的推文，骨架一律不画 —— 见下面的 laidOut 判断。
 */
export function armStage(snap?: Sketch, force = false, expectMove = false): void {
  const html = document.documentElement;
  if (!html) return;

  /**
   * 进场判据：**主栏已经有可读内容就不进场**。
   *
   * 2026-11-27 实测（登录态 Edge，逐帧采样）：
   *   t=0    按下后退 —— 主线程被 X 的重建阻塞，我们连一帧都插不进去
   *   t=697ms 第一帧可采样，此时 cells=9 / laid=3，内容**已经铺好**
   *   t=697→1216ms 遮罩盖着，而 cells/laid/scrollY 一个都没变，没有任何重排
   * ⇒ 遮罩白遮了 519ms 可读内容，用户看到的就是「回退后空白半秒多」。
   *
   * 所以判据不能是「有没有 cell 节点」（详情页的回复同样是 cell，会误判为「有内容」而把
   * 遮罩挂上去），也不能是「无条件挂」（会遮住已经能读的内容）。要的是 `laidOut`：
   * 有高度、且与视口相交的真实格子 —— 那才叫「用户已经能读了」。
   */
  // `force` 是「点返回箭头时预挂」专用：那一刻主栏里当然还是详情页的内容，
  // 正常判据会拒绝进场，而我们要的恰恰是抢在 X 的 600ms 重建之前把画面换掉。
  if (!force) {
    const c0 = column();
    if (!c0 || laidOut(c0)) {
      if (armed) release(true);
      return;
    }
  }

  // 上一轮揭幕排的「延时断观察」必须撤掉，否则会在回盖后把观察器摘掉
  if (moTimer) { clearTimeout(moTimer); moTimer = 0; }
  const now = performance.now();
  /**
   * ⛔ 舞台必须是**不透明**的：透出底下的重建过程就等于没遮。
   *   所以 force 进场却没有几何时，按当前页面选一个结构垫上 ——
   *   详情页用详情版式，其余用纯底（至少挡住抖动）。
   * ⛔ 必须在下面算 `usedSnap` / `hardAt` **之前**定下来：
   *   这两处都读 `snap.kind`，晚一步就等于「有骨架却按没骨架处理」。
   */
  if (!snap && force) snap = /\/(status|web\/status)\//.test(location.pathname) ? detailSketch() : baseSketch();
  if (!armed) {
    armed = true;
    recoatUsed = false;
    usedSnap = !!snap;
    startedAt = now;
    armedPath = location.pathname;
    waitMove = expectMove;
    hardAt =
      now +
      (snap?.kind === 'detail' ? DETAIL_MS : force ? PREARM_MS : snap ? HARD_SKETCH_MS : HARD_MS);
    raf = requestAnimationFrame(frame);
  } else if (snap) {
    // 回盖时补上新骨架：上限按骨架重算，别沿用回退那条 1800ms
    hardAt = now + HARD_SKETCH_MS;
  }
  if (snap && !snapEl) snapEl = showSketch(snap);
  // 回盖时要重新计时：安静期从这一刻重新数
  lastDirty = now;
  sig = '';
  const col = column();
  if (col) {
    observe(col);
    sig = sample(col);
  }
  html.classList.add(STAGE_CLS);
}

/**
 * 等主栏出现再动手。
 *
 * content script 在 document_start 就注入，那时 body 可能还没有，`column()` 拿不到矩形。
 * 直接打开详情页的舞台必须等主栏出现才量得出宽度，否则只能按视口猜一个版心。
 */
function waitColumn(cb: () => void, timeout = 4000): void {
  const t0 = performance.now();
  const tick = (): void => {
    if (column()) { cb(); return; }
    if (performance.now() - t0 >= timeout) return;
    requestAnimationFrame(tick);
  };
  tick();
}

/**
 * 「用户要后退」的意图。只有能**抢在 X 重建之前**拿到的信号才算：
 *   · 鼠标侧键后退（button 3）、键盘 Alt+←：浏览器把后退当输入事件处理，
 *     事件先到页面，我们可以在这一帧把舞台挂出来；
 *   · 浏览器 UI 上的后退按钮、手势：不经过页面事件，拿不到 —— 这是能力边界。
 */
function backIntent(ev: Event): boolean {
  if (ev.type === 'keydown') {
    const k = ev as KeyboardEvent;
    return k.altKey && k.key === 'ArrowLeft';
  }
  if (ev.type === 'pointerdown') {
    const p = ev as PointerEvent;
    return p.button === 3;
  }
  return false;
}

/**
 * 预挂：抢在重建之前把舞台画出来。
 * ⛔ 没有几何就不挂 —— 光一块不透明底等于把能读的详情页糊掉，比卡一帧更难受。
 */
function prearm(): void {
  const s = peekSketch();
  if (s) armStage(s, true, true);
}

export function initStage(): void {
  // 兜底：上一次会话若在揭幕前中止，class 可能留在 html 上，一进来先摘掉
  document.documentElement?.classList.remove(STAGE_CLS);

  /**
   * 往回走：挂遮罩，并尽量带上离开时量到的几何（见 sketch.ts）。
   * 带骨架的这一次才是用户真正看到的「X 那种等待」—— 回主页时 X 重建的正是刚才那个列表。
   */
  const retreat = (to: string, force = false): void => {
    if (document.hidden) return;
    armStage(recallSketch(to) ?? undefined, force);
  };

  addEventListener('popstate', () => {
    const to = location.pathname;
    // 只在路径层数变少时盖（详情页 → 时间线）；前进、横向切页不盖
    // popstate 是「回退已经发生」的确定信号：底下那屏详情页注定被替换，
    // 遮住它不会误伤。⛔ 不加 force 就会被 laidOut 判成「已有内容」而不进场 —— 舞台整块消失。
    if (segs(to) < segs(lastPath)) retreat(to, true);
    lastPath = to;
  });

  // bfcache 原样恢复：DOM 是旧的，一般不会抖，但 X 常会重排一次，盖一下成本为零
  addEventListener('pageshow', (e) => {
    if ((e as PageTransitionEvent).persisted) armStage();
  });

  /**
   * 点返回箭头那一刻就预挂。
   *
   * 实测（2026-11-27，登录态）：从按下后退到第一帧可采样隔了 560–700ms，主线程全程被 X 的同步
   * 重建占满 —— 带扩展与不带扩展的耗时无差别（592/615/633 vs 561/628/649），所以不是我们拖的。
   * 这意味着所有「事后」的挂载（popstate、80ms 轮询）都落在重建之后：那时内容已经铺好，
   * 我们唯一能做的只有把它遮住（实测遮了 519ms）。
   *
   * 要真正参与这一段，只能在**重建开始之前**动手：返回箭头的 pointerdown 就是最后的机会。
   * ⛔ 必须挂在 bail 之前注册：bail 会在任何 pointerdown 上立刻揭幕，顺序颠倒会把刚挂的撤掉。
   * ⛔ 没有几何就不预挂 —— 光挂遮罩等于把详情页藏起来，那才是真正的空白。
   */
  addEventListener(
    'pointerdown',
    (ev) => {
      if (!(ev.target as Element | null)?.closest?.(BACK_SEL)) return;
      const s = peekSketch();
      if (!s) return;
      armStage(s, true, true);
    },
    true,
  );

  // 用户一动立即揭幕 —— 宁可露出来，也不跟手指抢。
  // ⛔ pointerdown 要排除返回箭头：那一下是我们唯一能预挂的时机，
  //    同一个事件里 bail 紧跟着就把骨架撤了，等于白挂。
  const bail = (ev: Event): void => {
    if (backIntent(ev)) return;
    release(true);
  };
  for (const t of ['wheel', 'touchstart', 'keydown'] as const) {
    addEventListener(t, bail, { passive: true, capture: true });
  }
  addEventListener(
    'pointerdown',
    (ev) => {
      if ((ev.target as Element | null)?.closest?.(BACK_SEL) || backIntent(ev)) return;
      release(true);
    },
    { passive: true, capture: true },
  );

  // 侧键后退 / Alt+←：和点返回箭头同一性质，都是「重建之前的最后时机」。
  // ⛔ 必须注册在 bail 之后无所谓 —— bail 里已经按 backIntent 放行了。
  addEventListener('keydown', (ev) => { if (backIntent(ev)) prearm(); }, { capture: true });
  addEventListener('pointerdown', (ev) => { if (backIntent(ev)) prearm(); }, { capture: true });

  /**
   * 路径靠轮询：`history.pushState` 在隔离世界里拦不到页面自己的调用，
   * 而且 X 的返回箭头不一定走 popstate（多数情况是 router 自己 push）。
   * 80ms ≈ 五帧，够快；比 400ms 那版快的理由就是「晚一帧就露一帧裸骨架」。
   *
   * 同样走 force：轮询命中时路径已经变了，底下那屏不管是什么都注定被换掉。
   * 万一它确实来晚了、内容已经铺好，frame() 里的 `laidOut` 会在 100ms 内揭幕，
   * 最多遮一帧多 —— 比「整块舞台消失」可接受得多。
   */
  setInterval(() => {
    const to = location.pathname;
    if (to === lastPath) return;
    if (segs(to) < segs(lastPath)) retreat(to, true);
    lastPath = to;
  }, 80);

  /**
   * 整页加载：content script 全新注入，popstate 一个都没等到，只能看导航类型。
   *   · back_forward —— 整页回退，没有几何，按当前路径兜底（详情页用详情版式）；
   *   · 直接打开 `/status/...` —— 屏幕上要出现的是一条推文，用**详情页结构**搭舞台，
   *     拿主页的列表形状去盖是错位的。主栏可能还没出现，等它。
   */
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav?.type === 'back_forward') {
      armStage(undefined, true);
    } else if (/\/(status|web\/status)\//.test(location.pathname)) {
      waitColumn(() => armStage(detailSketch(), true));
    }
  } catch {
    /* 拿不到导航类型就当普通打开 */
  }
}
