/**
 * 锚点适配层 —— 全项目唯一记录「X 的页面结构长什么样」的地方。
 *
 * 2026-11 X 把 Web 端整体换成 Tailwind 重写版（abs.twimg.com/x-web）：`data-testid`
 * 从上百个掉到 2 个（只剩 SearchBox_Search_Input / premium-signup-tab），主栏、格子、
 * 推文的 testid 全部消失 —— 旧选择器命中率 0，扩展静默失效（样式照注入，只是全落空）。
 *
 * 这里把新旧两套收敛成「优先旧版、回落新版」的一组函数：
 *   · 旧锚点还在（灰度回滚、部分账号仍是旧客户端）→ 行为与 v0.1.94 完全一致；
 *   · 旧锚点不在 → 走新版：`main` / `li[data-index]` / `article` / `div[data-post-avatar]`。
 *
 * ⛔ 其它模块不许再自己写这几类选择器。X 一年改三次结构，散在外面就得点十处。
 * ⛔ 旧锚点一律保留、不删：它是灰度回退时的唯一活路。
 *
 * 新版结构（2026-11 实测，vw 1407）：
 *   div.mx-auto.flex.[--x-main-column-width:600px]
 *     └ div.flex.w-full.grow.justify-center
 *       ├ div.hidden.sm:block            ← 左侧导航外壳（宽 256，可折到 72）
 *       ├ div.min-w-0.flex-1.grid        ← 主栏容器（宽 1024）
 *       │ └ main.max-w-(--x-main-column-width)   ← 主栏（600）
 *       │   └ div.flex.grow.flex-col
 *       │     ├ header.sticky            ← 页头 + [role=tablist]
 *       │     └ ul > li[data-index]      ← 虚拟列表项，position:absolute + translateY
 *       │         └ div[role=link][data-href="/user/status/id"]
 *       │             └ article          ← 推文本体
 *       │                 └ div[data-post-avatar]
 *       └ aside                          ← 右侧栏
 */

const OLD_COL = '[data-testid="primaryColumn"]';
const OLD_CELL = '[data-testid="cellInnerDiv"]';
const OLD_TWEET = '[data-testid="tweet"]';
const OLD_AVATAR = '[data-testid="Tweet-User-Avatar"]';
const OLD_NAV = 'header[role="banner"]';

/** 新版虚拟列表项：带 data-index，且由 X 自己写 translateY 定位 */
const NEW_CELL = 'li[data-index]';
const NEW_AVATAR = 'div[data-post-avatar="true"]';

/** 主栏。旧版优先 —— 旧版里 `main` 是主栏的祖先，直接用它会把范围放大一圈 */
export function column(): HTMLElement | null {
  return document.querySelector<HTMLElement>(OLD_COL) ?? document.querySelector<HTMLElement>('main');
}

/** 是否已经是 Tailwind 重写版。只用于「要不要走纯 CSS 变量」这类结构判断 */
export function isNewLayout(): boolean {
  return !document.querySelector(OLD_COL) && !!document.querySelector(NEW_CELL);
}

/**
 * 时间线格子。旧版是 `cellInnerDiv`，新版是 `li[data-index]`。
 * 返回顺序即 DOM 序 = 视觉序（两者都靠 translateY 定位，文档序仍是自上而下）。
 */
export function cells(scope: ParentNode | null = column()): HTMLElement[] {
  if (!scope) return [];
  const old = scope.querySelectorAll<HTMLElement>(OLD_CELL);
  if (old.length) return Array.from(old);
  return Array.from(scope.querySelectorAll<HTMLElement>(NEW_CELL));
}

/**
 * 最外层推文（引用推文里的 article 不算独立一条）。
 * ⛔ 旧版要按 testid 认：通知 / 关注推荐那些条目也是 article，混进来会让分组和锚定错位。
 */
export function tweets(scope: ParentNode | null = column()): HTMLElement[] {
  if (!scope) return [];
  const old = scope.querySelectorAll<HTMLElement>(`article${OLD_TWEET}`);
  if (old.length) return Array.from(old);
  return Array.from(scope.querySelectorAll<HTMLElement>('article')).filter(
    (a) => !a.parentElement?.closest('article'),
  );
}

/** 推文所属的格子 */
export function cellOf(art: HTMLElement): HTMLElement | null {
  return art.closest<HTMLElement>(OLD_CELL) ?? art.closest<HTMLElement>(NEW_CELL);
}

/** 头像。新版挂在 `data-post-avatar` 上，旧版是 Tweet-User-Avatar */
export function avatarOf(scope: ParentNode): HTMLElement | null {
  return scope.querySelector<HTMLElement>(OLD_AVATAR) ?? scope.querySelector<HTMLElement>(NEW_AVATAR);
}

/**
 * 左侧导航。旧版是 header[role=banner]，新版是 nav[aria-label="主要"]。
 * 注意新版的 nav 只是内层滚动区，它的外壳（宽 256 那层）还要再往上找。
 */
export function navRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(OLD_NAV) ?? document.querySelector<HTMLElement>('nav[aria-label="主要"]');
}

/** 里是否含有「一条推文」的实质内容。发帖面板判定用，宁可判宽也不能藏到推文 */
export function hasTweet(scope: ParentNode): boolean {
  return !!(
    scope.querySelector('article')
    || scope.querySelector('[data-testid="tweetText"]')
    || scope.querySelector(OLD_AVATAR)
    || scope.querySelector(NEW_AVATAR)
  );
}
