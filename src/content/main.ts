import { loadSettings, onSettings, saveSettings, type Settings } from '../shared/settings';
import { initAnchor } from './anchor';
import { BackgroundLayer } from './bg/background';
import { applyFlat, clearCardWrappers, reflowCards, resetReflowBase, resetThreadSig, setFeedFrozen } from './feed';
import { injectFonts } from './fonts';
import { applyLayout, markComposer, markFloats, syncWidthVar, widenInner } from './layout';
import { markPageHead } from './pageHead';
import { killPill } from './pill';
import { createPanel, type PanelApi } from './panel';
import { applyRail, railItems } from './rail';
import { column, navRoot } from './sel';
import { initShot } from './shot';
import { initStage } from './stage';
import { injectBase } from './styles';
import { applyTheme, enforceTheme, onSystemThemeChange, reloadForTheme, resolveTheme } from './theme';
import { applyAccent, applyFont, applySkin, detectTheme, type Theme } from './theming';

/** 首次开启图标栏时保留的图标个数（含顶部的 X logo） */
const RAIL_KEEP = 5;
/**
 * 预置版本。2 起把 role=button 型导航项也纳入裁剪；
 * 3 起按**新版的 href 键**重灌一次 —— 旧版键是 testid（`t:SideNav_...`），
 * 在新版一个都匹配不上，表现就是「隐藏项全失效、12 个按钮全露着」。
 * 4 修 3 的时序 bug：3 跑在 boot 早期，nav 只渲染出 3 项就满足 `items.length > keep`
 * 直接结算了，结果只藏了 3 项。
 * 5 再修一次：4 只要求「≥6 项」，实测 8 项时就结算了（漏掉「更多」等后渲染的项）。
 * 现在要求连续 3 轮项数不变。
 */
const RAIL_SEED_V = 5;

let bg: BackgroundLayer;
let settings: Settings;
let theme: Theme = 'dark';
let ui: PanelApi | null = null;

/**
 * 把异常留在 html 的 dataset 上。
 * 扩展在隔离世界跑，控制台默认不在这儿，用户报「失效」时没有任何线索；
 * 留一行最短的错误摘要，排查时 `document.documentElement.dataset.xmErr` 直接读得到。
 */
function noteErr(where: string, e: unknown): void {
  const msg = e instanceof Error ? `${where}: ${e.message}` : `${where}: ${String(e)}`;
  document.documentElement.dataset.xmErr = msg.slice(0, 160);
  console.warn('[x-margin]', where, e);
}

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
  // 「显示 N 帖子」提示行：按文案认出来，交给样式表做成顶栏下沿的一条带
  killPill();
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
/** seedRail 是否在跑：tick 每 300ms 会来问一次，不挡住就会并发灌同一份默认值 */
let seeding = false;

