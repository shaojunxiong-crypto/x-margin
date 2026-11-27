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
 *
 * ⛔ 手势判据与主世界那份**必须一致**：按「这条 video 有没有拿到过用户手势」放行，
 *    不是「2 秒内有过点击」。只按时间窗会在键盘 Space、暂停后恢复、切码率时误停，
 *    而这条兜底一旦误停，比拦不住更容易被当成 bug 报上来。
 */

/** 用户刚在视频区动过手，这段时间内的起播一律放行（元素换了人也算） */
const GESTURE_MS = 2000;

let on = true;
let gestureAt = -1e9;
/** 用户动过手的 video：之后它的起播一律放行 */
const granted = new WeakSet<HTMLVideoElement>();
let asked = false;

const isGif = (v: HTMLVideoElement): boolean => v.loop === true;
const recentGesture = (): boolean => performance.now() - gestureAt <= GESTURE_MS;

function grantAll(root: Element): void {
  if (root instanceof HTMLVideoElement) granted.add(root);
  for (const v of root.querySelectorAll<HTMLVideoElement>('video')) granted.add(v);
}

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
 * 点在视频区里吗？与主世界那份保持一致：落点在 video 包围盒内即算。
 * 播放按钮是贴在视频上的浮层，从 SVG 图标往上要穿 7 层 DOM 才碰到含 video 的容器。
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

function grantAtPointer(t: EventTarget | null, x: number, y: number): void {
  grantAround(t);
  for (const v of document.querySelectorAll<HTMLVideoElement>('video')) {
    const r = v.getBoundingClientRect();
    if (r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) granted.add(v);
  }
}

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
      if (granted.has(v) || recentGesture()) return;
      v.pause();
    },
    true,
  );

  // 新插入的 video 摘掉 autoplay（改 DOM 属性跨 world 有效）
  // 刚点过视频时插入的 player 直接放行（点封面 → 弹层里新建 video 的链路）
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
  const observe = (): void => mo.observe(document.documentElement, { childList: true, subtree: true });
  if (document.documentElement) observe();
  else window.addEventListener('DOMContentLoaded', observe, { once: true });

  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!on || !inVideoZone(e.target, e.clientX, e.clientY)) return;
      gestureAt = performance.now();
      grantAtPointer(e.target, e.clientX, e.clientY);
    },
    true,
  );
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
}

installNoAutoplay();
