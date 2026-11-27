/**
 * 「显示 N 帖子」提示行。
 *
 * 做法：原生那条整条压成 0 高藏掉（见 styles.ts 的 [data-xm-pill] 段），
 * 另在 body 上挂一颗悬浮胶囊 .xm-pillbar（样式对齐 X 自己的「已发布」提示），
 * 贴在顶栏下沿居中；点它就把点击转发给原生按钮 —— 刷新由 X 自己跑，我们只做入口。
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

import { column, cells as feedCells } from './sel';
import { syncPageAccent } from './theming';

/** 打在原生提示行上的钩子：样式表据此把它压成 0 高 */
const PILL_ATTR = 'data-xm-pill';

/** 中文「显示 70 帖子」/「展示 12 条帖子」/「查看 12 条新帖子」/「12 条新帖子」，
 *  英文 "Show 70 posts" / "70 posts" / "Show 12 new posts"。
 *  ⛔ 文案随 X 改版漂移过（"帖子" → "条新帖子"、"显示" → "查看"），
 *    只认一种就会静默失效 —— 表现是提示彻底不出现，比样式错了更难查。 */
const CN_RE = /(显示|展示|查看)\s*\d+\s*条?\s*(新)?\s*帖子|^\d+\s*条?\s*新\s*帖子$/;
const EN_RE = /^(show\s+)?\d+\s+(new\s+)?posts?$/i;

/** 不带计数的新推提示：「查看新帖子 / See new posts」。
 *  它是提示行的另一种形态（X 按版本/实验在两者间切换），同样要接管 ——
 *  ⛔ 只收掉不接管 = 提示彻底消失（v0.1.84 的教训）。 */
const TOAST_RE = /^(查看新帖子|see\s+new\s+posts?|show\s+new\s+posts?)$/i;

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
/** 收起后再亮的最小间隔：X 重挂浮层时不要跟着闪 */
const FLASH_GAP = 800;

interface Hit {
  btn: HTMLElement;
  row: HTMLElement;
  label: string;
}

let bar: HTMLButtonElement | null = null;
let barText: HTMLSpanElement | null = null;
let barLabel = '';
let nativeRow: HTMLElement | null = null;
let nativeBtn: HTMLElement | null = null;
let lastFullScan = -1e9;
let lastHitAt = 0;
let lastPlace = -1e9;
let dismissedAt = -1e9;
let dismissedLabel = '';
/** 上一次收起浮条的时刻：用来压掉 X 反复重挂浮层造成的频闪 */
let lastHideAt = -1e9;

/** 按钮文案是否就是提示行；顺手把连续空白压成一个空格。
 *  两种形态都算：计数型（显示/查看 N 帖子）与无计数的「查看新帖子」。 */
function labelOf(btn: HTMLElement): string {
  const t = (btn.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > LABEL_MAX) return '';
  return CN_RE.test(t) || EN_RE.test(t) || TOAST_RE.test(t) ? t : '';
}

/** 从按钮上溯到「这一行」：cell 内就取 cell，浮层形态取 role=status */
function rowOf(el: HTMLElement): HTMLElement {
  const cell = el.closest<HTMLElement>('[data-testid="cellInnerDiv"], li[data-index]');
  if (cell) return cell;
  const status = el.closest<HTMLElement>('[role="status"]');
  return status ?? el;
}

/** pillLabel 形态：它本身可能不是 button（外层再包一层 div），按按钮认会整条漏掉；
 *  文案对得上就直接拿它当点击目标 —— 派发 click 同样会触发 X 的 onClick。 */
function hitPillLabel(scope: ParentNode): Hit | null {
  for (const el of Array.from(scope.querySelectorAll<HTMLElement>('[data-testid="pillLabel"]'))) {
    const label = labelOf(el);
    if (!label) continue;
    // 曾经被我方 toast 规则收掉的那颗，先还回去再接管 ——
    // 否则「display:none → 高度 0 → 认不到」会锁死，提示再也回不来。
    const host = el.closest<HTMLElement>(`[${TOAST_ATTR}]`);
    if (host) host.removeAttribute(TOAST_ATTR);
    const row = rowOf(el);
    if (!row.hasAttribute(PILL_ATTR) && row.getBoundingClientRect().height < 1) continue;
    return { btn: el, row, label };
  }
  return null;
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
  return hitPillLabel(scope);
}

/**
 * 左侧 Home 图标上的未读计数。
 * X 在「有 N 条新推」时把数字挂在链接内的小徽标上（超过上限显示 "20+"）；
 * 只有 1 条或不可数时是纯圆点、没有文本 —— 这时返回 0。
 * 这是页面自己认定的「几条」，比我们猜的可靠。
 */
