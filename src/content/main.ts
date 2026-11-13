import { loadSettings, onSettings, saveSettings, type Settings } from '../shared/settings';
import { initAnchor } from './anchor';
import { BackgroundLayer } from './bg/background';
import { applyFlat, clearCardWrappers, reflowCards, resetReflowBase, resetThreadSig, setFeedFrozen } from './feed';
import { injectFonts } from './fonts';
import { applyLayout, markComposer, markFloats, widenInner } from './layout';
import { markPageHead } from './pageHead';
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

/**
 * 滚动窗口：滚动中、以及停滚后 220ms 内，所有「全量扫描」类工作一律让路。
 * 滚动时 X 的虚拟列表一直在摘/插 cell，按结构变动驱动扫描等于持续扫描。
 */
let scrollUntil = 0;
const isScrolling = (): boolean => performance.now() < scrollUntil;

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
  // 二级页页头（通知 / 历史），只在那些路由下动，切走会自动还回去
  markPageHead();
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
 *
 * ⛔ 但「有结构变动就跑」在滚动时等于持续跑：X 的虚拟列表一直在摘/插 cell，
 * 频率比定时器高一个量级。所以滚动期间一律冻结全量扫描，只留 reflowCards
 * （不跑就会叠住），停滚 220ms 后再补一次。
 */
function watch(bindWide: () => void, onUnfreeze: () => void): void {
  let lastThemeCheck = 0;
  let lastWideCheck = 0;
  let lastWideBind = 0;
  let scanTimer = 0;
  let reflowDue = false;
  let feedMo: MutationObserver | null = null;
  let moCol: HTMLElement | null = null;
  let unfreezeT = 0;
  let rafReflow = 0;

  const queueReflow = (): void => { reflowDue = true; };

  /** 滚动中每帧最多一次重排 —— X 刚插入的 cell 用的是它自己的高度，慢了会叠住 */
  const scheduleReflow = (): void => {
    if (rafReflow) return;
    rafReflow = requestAnimationFrame(() => {
      rafReflow = 0;
      if (settings.layout.cardFeed) reflowCards();
    });
  };

  /** 结构变动后的补扫，150ms 合并（X 会连着插好几条 cell） */
  const scan = (): void => {
    if (scanTimer) return;
    scanTimer = window.setTimeout(() => {
      scanTimer = 0;
      applyFlat(true);
      // 二级页页头会被 X 重建，跟着补一次（条目留白是 CSS，不在这里管）
      markPageHead();
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
    // 底板擦除只在换主栏时做一次：它要遍历每条 cell 的所有祖先、逐层读 position，
    // 放进 scan() 就是每次结构变动都重来一遍（滚动时每 150ms 一次）
    clearCardWrappers(settings.layout.cardFeed);
    feedMo = new MutationObserver(() => scan());
    feedMo.observe(col, { childList: true, subtree: true });
    scan();
  };

  // 滚动 / 滚轮 / 触摸：冻结全量扫描，并持续把解冻时间往后推
  const noteScroll = (): void => {
    scrollUntil = performance.now() + 220;
    setFeedFrozen(true);
    clearTimeout(unfreezeT);
    unfreezeT = window.setTimeout(() => {
      unfreezeT = 0;
      setFeedFrozen(false);
      // 解冻只放开线程分组；其余补扫在滚动中是照常跑的，不必再补
      onUnfreeze();
    }, 220);
  };
  addEventListener('scroll', () => { noteScroll(); scheduleReflow(); }, { passive: true, capture: true });
  addEventListener('wheel', noteScroll, { passive: true, capture: true });
  addEventListener('touchmove', noteScroll, { passive: true, capture: true });
  addEventListener('resize', () => {
    resetThreadSig();
    resetReflowBase();
    scheduleReflow();
  }, { passive: true });

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

  // ---- 加宽层补扫 ----
  // 主栏内部一重建，那几层 600px 的 max-width 就回来了；盯 childList 比定时轮询快得多。
  let wideTimer = 0;
  let wideDue = 0;
  let wideCol: HTMLElement | null = null;
  let wideMo: MutationObserver | null = null;
  const queueWide = (delay = 60): void => {
    if (settings.layout.feedWidth === 600) return;
    // 滚动中不做：加宽标记打在祖先链上，新 cell 会继承，停滚后补一次就够
    if (isScrolling()) return;
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

  // ⛔ 不再挂 pointerover / pointermove 去补扫。
  // 那是「按症状触发」：X 换包装是 DOM 结构变化，MutationObserver 本来就看得见；
  // 而且真正让圆角回来的不是鼠标，是 applyFlat 里按「子孙节点」做键的缓存 ——
  // 包装被换、子孙没变，缓存照样短路，鼠标动一百次也补不回来。缓存已去掉。

  watch(bindWide, () => queueWide(0));
  void seedRail();
}

void boot();
