/**
 * 单条推文截图：右上角按钮 → 截取 → 预览 → 下载 / 复制。
 *
 * 像素从哪来？内容脚本读不到页面的渲染结果，只能请后台调 captureVisibleTab 截「当前视口」，
 * 再按推文的 getBoundingClientRect 把这一块裁出来。好处是所见即所得（真图、真字体、真卡片底色），
 * 代价是「视口之外」拿不到 —— 所以比一屏高的推文要滚动分帧，再按同样的偏移缝进一张 canvas。
 *
 * 三个必须处理的副作用：
 * 1. 按钮常显在操作栏里，会被拍进画面 → html.xm-shotting 先把按钮收掉；
 * 2. 吸顶标签栏会盖住分段顶部 → 截图期间把「贴顶、sticky/fixed、宽度覆盖主栏」的层 visibility:hidden
 *    （sticky 元素在流里占位，隐藏它不引起重排，所以偏移量不用跟着改）；
 * 3. 截图期间要滚动页面 → 结束后原位滚回，并把 scroll-behavior 临时改成 auto，
 *    否则会被 X 的平滑滚动拖成一段时间才归位。
 *
 * 位置：直接插进推文底部操作栏（[role=group]）的「收藏」右侧，作为一个 flex item 排着，
 * 尺寸/圆角与 X 自己的图标按钮一致，所以卡片模式的 padding 怎么变都不用跟着调坐标。
 */

const SIZE = 34;

/* 线性描边，和 X 操作栏里其它图标（评论/转推/点赞/书签/分享）同一风格；
   实心版本在一排线性图标里显得又黑又重。 */
const ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"'
  + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M3 9.2A2.7 2.7 0 0 1 5.7 6.5h1.6L8.6 4h6.8l1.3 2.5h1.6A2.7 2.7 0 0 1 21 9.2v8.1a2.7 2.7 0 0 1-2.7 2.7H5.7A2.7 2.7 0 0 1 3 17.3V9.2Z"/>'
  + '<circle cx="12" cy="13.3" r="3.6"/></svg>';

const CLOSE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">'
  + '<path d="M6 6l12 12M18 6L6 18"/></svg>';