function readNavCount(): number {
  const link = document.querySelector<HTMLElement>('[data-testid="AppTabBar_Home_Link"]');
  if (!link) return 0;
  let best = 0;
  for (const el of Array.from(link.querySelectorAll<HTMLElement>('span,div'))) {
    if (el.children.length) continue; // 只看叶子，避免把整段文案读进来
    const t = (el.textContent ?? '').trim();
    if (!/^\d{1,3}\+?$/.test(t)) continue;
    const n = parseInt(t, 10);
    if (n > best) best = n;
  }
  return best;
}

/**
 * 从 aria-label / title 里抠条数：X 的提示按钮常把「查看 12 条新帖子」写进无障碍属性，
 * 可见文案却只有「查看新帖子」。这是最贴原文的口径，优先于导航徽标。
 */
function readAriaCount(from: HTMLElement): number {
  let el: HTMLElement | null = from;
  for (let i = 0; el && el !== document.body && i < 5; i++, el = el.parentElement) {
    for (const attr of ['aria-label', 'title']) {
      const v = el.getAttribute(attr) ?? '';
      const m = v.match(/(\d{1,3})\s*(?:条|(?:new\s+)?posts?\b)/i);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > 0) return n;
      }
    }
  }
  return 0;
}

/**
 * 无计数的「查看新帖子」补上条数，让顶部浮条与左侧徽标说的是同一件事。
 * 取值顺序：按钮的 aria-label → 左侧 Home 徽标 → 都没有则返回 null。
 * ⛔ 返回 null 表示「这条提示没有信息量，不要弹」—— 光说「查看新帖子」
 *    既不知道几条，又在阅读时反复糊在正文上，宁可不显示。
 * ⛔ 只补无计数形态：计数型（显示 N 帖子）的数字来自 X 的信息流本身，
 *    和导航徽标不是同一口径，覆盖会张冠李戴。
 */
function withCount(label: string, from: HTMLElement): string | null {
  if (!TOAST_RE.test(label)) return label;
  const n = readAriaCount(from) || readNavCount();
  return n > 0 ? `查看 ${n} 条新帖子` : null;
}

/**
 * 认这一行。
 * 顺序：时间线头部 cell → role=status 浮层 → 全列按钮（限频兜底）。
 * 头部 cell 是主路径：真机上「显示 N 帖子」就是时间线的第 0 条 cell。
 */
function scan(col: HTMLElement, now: number): Hit | null {
  const cells = feedCells(col);
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
  // 兜底：主栏内所有按钮 → 主栏外的 pillLabel（挂在顶栏 / 悬浮层的那种）
  return hitIn(col) ?? hitPillLabel(document);
}

function ensureBar(): HTMLButtonElement {
  if (bar?.isConnected) return bar;
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'xm-pillbar';
  el.dataset.on = '0';
  // 药丸是内层：外层只做定位与承载动画（满主栏宽 + flex 居中），
  // 这样不用在 JS 里量文字宽度去算 left
  const text = document.createElement('span');
  text.className = 'xm-pillbar-in';
  el.appendChild(text);
  el.addEventListener('click', onClick);
  document.body.appendChild(el);
  bar = el;
  barText = text;
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
  const same = barLabel === label;
  if (!same) {
    if (barText) barText.textContent = label;
    barLabel = label;
  }
  if (el.dataset.on !== '1') {
    // 刚收起同一条（<800ms）就再等一轮：X 会反复重挂浮层，
    // 每挂一次就重新亮一遍的话，屏幕上就成了频闪灯。
    if (same && performance.now() - lastHideAt < FLASH_GAP) return;
    el.dataset.on = '1';
  }
}

