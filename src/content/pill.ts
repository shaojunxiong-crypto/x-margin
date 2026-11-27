/**
 * 收掉 X 自己的「有新帖子」提示（主人 2026-11-22：彻底去掉，页面上不留任何形态）。
 *
 * 这里**只做减法**：不接管、不重画、不提供替代入口。以前那套「自建悬浮胶囊
 * .xm-pillbar + 把点击转发给原生按钮」的机制已随这个决定一起停用（代码已删除），
 * 因为它接管的是用户明确不想看到的东西 —— 留着只会让人误以为还有入口。
 *
 * 要收的有三类，都在 `markNativeToast()` 里：
 *   ① 关注列表 / 首页顶部的「显示 N 帖子」「查看新帖子」胶囊（`[data-testid="pillLabel"]`
 *      与新版那段纯文本）；
 *   ② 发帖后的「已发布 / Posted」回执；
 *   ③ 没有 testid、只有 role=alert/status 的同类浮层（部分客户端版本）。
 *
 * ⛔ 只认「短文本 + 提示措辞」，绝不按 testid 无差别隐藏 toast ——
 *    发送失败、网络错误等提示必须让用户看见。
 * ⛔ 打标前先过 `toastable()`：X 的虚拟列表会复用容器节点，标记落到装推文的层上
 *    就是整条时间线空白（2026-11-26 事故）。每轮先 `healToasts()` 自愈。
 */

import { column, cells as feedCells } from './sel';

/** 旧版本打在原生提示行上的钩子。现在不再新打，只负责把历史标记清掉。 */
const PILL_ATTR = 'data-xm-pill';

/** 中文「显示 70 帖子」/「展示 12 条帖子」/「查看 12 条新帖子」/「12 条新帖子」，
 *  英文 "Show 70 posts" / "70 posts" / "Show 12 new posts"。
 *  ⛔ 文案随 X 改版漂移过（"帖子" → "条新帖子"、"显示" → "查看"），
 *    只认一种就会静默失效 —— 表现是提示反而原样露着，比样式错了更难查。 */
const CN_RE = /(显示|展示|查看)\s*\d+\s*条?\s*(新)?\s*帖子|^\d+\s*条?\s*新\s*帖子$/;
const EN_RE = /^(show\s+)?\d+\s+(new\s+)?posts?$/i;

/** 不带计数的新推提示：「查看新帖子 / See new posts」 */
const TOAST_RE = /^(查看新帖子|see\s+new\s+posts?|show\s+new\s+posts?)$/i;

/** 文案长度上限：超过这个长度必然是正文，不是提示行 */
const LABEL_MAX = 24;

/**
 * 浮层提示的隐藏标记。
 * ⛔ 属性只该落在「一行提示」上，见文件头的虚拟列表复用事故。
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

  // ① 「查看新帖子」胶囊
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
 * 每轮补扫调用（主栏结构变动后、以及 300ms 心跳里各一次）。
 *
 * 只做两件事：把历史遗留的 PILL_ATTR 清掉（旧版本用它压高度，不清会留一条空条），
 * 然后收掉 X 的提示浮层。**不接管、不显示任何东西**。
 */
export function hideNewPostsNotice(): void {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[${PILL_ATTR}]`))) {
    el.removeAttribute(PILL_ATTR);
  }
  markNativeToast();
}
