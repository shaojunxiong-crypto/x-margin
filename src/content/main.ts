import { BackgroundLayer } from './bg/background';
import { initAnchor } from './anchor';
import { injectFonts } from './fonts';
import { createPanel, type PanelApi } from './panel';
import { initShot } from './shot';
import { applyAccent, applyFlat, applyFont, applyLayout, applyRail, applySkin, clearCardWrappers, clearFloatWrappers, detectTheme, injectBase, markComposer, railItems, reflowCards, widenInner, type Theme } from './skin';
import { applyTheme, enforceTheme, onSystemThemeChange, reloadForTheme, resolveTheme } from './theme';
import { loadSettings, onSettings, saveSettings, type Settings } from '../shared/settings';

/** 首次开启图标栏时，竖列里保留的图标个数（视觉计数，含顶部的 X logo） */
const RAIL_KEEP = 5;
/** 预置版本：2 起把 role=button 型的导航项（More / Grok）也纳入裁剪 */
const RAIL_SEED_V = 2;

let bg: BackgroundLayer;
let settings: Settings;
let theme: Theme = 'dark';
let ui: PanelApi | null = null;

function ready(): Promise<void> {
  if (document.body) return Promise.resolve();
  return new Promise((resolve) => {
    const mo = new MutationObserver(() => {
      if (document.body) { mo.disconnect(); resolve(); }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  });
}

/** 按当前设置把「背景层 + 换肤 + 字体」一次性对齐 */
function sync(): void {
  const s = settings;
  if (!bg) return;
  // 明确选了白 / 黑就按选择来；跟随系统时用 X 实际渲染色兜底（cookie 没生效也不会错配）
  theme = resolveTheme(s.theme, detectTheme());
  const on = s.bg.mode !== 'off';
  applyAccent(s.accent);
  // 主栏要不要留底板：推文浮起 / 推文独立成块都不要
  const bareCol = s.layout.floatCards || s.layout.cardFeed;
  applySkin(theme, on, s.bg.glass, s.softText, bareCol);
  applyFont(s.font.choice, s.font.custom, s.font.scale);
  applyLayout(s.layout.hideSidebar, s.layout.feedWidth, s.layout.hideAds, s.layout.floatCards, s.layout.cardFeed);
  // 每条推文的祖先链上的底板逐层戳透（X 的底板可能不在同一层，CSS 写不到那么深）
  clearFloatWrappers(s.layout.floatCards);
  // 推文独立成块：时间线那几层底板逐层戳透（吸顶栏是主栏的兄弟，不会被碰到）
  clearCardWrappers(s.layout.cardFeed);
  // 卡片内部上下留白改过之后 cell 会变高，X 写死的 translateY 必须重排（等一帧让 CSS 先生效）
  requestAnimationFrame(() => reflowCards());
  // 推文之间的横线 + 引用卡片的圆角/描边：一起抹掉（靠 JS 认元素，CSS 只认自有 class）
  applyFlat(true);
  applyRail(s.layout.railNav, theme, s.layout.railHide, s.layout.hideCompose);
  // 发推面板：不发推的人整块收掉（和左侧发帖按钮同一个开关）
  markComposer(s.layout.hideCompose);
  // 图标栏开关会变：齿轮按钮跟着在「栏内」与「浮动球」之间搬
  if (ui) ui.place(s.layout.railNav && document.documentElement.classList.contains('xm-rail'));
  void bg.apply(s.bg, theme);
}

/**
 * 首次启用（或预置版本升级）时给 railHide 灌默认值：保留前 RAIL_KEEP 项，其余收起。
 * 与已有设置**合并**而不是覆盖，用户手动勾过的项不会因为升级被重置。
 */
async function seedRail(): Promise<void> {
  if (!settings.layout.railNav || settings.layout.railSeedV >= RAIL_SEED_V) return;
  // X logo 在 h1 里、不在 nav 内时，nav 侧只需保留 4 项，视觉上才是 5 个
  const logoInNav = !!document.querySelector<HTMLElement>('header[role="banner"] nav a[href="/"]');
  const keep = logoInNav ? RAIL_KEEP : RAIL_KEEP - 1;
  for (let i = 0; i < 24; i++) {
    const items = railItems();
    // 只要有「超出保留数」的项就可以预置；之前要求 keep+2，nav 侧只有 keep+1 项时永远等不到
    if (items.length > keep) {
      const merged = new Set(settings.layout.railHide);
      items.slice(keep).forEach((x) => merged.add(x.key));
      const layout = { ...settings.layout, railHide: [...merged].slice(0, 40), railSeedV: RAIL_SEED_V };
      settings = { ...settings, layout };
      await saveSettings({ layout });
      sync();
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** X 改主题 / 重新渲染都会换掉我们刷过的元素，这里兜底恢复 */
function watch(bindWide: () => void): void {
  let lastThemeCheck = 0;
  let lastWideCheck = 0;
  let lastWideBind = 0;
  let lastDeepCheck = 0;
  let lastReflow = 0;
  const tick = () => {
    const now = performance.now();
    if (now - lastThemeCheck > 1500) {
      lastThemeCheck = now;
      const t = resolveTheme(settings.theme, detectTheme());
      if (t !== theme) { theme = t; sync(); }
      // 祖先链被 X 重建后，内联底色会丢，重新刷一遍
      if (settings.bg.mode !== 'off') {
        const col = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]');
        if (col && col.parentElement && col.parentElement.style.backgroundColor !== 'transparent') applySkin(theme, true, settings.bg.glass, settings.softText, settings.layout.floatCards || settings.layout.cardFeed);
      }
      // 路由切换会重建 header 的父元素，补位的 padding 跟着丢，这里续上
      // 虚拟滚动新插入的 cell 与原节点重建都会带回底板，低频补扫即可；
      // 「整宽容器」全量扫描太贵，5 秒一次，浅扫每 1.5 秒
      const deep = now - lastDeepCheck > 5000;
      if (deep) lastDeepCheck = now;
      clearFloatWrappers(settings.layout.floatCards, deep);
      clearCardWrappers(settings.layout.cardFeed);
      // 虚拟滚动新插入的推文 / 引用卡片同样要处理（幂等，已有标记的不会重复计算样式）
      applyFlat(true);
      if (settings.layout.railNav) applyRail(true, theme, settings.layout.railHide, settings.layout.hideCompose);
      // 切标签页 / 路由跳转会重建发推面板，幂等补一次（有标记就不动 DOM）
      if (settings.layout.hideCompose && !document.querySelector('.xm-comp-hide')) markComposer(true);
      // X 重渲染 nav 时会把我们的齿轮按钮一起清掉，低频补挂回去（幂等）
      ui?.place(settings.layout.railNav);
    }
    // 重排节拍比换肤快得多：推文里的图片加载完会改 cell 高度，不跟上的话下面几条会叠住。
    // 遍历只读 offsetHeight + 行内 transform，没有异动时几乎零成本（幂等，差值 <0.5px 不写）。
    if (settings.layout.cardFeed && now - lastReflow > 500) {
      lastReflow = now;
      reflowCards();
    }
    // 加宽时新渲染出来的时间线容器可能又带回 600px 的 max-width。
    // 主栏被整个换掉时（回退 / 路由切换）观察器会失效，这里 300ms 验一次连接性，
    // 真正的补扫交给 MutationObserver，不再等这个 4 秒兜底（那 4 秒就是「先窄后宽」）。
    if (now - lastWideBind > 300) {
      lastWideBind = now;
      bindWide();
    }
    if (settings.layout.feedWidth !== 600 && now - lastWideCheck > 4000) {
      lastWideCheck = now;
      widenInner();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function boot(): Promise<void> {
  await ready();
  settings = await loadSettings();

  injectFonts();
  injectBase();

  bg = new BackgroundLayer();
  document.body.prepend(bg.el);
  addEventListener('xm:bg-image', () => bg.reloadImage());

  theme = resolveTheme(settings.theme, detectTheme());
  sync();
  // 主题要和 X 自己的外观开关对齐：写 night_mode，必要时刷一次页面
  if (enforceTheme(settings.theme)) reloadForTheme();

  const panel = createPanel({
    settings: () => settings,
    update: async (patch) => {
      const themeChanged = patch.theme !== undefined && patch.theme !== settings.theme;
      settings = { ...settings, ...patch };
      sync();
      await saveSettings(patch);
      // 主题不是画上去的：无条件写 cookie + 整页重载，让 X 从头读一遍重渲染。
      // 不做「值没变就不刷」的判断 —— 页面上的配色不会因为 cookie 变化自己重算。
      if (themeChanged) applyTheme(settings.theme);
    },
  });
  ui = panel;
  document.body.append(panel.root);
  // 推文右上角的截图按钮：自己带定时扫描，X 重渲染后会自动补挂
  initShot();

  onSettings((next) => { settings = next; sync(); });
  // 系统明暗变化：跟随系统模式下写新 cookie 并整页重载，X 才会跟着换
  onSystemThemeChange(() => {
    sync();
    if (settings.theme === 'auto') applyTheme('auto');
  });
  // 滚动 / 缩放时 X 会插入新 cell 并写它自己那套 translateY，rAF 合并后立刻重排，避免位移跳一下
  let rafReflow = 0;
  const scheduleReflow = (): void => {
    if (rafReflow) return;
    rafReflow = requestAnimationFrame(() => {
      rafReflow = 0;
      if (settings.layout.cardFeed) reflowCards();
    });
  };
  addEventListener('scroll', scheduleReflow, { passive: true, capture: true });
  addEventListener('resize', scheduleReflow, { passive: true });

  // ---- 加宽层的即时补扫 ----
  // 主栏内部一重建，那几层 600px 的 max-width 就又回来了。旧实现靠 4 秒轮询，
  // 回退时会先看到一眼「窄推流」，等宽度补齐时正文重折行、位置也丢了。
  // 改成：盯着主栏子树的 childList，重建后 60ms 内补扫；popstate 先于渲染，先挂观察器再补。
  let wideTimer = 0;
  let wideDue = 0;
  let wideCol: HTMLElement | null = null;
  let wideMo: MutationObserver | null = null;
  const queueWide = (delay = 60): void => {
    if (settings.layout.feedWidth === 600) return;
    const due = performance.now() + delay;
    // 已经有一次更早的排着就不重复排；否则换成这次（更早的会覆盖更晚的）
    if (wideTimer && wideDue <= due) return;
    clearTimeout(wideTimer);
    wideDue = due;
    wideTimer = window.setTimeout(() => {
      wideTimer = 0;
      widenInner();
    }, delay);
  };
  const bindWide = (): void => {
    const col = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]');
    if (!col) return;
    if (col === wideCol && col.isConnected) return;
    wideMo?.disconnect();
    wideCol = col;
    wideMo = new MutationObserver(() => queueWide());
    wideMo.observe(col, { childList: true, subtree: true });
    queueWide(0);
  };
  // 回退 / 前进：popstate 早于 X 把新 DOM 挂上，所以这里做的是「挂观察器 + 立刻补一次」，
  // 真正吃到新节点的是观察器回调。
  addEventListener('popstate', () => { bindWide(); queueWide(0); });
  addEventListener('pageshow', () => { bindWide(); queueWide(0); });

  // 回退后的位置锚定（详见 anchor.ts）
  initAnchor();

  // 鼠标扫过推文时，X 会换掉图片 / 引用卡的包装层（新节点没有我们的标记），
  // 等 1.5 秒的定时补扫太慢，看起来就是「跟着鼠标来回切」。
  // 注意不能在事件里同步补：X 的替换发生在 pointerover / mouseenter 之后，
  // 同步跑只会扫到还没被换掉的旧节点（实测第二次 hover 就漏）。所以推迟 140ms 再扫，
  // pointermove 也挂上 —— 重建后再动一下鼠标就能兜住。
  let hoverTimer = 0;
  const queueFlat = (): void => {
    if (hoverTimer) return;
    hoverTimer = window.setTimeout(() => { hoverTimer = 0; applyFlat(true); }, 140);
  };
  addEventListener('pointerover', queueFlat, { passive: true });
  addEventListener('pointermove', queueFlat, { passive: true });

  watch(bindWide);
  void seedRail();
}

void boot();
