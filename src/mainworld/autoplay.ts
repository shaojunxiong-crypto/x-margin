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
 */

const GESTURE_MS = 2000;

let on = document.documentElement?.dataset.xmNoAutoplay !== '0';
let gestureAt = -1e9;

function inVideoZone(t: EventTarget | null): boolean {
  if (!(t instanceof Element)) return false;
  if (t.closest('video')) return true;
  if (t.closest('[data-testid="videoPlayer"],[data-testid="videoComponent"]')) return true;
  // 播放按钮多是贴在 video 之上的兄弟层，不是它的后代：往上找「子树里有 video」的容器
  let el: Element | null = t;
  for (let i = 0; i < 6 && el; i++) {
    if (el.querySelector('video')) return true;
    el = el.parentElement;
  }
  return false;
}

const isGif = (v: HTMLVideoElement): boolean => v.loop === true;

function syncOn(): void {
  on = document.documentElement?.dataset.xmNoAutoplay !== '0';
}

if (!(window as unknown as Record<string, unknown>).__xmNoAutoplay) {
  (window as unknown as Record<string, unknown>).__xmNoAutoplay = true;

  const orig = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement): Promise<void> {
    if (on && this instanceof HTMLVideoElement && !isGif(this) && performance.now() - gestureAt > GESTURE_MS) {
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
      if (performance.now() - gestureAt <= GESTURE_MS) return;
      v.pause();
    },
    true,
  );

  // 兜底二：新插入的 video 摘掉 autoplay，免得「亮一帧再停」
  const strip = (n: Element): void => {
    if (n instanceof HTMLVideoElement) {
      n.autoplay = false;
      return;
    }
    for (const v of n.querySelectorAll<HTMLVideoElement>('video[autoplay]')) v.autoplay = false;
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
      if (on && inVideoZone(e.target)) gestureAt = performance.now();
    },
    true,
  );
} else {
  syncOn();
}
