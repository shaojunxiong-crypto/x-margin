/**
 * 推文流的视觉处理：抹掉分割线与圆角、把时间线底板戳透、重排虚拟列表的 translateY。
 * 涉及结构的判断一律在 JS 里做（X 的嵌套深度每个版本都在变），CSS 只认自有 class。
 */

import { avatarOf, cellOf as anchorCellOf, cells as feedCells, column, tweets as feedTweets } from './sel';

const FLAT_CELL_CLS = 'xm-cell-flat';
const JOINER_CLS = 'xm-joiner';

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

/**
 * ⛔ 这里原本有 seenArt / seenText / seenPhoto / seenSeed 四个 WeakSet，按「子孙节点」做键、
 * 记为「这条已经处理过」。它和「标记打在祖先上」这一事实天然冲突：
 * X 换掉图片 / 引用卡的外层包装时，子孙节点（tweetPhoto、tweetText）原封不动，
 * 缓存照样短路，于是新包装上的圆角再也补不回来 —— 这就是「圆角又回来了」的根因。
 * 而 pointerover 补扫走的是同一套缓存，所以鼠标动多少次都没用。
 *
 * 现在一律不缓存、每轮重走：已标记的层用 classList.contains 懒跳过（不读样式、不写属性），
 * 只有未标记的层才做一次 getComputedStyle 判圆角。幂等且不会漏。
 */
/** article → 它所在的 cell，省掉每轮 closest + 量宽度 */
const cellByArt = new WeakMap<HTMLElement, HTMLElement>();

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

