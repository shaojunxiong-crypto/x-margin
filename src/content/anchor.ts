/**
 * 回退 / 前进后的位置锚定。
 *
 * 回退时主栏整棵重建、加宽层晚一两帧才补上，宽度一变正文重折行、cell 高度全变 ——
 * 滚动值没动，但那条推文已经不在那个高度上了。所以锚的不是 scrollY，而是
 * 「视口顶部第一条推文的 status id + 它的 rect.top」，按路径分桶（详情页与时间线各记各的）。
 * 恢复时把那条推文摆回原来的 top：只在有限时间内、漂移 > 8px 才纠，用户一动就收手。
 */

const KEY = 'xm:anchors';
/** 最多记 8 条路径，够覆盖「时间线 → 详情 → 返回」这种来回了 */
const MAX_PATHS = 8;
/** 漂移小于这个值不动：1–2px 是取整噪声，纠了反而抖 */
const DRIFT = 8;
const STEP_MS = 130;
/** SPA 内回退：X 一般几百毫秒内就把旧位置恢复好，2.6 秒足够兜住它 */
const WINDOW_SPA = 2600;
/** 整页回退加载：要等 JS 起、接口回、虚拟列表铺开，给得更宽一些 */
const WINDOW_LOAD = 6000;

interface Rec {
  id: string;
  top: number;
  at: number;
}

let noteTimer = 0;
let loopTimer = 0;
let deadline = 0;

function readAll(): Record<string, Rec> {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) || '{}');
    return raw && typeof raw === 'object' ? (raw as Record<string, Rec>) : {};
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, Rec>): void {
  const keep = Object.keys(map)
    .sort((a, b) => (map[b]?.at || 0) - (map[a]?.at || 0))
    .slice(0, MAX_PATHS);
  const out: Record<string, Rec> = {};
  for (const k of keep) {
    const v = map[k];
    if (v && v.id) out[k] = v;
  }
  try {
    sessionStorage.setItem(KEY, JSON.stringify(out));
  } catch {
    /* 无痕模式禁 sessionStorage：放弃记忆，不影响其它功能 */
  }
}

function pathKey(): string {
  return location.pathname + location.search;
}

/**
 * 推文**自己**的 status id。
 * 不能取第一个 `/status/` 链接：引用推文里也有，按文档序排在前面 —— 会把别人的 id 当成这条的。
 */
function selfId(art: HTMLElement): string | null {
  for (const a of art.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')) {
    if (a.closest('article[data-testid="tweet"]') !== art) continue;
    const m = /\/status\/(\d+)/.exec(a.getAttribute('href') || '');
    if (m) return m[1];
  }
  return null;
}

function findById(id: string): HTMLElement | null {
  for (const a of document.querySelectorAll<HTMLAnchorElement>(`a[href*="/status/${id}"]`)) {
    const art = a.closest<HTMLElement>('article[data-testid="tweet"]');
    if (art && selfId(art) === id) return art;
  }
  return null;
}

/** 视口顶部第一条「真正露出来」的推文（DOM 序 = 视觉序，虚拟列表也成立） */
function topArticle(): { id: string; top: number } | null {
  const arts = document.querySelectorAll<HTMLElement>(
    '[data-testid="primaryColumn"] article[data-testid="tweet"]',
  );
  for (const art of arts) {
    const r = art.getBoundingClientRect();
    if (r.bottom <= 8 || r.height < 20) continue;
    const id = selfId(art);
    if (id) return { id, top: Math.round(r.top) };
  }
  return null;
}

function remember(): void {
  const t = topArticle();
  if (!t) return;
  const all = readAll();
  all[pathKey()] = { id: t.id, top: t.top, at: Date.now() };
  writeAll(all);
}

/** 滚动结束后再记（连续滚动时每 180ms 记一次就够，不需要每帧读 rect） */
function noteScroll(): void {
  if (noteTimer) return;
  noteTimer = window.setTimeout(() => {
    noteTimer = 0;
    remember();
  }, 180);
}

/** X 的滚动容器通常是 window；万一被套在内层，沿主栏往上找一个真在滚的 */
function scroller(): HTMLElement | null {
  const col = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]');
  let el = col?.parentElement ?? null;
  while (el && el !== document.body && el !== document.documentElement) {
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 8) return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * 瞬时跳动。X 给 html 设了 scroll-behavior:smooth，直接 scrollBy 会被动画接管，
 * 校正量在下一帧才走完、和我们自己的循环打架 ⇒ 先临时压成 auto，并且强制一次布局
 * （不然同一帧里的 scroll 仍按旧的计算值走）。
 */
function jump(dy: number): void {
  const html = document.documentElement;
  const prev = html.style.scrollBehavior;
  html.style.setProperty('scroll-behavior', 'auto', 'important');
  void html.offsetHeight;
  const el = scroller();
  if (el) el.scrollTop += dy;
  else window.scrollBy(0, dy);
  html.style.scrollBehavior = prev;
}

function step(rec: Rec): void {
  loopTimer = 0;
  if (performance.now() > deadline) return;
  const art = findById(rec.id);
  if (art) {
    const drift = Math.round(art.getBoundingClientRect().top - rec.top);
    if (Math.abs(drift) > DRIFT) jump(drift);
  }
  // 一直盯到截止：X 自己的恢复、我们的重排都可能在我们之后才落地，纠一次不够
  loopTimer = window.setTimeout(() => step(rec), STEP_MS);
}

/** 用户一动就放弃校正 —— 宁可位置偏，也不能和手指抢滚动 */
function stop(): void {
  deadline = 0;
}

/** 开始为当前路径恢复位置（没有记录、或已经过了有效期就什么都不做） */
export function restoreAnchor(windowMs = WINDOW_SPA): void {
  const rec = readAll()[pathKey()];
  if (!rec || !rec.id) return;
  // 超过 30 分钟的记录不再可信（内容早换了）
  if (Date.now() - (rec.at || 0) > 30 * 60 * 1000) return;
  deadline = performance.now() + windowMs;
  if (!loopTimer) step(rec);
}

export function initAnchor(): void {
  addEventListener('scroll', noteScroll, { passive: true, capture: true });
  addEventListener('pointerdown', stop, { passive: true, capture: true });
  addEventListener('wheel', stop, { passive: true, capture: true });
  addEventListener('touchstart', stop, { passive: true, capture: true });
  addEventListener('keydown', stop, true);
  // 离开页面时补记一次：pagehide 比最后一次 scroll 可靠
  addEventListener('pagehide', remember);
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') remember();
  });

  // SPA 内回退 / 前进
  addEventListener('popstate', () => restoreAnchor(WINDOW_SPA));
  // 从 bfcache 原样恢复：DOM 都还在，位置一般没丢，但 X 可能已重排，仍验一次
  addEventListener('pageshow', (e) => {
    if ((e as PageTransitionEvent).persisted) restoreAnchor(WINDOW_SPA);
  });

  // 整页回退加载：content script 是全新注入的，上面那些事件一个都等不到，
  // 只能看导航类型。document_start 时这条记录一般已可读，读不到就等 load。
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav?.type === 'back_forward') restoreAnchor(WINDOW_LOAD);
    else if (!nav) addEventListener('load', () => restoreAnchor(WINDOW_LOAD), { once: true });
  } catch {
    /* 拿不到导航类型就当普通打开 */
  }
}
