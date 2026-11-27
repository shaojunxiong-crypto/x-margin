/**
 * 主世界（MAIN world）的视频自动播放拦截器。
 *
 * ⛔ 为什么必须单独一份：content script 跑在**隔离世界**，它有自己的
 *    `HTMLMediaElement.prototype`。在那边改 `play()` 对 X 的 React 代码毫无影响 ——
 *    这是 0.2.19 第一版的致命错误，判据再对也拦不住任何东西。
 *    只有 `chrome.scripting.executeScript({ world: 'MAIN' })` 注入的代码才和 X 同处一个上下文。
 *
 * 开关不读 chrome.storage（主世界没有 chrome API），读
 * `document.documentElement.dataset.xmNoAutoplay` —— content script 负责写，这里监听变化。
 *
 * 本文件用 `files:` 方式注入，不走 web_accessible_resources，因此不受页面 CSP 约束。
 *
 * ⛔ 判据是「这条 video 有没有拿到过用户手势」，不是一个全局时间窗：
 *    早期版本只记「2 秒内有过 pointerdown」，于是键盘 Space 起播、暂停 2 秒后恢复、
 *    X 切码率重调 play()、页面从后台回来重播，全被当成自动播放拒掉 ——
 *    现象是「点了没反应、再点才播」「看着看着自己停了」。
 *    现在：在 video 这一片里按过鼠标 / 键盘 ⇒ 这条 video 终身放行（WeakSet，元素回收即释放）。
 *    2 秒窗口仍保留，只用于「点了视频 → X 插入新的 player 元素 → 再调 play()」这类
 *    元素换了人、来不及打标记的链路。
 */

const GESTURE_MS = 2000;

let on = document.documentElement?.dataset.xmNoAutoplay !== '0';
let gestureAt = -1e9;
/** 用户动过手的 video：之后它怎么调 play() 都放行 */
const granted = new WeakSet<HTMLVideoElement>();

const isGif = (v: HTMLVideoElement): boolean => v.loop === true;
const recentGesture = (): boolean => performance.now() - gestureAt <= GESTURE_MS;

/** 把一棵子树里的 video 全部放行 */
function grantAll(root: Element): void {
  if (root instanceof HTMLVideoElement) granted.add(root);
  for (const v of root.querySelectorAll<HTMLVideoElement>('video')) granted.add(v);
}

/**
 * 落点（或焦点）所在的这一小片里所有 video 都算「用户要它播」。
 * 向上 6 层：X 的播放按钮是贴在视频上的浮层，从 SVG 图标到含 video 的容器要穿好几层。
 */
function grantAround(t: EventTarget | null): void {
  if (!(t instanceof Element)) return;
  const v = t.closest('video');
  if (v) granted.add(v as HTMLVideoElement);
  let el: Element | null = t;
  for (let i = 0; i < 6 && el; i++) {
    if (el instanceof HTMLVideoElement || el.querySelector('video')) grantAll(el);
    el = el.parentElement;
  }
}

/**
 * 点在视频区里吗？判据三条，从准到糙：
 *   ① 落点直接是 video 或它的后代；
 *   ② 落点在某条 video 的**包围盒**内 —— X 的播放按钮是贴在视频上的浮层，
 *      实测从 SVG 图标往上要穿 7 层才碰到含 video 的容器，靠层级一定漏；
 *   ③ 兜底：往上 6 层里子树含 video（窄内容，避免把「点推文任意位置」也算进来）。
 */
