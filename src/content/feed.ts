/**
 * 推文流的视觉处理：抹掉分割线与圆角、把时间线底板戳透、重排虚拟列表的 translateY。
 * 涉及结构的判断一律在 JS 里做（X 的嵌套深度每个版本都在变），CSS 只认自有 class。
 */

const QUOTE_CLS = 'xm-quote';
const PHOTO_CLS = 'xm-photo';
const MEDIA_CLS = 'xm-media';
const FLAT_CELL_CLS = 'xm-cell-flat';

/** 回复链：同一条链上的 cell 只在首尾裁切，中间不裁，竖线才连得住 */
const THREAD_TOP = 'xm-thread-top';
const THREAD_MID = 'xm-thread-mid';
const THREAD_END = 'xm-thread-end';
const THREAD_CLS = [THREAD_TOP, THREAD_MID, THREAD_END];

interface PrevBg { color: string; image: string }

/** 抹掉过的 border-bottom 原值 */
const flatLines = new Map<HTMLElement, string>();
/** 抹透过的底板原值 */
const cardWrappers = new Map<HTMLElement, PrevBg>();

function wipeFlatLine(el: HTMLElement): void {
  if (!flatLines.has(el)) flatLines.set(el, el.style.getPropertyValue('border-bottom'));
  if (el.style.getPropertyValue('border-bottom') !== '0 solid transparent') {
    el.style.setProperty('border-bottom', '0 solid transparent', 'important');
  }
}

function wipeCardBg(el: HTMLElement): void {
  if (!cardWrappers.has(el)) {
    cardWrappers.set(el, {
      color: el.style.getPropertyValue('background-color'),
      image: el.style.getPropertyValue('background-image'),
    });
  }
  if (el.style.getPropertyValue('background-color') !== 'transparent') {
    el.style.setProperty('background-color', 'transparent', 'important');
  }
  const img = el.style.getPropertyValue('background-image');
  if (img && img !== 'none') el.style.setProperty('background-image', 'none', 'important');
}

function radiusOf(cs: CSSStyleDeclaration): number {
  return Math.max(parseFloat(cs.borderTopLeftRadius) || 0, parseFloat(cs.borderBottomRightRadius) || 0);
}

/** 推文所在 cell：优先用 X 的 testid，认不到就往上找「接近主栏宽度」的那层 */
function cellOf(article: HTMLElement, col: HTMLElement, cw: number): HTMLElement | null {
  const byTestId = article.closest<HTMLElement>('[data-testid="cellInnerDiv"]');
  if (byTestId) return byTestId;
  let el: HTMLElement | null = article.parentElement;
  for (let i = 0; el && el !== col && i < 6; i++, el = el.parentElement) {
    const r = el.getBoundingClientRect();
    if (cw > 0 && r.width >= cw * 0.9 && r.height >= 40) return el;
  }
  return null;
}

/**
 * 线程竖线：X 用 1–3px 宽的 div 画，没有 testid、class 是构建哈希，
 * 只能按几何认 —— 窄、够高、有底色（或左描边）、贴着推文左侧。
 * 分别记「上段」「下段」：只有上一段下沿与下一段上沿都伸到各自推文边界，
 * 这两条才算连在同一条回复链上（链尾只有上段，不会把后面无关的推文吸进来）。
 */
function threadLink(article: HTMLElement): { up: boolean; down: boolean } {
  const link = { up: false, down: false };
  const ar = article.getBoundingClientRect();
  if (ar.height < 24) return link;
  const EDGE = 26; // 线端离推文边界的容差；必须大于 --xm-card-pad（19px），否则线被 padding 顶开就认不出
  for (const el of article.querySelectorAll<HTMLElement>('div,span')) {
    const r = el.getBoundingClientRect();
    if (r.width < 0.5 || r.width > 4 || r.height < 16) continue;
    if (r.left - ar.left > 72) continue;
    const cs = getComputedStyle(el);
    // X 两种画法都见过：实心 div，或 1–2px 的左描边盒子
    const painted =
      alphaOf(cs.backgroundColor) >= 0.15 ||
      (parseFloat(cs.borderLeftWidth) >= 1 && alphaOf(cs.borderLeftColor) >= 0.15);
    if (!painted) continue;
    if (r.top - ar.top < EDGE) link.up = true;
    if (ar.bottom - r.bottom < EDGE) link.down = true;
    if (link.up && link.down) break;
  }
  return link;
}

