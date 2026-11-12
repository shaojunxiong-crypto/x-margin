import { loadSettings, onSettings, saveSettings, type Settings } from '../shared/settings';
import { initAnchor } from './anchor';
import { BackgroundLayer } from './bg/background';
import { applyFlat, clearCardWrappers, reflowCards } from './feed';
import { injectFonts } from './fonts';
import { applyLayout, markComposer, markFloats, widenInner } from './layout';
import { createPanel, type PanelApi } from './panel';
import { applyRail, railItems } from './rail';
import { initShot } from './shot';
import { injectBase } from './styles';
import { applyTheme, enforceTheme, onSystemThemeChange, reloadForTheme, resolveTheme } from './theme';
import { applyAccent, applyFont, applySkin, detectTheme, type Theme } from './theming';

/** 首次开启图标栏时保留的图标个数（含顶部的 X logo） */
const RAIL_KEEP = 5;
/** 预置版本：2 起把 role=button 型导航项也纳入裁剪 */
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

/** 按当前设置把背景、换肤、字体、布局一次性对齐 */
function sync(): void {
  const s = settings;
  if (!bg) return;
  // 跟随系统时用 X 实际渲染色兜底，cookie 没生效也不会错配
  theme = resolveTheme(s.theme, detectTheme());
  applyAccent(s.accent);
  applySkin(theme, s.bg.mode !== 'off', s.bg.glass, s.softText, s.layout.cardFeed);
  applyFont(s.font.choice, s.font.custom);
  applyLayout(s.layout);
  clearCardWrappers(s.layout.cardFeed);
  // 等一帧让 CSS 生效后再量高度
  requestAnimationFrame(() => reflowCards());
  applyFlat(true);
  applyRail(s.layout.railNav, theme, s.layout.railHide, s.layout.hideCompose);
  markComposer(s.layout.hideCompose);
  // 齿轮按钮跟着图标栏在「栏内」与「浮动球」之间搬
  if (ui) ui.place(s.layout.railNav && document.documentElement.classList.contains('xm-rail'));
  void bg.apply(s.bg, theme);
}

/**
 * 首次启用图标栏时给 railHide 灌默认值：保留前 RAIL_KEEP 项，其余收起。
 * 与已有设置合并，用户手动勾过的项不会被重置。
 */
async function seedRail(): Promise<void> {
  if (!settings.layout.railNav || settings.layout.railSeedV >= RAIL_SEED_V) return;
  // X logo 在 h1 里、不在 nav 内时，nav 侧只需保留 4 项
  const logoInNav = !!document.querySelector<HTMLElement>('header[role="banner"] nav a[href="/"]');
  const keep = logoInNav ? RAIL_KEEP : RAIL_KEEP - 1;
  for (let i = 0; i < 24; i++) {
    const items = railItems();
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

/** X 改主题 / 重建节点都会冲掉我们刷过的东西，这里按心跳补扫（全部幂等） */
function watch(bindWide: () => void): void {
  let lastThemeCheck = 0;
  let lastWideCheck = 0;
  let lastWideBind = 0;
  let lastReflow = 0;
  const tick = () => {
    const now = performance.now();
    if (now - lastThemeCheck > 1500) {
      lastThemeCheck = now;
      const t = resolveTheme(settings.theme, detectTheme());
      if (t !== theme) { theme = t; sync(); }
      // 祖先链被重建后内联底色会丢，重新刷一遍
      if (settings.bg.mode !== 'off') {
        const col = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]');
        if (col && col.parentElement && col.parentElement.style.backgroundColor !== 'transparent') {
          applySkin(theme, true, settings.bg.glass, settings.softText, settings.layout.cardFeed);
        }
      }
      clearCardWrappers(settings.layout.cardFeed);
      applyFlat(true);
      if (settings.layout.railNav) applyRail(true, theme, settings.layout.railHide, settings.layout.hideCompose);
      if (settings.layout.hideCompose && !document.querySelector('.xm-comp-hide')) markComposer(true);
      if (settings.layout.hideFloats) markFloats(true);
      // X 重渲染 nav 会把齿轮一起清掉
      ui?.place(settings.layout.railNav);
    }
    // 图片加载完会改 cell 高度，重排要跟得上，否则下面几条会叠住
    if (settings.layout.cardFeed && now - lastReflow > 500) {
      lastReflow = now;
      reflowCards();
    }
    // 主栏被整体换掉时观察器会失效，这里定期验连接性；补扫交给 MutationObserver
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
  // 主题写在 X 自己的 night_mode 里，值有变才需要整页重载
  if (enforceTheme(settings.theme)) reloadForTheme();

  const panel = createPanel({
    settings: () => settings,
    update: async (patch) => {
      const themeChanged = patch.theme !== undefined && patch.theme !== settings.theme;
      settings = { ...settings, ...patch };
      sync();
      await saveSettings(patch);
      // 主题不是画上去的，且页面配色不会因 cookie 变化自己重算 —— 一律重载
      if (themeChanged) applyTheme(settings.theme);
    },
  });
  ui = panel;
  document.body.append(panel.root);
  initShot();

  onSettings((next) => { settings = next; sync(); });
  onSystemThemeChange(() => {
    sync();
    if (settings.theme === 'auto') applyTheme('auto');
  });

  // 滚动 / 缩放时 X 会插入新 cell 并写死 translateY，rAF 合并后立刻重排
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

  // ---- 加宽层补扫 ----
  // 主栏内部一重建，那几层 600px 的 max-width 就回来了；盯 childList 比定时轮询快得多。
  let wideTimer = 0;
  let wideDue = 0;
  let wideCol: HTMLElement | null = null;
  let wideMo: MutationObserver | null = null;
  const queueWide = (delay = 60): void => {
    if (settings.layout.feedWidth === 600) return;
    const due = performance.now() + delay;
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
  // popstate 早于 X 挂新 DOM：先挂观察器，再立刻补一次
  addEventListener('popstate', () => { bindWide(); queueWide(0); });
  addEventListener('pageshow', () => { bindWide(); queueWide(0); });

  initAnchor();

  // X 在 hover 后会换掉图片 / 引用卡的包装层，且替换发生在事件之后，
  // 必须推迟一拍再扫，否则扫到的还是旧节点。
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