/** 推文所在 cell：优先走适配层，认不到就往上找「接近主栏宽度」的那层 */
function cellOf(article: HTMLElement, col: HTMLElement, cw: number): HTMLElement | null {
  const byAnchor = anchorCellOf(article);
  if (byAnchor) return byAnchor;
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
  const av = avatarOf(article);
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
  return feedTweets(cell)[0] ?? null;
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
 * 详情页里的「显示回复」行：与主推文同属一个 cell（时间线里它是独立按钮块）。
 * 它贴在 cell 最底部，卡片模式那 15px 裁切正好切在字上，只有半行可见。
 * ⛔ 不能并进 isJoiner：那个判据同时决定回复链的分组边界，把含推文的 cell 认成
 *    按钮块会让它被并进上一条，拆错组。这里只用来打 xm-joiner 类补内边距。
 */
function isTailJoiner(cell: HTMLElement): boolean {
  const art = cell.querySelector('article');
  if (!art) return false;
  // 先过一遍整格文字，绝大多数推文在这一步就返回了
  if (!JOINER_RE.test(cell.textContent || '')) return false;
  // 取最后一个匹配的叶子节点：正文里提到「显示回复」不算，必须落在 article 之后
  const leaf = [...cell.querySelectorAll('button,div,span')]
    .filter((e) => e.childElementCount === 0 && JOINER_RE.test((e.textContent || '').trim()))
    .pop();
  if (!leaf || art.contains(leaf)) return false;
  return (art.compareDocumentPosition(leaf) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/**
 * 「发现更多 / 源自于整个 X」：推文详情页回复列表之后那颗相关推文流的分区标。
 * 它既不是推文也不匹配 JOINER_RE，卡片模式按 15px 裁切却不补内边距 ——
 * 原来那两行字被削掉字头字脚，按内层结构改单行在真机上更差（层级/内边距与模拟不一致）。
 * 现在样式表不碰内层结构：整块隐藏、cell 锁 66px、伪元素画一行居中省略号。
 * ⛔ 属性名 data-xm-more-sec 就是样式表唯一的选择器，别在 <html> 上再用同名 dataset —
 *   那样会把整页一起命中（v0.1.65 的 data-xm-page-head 就是这么翻车的）。
 * ⛔ cell 高度被锁死后必须补一次 reflowCards：真机自然高度若不是 66，后面几条会错位。
 */
const MORE_SEC_ATTR = 'xmMoreSec';
const MORE_SEC_RE = /^(发现更多|Discover more|もっと見る|더 보기|Show more)/i;

function isMoreSection(cell: HTMLElement): boolean {
  // 有推文正文的格子一律放行：有人在推文里写「发现更多」不算
  if (cell.querySelector('article')) return false;
  const h2 = cell.querySelector('h2');
  if (!h2) return false;
  const title = (h2.textContent || '').trim();
  if (!title || title.length > 20 || !MORE_SEC_RE.test(title)) return false;
  // 标题 + 副标题，整格文字很短；不做全等是因为副标题会随语种变
  return (cell.textContent || '').trim().length <= 40;
}

/** 扫描限频：applyFlat 被悬停、心跳反复调用，每轮遍历全部 cell 没必要 */
let lastMoreScan = -1e9;

/** 「显示可能的垃圾信息 / Show probable spam」：X 在回复末尾插的折叠提示，整格去掉 */
const SPAM_NOTE_ATTR = 'xmSpamNote';
const SPAM_NOTE_RE = /显示可能的垃圾信息|Show probable spam/i;

function isSpamNote(cell: HTMLElement): boolean {
  if (cell.querySelector('article')) return false;
  return SPAM_NOTE_RE.test((cell.textContent || '').trim());
}

let lastSpamScan = -1e9;

/**
 * 抹掉「显示可能的垃圾信息」这一格。
 * ⛔ 必须每轮重判、不成立就摘：X 的虚拟列表会复用 li 节点，属性一旦跟着被复用的节点
 *    跑到一条正常推文上，那条推文就整格消失（比 markMoreSection 更狠，它至少还留个 `···`）。
 * ⛔ 用 dataset 而不是 class：applyFlat 的关卡分支按 class 批量摘，会把这个标记一起清掉。
 * ⛔ 高度归零后要补 reflowCards，否则后面每条的 translateY 都少算这 48px。
 */
export function markSpamNote(): void {
  const col = column();
  if (!col) return;
  const now = performance.now();
  if (now - lastSpamScan < 600) return;
  lastSpamScan = now;
  // 只在卡片模式生效：非卡片模式不做 reflowCards，藏掉的高度没人补，会留一条空洞
  const card = document.documentElement.classList.contains('xm-card');
  let touched = 0;
  feedCells(col).forEach((cell) => {
    const marked = cell.dataset[SPAM_NOTE_ATTR] === '1';
    const hit = card && isSpamNote(cell);
    if (hit === marked) return;
    if (hit) cell.dataset[SPAM_NOTE_ATTR] = '1';
    else delete cell.dataset[SPAM_NOTE_ATTR];
    touched++;
  });
  if (touched) requestAnimationFrame(() => reflowCards());
}

/**
 * 标记「发现更多」小节条。
 * ⛔ 每轮重判、不成立就摘。这条规则会把格内所有子元素
 * display:none 并锁死高度，一旦标记跟着被复用的节点跑到一条正常推文上，
 * 那条推文就只剩一个 `···` 小牌（看起来像被换掉了）。
 * ⛔ 撤销同样要补 reflowCards：锁定的 74px 恢复成自然高度，后面的 translateY 全错。
 */
export function markMoreSection(): void {
  const col = column();
  if (!col) return;
  const now = performance.now();
  if (now - lastMoreScan < 600) return;
  lastMoreScan = now;
  let touched = 0;
  // 样式只在卡片模式下生效；关掉卡片就一律摘，别把属性留给下次开卡
  const card = document.documentElement.classList.contains('xm-card');
  feedCells(col).forEach((cell) => {
    const marked = cell.dataset[MORE_SEC_ATTR] === '1';
    const hit = card && isMoreSection(cell);
    if (hit === marked) return;
    if (hit) cell.dataset[MORE_SEC_ATTR] = '1';
    else delete cell.dataset[MORE_SEC_ATTR];
    touched++;
  });
  // 样式把这一格锁成 74px，与自然高度可能差几像素；高度一改，后面几条的 translateY 就错了
  if (touched && card) {
    requestAnimationFrame(() => reflowCards());
  }
}

/** 线程扫描的限频时间戳（applyFlat 会被悬停、心跳反复调用） */
let lastThreadScan = -1e9;
/** 上一次「已采纳」的拓扑签名：cell 数 + 总高度。没变就说明分组不会变，不必重量。 */
let threadSig = '';
/** 正在等它稳住的候选签名，以及它第一次出现的时刻 */
let pendingSig = '';
let pendingAt = 0;
/** 稳定性重试定时器 */
let pendingTimer = 0;

/**
 * 滚动冻结。滚动时 X 的虚拟列表一直在增删 cell，此时算分组既贵又不准：
 * 窗口顶部会把回复链截断，链首被判成链尾，thread class 一翻，article 高度差 15px，
 * 整列 translateY 跟着重排 —— 表现就是「闪一下、错一下、又好了」。
 * 冻结期间只保留 reflowCards（不跑就会叠住），全量扫描让到停滚之后。
 */
let frozen = false;

export function setFeedFrozen(v: boolean): void {
  frozen = v;
}

/**
 * 分组是否已落定。回退幕布用：
 * 260ms 稳定闸门没走完就揭幕，会正好撞上「分组一改 → article 高度差 15px → 整列重排」那一下，
 * 用户看到的就是「动画结束之后页面还在重排」。
 */
export function feedSettled(): boolean {
  return pendingSig === '';
}

/** 主栏被整棵换掉时清掉签名，强制下一轮重扫 */
export function resetThreadSig(): void {
  threadSig = '';
  pendingSig = '';
  pendingAt = 0;
  lastThreadScan = -1e9;
  clearTimeout(pendingTimer);
  pendingTimer = 0;
}

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
  if (frozen) return;
  const col = column();
  if (!col) return;
  // 裁切只在卡片模式下存在，没开卡片就不用分组
  if (!document.documentElement.classList.contains('xm-card')) return;
  // 高度 0 的是被隐藏的推广 / 折叠项：不占位，也不该把回复链断开
  const cells: HTMLElement[] = [];
  let sum = 0;
  for (const c of feedCells(col)) {
    const h = c.offsetHeight;
    if (h === 0) continue;
    cells.push(c);
    sum += h;
  }
  // 拓扑签名：数量 + 总高度。滚动时 X 只改 translateY、不改高度，签名稳定
  const sig = `${cells.length}|${Math.round(sum)}`;
  if (sig === threadSig) return;
  const now = performance.now();
  // 签名必须连续 260ms 不变才采纳 —— 滚动中列表换到一半时算出来的分组是错的；
  // 同时保留 800ms 的扫描限频（鼠标悬停会反复触发 applyFlat）。
  if (sig !== pendingSig) { pendingSig = sig; pendingAt = now; }
  const wait = Math.max(260 - (now - pendingAt), 800 - (now - lastThreadScan));
  if (wait > 0) {
    // ⛔ 必须自己排重试：页面静下来之后没有任何 mutation，不会有人再调到这里
    if (!pendingTimer) {
      pendingTimer = window.setTimeout(() => { pendingTimer = 0; markThreads(); }, Math.ceil(wait) + 16);
    }
    return;
  }
  lastThreadScan = now;
  threadSig = sig;
  pendingSig = '';
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

  let changed = false;

  /**
   * 组尾那条的线不能贯穿整格：链在这里就断了，线应当止于自己的头像下沿。
   * 原来是 top:0 → bottom:0 画满 cell，于是线越过最后一条推文继续往下扎，
   * 先把回复正文的左侧切开（正文若因 X 的布局落在左侧，线正好从字上穿过），
   * 再穿过时间戳与操作栏，看起来像「竖线撕裂了文字」。
   * 高度按几何量出来（头像底部 − cell 顶部）写进 --xm-le，交给样式表。
   * ⛔ 只量一次、只在组尾量：组首/组中段的线本来就该贯穿整格，不能一起收。
   */
  const endLine = new Map<HTMLElement, number>();
  // 组首是镜像问题：线从 top:0 起画，会顶到自己头像的上方去（详情页首条 padding 更大，
  // clip 那 15px 兜不住）。把头像下沿相对 cell 顶的位置写进 --xm-ls，让线从头像底部起步。
  const startLine = new Map<HTMLElement, number>();
  // 量的时候这一格可能还没打上 thread-end 类，article 的 padding-top 还是「独立卡片」的 19，
  // 等类打上才变成 pad−gap（4）。所以按「当前 padding → 目标 padding」做换算，
  // 否则会多出一截（实测 59 vs 44），线还是会长过自己的头像。
  const rootCS = getComputedStyle(document.documentElement);
  const padVar = parseFloat(rootCS.getPropertyValue('--xm-card-pad')) || 19;
  const gapVar = parseFloat(rootCS.getPropertyValue('--xm-card-gap')) || 15;
  const targetPad = padVar - gapVar;
  for (const [cell, cls] of want) {
    if (cls !== THREAD_TOP && cls !== THREAD_END) continue;
    const av = avatarOf(cell);
    const art = topTweetOf(cell);
    if (!av || !art) continue;
    const top = cell.getBoundingClientRect().top;
    const avBottom = av.getBoundingClientRect().bottom - top;
    const padNow = parseFloat(getComputedStyle(art).paddingTop) || 0;
    // 组首的 padding-top 保持 pad（上侧被 clip 补回），组尾被压成 pad−gap
    const padTarget = cls === THREAD_TOP ? padVar : targetPad;
    const h = Math.round(avBottom - padNow + padTarget);
    if (h > 0) (cls === THREAD_TOP ? startLine : endLine).set(cell, h);
  }
  for (const cell of cells) {
    const next = want.get(cell) ?? '';
    for (const cls of THREAD_CLS) {
      const on = cls === next;
      if (cell.classList.contains(cls) !== on) { cell.classList.toggle(cls, on); changed = true; }
    }
    // 按钮块没有 article，画线会盖在「显示回复」上
    const g = topTweetOf(cell) ? geo.get(cell) : undefined;
    if (g) {
      setVar(cell, '--xm-lx', `${g.x}px`);
      setVar(cell, '--xm-lw', `${g.w}px`);
      setVar(cell, '--xm-lc', g.color);
      const le = endLine.get(cell);
      if (le) setVar(cell, '--xm-le', `${le}px`);
      else cell.style.removeProperty('--xm-le');
      const ls = startLine.get(cell);
      if (ls) setVar(cell, '--xm-ls', `${ls}px`);
      else cell.style.removeProperty('--xm-ls');
    } else {
      cell.style.removeProperty('--xm-lx');
      cell.style.removeProperty('--xm-lw');
      cell.style.removeProperty('--xm-lc');
      cell.style.removeProperty('--xm-le');
      cell.style.removeProperty('--xm-ls');
    }
    // 按钮块没有 article，走不到 applyFlat 的分割线清理，这里单独抹
    if (isJoiner(cell) || isTailJoiner(cell)) {
      if (!cell.classList.contains(JOINER_CLS)) {
        cell.classList.add(FLAT_CELL_CLS, JOINER_CLS);
        // 补了内边距，cell 高度变了：交给循环后的 reflowCards 统一重排
        changed = true;
      }
      wipeFlatLine(cell);
    }
  }
  document.documentElement.dataset.xmThreads = String(groups);
  // class 一改，article 高度就变了 ±15px（组首/组尾的 padding 差异）。
  // ⛔ 必须在本任务内立刻重排：交给下一帧的 tick，中间那一帧就是「已改高度、未改 translateY」，
  // 画面上会看到推文叠住再弹开 —— 也就是「偶尔排版错乱但最终会好」。
  if (changed) reflowCards();
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
  const col = column();
  if (!col) return;

  feedCells(col).forEach((cell) => {
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
    for (const cls of [FLAT_CELL_CLS, JOINER_CLS, ...THREAD_CLS]) {
      document.querySelectorAll<HTMLElement>('.' + cls).forEach((el) => el.classList.remove(cls));
    }
    // 「发现更多」小节条是 dataset 属性，上面那个 class 循环管不到它 —— 原先
    // 关掉卡片模式后它仍锁着 74px、内容继续隐身，只有整页刷新才恢复。
    document.querySelectorAll<HTMLElement>('[data-xm-more-sec]').forEach((el) => el.removeAttribute('data-xm-more-sec'));
    // 「显示可能的垃圾信息」的隐藏标记同理，关掉卡片就还回来
    document.querySelectorAll<HTMLElement>('[data-xm-spam-note]').forEach((el) => el.removeAttribute('data-xm-spam-note'));
    for (const [el, prev] of flatLines) {
      if (!el.isConnected) continue;
      if (prev) el.style.setProperty('border-bottom', prev);
      else el.style.removeProperty('border-bottom');
    }
    flatLines.clear();
    resetThreadSig();
    resetReflowBase();
    return;
  }
  const col = column();
  if (!col) return;

  const cw = col.getBoundingClientRect().width || 0;
  // 0) 相关推文流的分区条：只打属性，高度不变，不需要重排
  markMoreSection();
  // 0.5) 「显示可能的垃圾信息」：整格隐藏，高度归零后才需要重排（函数内部已处理）
  markSpamNote();
  // 只取最外层推文：引用推文里还有一层 article，不是独立的一条
  const arts = feedTweets(col);

  // 1) 分割线：从 cell 一路清到主栏。cell 只认一次，之后走缓存
  arts.forEach((a) => {
    let cell = cellByArt.get(a);
    if (!cell || !cell.isConnected) {
      cell = cellOf(a, col, cw) ?? undefined;
      if (!cell) return;
      cellByArt.set(a, cell);
    }
    // ⛔ classList.add 对已存在的 class 也会重写 attribute、触发 mutation：
    // 每条 cell 每轮都写一遍，滚动时就是肉眼可见的重排抖动。先判存在再写。
    if (!cell.classList.contains(FLAT_CELL_CLS)) cell.classList.add(FLAT_CELL_CLS);
    // 每轮都重走：只读内联样式、不读布局，很便宜；X 在 cell 与 article 之间新插一层时，
    // 那一层也才会被擦到（缓存版永远漏）。
    for (let el: HTMLElement | null = cell; el && el !== col; el = el.parentElement) wipeFlatLine(el);
  });

  // 2) 圆角压制已全部移到样式表（见 styles.ts 的媒体直角化一节）。
  //    ⛔ 不要再在这里给祖先打 class：X 会换掉图片 / 引用的包装层，
  //    新节点天然没有 class，只能等观察器防抖后补 —— 那 150ms 就是
  //    「鼠标移动时圆角直角来回切」的窗口期，实测 90% 的帧仍是圆角。

  // 诊断：分割线覆盖到的推文条数（covers 数够用，圆角由 CSS 保证）
  html.dataset.xmFlatCells = String(arts.length);

  markThreads();
}

const TY_RE = /translateY\((-?[\d.]+)px\)/;

/**
 * 上一轮写过 min-height 的容器。
 * ⛔ 只用于「只增不减」的判定：同一容器算出的高度变小就保留旧值，
 * 换容器（或换路由）才允许按新值写。
 */
let minCol: HTMLElement | null = null;
/** 上次看到的路由：SPA 换页面时容器常被复用，必须把高度记忆清掉 */
let minPath = '';

export function resetReflowBase(): void {
  minCol = null;
}

/**
 * 重排虚拟列表：改成卡片后 cell 变高，而 X 把每条的 translateY 写死在行内，不会重算。
 *
 * ⛔ 只做「局部修复」，不做绝对坐标重算：
 * 每轮从首条重新累加，一旦 X 把顶部 cell 摘掉（滚动时的常态），首条换成第二条，
 * 整列就会被我们按新起点平移一次 —— 每摘一格抖一下，正是滚动时的重排来源。
 * 改成「后一条 = 前一条 y + 前一条高度」，已有位置原地不动，只补掉错位的那几格。
 *
 * ⛔ 只碰 X 自己写过 translateY 的 cell（文档流布局交回 X）：
 * 详情页主帖可能不是绝对定位，给它补一个 translateY 会把它整块推出视口，
 * 表现就是「点开推文后主帖不见、只剩回复」。渲染窗口里只要有一条没有 y，
 * 说明这一页不是纯绝对定位列表，本轮一律不动（结构未稳定，硬算必错）。
 */
export function reflowCards(): void {
  const col = column();
  if (!col) return;
  const cells = feedCells(col);
  if (cells.length < 2) return;

  // ⛔ 读写分离：先把所有高度读完再统一写，不要在「写样式 → 读高度」之间来回切。
  // 这种交替每轮都会逼浏览器做一次同步重排，滚动时每帧几十条，就是卡顿与闪动的来源。
  const n = cells.length;
  const has = new Uint8Array(n);
  const hs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const h = cells[i].offsetHeight;
    has[i] = h > 0 ? 1 : 0;
    hs[i] = h;
    const cur = TY_RE.exec(cells[i].style.transform || '');
    ys[i] = cur ? parseFloat(cur[1]) : NaN;
  }

  let first = 0;
  while (first < n && !has[first]) first++;
  if (first >= n) return;

  // 有高度的格子里，带 y 与不带 y 各数一遍
  let withY = 0;
  let noY = 0;
  for (let i = first; i < n; i++) {
    if (!has[i]) continue;
    if (Number.isNaN(ys[i])) noY++;
    else withY++;
  }
  // 整列文档流（一条 y 都没有）⇒ 不是虚拟列表，交回 X
  if (!withY) {
    document.documentElement.dataset.xmReflow = `${n}/plain`;
    return;
  }
  // 混排 ⇒ 正处在路由切换 / 主帖填充的中途，本轮不写坐标也不改容器高度
  if (noY) {
    document.documentElement.dataset.xmReflow = `${n}/mixed`;
    return;
  }

  // 首条锚点：原地不动，只以它为基准往下推
  let prevY = ys[first];
  let prevH = hs[first];
  let moved = 0;
  for (let i = first + 1; i < n; i++) {
    if (!has[i]) continue; // 广告 / 折叠项：不占位也不动它
    const want = prevY + prevH;
    if (!(Math.abs(ys[i] - want) <= 0.5)) {
      cells[i].style.setProperty('transform', `translateY(${want.toFixed(3)}px)`, 'important');
      moved++;
    }
    prevY = want;
    prevH = hs[i];
  }

  // 容器高度：X 靠它算可滚动范围。
  // ⛔ 只增不减 —— 视频加载中途读到的高度偏小，写下去会让容器变矮、scrollTop 被 clamp，
  // 页面整个往上跳一下，主帖被甩出视口。真变矮由 X 自己重建容器收回。
  // ⛔ 两条硬闸（v0.1.90）：
  //   ① 详情页（/status/）一律不写 —— 那里的内容由 X 自己撑，写高度收益为零，
  //      而主帖视频从占位高度变实高时会让我们把容器写矮，正是「点开推文后主帖消失」；
  //   ② 渲染窗口里只要有还没就绪的媒体（video 没拿到 videoWidth / img 没 complete），
  //      本轮高度必是中间态，一律不写。
  const wrap = cells[first].parentElement;
  const skipMh = isDetailPath() || hasPendingMedia(col);
  if (wrap && wrap !== col && !skipMh) {
    const path = location.pathname;
    if (path !== minPath) {
      minPath = path;
      minCol = null;
    }
    const need = Math.round(prevY + prevH);
    const cur = parseFloat(wrap.style.minHeight) || 0;
    const same = wrap === minCol;
    if (!same || need > cur + 0.5) {
      if (Math.abs(cur - need) > 0.5) wrap.style.setProperty('min-height', `${need}px`, 'important');
      minCol = wrap;
    }
  }

  document.documentElement.dataset.xmReflow = `${cells.length}/${moved}${skipMh ? ':nomh' : ''}`;
}

/** 详情页（/<user>/status/<id>）：主帖 + 回复由 X 自己排版，我们不参与撑高 */
function isDetailPath(): boolean {
  return location.pathname.includes('/status/');
}

/** 还有媒体没加载完 ⇒ 此刻的高度是占位值，不能拿来定容器高度 */
function hasPendingMedia(col: HTMLElement): boolean {
  for (const v of Array.from(col.querySelectorAll('video'))) {
    if (!v.videoWidth) return true;
  }
  for (const im of Array.from(col.querySelectorAll('img'))) {
    // 有 src 才算「正在加载」；无 src 的占位节点 complete 恒为 true，不必绕过
    if (im.getAttribute('src') && !im.complete) return true;
  }
  return false;
}