const CSS = `
/* 按钮是推文底部操作栏 [role=group] 里的一个 flex item，跟着「收藏 / 分享」排，
   不做绝对定位，也就不需要跟 X 的重渲染同步坐标。常显。 */
.xm-shot{flex:none;width:${SIZE}px;height:${SIZE}px;box-sizing:border-box;
  padding:0;border:0;border-radius:9999px;background:transparent;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  color:var(--xm-ui-sub,#71767b);
  transition:background .12s ease,color .12s ease;
  -webkit-tap-highlight-color:transparent}
.xm-shot:hover{background:var(--xm-acc-soft,rgba(29,155,240,.14));color:var(--xm-acc,#1d9bf0)}
.xm-shot:active{transform:scale(.94)}
.xm-shot svg{display:block;width:19px;height:19px}
/* 截图期间：按钮本身、以及它的 hover 底色一律不出现 */
html.xm-shotting .xm-shot{opacity:0!important;pointer-events:none!important}
/* 自己的提示条也在视口里，不藏掉会被拍进长图的接缝处 */
html.xm-shotting .xm-shot-tip{opacity:0!important}
html.xm-shotting,html.xm-shotting *{scroll-behavior:auto!important}

.xm-shot-ov{position:fixed;inset:0;z-index:2147483003;display:flex;align-items:center;justify-content:center;
  background:rgba(0,0,0,.74);-webkit-backdrop-filter:blur(9px) saturate(1.1);backdrop-filter:blur(9px) saturate(1.1);
  font:13px/1.55 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  color:var(--xm-ui-fg,#e7e9ea);opacity:0;visibility:hidden;
  transition:opacity .16s ease,visibility .16s}
.xm-shot-ov[data-open="1"]{opacity:1;visibility:visible}
.xm-shot-box{display:flex;flex-direction:column;max-width:min(92vw,900px);max-height:90vh;
  border:1px solid var(--xm-ui-line,rgba(255,255,255,.12));border-radius:0;overflow:hidden;
  background:var(--xm-ui-bg,rgba(17,17,19,.94));
  box-shadow:0 30px 80px rgba(0,0,0,.5),0 2px 10px rgba(0,0,0,.2)}
.xm-shot-hd{display:flex;align-items:center;gap:10px;padding:11px 12px 10px 16px;flex:none;
  border-bottom:1px solid var(--xm-ui-line,rgba(255,255,255,.1))}
.xm-shot-hd-t{flex:1;min-width:0;line-height:1.25}
.xm-shot-hd-t b{display:block;font:600 13px/1.25 inherit}
.xm-shot-hd-t i{display:block;font-style:normal;font:400 10.5px/1.35 inherit;
  color:var(--xm-ui-sub,#8b98a5);margin-top:2px}
.xm-shot-x{flex:none;width:28px;height:28px;border:0;border-radius:0;background:transparent;padding:0;
  color:var(--xm-ui-sub,#8b98a5);cursor:pointer;display:flex;align-items:center;justify-content:center}
.xm-shot-x:hover{background:var(--xm-ui-hover,rgba(255,255,255,.07));color:var(--xm-ui-fg,#e7e9ea)}
.xm-shot-x svg{width:16px;height:16px;display:block}
.xm-shot-body{flex:1;min-height:0;overflow:auto;background:rgba(127,127,127,.06);padding:10px 10px 0}
.xm-shot-body img{display:block;margin:0 auto;max-width:100%;max-height:calc(90vh - 122px);
  width:auto;height:auto;border-radius:0}
.xm-shot-ft{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:10px 12px 12px;flex:none}
.xm-shot-btn{height:32px;padding:0 14px;border-radius:0;border:1px solid var(--xm-ui-line,rgba(255,255,255,.14));
  background:var(--xm-ui-card,rgba(255,255,255,.05));color:var(--xm-ui-fg,#e7e9ea);
  font:500 12.5px/1 inherit;cursor:pointer;transition:background .14s ease,border-color .14s ease}
.xm-shot-btn:hover{background:var(--xm-ui-hover,rgba(255,255,255,.09))}
.xm-shot-btn[data-a="dl"]{border-color:transparent;background:var(--xm-acc,#1d9bf0);color:var(--xm-shot-ink,#fff)}
.xm-shot-btn[data-a="dl"]:hover{filter:brightness(1.08)}

.xm-shot-tip{position:fixed;left:50%;bottom:36px;transform:translate(-50%,10px);z-index:2147483004;
  max-width:72vw;padding:9px 16px;border-radius:9999px;
  background:rgba(16,17,20,.94);color:#f2f4f7;border:1px solid rgba(255,255,255,.1);
  font:12.5px/1.45 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  box-shadow:0 12px 34px rgba(0,0,0,.4);opacity:0;pointer-events:none;
  transition:opacity .18s ease,transform .18s ease}
.xm-shot-tip[data-on="1"]{opacity:1;transform:translate(-50%,0)}
`;

let styleIn = false;
let ov: HTMLElement | null = null;
let ovImg: HTMLImageElement | null = null;
let ovSub: HTMLElement | null = null;
let tipEl: HTMLElement | null = null;
let tipTimer = 0;
let busy = false;
let lastMount = 0;
let blobUrl = '';
let blob: Blob | null = null;
let fileName = 'x.png';

/** 一次 0.16s 的淡入淡出：留给 CSS 一帧，再等图片解码 */
function settle(): Promise<void> {
  return new Promise((res) => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 70)));
  });
}

function injectStyle(): void {
  if (styleIn) return;
  styleIn = true;
  const s = document.createElement('style');
  s.id = 'xm-shot-css';
  s.textContent = CSS;
  (document.head ?? document.documentElement).append(s);
}

function tip(text: string, ms = 2200): void {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'xm-shot-tip';
    document.body.append(tipEl);
  }
  tipEl.textContent = text;
  tipEl.dataset.on = '1';
  clearTimeout(tipTimer);
  if (ms > 0) tipTimer = window.setTimeout(() => { if (tipEl) tipEl.dataset.on = '0'; }, ms);
}

/* ────────────────────────── 按钮 ────────────────────────── */

/**
 * 找「属于这条推文」的操作栏。
 * 引用推文（quote）内部也有自己的 [role=group]，按文档序它排在前面，
 * 所以不能直接取第一个 —— 用「最近的 article 祖先是不是我」来筛。
 */