/** rgba()/rgb() 字符串的 alpha，认不出按 0 处理 */
function alphaOf(color: string): number {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(color);
  if (!m) return 0;
  return m[4] === undefined ? 1 : +m[4];
}

/** 每条 cell 的第一层推文；引用推文里的 article 不算一条独立推文 */
function topTweetOf(cell: HTMLElement): HTMLElement | null {
  return cell.querySelector<HTMLElement>('article[data-testid="tweet"]');
}

/** 线程扫描的限频时间戳（applyFlat 会被悬停、心跳反复调用） */
let lastThreadScan = -1e9;

/**
 * 给回复链打标记：相邻两条的线接得上就并进同一组。
 * 组内 cell 不裁上下，背景连成一块，竖线不再被切出线头。
 */
export function markThreads(): void {
  const col = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]');
  if (!col) return;
  // 裁切只在卡片模式下存在，没开卡片就不用分组
  if (!document.documentElement.classList.contains('xm-card')) return;
  // 逐条量几何是整轮里最贵的一段，鼠标悬停会反复触发 applyFlat，这里限频
  const now = performance.now();
  if (now - lastThreadScan < 800) return;
  lastThreadScan = now;
  // 高度 0 的是被隐藏的推广 / 折叠项：不占位，也不该把回复链断开
  const cells = Array.from(col.querySelectorAll<HTMLElement>('[data-testid="cellInnerDiv"]'))
    .filter((c) => c.offsetHeight > 0);
  const links = cells.map((c) => {
    const art = topTweetOf(c);
    return art ? threadLink(art) : { up: false, down: false };
  });

  const want = new Map<HTMLElement, string>();
  let groups = 0;
  for (let i = 0; i < cells.length; i++) {
    let j = i;
    while (j + 1 < cells.length && links[j].down && links[j + 1].up) j++;
    if (j === i) continue;
    want.set(cells[i], THREAD_TOP);
    for (let k = i + 1; k < j; k++) want.set(cells[k], THREAD_MID);
    want.set(cells[j], THREAD_END);
    groups++;
    i = j;
  }

  for (const cell of cells) {
    const next = want.get(cell) ?? '';
    for (const cls of THREAD_CLS) cell.classList.toggle(cls, cls === next);
  }
  document.documentElement.dataset.xmThreads = String(groups);
}

/**
 * 抹掉 X 画在主栏与推文之间的底板。
 * 从 cell 的父层开始擦、不擦 cell 本身 —— 卡片底色画在 cell 上，擦掉就没有卡片了。
 * 遇到 sticky / fixed 停手，免得把吸顶栏自己的底板也擦掉。
 */
export function clearCardWrappers(on: boolean): void {
  if (!on) {
    for (const [el, prev] of cardWrappers) {
      if (!el.isConnected) continue;
      if (prev.color) el.style.setProperty('background-color', prev.color);
      else el.style.removeProperty('background-color');
      if (prev.image) el.style.setProperty('background-image', prev.image);
      else el.style.removeProperty('background-image');
    }
    cardWrappers.clear();
    return;
  }
  const col = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]');
  if (!col) return;

  col.querySelectorAll<HTMLElement>('[data-testid="cellInnerDiv"]').forEach((cell) => {
    for (let el: HTMLElement | null = cell.parentElement; el; el = el.parentElement) {
      if (el === col) {
        wipeCardBg(el);
        break;
      }
      // 已擦过就继续往上，不 break —— X 可能在这中间新插一层
      if (cardWrappers.has(el) && el.style.getPropertyValue('background-color') === 'transparent') continue;
      const pos = getComputedStyle(el).position;
      if (pos === 'sticky' || pos === 'fixed') break;
      wipeCardBg(el);
    }
  });

  for (let el = col.parentElement; el && el !== document.documentElement; el = el.parentElement) {
    const pos = getComputedStyle(el).position;
    if (pos === 'sticky' || pos === 'fixed') break;
    wipeCardBg(el);
  }
}