function inVideoZone(t: EventTarget | null, x: number, y: number): boolean {
  if (!(t instanceof Element)) return false;
  if (t.closest('video')) return true;
  if (t.closest('[data-testid="videoPlayer"],[data-testid="videoComponent"]')) return true;
  for (const v of document.querySelectorAll('video')) {
    const r = v.getBoundingClientRect();
    if (r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  let el: Element | null = t;
  for (let i = 0; i < 6 && el; i++) {
    if (el.querySelector('video')) return true;
    el = el.parentElement;
  }
  return false;
}

/** 指针手势：层级判 + 包围盒判，两边命中的 video 一起放行 */
function grantAtPointer(t: EventTarget | null, x: number, y: number): void {
  grantAround(t);
  for (const v of document.querySelectorAll<HTMLVideoElement>('video')) {
    const r = v.getBoundingClientRect();
    if (r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) granted.add(v);
  }
}

function syncOn(): void {
  on = document.documentElement?.dataset.xmNoAutoplay !== '0';
}

if (!(window as unknown as Record<string, unknown>).__xmNoAutoplay) {
  (window as unknown as Record<string, unknown>).__xmNoAutoplay = true;

  const orig = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement): Promise<void> {
    if (
      on &&
      this instanceof HTMLVideoElement &&
      !isGif(this) &&
      !granted.has(this) &&
      !recentGesture()
    ) {
      // 模拟浏览器自动播放策略：X 本来就处理 NotAllowedError，会停在首帧、显示播放键。
      // resolve 反而会让它以为在播（UI 显示暂停键，用户点一下变成暂停），更别扭。
      return Promise.reject(new DOMException('Autoplay disabled by X MARGIN', 'NotAllowedError'));
    }
    return orig.call(this);
  };

  // 兜底一：靠 autoplay 属性起播不经过 play()。play 不冒泡，但捕获阶段能收到。
  window.addEventListener(
    'play',
    (ev) => {
      const v = ev.target;
      if (!on || !(v instanceof HTMLVideoElement) || isGif(v)) return;
      if (granted.has(v) || recentGesture()) return;
      v.pause();
    },
    true,
  );

  // 兜底二：新插入的 video 摘掉 autoplay，免得「亮一帧再停」
  // 顺带：刚点过视频时插入的 player 直接放行 —— 这就是「点封面 → 弹层里新建 video」那条链路，
  // 等它调 play() 时往往已经过了 2 秒窗口，不打这个标记就会被误拒。
  const strip = (n: Element): void => {
    if (n instanceof HTMLVideoElement) {
      n.autoplay = false;
      if (recentGesture()) granted.add(n);
      return;
    }
    for (const v of n.querySelectorAll<HTMLVideoElement>('video')) {
      v.autoplay = false;
      if (recentGesture()) granted.add(v);
    }
  };
  const mo = new MutationObserver((recs) => {
    if (!on) return;
    for (const r of recs) for (const n of r.addedNodes) if (n instanceof Element) strip(n);
  });
  const start = (): void => {
    mo.observe(document.documentElement, { childList: true, subtree: true });
    // 开关由 content script 写在 dataset 上
    new MutationObserver(syncOn).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-xm-no-autoplay'],
    });
    syncOn();
  };
  if (document.documentElement) start();
  else window.addEventListener('DOMContentLoaded', start, { once: true });

  // 手势放行：点在视频或它的播放控件上，说明是用户要看
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!on || !inVideoZone(e.target, e.clientX, e.clientY)) return;
      gestureAt = performance.now();
      grantAtPointer(e.target, e.clientX, e.clientY);
    },
    true,
  );
  // 键盘起播（Space / Enter 落在播放器上）走的是同一套意图，只是没有坐标。
  // ⛔ 不按「视口里的 video 全放行」处理：那会把「按空格翻页」当成播放指令。
  document.addEventListener(
    'keydown',
    (e) => {
      if (!on || (e.key !== ' ' && e.key !== 'Enter' && e.key !== 'k' && e.key !== 'K')) return;
      const a = document.activeElement;
      if (!(a instanceof Element)) return;
      if (!a.closest('video') && !a.querySelector('video') && !a.closest('[data-testid="videoPlayer"],[data-testid="videoComponent"]')) {
        return;
      }
      gestureAt = performance.now();
      grantAround(a);
    },
    true,
  );
} else {
  syncOn();
}