function groupOf(art: HTMLElement): HTMLElement | null {
  for (const g of art.querySelectorAll<HTMLElement>('[role="group"]')) {
    if (g.closest('article[data-testid="tweet"]') === art) return g;
  }
  return null;
}

/**
 * 插在「收藏」右边：收藏按钮可能被包一层 div，往上爬到 group 的直属子节点再取其 nextSibling。
 * 没有收藏按钮（少数版式）就退化成放在组末，视觉上仍在分享一带。
 */
function slotOf(group: HTMLElement): { parent: HTMLElement; before: Node | null } {
  let anchor = group.querySelector<HTMLElement>('[data-testid="bookmark"]');
  while (anchor && anchor.parentElement !== group) anchor = anchor.parentElement;
  if (!anchor) return { parent: group, before: null };
  return { parent: group, before: anchor.nextSibling };
}

function mount(): void {
  const arts = document.querySelectorAll<HTMLElement>('article[data-testid="tweet"]');
  let n = 0;
  for (const art of arts) {
    if (!art.isConnected) continue;
    const group = groupOf(art);
    // 操作栏还没渲染出来：跳过，下一轮补
    if (!group) continue;
    let btn = group.querySelector<HTMLButtonElement>(':scope > .xm-shot');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'xm-shot';
      btn.title = '截图这条推文';
      btn.setAttribute('aria-label', '截图这条推文');
      btn.innerHTML = ICON;
      const { parent, before } = slotOf(group);
      parent.insertBefore(btn, before);
    }
    n++;
  }
  document.documentElement.dataset.xmShot = String(n);
}

/** 点到按钮：别让 X 把这次点击当成「打开推文」 */
function onDocClick(ev: MouseEvent): void {
  const t = ev.target;
  if (!(t instanceof Element)) return;
  const btn = t.closest<HTMLElement>('.xm-shot');
  if (!btn) return;
  ev.preventDefault();
  ev.stopPropagation();
  const art = btn.closest<HTMLElement>('article[data-testid="tweet"]');
  if (art) void shoot(art);
}

/* ────────────────────────── 截图 ────────────────────────── */

function captureFrame(): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('截图超时（后台无响应）'));
    }, 5000);
    const done = (err: Error | null, url?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(url as string);
    };
    try {
      chrome.runtime.sendMessage({ type: 'xm:shot' }, (res?: { ok?: boolean; url?: string; err?: string }) => {
        const err = chrome.runtime.lastError;
        if (err) return done(new Error(err.message || '后台不可达'));
        if (!res || !res.ok || !res.url) return done(new Error(res?.err || '取不到画面'));
        done(null, res.url);
      });
    } catch (e) {
      done(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画面解码失败'));
    img.src = src;
  });
}

/** 最近的「可滚动祖先」；返回 null 表示整页滚动（主页与详情页都是这种情况） */
function scrollRoot(art: HTMLElement): HTMLElement | null {
  let el = art.parentElement;
  while (el && el !== document.body && el !== document.documentElement) {
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 8) return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * 吸顶 / 固定层：用 elementsFromPoint 在主栏顶部取三个点，比遍历 DOM 便宜得多。
 * 只认「宽度覆盖主栏 70% 以上、贴在顶部、高度不超过 260」的层，避免误伤整页遮罩。
 */
function hideTopOverlays(): () => void {
  const col = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]');
  if (!col) return () => {};
  const r = col.getBoundingClientRect();
  const found = new Set<HTMLElement>();
  for (const y of [4, 16, 32]) {
    for (const el of document.elementsFromPoint(r.left + r.width / 2, y)) {
      if (!(el instanceof HTMLElement) || el === col) continue;
      const cs = getComputedStyle(el);
      if (cs.position !== 'sticky' && cs.position !== 'fixed') continue;
      const er = el.getBoundingClientRect();
      if (er.width < r.width * 0.7 || er.height > 260 || er.top > 40) continue;
      found.add(el);
    }
  }
  const prev = [...found].map((el) => el.style.getPropertyValue('visibility'));
  found.forEach((el) => el.style.setProperty('visibility', 'hidden', 'important'));
  return () => {
    [...found].forEach((el, i) => {
      if (prev[i]) el.style.setProperty('visibility', prev[i]);
      else el.style.removeProperty('visibility');
    });
  };
}