/**
 * 去线条与直角化。
 * 标记是幂等的（只补不摘）：摘了再补之间只要落下一帧绘制，X 原生的圆角就会闪出来，
 * 表现成鼠标一动圆角来回切。只有关闭时才摘。
 */
export function applyFlat(on: boolean): void {
  const html = document.documentElement;
  html.classList.toggle('xm-flat', on);
  if (!on) {
    for (const cls of [QUOTE_CLS, PHOTO_CLS, MEDIA_CLS, FLAT_CELL_CLS, ...THREAD_CLS]) {
      document.querySelectorAll<HTMLElement>('.' + cls).forEach((el) => el.classList.remove(cls));
    }
    for (const [el, prev] of flatLines) {
      if (!el.isConnected) continue;
      if (prev) el.style.setProperty('border-bottom', prev);
      else el.style.removeProperty('border-bottom');
    }
    flatLines.clear();
    return;
  }
  const col = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]');
  if (!col) return;

  const cw = col.getBoundingClientRect().width || 0;
  // 只取最外层推文：引用推文里还有一层 article，不是独立的一条
  const arts = [...col.querySelectorAll<HTMLElement>('article')].filter((a) => !a.parentElement?.closest('article'));

  // 1) 分割线：从 cell 一路清到主栏
  arts.forEach((a) => {
    const cell = cellOf(a, col, cw);
    if (!cell) return;
    cell.classList.add(FLAT_CELL_CLS);
    for (let el: HTMLElement | null = cell; el && el !== col; el = el.parentElement) wipeFlatLine(el);
  });

  // 2) 引用卡片：从嵌套 article 往上，途经的每一层都标记（结构式，不问「此刻有没有圆角」）
  col.querySelectorAll<HTMLElement>('article article, [data-testid="tweet"] [data-testid="tweet"]').forEach((node) => {
    let el: HTMLElement | null = node.parentElement;
    for (let i = 0; el && el !== col && i < 8; i++, el = el.parentElement) {
      if (el.tagName === 'ARTICLE') break;
      if (!el.classList.contains(QUOTE_CLS)) el.classList.add(QUOTE_CLS);
    }
  });
  // 2b) 没有嵌套 article 的引用结构：用「含 User-Name + 圆角 + 宽度 ≥150px」认定卡片容器。
  //     半径上限 100 挡头像（9999px），宽度下限挡小圆标。
  col.querySelectorAll<HTMLElement>('[data-testid="tweetText"]').forEach((node) => {
    let el: HTMLElement | null = node.parentElement;
    for (let i = 0; el && el !== col && i < 10; i++, el = el.parentElement) {
      if (el.tagName === 'ARTICLE') break;
      if (el.classList.contains(QUOTE_CLS)) continue;
      const radius = radiusOf(getComputedStyle(el));
      if (radius <= 0 || radius > 100) continue;
      if (!el.querySelector('[data-testid="User-Name"]')) continue;
      if (el.getBoundingClientRect().width < 150) continue;
      el.classList.add(QUOTE_CLS);
    }
  });

  // 3) 内嵌图片：圆角画在 <a> 与外层 div 上，从 tweetPhoto 往上标记
  col.querySelectorAll<HTMLElement>('[data-testid="tweetPhoto"]').forEach((node) => {
    let el: HTMLElement | null = node;
    for (let i = 0; el && el !== col && i < 12; i++, el = el.parentElement) {
      if (el.tagName === 'ARTICLE' || el.classList.contains(QUOTE_CLS)) break;
      if (!el.classList.contains(PHOTO_CLS)) el.classList.add(PHOTO_CLS);
    }
  });

  // 4) 卡片封面 / 视频封面：img、video、内联背景图三种写法都要覆盖。
  //    过滤头像与圆标：种子宽度 <100px 跳过；层是正方形且半径 ≥ 半边长（全圆）跳过。
  const seeds = col.querySelectorAll<HTMLElement>(
    'article img, article video, article [style*="background-image"],' +
      ' article [data-testid^="card."], article [data-testid^="video"], article [data-testid="tweetPhoto"]',
  );
  seeds.forEach((seed) => {
    const selfSize = seed.getBoundingClientRect();
    const painted = seed.tagName === 'IMG' || seed.tagName === 'VIDEO'
      || (seed.getAttribute('style') || '').includes('background-image');
    if (painted && selfSize.width < 100) return;
    let el: HTMLElement | null = seed;
    for (let i = 0; el && el !== col && i < 12; i++, el = el.parentElement) {
      if (el.tagName === 'ARTICLE' || el.classList.contains(QUOTE_CLS)) break;
      if (el.classList.contains(MEDIA_CLS)) continue;
      const radius = radiusOf(getComputedStyle(el));
      if (radius > 100) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && Math.abs(r.width - r.height) <= 4 && radius >= Math.min(r.width, r.height) / 2 - 1) continue;
      el.classList.add(MEDIA_CLS);
    }
  });

  // 诊断：写总数而不是本轮增量（标记幂等，增量恒为 0）
  html.dataset.xmFlatCells = String(arts.length);
  html.dataset.xmFlatQuotes = String(col.querySelectorAll('.' + QUOTE_CLS).length);
  html.dataset.xmFlatPhotos = String(col.querySelectorAll('.' + PHOTO_CLS).length);
  html.dataset.xmFlatMedia = String(col.querySelectorAll('.' + MEDIA_CLS).length);

  markThreads();
}