function hideBar(): void {
  if (bar && bar.dataset.on !== '0') {
    bar.dataset.on = '0';
    lastHideAt = performance.now();
  }
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
 * X 自己的浮层提示，两类都和我们重复，留着就是双份：
 * ① 「查看新帖子」胶囊（`[data-testid="pillLabel"]`）—— 浮条停用后整块收掉；
 * ② 「已发布 / Posted」回执胶囊（`[data-testid="toast"]`，里面没有 pillLabel）—— 直接收。
 * ⛔ 只认「短文本 + 回执措辞」，绝不按 testid 无差别隐藏 toast ——
 *   发送失败、网络错误等提示必须让用户看见。
 * ⛔ 新推胶囊按「是不是浮层」判，不按文案判：带不带计数一律收（主人 2026-11-22 定）。
 */
const TOAST_ATTR = 'data-xm-toast';
/** 「已发布 / 已发送 / Posted / Your post was sent」这类回执，文本很短 */
const POSTED_RE = /^(已发布|已发送|已投递|posted|sent|your\s+post\s+was\s+sent|your\s+post\s+was\s+posted)$/i;
let lastToastScan = -1e9;
/** 全列按文案兜底扫描的时间戳（比 cell 快路径贵，单独降频） */
let lastDeepScan = -1e9;

/** 上溯到「浮层本体」：第一个 fixed/absolute 祖先，但高度超过 140 就停 */
function climbToOverlay(from: HTMLElement): HTMLElement {
  let box: HTMLElement | null = from;
  let pick: HTMLElement | null = null;
  for (let i = 0; box && box !== document.body && i < 8; i++) {
    if (box.getBoundingClientRect().height > 140) break;
    pick = box;
    const pos = getComputedStyle(box).position;
    if (pos === 'fixed' || pos === 'absolute') break;
    box = box.parentElement;
  }
  return pick ?? from;
}

/**
 * 一个节点能不能被当成「一行提示」藏掉。
 *
 * ⛔ 2026-11-26 事故：X 的虚拟列表会**复用容器节点** —— 打过标记的提示条外层，
 *    之后被拿去装整条时间线（现场：它里面的 ul 行内高 208438px 仍在增长，
 *    说明 X 正常在填，是我们把它连窝端了），属性还挂在上面，整层就 display:none，
 *    表现就是「阅读中突然所有推文消失、刷新才好」。
 *    所以打标前先确认：它既不是内容层，也不含内容层。
 */
function toastable(el: HTMLElement): boolean {
  if (el === document.body || el === document.documentElement) return false;
  if (el === document.querySelector('main')) return false;
  // 含推文 / 含虚拟列表格子 / 含列表容器 ⇒ 这是内容层，不是提示条
  if (el.querySelector('article, [data-testid="cellInnerDiv"], li[data-index], ul')) return false;
  // 高度已经超过一行提示的体量
  if (el.scrollHeight > 200) return false;
  return true;
}

/**
 * 每轮自愈：属性一旦落到内容层上，立刻摘掉。
 * 不节流 —— 正常只有 0~3 个节点，成本是一次 querySelectorAll；
 * 而这一步正是「永久空白」唯一的兜底，晚一轮就是一帧空白。
 */
function healToasts(): void {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[${TOAST_ATTR}]`))) {
    if (!toastable(el)) el.removeAttribute(TOAST_ATTR);
  }
}

/**
 * 按文案认提示行本体。
 * ⛔ 新版 X 把「显示 N 帖子」渲染成一段**纯文本**：既不是 button，也没有 pillLabel，
 *    只按 testid / role 找必然漏 —— 表现就是提示原样露在时间线顶上（2026-11-22 现场）。
 * 只在主栏前三条 cell 的叶子里找，成本可忽略；命中后交给调用方上溯到浮层本体。
 */
function findPillText(col: HTMLElement): HTMLElement | null {
  const matchLeaf = (root: ParentNode): HTMLElement | null => {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('span,div,p'))) {
      if (el.children.length) continue; // 只看叶子，避免整段正文
      const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > LABEL_MAX) continue;
      if (CN_RE.test(t) || EN_RE.test(t) || TOAST_RE.test(t)) return el;
    }
    return null;
  };

  // 快路径：真机上提示行就是时间线的第 0 条 cell
  const cells = feedCells(col);
  for (let i = 0; i < Math.min(cells.length, 3); i++) {
    const hit = matchLeaf(cells[i]);
    if (hit) return hit;
  }
  // 兜底：不在 cell 里（新版把它挂在标签栏下方独立一层）时全列扫，降频 2s 一次
  const now = performance.now();
  if (now - lastDeepScan < 2000) return null;
  lastDeepScan = now;
  return matchLeaf(col);
}

function markNativeToast(): void {
  // 自愈必须在节流之前：属性被带到内容层上时，晚 400ms 就是 400ms 的空白
  healToasts();
  const now = performance.now();
  // 400ms：标记会随虚拟列表重建而丢失，间隔太长就是肉眼可见的「闪一下又出来」
  if (now - lastToastScan < 400) return;
  lastToastScan = now;

  // ① 关注列表的「查看新帖子」胶囊
  for (const label of Array.from(document.querySelectorAll<HTMLElement>('[data-testid="pillLabel"]'))) {
    if (label.closest(`[${PILL_ATTR}]`)) continue;
    const text = (label.textContent ?? '').replace(/\s+/g, ' ').trim();
    // ⛔ 这里不再区分「带数字 / 不带数字」：主人已明确不要任何新推提示，
    //    连「显示 70 帖子」这种带计数的也一并收掉，页面上不留空条。
    if (!text) continue;
    const target = climbToOverlay(label);
    // 安全阀：上溯上来的若是「一块内容」而不是一颗小浮层，宁可不收。
    // 整块 display:none 很容易把主栏内容一起带走，且看不出是谁干的。
    if (target !== label && target.getBoundingClientRect().height > 96) continue;
    if (!toastable(target)) continue;
    if (!target.hasAttribute(TOAST_ATTR)) target.setAttribute(TOAST_ATTR, '');
  }

  // ①-b 纯文本形态（新版 X）：按文案找，命中就上溯到浮层本体整块收掉
  const col = column();
  const leaf = col ? findPillText(col) : null;
  if (leaf && !leaf.closest(`[${TOAST_ATTR}]`)) {
    const target = climbToOverlay(leaf);
    // 安全阀同 ①：上溯成「一块内容」就不收，宁可留着也不吞主栏
    const tooBig = target !== leaf && target.getBoundingClientRect().height > 96;
    if (!tooBig && toastable(target)) target.setAttribute(TOAST_ATTR, '');
  }

  // ② 发帖后的「已发布」回执：根节点自带 testid，整颗收掉即可，不用上溯
  for (const toast of Array.from(document.querySelectorAll<HTMLElement>('[data-testid="toast"]'))) {
    if (toast.hasAttribute(TOAST_ATTR)) continue;
    const text = (toast.textContent ?? '').replace(/\s+/g, ' ').trim();
    // 回执里可能还带用户名或头像 alt，故不要求整段全等：短 + 含回执词即可
    if (text.length > 60 || !POSTED_RE.test(text) && !/(已发布|已发送|posted|was\s+sent)/i.test(text)) continue;
    if (!toastable(toast)) continue;
    toast.setAttribute(TOAST_ATTR, '');
  }

  // ③ 兜底：某些客户端版本的回执没有 data-testid="toast"，只是 role=alert/status 的浮层。
  //    这里只认「文字整段全等回执词」——比 ② 更严，因为 role 容器可能是别的东西。
  for (const region of Array.from(
    document.querySelectorAll<HTMLElement>('[role="alert"],[role="status"]'),
  )) {
    if (region.hasAttribute(TOAST_ATTR)) continue;
    const text = (region.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 24 || !POSTED_RE.test(text)) continue;
    const target = climbToOverlay(region);
    if (toastable(target) && !target.hasAttribute(TOAST_ATTR)) target.setAttribute(TOAST_ATTR, '');
  }
}

/**
 * 停用提示浮条（主人 2026-11-22：「彻底把这个提示去掉」）。
 *
 * 停用后：不接管 X 的原生提示行、不画我们的胶囊，同时把 X 自己的
 * 「显示 N 帖子」整块收掉 —— 页面上既不出现浮条，也不留一条空白。
 * 清标记是必须的：旧版本给节点打过 PILL_ATTR / TOAST_ATTR，
 * 样式表靠属性压 display，不清就会继续显示成空条。
 */
export function killPill(): void {
  if (bar) {
    bar.remove();
    bar = null;
    barText = null;
    barLabel = '';
  }
  clearRow();
  nativeBtn = null;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[${PILL_ATTR}]`))) {
    el.removeAttribute(PILL_ATTR);
  }
  document.documentElement.dataset.xmPillState = 'off';
  markNativeToast();
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
  const col = column();
  if (!col) {
    if (nativeRow || bar) teardown();
    return;
  }

  // 浮条用页面主题的强调色，不用扩展设置里那个（可能和页面撞色）
  syncPageAccent();

  const now = performance.now();
  // ⛔ 顺序：先接管、再收 toast。反过来的话，同一轮里 toast 会先把 pillLabel
  //    压成 display:none（高度 0），紧接着扫描就认不到它 —— 原生被藏、浮条不出，
  //    表现就是「提示彻底消失」。
  const hit = scan(col, now);

  if (hit) {
    nativeBtn = hit.btn;
    lastHitAt = now;
    takeRow(hit.row);
    // 无计数形态补上按钮 aria-label / 左侧徽标的条数，两处提示口径一致
    const shown = withCount(hit.label, hit.btn);
    if (shown == null) {
      // 两处都拿不到条数 ⇒ 顶部一条提示都不显示：光说「查看新帖子」既不知道几条，
      // 又会在阅读时反复糊在正文上。原生行已 takeRow 压掉，浮层形态由末尾的
      // markNativeToast 收掉；新推仍由左侧图标的圆点/数字兜着，滚回顶部即可看到。
      hideBar();
      document.documentElement.dataset.xmPillState = 'nocount';
    } else {
      const muzzled = shown === dismissedLabel && now - dismissedAt < MUZZLE_MS;
      if (muzzled) hideBar();
      else showBar(shown);
      document.documentElement.dataset.xmPillState = 'ok';
    }
  } else if (bar?.dataset.on === '1' && now - lastHitAt < STALE_MS) {
    // 按钮暂时不在 DOM：浮条继续挂着，用户点了会滚回顶部重新认
    document.documentElement.dataset.xmPillState = 'hold';
  } else {
    hideBar();
    clearRow();
    nativeBtn = null;
    document.documentElement.dataset.xmPillState = 'miss';
  }

  // 接管失败的原生浮层（以及发帖回执）才收掉
  markNativeToast();

  place(col, now);
}