function nameFor(art: HTMLElement): string {
  const href = art.querySelector('[data-testid="User-Name"] a[href^="/"]')?.getAttribute('href') || '';
  const handle = href.split('/')[1] || 'x';
  const id = (location.pathname.match(/status\/(\d+)/) || [])[1] || '';
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  return `${handle}${id ? `-${id}` : ''}-${ts}.png`.replace(/[^\w.@-]+/g, '_');
}

async function shoot(art: HTMLElement): Promise<void> {
  if (busy) return;
  busy = true;
  const html = document.documentElement;
  const scroller = scrollRoot(art);
  const prevScroll = scroller ? scroller.scrollTop : window.scrollY;
  const prevBehavior = html.style.scrollBehavior;
  const prevTitle = document.title;
  html.classList.add('xm-shotting');
  html.style.scrollBehavior = 'auto';
  let restore: () => void = () => {};
  try {
    await settle();
    restore = scroller ? () => {} : hideTopOverlays();

    const rect = art.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width < 40 || height < 16) throw new Error('推文还没渲染好，稍后再试');

    // 可视带：整页滚动时是视口，弹窗里是那个滚动容器
    const box = scroller ? scroller.getBoundingClientRect() : null;
    const base = box ? Math.max(0, box.top) : 0;
    const bottom = box ? Math.min(window.innerHeight, box.bottom) : window.innerHeight;
    const usable = Math.max(160, Math.floor(bottom - base) - 6);

    // 文章顶部在「滚动内容」里的位置：视口偏移 + 已滚距离
    const cur = scroller ? scroller.scrollTop : window.scrollY;
    const offset = rect.top - base + cur;
    const chunks = Math.max(1, Math.ceil(height / usable));

    // 进度只能放在「不会被截进去」的地方：页面里的任何浮层都可能压在推文上。
    // 标签页标题是最干净的落点（浏览器 UI 不参与截图）。
    if (chunks > 1) document.title = `◔ 截图 1/${chunks} · ${prevTitle}`;

    let done = 0;
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;
    let scale = 1;

    // 每段多滚 LEAD 像素：滚动后帧顶那一行是脏的（合成器还没画满），
    // 直接按 frame(0) 裁会在接缝处留一条 1px 黑线。
    const LEAD = 3;
    while (done < height) {
      const target = Math.max(0, offset + done - LEAD);
      if (scroller) scroller.scrollTop = target;
      else window.scrollTo(0, target);
      await settle();

      // 目标位置可能被「文档底部 / 容器顶部」夹住，实际位置一律以 rect 为准
      const now = scroller ? scroller.scrollTop : window.scrollY;
      const top = base + (offset + done) - now;
      const h = Math.min(usable, height - done, Math.round(bottom - top));
      if (h < 8) break;

      const url = await captureFrame();
      const img = await loadImg(url);
      if (!canvas) {
        scale = img.width / window.innerWidth;
        canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('画布创建失败');
        ctx.imageSmoothingQuality = 'high';
      }
      const sw = Math.round(width * scale);
      // 高度用「累计边界」相减，而不是每段各自 round(h*scale)：
      // 后者在 scale=1.5 这类非整数倍率下会让相邻两段重叠/漏掉 1 行，接缝处出现一道浅痕。
      const dTop = Math.round(done * scale);
      const dh = Math.round((done + h) * scale) - dTop;
      ctx!.drawImage(
        img,
        Math.round(rect.left * scale), Math.round(top * scale), sw, dh,
        0, dTop, sw, dh,
      );
      done += h;
      if (chunks > 1) {
        document.title = `◔ 截图 ${Math.min(chunks, Math.ceil(done / usable))}/${chunks} · ${prevTitle}`;
      }
    }

    if (!canvas) throw new Error('没有截到内容');
    const blobOut = await new Promise<Blob | null>((res) => (canvas as HTMLCanvasElement).toBlob(res, 'image/png'));
    if (!blobOut) throw new Error('PNG 编码失败');

    fileName = nameFor(art);
    showPreview(blobOut, canvas.width, canvas.height, chunks);
    html.dataset.xmShotLast = `${canvas.width}x${canvas.height}@${chunks}`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    tip(`截图失败：${msg}`, 3200);
    html.dataset.xmShotLast = `err:${msg.slice(0, 40)}`;
  } finally {
    document.title = prevTitle;
    // 回滚必须是瞬时的：X 给 html 设了 scroll-behavior:smooth，
    // 直接 scrollTo 会被动画接管，函数返回时位置还在半路。
    html.style.setProperty('scroll-behavior', 'auto', 'important');
    // 改完样式必须先把布局读一次：这一帧里浏览器仍按旧的 smooth 处理 scrollTo。
    void html.offsetHeight;
    if (scroller) scroller.scrollTop = prevScroll;
    else window.scrollTo(0, prevScroll);
    restore();
    // 赋回原值顺带清掉上面那条 important
    html.style.scrollBehavior = prevBehavior;
    html.classList.remove('xm-shotting');
    busy = false;
  }
}