const TY_RE = /translateY\((-?[\d.]+)px\)/;

/**
 * 重排虚拟列表：改成卡片后 cell 变高，而 X 把每条的 translateY 写死在行内，不会重算。
 * 按 DOM 顺序累加 offsetHeight 逐条重写，第一条的原始 Y 作基准，保证整条时间线不整体位移。
 */
export function reflowCards(): void {
  const col = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]');
  if (!col) return;
  const cells = Array.from(col.querySelectorAll<HTMLElement>('[data-testid="cellInnerDiv"]'));
  if (cells.length < 2) return;

  const m0 = TY_RE.exec(cells[0].style.transform || '');
  const base = m0 ? parseFloat(m0[1]) : 0;
  let acc = base;
  let moved = 0;
  for (const c of cells) {
    const h = c.offsetHeight;
    if (h === 0) continue; // 广告 / 折叠项：不占位也不动它
    const cur = TY_RE.exec(c.style.transform || '');
    const y = cur ? parseFloat(cur[1]) : null;
    if (y === null || Math.abs(y - acc) > 0.5) {
      c.style.setProperty('transform', `translateY(${acc.toFixed(3)}px)`, 'important');
      moved++;
    }
    acc += h;
  }

  // 容器高度：X 靠它算可滚动范围
  const wrap = cells[0].parentElement;
  if (wrap && wrap !== col && base === 0) {
    const need = Math.round(acc);
    const cur = parseFloat(wrap.style.minHeight) || 0;
    if (Math.abs(cur - need) > 0.5) wrap.style.setProperty('min-height', `${need}px`, 'important');
  }

  document.documentElement.dataset.xmReflow = `${cells.length}/${moved}`;
}
