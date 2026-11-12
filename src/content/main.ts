import { loadSettings, onSettings, saveSettings, type Settings } from '../shared/settings';
import { initAnchor } from './anchor';
import { BackgroundLayer } from './bg/background';
import { applyFlat, clearCardWrappers, reflowCards, resetReflowBase, resetThreadSig } from './feed';
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
  resetThreadSig();
  resetReflowBase();
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

/**
 * X 改主题 / 重建节点都会冲掉我们刷过的东西。
 * 补扫改成事件驱动：只在主栏被换掉、或主栏内有结构变动时才跑，
 * 不再按秒全量重来 —— 逐条量几何是整轮最贵的一段，单条推文就上百个节点。
 */
function watch(bindWide: () => void): void {
  let lastThemeCheck = 0;
  let lastWideCheck = 0;
  let lastWideBind = 0;
  let scanTimer = 0;
  let reflowDue = false;
  let feedMo: MutationObserver | null = null;
  let moCol: HTMLElement | null = null;

  const queueReflow = (): void => { reflowDue = true; };

  /** 结构变动后的补扫，150ms 合并（X 会连着插好几条 cell） */
  const scan = (): void => {
    if (scanTimer) return;
    scanTimer = window.setTimeout(() => {
      scanTimer = 0;
      clearCardWrappers(settings.layout.cardFeed);
      applyFlat(true);
      if (settings.layout.railNav) applyRail(true, theme, settings.layout.railHide, settings.layout.hideCompose);
      if (settings.layout.hideCompose && !document.querySelector('.xm-comp-hide')) markComposer(true);
      if (settings.layout.hideFloats) markFloats(true);
      ui?.place(settings.layout.railNav);
      queueReflow();
    }, 150);
  };

  /** 主栏换成另一个节点 = 标记全部失效，缓存与签名一起清掉再重扫 */
  const rebind = (col: HTMLElement | null): void => {
    if (col === moCol) return;
    moCol = col;
    feedMo?.disconnect();
    feedMo = null;
    if (!col) return;
    resetThreadSig();
    resetReflowBase();
    feedMo = new MutationObserver(() => scan());
    feedMo.observe(col, { childList: true, subtree: true });
    scan();
  };

  // 图片解码完 / 字体就绪都会改高度，重排要跟得上，否则下面几条会叠住
  document.addEventListener('load', (e) => {
    if (e.target instanceof HTMLImageElement) queueReflow();
  }, true);
  void document.fonts?.ready.then(() => queueReflow());

  const tick = () => {
    const now = performance.now();
    // 心跳只留最便宜的两件事：主题、齿轮有没有被冲掉
    if (now - lastThemeCheck > 1500) {
      lastThemeCheck = now;
      const t = resolveTheme(settings.theme, detectTheme());
      if (t !== theme) { theme = t; sync(); }
      // 祖先链被重建后内联底色会丢，重新刷一遍
      if (settings.bg.mode !== 'off') {
        const col = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]');
        if (col && col.parentElement && col.parentElement.style.backgroundColor !== 'transparent') {
          applySkin(theme, true, settings.bg.glass, settings.softText, settings.layout.cardFeed);
          queueReflow();
        }
      }
      ui?.place(settings.layout.railNav);
    }
    // 主栏身份变化：一次 querySelector，代价可忽略
    if (now - lastWideBind > 300) {
      lastWideBind = now;
      rebind(document.querySelector<HTMLElement>('[data-testid="primaryColumn"]'));
      bindWide();
    }
    if (reflowDue && settings.layout.cardFeed) {
      reflowDue = false;
      reflowCards();
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
  addEventListener('resize', () => { resetThreadSig(); scheduleReflow(); }, { passive: true });

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