/* ────────────────────────── 预览 ────────────────────────── */

function ensureOverlay(): void {
  if (ov) return;
  const el = document.createElement('div');
  el.className = 'xm-shot-ov';
  el.innerHTML = `
    <div class="xm-shot-box" role="dialog" aria-label="推文截图">
      <div class="xm-shot-hd">
        <div class="xm-shot-hd-t"><b>推文截图</b><i></i></div>
        <button type="button" class="xm-shot-x" data-a="close" aria-label="关闭">${CLOSE}</button>
      </div>
      <div class="xm-shot-body"><img alt="推文截图" /></div>
      <div class="xm-shot-ft">
        <button type="button" class="xm-shot-btn" data-a="close">关闭</button>
        <button type="button" class="xm-shot-btn" data-a="copy">复制图片</button>
        <button type="button" class="xm-shot-btn" data-a="dl">下载 PNG</button>
      </div>
    </div>`;
  ovImg = el.querySelector<HTMLImageElement>('.xm-shot-body img');
  ovSub = el.querySelector<HTMLElement>('.xm-shot-hd-t i');
  el.addEventListener('click', (ev) => {
    const t = ev.target;
    const act = t instanceof Element ? t.closest<HTMLElement>('[data-a]')?.dataset.a : undefined;
    if (!act) {
      if (ev.target === el) closePreview();
      return;
    }
    if (act === 'close') closePreview();
    else if (act === 'dl') download();
    else if (act === 'copy') void copy();
  });
  document.body.append(el);
  ov = el;
  addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && ov?.dataset.open === '1') closePreview();
  });
}

/**
 * 主按钮的文字色按强调色的亮度二选一。
 * ⛔ 不能用 --xm-ui-on：那是「开关打开」的底色（深色主题下是 15% 白），
 * 当文字色会变成浅灰压蓝底，几乎看不见。
 */
function inkFor(): string {
  const hex = getComputedStyle(document.documentElement).getPropertyValue('--xm-acc').trim() || '#1d9bf0';
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 170 ? '#0b0d10' : '#ffffff';
}

function showPreview(b: Blob, w: number, h: number, chunks: number): void {
  ensureOverlay();
  if (ov) ov.style.setProperty('--xm-shot-ink', inkFor());
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blob = b;
  blobUrl = URL.createObjectURL(b);
  if (ovImg) ovImg.src = blobUrl;
  if (ovSub) {
    const kb = Math.round(b.size / 1024);
    ovSub.textContent = `${w} × ${h} px · ${kb} KB${chunks > 1 ? ` · ${chunks} 段拼接` : ''}`;
  }
  if (ov) ov.dataset.open = '1';
}

function closePreview(): void {
  if (ov) ov.dataset.open = '0';
  if (ovImg) ovImg.removeAttribute('src');
  if (blobUrl) {
    const u = blobUrl;
    blobUrl = '';
    setTimeout(() => URL.revokeObjectURL(u), 220);
  }
  blob = null;
}

function download(): void {
  if (!blobUrl) return;
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  tip(`已保存 ${fileName}`);
}

async function copy(): Promise<void> {
  if (!blob) return;
  try {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('no api');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    tip('已复制到剪贴板');
  } catch {
    tip('复制失败：浏览器没给剪贴板权限，请改用「下载 PNG」', 3200);
  }
}

/* ────────────────────────── 启动 ────────────────────────── */

export function initShot(): void {
  injectStyle();
  ensureOverlay();
  document.addEventListener('click', onDocClick, true);
  const loop = (): void => {
    const now = performance.now();
    if (now - lastMount > 900) {
      lastMount = now;
      mount();
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
