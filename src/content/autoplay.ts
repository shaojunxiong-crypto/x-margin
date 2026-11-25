/**
 * 禁止推文内视频自动播放（GIF 不动，照常循环）。这里是**隔离世界**那一半。
 *
 * ⛔ 真正拦 `play()` 的代码在 `src/mainworld/autoplay.ts`，用 chrome.scripting 注入主世界。
 *    在隔离世界改 `HTMLMediaElement.prototype.play` 完全无效：两个 world 各有一套原型，
 *    X 的 React 跑在主世界，看不见这边的补丁。第一版就是这么写错的。
 *
 * 这一半做三件事：
 *   ① 把开关写到 `html[data-xm-no-autoplay]`，主世界读它；
 *   ② 请求后台注入主世界脚本（页面每次加载一次）；
 *   ③ 留一条 `play` 事件兜底：万一注入失败（权限被撤、后台没醒），至少还能把画面停住。
 *      DOM 事件跨 world 共享，这条无论如何都生效，代价是会闪一下。
 */

/** 用户刚在视频上点过，这段时间内的起播一律放行 */
const GESTURE_MS = 2000;

let on = true;
let gestureAt = -1e9;
let asked = false;

function inVideoZone(t: EventTarget | null): boolean {
  if (!(t instanceof Element)) return false;
  if (t.closest('video')) return true;
  if (t.closest('[data-testid="videoPlayer"],[data-testid="videoComponent"]')) return true;
  let el: Element | null = t;
  for (let i = 0; i < 6 && el; i++) {
    if (el.querySelector('video')) return true;
    el = el.parentElement;
  }
  return false;
}

const isGif = (v: HTMLVideoElement): boolean => v.loop === true;

/** 开关；默认开（用户要的就是「禁止」） */
export function setNoAutoplay(v: boolean): void {
  on = v;
  const html = document.documentElement;
  if (html) html.dataset.xmNoAutoplay = v ? '1' : '0';
  // install 时那次若因后台还在启动而落空，这里补一次
  requestInject();
}

/**
 * 请求后台把主世界脚本注进来。
 * ⛔ 放在 install 时做而不是 sync 时：boot 要先 await 读设置，首屏视频可能已经开播。
 * 只请求一次；主世界靠 dataset 跟开关，切换不需要重新注入。
 */
function requestInject(): void {
  if (asked) return;
  asked = true;
  try {
    chrome.runtime.sendMessage({ type: 'xm:autoplay' }, () => {
      // 后台还在启动时这条会失败；把 asked 放开，sync 那次会再试
      if (chrome.runtime.lastError) asked = false;
    });
  } catch {
    asked = false;
  }
}

/** 在模块加载时立刻安装，不等 boot()：boot 要 await 读设置，首屏视频可能已经起播 */
export function installNoAutoplay(): void {
  // 尽早注入主世界；数据集里的开关值随后台 boot 补齐
  requestInject();
  // 兜底：autoplay 属性触发的起播不经过 play()。play 不冒泡，但捕获阶段能收到。
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

  // 新插入的 video 摘掉 autoplay（改 DOM 属性跨 world 有效）
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
  const observe = (): void => mo.observe(document.documentElement, { childList: true, subtree: true });
  if (document.documentElement) observe();
  else window.addEventListener('DOMContentLoaded', observe, { once: true });

  document.addEventListener(
    'pointerdown',
    (e) => {
      if (on && inVideoZone(e.target)) gestureAt = performance.now();
    },
    true,
  );
}

installNoAutoplay();