async function seedRail(): Promise<void> {
  if (seeding) return;
  if (!settings.layout.railNav || settings.layout.railSeedV >= RAIL_SEED_V) return;
  // 新版没有 header，导航项在 nav[aria-label="主要"] 里 —— 两套都认，否则新版永远不灌默认值
  if (!document.querySelector('header[role="banner"]') && !document.querySelector('nav[aria-label="主要"]')) return;
  seeding = true;
  try {
    // X logo 在 h1 里、不在 nav 内时，nav 侧只需保留 4 项；新版侧栏没有 logo 项，按 5 项算
    const hasHeader = !!document.querySelector('header[role="banner"]');
    const logoInNav = !!navRoot()?.querySelector('a[href="/"]');
    const keep = !hasHeader || logoInNav ? RAIL_KEEP : RAIL_KEEP - 1;
    /** 一栏完整的导航至少有这么多项；少了说明 nav 还在渲染，这时候结算会把没渲染的项当不存在 */
    const MIN_ITEMS = 6;
    /** 项数连续这么多轮不变才认「已经渲染完」—— 曾按「够 5 项就结算」写过，结果只藏了一半 */
    const STABLE_ROUNDS = 3;
    let prevLen = -1;
    let stable = 0;
    for (let i = 0; i < 24; i++) {
      const items = railItems();
      if (items.length >= MIN_ITEMS && items.length > keep) {
        if (items.length === prevLen) stable += 1;
        else { prevLen = items.length; stable = 1; }
        if (stable >= STABLE_ROUNDS) {
          const merged = new Set(settings.layout.railHide);
          items.slice(keep).forEach((x) => merged.add(x.key));
          const layout = { ...settings.layout, railHide: [...merged].slice(0, 40), railSeedV: RAIL_SEED_V };
          settings = { ...settings, layout };
          await saveSettings({ layout });
          sync();
          return;
        }
      } else {
        prevLen = -1;
        stable = 0;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  } finally {
    seeding = false;
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
      killPill();
      if (settings.layout.railNav) applyRail(true, theme, settings.layout.railHide, settings.layout.hideCompose);
      // ⛔ 每轮都要重判：详情页主帖的 article 常晚于面板出现，跳过重判会让误藏的主帖
      // 永久锁在 display:none 里（v0.1.91 修）。
      // 但函数内部是「算完再和上一轮比对、只变时才切 class」，不是每轮摘了重打 ——
      // 那样遇到限频提前返回时 class 已被摘掉的空档，面板就每 400ms 闪一次（v0.1.92 修）。
      if (settings.layout.hideCompose) markComposer(true);
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

  /**
   * 心跳本体。
   * ⛔ 外层必须包 try/catch：这里挂的是各模块的「补扫」，任何一处抛异常都会让
   *    requestAnimationFrame 链断掉，此后布局、加宽、图标栏、主题**全部永久停摆** ——
   *    现象是「刷新后偶尔好使、偶尔整页裸奔」，极难归因（2026-11-24 修）。
   */
  const tickBody = () => {
    const now = performance.now();
    // 心跳只留最便宜的两件事：主题、齿轮有没有被冲掉
    if (now - lastThemeCheck > 1500) {
      lastThemeCheck = now;
      const t = resolveTheme(settings.theme, detectTheme());
      if (t !== theme) { theme = t; sync(); }
      // 祖先链被重建后内联底色会丢，重新刷一遍
      if (settings.bg.mode !== 'off') {
        const col = column();
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
      rebind(column());
      bindWide();
      // 提示行的显隐往往只改 display / transform，不产生 childList 变动，
      // 观察器看不到；300ms 一次的这条路是它的兜底。
      killPill();
      // 图标栏同理且更要紧：boot 时 nav 往往还没渲染，applyRail 当场落空就再也没有第二次机会
      // （scan 只跟主栏 childList 走，页面静止后不再触发）。实测表现就是「折叠没发生、
      // 栏里 12 个按钮一个没藏、齿轮留在栏外」（2026-11-24 修）。
      // 内部全是值比较，稳态零写入。
      if (settings.layout.railNav) {
        applyRail(true, theme, settings.layout.railHide, settings.layout.hideCompose);
        // 默认隐藏清单没灌成过（railSeedV 落后）就继续试：boot 那一趟往往赶在 nav 渲染之前，
        // 一次失败就再也不会重试，而旧版 testid 键在新版一个都匹配不上 ⇒ 整栏按钮全露着。
        if (settings.layout.railSeedV < RAIL_SEED_V) void seedRail();
      }
    }
    if (reflowDue && settings.layout.cardFeed) {
      reflowDue = false;
      reflowCards();
    }
    if (settings.layout.feedWidth !== 600 && now - lastWideCheck > 4000) {
      lastWideCheck = now;
      // 新版宽度靠 --x-main-column-width 喂 grid 轨道，而 X 重建主栏外壳时会把内联变量一起冲掉
      // （路由切换、首屏渲染完成）。sync() 只在启动与改设置时跑 ⇒ 那时设置里是 840、
      // 主栏却回到 600，要等下次动设置才复位。这里补一次，两处都带值比较，稳态零写入。
      if (!syncWidthVar(settings.layout.feedWidth)) widenInner();
    }
  };

  const tick = () => {
    try {
      tickBody();
    } catch (e) {
      // 单帧失败不能让心跳链断掉：记一笔、继续排下一帧
      noteErr('tick', e);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // 后台标签页 / 最小化窗口里 rAF 会被浏览器暂停，心跳整套停摆 ——
  // 切回前台时先补一帧，别让用户看到「刚回来那一瞬」还是 12 个按钮全露着的样子。
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    try { tickBody(); } catch (e) { noteErr('resume', e); }
  });
}

async function boot(): Promise<void> {
  await ready();
  settings = await loadSettings();

  injectFonts();
  injectBase();
  // 幕布要赶在任何 popstate 之前挂好（也赶在整页回退的首帧之前），所以紧跟样式表
  initStage();

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
    const col = column();
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

void boot().catch((e) => noteErr('boot', e));
