/**
 * 推文流的视觉处理：抹掉分割线与圆角、把时间线底板戳透、重排虚拟列表的 translateY。
 * 涉及结构的判断一律在 JS 里做（X 的嵌套深度每个版本都在变），CSS 只认自有 class。
 */

const QUOTE_CLS = 'xm-quote';
const PHOTO_CLS = 'xm-photo';
const MEDIA_CLS = 'xm-media';
const FLAT_CELL_CLS = 'xm-cell-flat';
const JOINER_CLS = 'xm-joiner';
const NOISE_CLS = 'xm-noise';

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
 * 线程竖线：X 用 2px 宽的 div 画，没有 testid、class 全是构建哈希。
 * ⛔ 别拿高度当门槛 —— 推文顶部那段只有一行高（约 12–20px），压 16px 会整片漏判。
 * 可靠特征是「水平中线压在头像中轴上」：线永远是头像列居中那根。
 * 分别记上段 / 下段：上一段下沿与下一段上沿都伸到各自推文边界，才算连在同一条链上。
 * 顺便记下线的横坐标 / 宽度 / 颜色，组内补线要用（见 THREAD_LINE_CSS）。
 */
function threadLink(article: HTMLElement, cell: HTMLElement): ThreadLink {
  const link: ThreadLink = { up: false, down: false, x: 0, w: 2, color: '' };
  const ar = article.getBoundingClientRect();
  if (ar.height < 24) return link;
  const cr = cell.getBoundingClientRect();
  const av = article.querySelector<HTMLElement>('[data-testid="Tweet-User-Avatar"]');
  const avr = av?.getBoundingClientRect();
  const axis = avr && avr.width ? avr.left + avr.width / 2 : null;
  const EDGE = 26; // 线端离推文边界的容差；必须大于 --xm-card-pad（19px），否则线被 padding 顶开就认不出
  for (const el of article.querySelectorAll<HTMLElement>('div')) {
    const r = el.getBoundingClientRect();
    if (r.width < 0.5 || r.width > 5 || r.height < 2) continue;
    if (axis === null) {
      if (r.left - ar.left > 72) continue;
    } else if (Math.abs(r.left + r.width / 2 - axis) > 8) continue;
    const cs = getComputedStyle(el);
    // X 两种画法都见过：实心 div，或 1–2px 的左描边盒子
    const solid = alphaOf(cs.backgroundColor) >= 0.15;
    const border = parseFloat(cs.borderLeftWidth) >= 1 && alphaOf(cs.borderLeftColor) >= 0.15;
    if (!solid && !border) continue;
    if (!link.color) {
      link.x = Math.round(r.left - cr.left);
      link.w = Math.max(1, Math.round(r.width));
      link.color = solid ? cs.backgroundColor : cs.borderLeftColor;
    }
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

/**
 * 「显示回复 / 显示更多帖子」这类纯按钮 cell —— 里面没有 article，
 * 单独成卡就是一行裸露的文字，应该并进上面那条推文。
 */
const JOINER_RE = /显示(更多)?回复|显示更多帖子|Show (more )?replies|Show more posts|返信を表示|답글 표시/i;

function isJoiner(cell: HTMLElement): boolean {
  if (cell.querySelector('article')) return false;
  return JOINER_RE.test((cell.textContent || '').trim());
}

/**
 * 信息流里没有正文的杂物格子 —— 跟推广一起收掉：
 *  · 垃圾折叠入口（「显示可能的垃圾信息」）
 *  · 推荐关注模块（标题格 + 每条 UserCell）
 * 它们既不是推文，也没有 out-of-card 的排版，留着就是一条裸露文字或被裁半行。
 */
const SPAM_RE =
  /显示可能的垃圾信息|可能包含垃圾信息|显示更多可能的|Show (more )?probable spam|probable spam|Show spam|スパムの可能性/i;
/** 推荐关注模块的标题格。X 把标题单独放一格，后面每条推荐各占一格。 */
const NOISE_RE =
  /who to follow|推荐关注|关注推荐|你可能想关注|可能认识的人|follow 推荐|フォローする人/i;

/** 杂物块扫描的限频时间戳 */
let lastNoiseScan = -1e9;

/**
 * 判定单个格子是不是该整条收起。有推文的正文字段一律放行 ——
 * 有人在正文里讨论「垃圾信息」「who to follow」不算。
 */
function isNoise(cell: HTMLElement): boolean {
  if (cell.querySelector('article[data-testid="tweet"]')) return false;
  if (cell.querySelector('[data-testid="UserCell"]')) return true;
  const txt = (cell.textContent || '').trim();
  if (!txt) return false;
  if (SPAM_RE.test(txt)) return true;
  // 标题很短，正文不会被误伤；不做 ^$ 锚定是因为标题格里可能带「显示更多」之类
  return txt.length <= 40 && NOISE_RE.test(txt);
}

/**
 * 藏掉杂物格子。只在开启「隐藏推广」时生效，跟广告同一个开关。
 * 作用域限主栏 —— 右栏那个「Who to follow」模块是常驻组件，不动它。
 */
export function markNoise(): void {
  const html = document.documentElement;
  const now = performance.now();
  if (now - lastNoiseScan < 600) return;
  lastNoiseScan = now;
  const col = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]');
  if (!col) return;
  // 开关关掉时要能撤回：class 是 JS 打的，纯 CSS 收不回去
  if (!html.classList.contains('xm-noads')) {
    const marked = col.querySelectorAll<HTMLElement>('.' + NOISE_CLS);
    if (!marked.length) return;
    marked.forEach((el) => el.classList.remove(NOISE_CLS));
    html.dataset.xmNoise = '0';
    if (html.classList.contains('xm-card')) requestAnimationFrame(() => reflowCards());
    return;
  }
  let added = 0;
  col.querySelectorAll<HTMLElement>('[data-testid="cellInnerDiv"]').forEach((cell) => {
    if (cell.classList.contains(NOISE_CLS)) return;
    if (!isNoise(cell)) return;
    cell.classList.add(NOISE_CLS);
    added++;
  });
  html.dataset.xmNoise = String(col.querySelectorAll('.' + NOISE_CLS).length);
  // 藏掉后这一格高度归零，下面的 translateY 得重排，否则原地留一条空带
  if (added && html.classList.contains('xm-card')) requestAnimationFrame(() => reflowCards());
}

/** 线程扫描的限频时间戳（applyFlat 会被悬停、心跳反复调用） */
let lastThreadScan = -1e9;

interface ThreadLink {
  up: boolean;
  down: boolean;
  /** 线左缘相对 cell 的偏移、宽度、颜色（组内补线用） */
  x: number;
  w: number;
  color: string;
}

/** 同值不写，避免每轮心跳都让样式失效 */
function setVar(el: HTMLElement, name: string, value: string): void {
  if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
}

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
  const links = cells.map((c): ThreadLink | null => {
    const art = topTweetOf(c);
    return art ? threadLink(art, c) : null;
  });
  // 按钮块一律并进上一条；其余靠竖线接不接得上
  const join = cells.map((c, i) => {
    if (i === 0) return false;
    if (isJoiner(c)) return true;
    return Boolean(links[i - 1]?.down && links[i]?.up);
  });

  const want = new Map<HTMLElement, string>();
  const geo = new Map<HTMLElement, ThreadLink>();
  let groups = 0;
  for (let i = 0; i < cells.length; i++) {
    let j = i;
    while (j + 1 < cells.length && join[j + 1]) j++;
    if (j === i) continue;
    want.set(cells[i], THREAD_TOP);
    for (let k = i + 1; k < j; k++) want.set(cells[k], THREAD_MID);
    want.set(cells[j], THREAD_END);
    // 组内推文的 padding 把 X 自己画的线顶开了，用同一个横坐标补一条贯穿线
    const found = links.slice(i, j + 1).find((l): l is ThreadLink => Boolean(l && l.color));
    if (found) for (let k = i; k <= j; k++) geo.set(cells[k], found);
    groups++;
    i = j;
  }

  for (const cell of cells) {
    const next = want.get(cell) ?? '';
    for (const cls of THREAD_CLS) cell.classList.toggle(cls, cls === next);
    // 按钮块没有 article，画线会盖在「显示回复」上
    const g = topTweetOf(cell) ? geo.get(cell) : undefined;
    if (g) {
      setVar(cell, '--xm-lx', `${g.x}px`);
      setVar(cell, '--xm-lw', `${g.w}px`);
      setVar(cell, '--xm-lc', g.color);
    } else {
      cell.style.removeProperty('--xm-lx');
      cell.style.removeProperty('--xm-lw');
      cell.style.removeProperty('--xm-lc');
    }
    // 按钮块没有 article，走不到 applyFlat 的分割线清理，这里单独抹
    if (isJoiner(cell)) {
      cell.classList.add(FLAT_CELL_CLS, JOINER_CLS);
      wipeFlatLine(cell);
    }
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
    for (const cls of [QUOTE_CLS, PHOTO_CLS, MEDIA_CLS, FLAT_CELL_CLS, JOINER_CLS, NOISE_CLS, ...THREAD_CLS]) {
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
  // 0) 先把「可能的垃圾信息」入口藏掉，后面的分组 / 重排就不用管它
  markNoise();
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
