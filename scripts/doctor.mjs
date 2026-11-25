#!/usr/bin/env node
/**
 * X MARGIN 体检 —— 一条命令查「功能是不是坏了」。
 *
 *   npm run doctor
 *
 * 设计取舍：
 *   ① **零依赖**。不引 playwright，只用 Node 内置 fetch + WebSocket 直连 CDP，
 *      在别人的机器上也能跑（本项目没有 playwright 作为依赖）。
 *   ② **不重复页面内探针**，而是把它的结论（`html.dataset.xmProbe`）当输入之一，
 *      再加一层「页面内探针看不见、但主人一眼能看见」的几何断言：
 *      主栏宽度、卡片间隙是否一致、详情页横条是否真的没了、回复框有没有按开关收放……
 *   ③ **抓抖动**，不只抓「当下对不对」。0.2.17 那个 bug 是每 3 秒翻转一次，
 *      单次采样必定误判「正常」——所以每条路由采样 6 次看是否来回跳。
 *   ④ 只读。不改 DOM、不改样式、不改设置；只开关自己新建的标签页。
 *
 * 前置：浏览器要以调试端口启动。
 *   夸克/Chrome 加 `--remote-debugging-port=9222`，并在里面登录 x.com。
 *
 * 退出码：0 全部通过；1 有异常；2 连不上浏览器。
 */

const PORT = process.env.XM_DOCTOR_PORT || process.env.XM_CDP_PORT || 9222;
const BASE = `http://127.0.0.1:${PORT}`;
const TIMEOUT_NAV = 20000;
/** 探针 3 秒一轮，首屏渲染慢时要给够；实测连续巡检偶发 20 秒才写出 */
const TIMEOUT_PROBE = 25000;
/** 采 10 帧、每帧 350ms ≈ 3.2 秒：够覆盖一个 3 秒周期的翻转 */
const SAMPLES = 10;
const SAMPLE_GAP = 350;
/** 页面正文低于这个字数，视为 X 没渲染出内容（限流 / 登录墙 / 网络），整页跳过不报红 */
const MIN_BODY = 500;

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const useColor = process.stdout.isTTY;
const paint = (c, s) => (useColor ? c + s + C.reset : s);

/** 页面内探针的 id → 中文名 / 症状。与 src/content/probes.ts 保持一致 */
const PROBE_META = {
  'R1-1': ['主栏', '整页像没装扩展（版式、卡片、主题全失效）'],
  'R1-2': ['右栏', '去右栏失效，右侧搜索/推荐栏回来了，主栏不再居中'],
  'R1-3': ['左导航', '图标栏失效：栏没折叠、文字回来了、齿轮位置偏掉'],
  'R2-1': ['时间线格子', '卡片化失效：推文连成一片、没有缝隙、裁切全乱'],
  'R2-2': ['推文本体', '分组、补线、位置锚定一起失效（article 换成别的标签了）'],
  'R2-3': ['卡片裁切', '推文上下不裁了：间距变大、相邻卡片露出对方的边'],
  'R3-1': ['引用卡直角', '引用推文又变回圆角 + 浅色描边'],
  'R3-2': ['正文图直角', '推文图片 / 视频封面又变回圆角'],
  'R6-1': ['品牌色替换', '强调色失效：下划线、链接、按钮还是默认蓝'],
  'R8-1': ['状态链接', '回退后位置丢失、幕布迟迟不揭（锚定认不出推文 id）'],
};

/* ─────────────────────────── 极简 CDP 客户端 ─────────────────────────── */

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id == null) return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    });
    this.ws.addEventListener('close', () => {
      for (const [, p] of this.pending) p.reject(new Error('CDP 连接已断开'));
      this.pending.clear();
    });
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('CDP WebSocket 连接失败')), { once: true });
    });
    return new Cdp(ws);
  }

  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP 超时：${method}`));
      }, 30000);
    });
  }

  /** 在页面主世界求值，返回 JSON 可序列化的结果 */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression: `(() => { ${expression} })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || '页面求值异常');
    }
    return r.result?.value;
  }

  close() { try { this.ws.close(); } catch { /* noop */ } }
}

async function cdpJson(path) {
  const r = await fetch(BASE + path, { method: 'PUT' });
  if (!r.ok) throw new Error(`CDP ${path} → HTTP ${r.status}`);
  return r.json();
}

async function openTab(url) {
  const t = await cdpJson(`/json/new?${encodeURIComponent(url)}`);
  return { id: t.id, wsUrl: t.webSocketDebuggerUrl };
}

async function closeTab(id) {
  try { await fetch(`${BASE}/json/close/${id}`); } catch { /* noop */ }
}

/* ─────────────────────────── 页面采集 ─────────────────────────── */

/**
 * 一次采样。全部只读。
 * 返回的每一项都可能为 null（该页没有这类东西），判定在 Node 侧做。
 */
const COLLECT = String.raw`
  const html = document.documentElement;
  const vis = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  };
  const cells = [...document.querySelectorAll('main li[data-index], main [data-testid="cellInnerDiv"]')]
    .filter((e) => e.getBoundingClientRect().height > 20);
  const main = document.querySelector('main');
  const aside = document.querySelector('aside, [data-testid="sidebarColumn"]');
  const nav = document.querySelector('nav[aria-label="主要"], header[role="banner"] nav, header[role="banner"]');

  // 卡片间隙：相邻两格之间露出来的空白。重叠记负数
  const gaps = [];
  for (let i = 1; i < Math.min(cells.length, 9); i++) {
    const a = cells[i - 1].getBoundingClientRect();
    const b = cells[i].getBoundingClientRect();
    gaps.push(Math.round((b.top - a.bottom) * 10) / 10);
  }

  // 可见的品牌蓝（与 R6 同口径：只数看得见的）
  const brandBlue = [...document.querySelectorAll('[style*="rgb(29, 155, 240)"],[style*="rgb(29,155,240)"]')]
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; }).length;

  const quotes = document.querySelector('a[href*="/quotes"]');
  const form = document.querySelector('main form');
  const detailHeader = document.querySelector('main div.sticky.top-0');

  return {
    injected: html.classList.contains('xm-skin'),
    err: html.dataset.xmErr || null,
    probe: html.dataset.xmProbe || null,
    cls: html.className,
    cardFeed: html.classList.contains('xm-card'),
    hideCompose: html.classList.contains('xm-hidecompose'),
    mainW: main ? Math.round(main.getBoundingClientRect().width) : null,
    mainH: main ? Math.round(main.getBoundingClientRect().height) : null,
    cells: cells.length,
    firstClip: cells[0] ? getComputedStyle(cells[0]).clipPath : null,
    gaps,
    asideVisible: aside ? vis(aside) : false,
    navW: nav ? Math.round(nav.getBoundingClientRect().width) : null,
    bgLayer: !!document.querySelector('.xm-bg'),
    brandBlue,
    quotesVisible: quotes ? quotes.getBoundingClientRect().height > 1 : false,
    quotesExists: !!quotes,
    replyVisible: form ? form.getBoundingClientRect().height > 1 : false,
    headerBorder: detailHeader ? getComputedStyle(detailHeader).borderBottomWidth : null,
    widthVar: (getComputedStyle(html).getPropertyValue('--x-main-column-width')
      || (main ? getComputedStyle(main).getPropertyValue('--x-main-column-width') : '') || '').trim() || null,
    url: location.pathname + location.search,
    title: (document.title || '').slice(0, 40),
    bodyLen: (document.body?.innerText || '').length,
  };
`;

async function waitFor(cdp, expression, timeout, interval = 300) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (await cdp.eval(expression)) return true; } catch { /* 导航中会抛，继续等 */ }
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}

/* ─────────────────────────── 断言 ─────────────────────────── */

/** @typedef {{id:string, name:string, state:'ok'|'fail'|'skip', got:string, symptom?:string}} Check */

function judge(samples, route) {
  /** @type {Check[]} */
  const out = [];
  const last = samples[samples.length - 1];
  const add = (id, name, ok, got, symptom) =>
    out.push({ id, name, state: ok === null ? 'skip' : ok ? 'ok' : 'fail', got, symptom });

  // 页面没渲染出内容（X 限流 / 登录墙 / 网络抖动）：这一页的所有断言都不成立，
  // 全部跳过并单独标一条。⛔ 绝不能让它顺着往下判「扩展坏了」——那是假警报。
  if (!last.bodyLen || last.bodyLen < MIN_BODY) {
    add('PAGE-1', '页面内容', null,
      `正文仅 ${last.bodyLen || 0} 字，X 没渲染出内容（限流 / 未登录 / 网络）`, '');
    return out;
  }

  // 0) 注入与错误
  add('EXT-1', '扩展注入', last.injected, last.injected ? 'html.xm-skin 在' : 'html 上没有任何 xm-* 类',
    '扩展没加载、被禁用，或这个站点没有授权');
  add('EXT-2', '运行时错误', last.err === null, last.err ?? '无',
    '看 html.dataset.xmErr / 控制台，扩展内部抛错了');

  // 1) 页面内探针的结论
  const probe = last.probe;
  if (probe === null) {
    add('PROBE', '页面内探针', false, '16 秒内没写出结果', '探针节拍没跑起来（isScrolling 卡住 / 主循环未启动）');
  } else if (probe === 'ok') {
    add('PROBE', '页面内探针', true, '全部通过');
  } else {
    for (const id of probe.split(',')) {
      const meta = PROBE_META[id] || [id, ''];
      add(id, meta[0], false, '页面内探针报错', meta[1]);
    }
  }

  // 2) 探针管不到的几何量
  add('LAY-1', '主栏宽度', last.mainW !== null && last.mainW >= 560,
    last.mainW === null ? '量不到 main' : `${last.mainW}px（变量 ${last.widthVar || '未写'}）`,
    '加宽失效或主栏被挤窄，版式会整体左偏');

  add('LAY-2', '右侧栏', !last.asideVisible, last.asideVisible ? '右栏还看得见' : '已隐藏',
    '去右栏失效，主栏不再居中');

  // 格子排布：卡片模式下格与格是「紧贴 + clip-path 裁出视觉缝」，所以这里只看
  // 有没有重叠或异常大洞，不看绝对值。真正的视觉缝隙由 CARD-2 的 clip 值代表。
  if (!last.cardFeed || last.cells < 3) {
    add('CARD-1', '格子排布', null, last.cardFeed ? `仅 ${last.cells} 格` : '非卡片模式', '');
  } else {
    const g = last.gaps;
    const worst = Math.max(...g.map(Math.abs));
    add('CARD-1', '格子排布', worst <= 2,
      `相邻偏移 ${g.slice(0, 5).join('/')}${g.length > 5 ? '…' : ''}（紧贴属正常，靠 clip 出缝）`,
      '格子重叠或错位：会出现叠压、双份内容');
  }

  if (!last.cardFeed) {
    add('CARD-2', '卡片裁切', null, '非卡片模式', '');
  } else if (last.cells === 0) {
    add('CARD-2', '卡片裁切', false, '一个格子都没有', 'X 换了结构，anchors 全落空');
  } else {
    add('CARD-2', '卡片裁切', last.firstClip && last.firstClip !== 'none',
      last.firstClip ?? '没有首格', '推文上下不裁：间距变大、相邻卡片互相露边');
  }

  add('LAY-3', '背景层', last.bgLayer, last.bgLayer ? '存在' : '没有 .xm-bg',
    '背景开启时这层是必需的，缺了就是整页纯色');

  // 3) 详情页专属
  const isDetail = route.kind === 'detail';
  if (isDetail) {
    add('DET-1', '相关/查看引用横条', last.quotesVisible === false,
      last.quotesExists ? (last.quotesVisible ? '还看得见' : '已去掉') : '本页没有这条横条',
      '0.2.17 要求整条去掉，露出说明判据又没命中');
    const expectHidden = last.hideCompose;
    add('DET-2', '详情页回复框',
      expectHidden ? !last.replyVisible : true,
      `${expectHidden ? '隐藏发推入口=开' : '隐藏发推入口=关'}，回复框${last.replyVisible ? '可见' : '已收'}`,
      '开关与画面不一致：要么该藏没藏，要么关了没还回来');
  }

  // 4) 抖动：只比较**后 4 次**采样。前两次常是首屏过渡 —— 例如详情页回复框
  //    先渲染出来、1.5 秒节拍才把它藏掉，那是正常收敛，不是抖动。
  const flip = (pick) => {
    const v = samples.slice(2).map(pick).filter((x) => x !== null);
    if (v.length < 2) return null;
    return new Set(v).size > 1 ? v.join(' → ') : null;
  };
  const flips = [
    ['STB-1', '主栏宽度', flip((s) => s.mainW)],
    ['STB-2', '格子数量', flip((s) => s.cells)],
    ['STB-3', '横条可见性', isDetail ? flip((s) => s.quotesVisible) : undefined],
    ['STB-4', '回复框可见性', isDetail ? flip((s) => s.replyVisible) : undefined],
  ];
  for (const [id, name, v] of flips) {
    if (v === undefined) { add(id, name + '抖动', null, '本页不适用', ''); continue; }
    add(id, name + '抖动', v === null, v === null ? `后段采样一致` : `来回变：${v}`,
      '有东西在周期性地改回来又藏起来，页面会闪');
  }

  // 自检：XM_DOCTOR_SELFTEST=1 时插一条必然失败的检查，
  // 用来确认红字、症状行与退出码这条通路本身是通的（别让"永远全绿"骗了自己）。
  if (process.env.XM_DOCTOR_SELFTEST) {
    add('SELF-1', '报错通路自检', false, '故意失败', '这条红是自检，不是真故障');
  }

  return out;
}

/* ─────────────────────────── 主流程 ─────────────────────────── */

async function resolveVersion() {
  try {
    const r = await fetch(BASE + '/json/version');
    return (await r.json()).Browser || 'unknown';
  } catch {
    return 'unknown';
  }
}

async function probeRoute(cdp, url) {
  await cdp.send('Page.navigate', { url });
  await waitFor(cdp, `return document.readyState === 'complete'`, TIMEOUT_NAV);
  // 等扩展注入 + 探针写出结论
  const ready = await waitFor(cdp, `return !!document.documentElement.dataset.xmProbe`, TIMEOUT_PROBE);
  if (!ready) {
    // 也可能真的没注入：再给一点时间，让 EXT-1 能报出来
    await new Promise((r) => setTimeout(r, 1200));
  } else {
    await new Promise((r) => setTimeout(r, 3500)); // 让 paintBrand / 1.5s 节拍 / reflow 都收敛
  }
  const samples = [];
  for (let i = 0; i < SAMPLES; i++) {
    try { samples.push(await cdp.eval(COLLECT)); } catch { /* skip 单次 */ }
    if (i < SAMPLES - 1) await new Promise((r) => setTimeout(r, SAMPLE_GAP));
  }
  if (!samples.length) throw new Error('采集失败：页面求值全部异常');
  return samples;
}

function printRoute(label, route, checks) {
  const fails = checks.filter((c) => c.state === 'fail');
  const skips = checks.filter((c) => c.state === 'skip');
  // 整页没渲染出内容：不算故障，用黄色提示，别让它混进「异常」计数
  if (checks.length === 1 && checks[0].id === 'PAGE-1') {
    console.log(`\n${paint(C.yellow, '– ' + label)} ${paint(C.dim, route)}`);
    console.log(`  ${paint(C.dim, '本页跳过：' + checks[0].got)}`);
    return { fails: 0, skips: 1, blocked: true };
  }
  const head = fails.length
    ? paint(C.red, `✗ ${label}`)
    : paint(C.green, `✓ ${label}`);
  console.log(`\n${head} ${paint(C.dim, route)}`);
  for (const c of checks) {
    if (c.state === 'skip') {
      console.log(`  ${paint(C.dim, '–')} ${c.id.padEnd(7)} ${c.name.padEnd(12, '　')} ${paint(C.dim, c.got)}`);
      continue;
    }
    if (c.state === 'ok') {
      console.log(`  ${paint(C.green, '✓')} ${c.id.padEnd(7)} ${c.name.padEnd(12, '　')} ${paint(C.dim, c.got)}`);
    } else {
      console.log(`  ${paint(C.red, '✗')} ${c.id.padEnd(7)} ${c.name.padEnd(12, '　')} ${paint(C.red, c.got)}`);
      if (c.symptom) console.log(`      ${paint(C.dim, '→ ' + c.symptom)}`);
    }
  }
  return { fails: fails.length, skips: skips.length };
}

async function main() {
  const started = new Date();
  let browser;
  try {
    browser = await resolveVersion();
  } catch {
    console.error(paint(C.red, `连不上浏览器调试端口 ${BASE}`));
    console.error('启动浏览器时加 --remote-debugging-port=9222，并确认里面已登录 x.com。');
    process.exit(2);
  }

  console.log(paint(C.bold, `X MARGIN 体检  ${started.toLocaleString('zh-CN')}`));
  console.log(paint(C.dim, `浏览器：${browser}　端口：${PORT}　只读检查，不改任何设置`));

  // 先用首页建标签页，再从里面找一条推文链接给详情页用
  let tab;
  try {
    tab = await openTab('https://x.com/home');
  } catch (e) {
    console.error(paint(C.red, `无法新建标签页：${e.message}`));
    process.exit(2);
  }
  const cdp = await Cdp.connect(tab.wsUrl);
  await cdp.send('Page.enable');

  const routes = [
    { kind: 'home', label: '首页', url: 'https://x.com/home' },
    { kind: 'search', label: '搜索', url: 'https://x.com/search?q=%E7%A7%91%E6%8A%80&src=typed_query&f=live' },
    { kind: 'notify', label: '通知', url: 'https://x.com/notifications' },
  ];

  let totalFail = 0;
  let totalSkip = 0;

  try {
    // 首页先跑，顺便拿详情页链接
    const first = await probeRoute(cdp, routes[0].url);
    const r0 = printRoute(routes[0].label, routes[0].url.replace('https://x.com', ''), judge(first, routes[0]));
    totalFail += r0.fails; totalSkip += r0.skips;

    const href = await cdp.eval(`
      const a = [...document.querySelectorAll('a[href*="/status/"]')]
        .map((x) => x.getAttribute('href'))
        .find((h) => h && /\\/status\\/\\d+$/.test(h));
      return a || null;
    `);

    // 指定帖子时优先用指定的：排查「某一条推文上失效」比随机抓一条可靠
    const override = process.env.XM_DOCTOR_DETAIL;
    if (override) {
      routes.push({
        kind: 'detail',
        label: '推文详情',
        url: /^https?:/.test(override) ? override : 'https://x.com' + (override.startsWith('/') ? override : '/' + override),
      });
    } else if (href) {
      routes.push({ kind: 'detail', label: '推文详情', url: 'https://x.com' + href });
    } else {
      console.log(paint(C.yellow, '\n– 首页没抓到推文链接，跳过详情页检查'));
      totalSkip += 1;
    }

    for (const route of routes.slice(1)) {
      // 路由之间歇一下：连续导航太快时 X 会慢半拍，容易误判成扩展没工作
      await new Promise((r) => setTimeout(r, 1500));
      const samples = await probeRoute(cdp, route.url);
      const r = printRoute(route.label, route.url.replace('https://x.com', '').slice(0, 60), judge(samples, route));
      totalFail += r.fails; totalSkip += r.skips;
    }
  } catch (e) {
    totalFail += 1;
    console.error(paint(C.red, `\n巡检中断：${e.message}`));
  } finally {
    cdp.close();
    await closeTab(tab.id);
  }

  console.log('');
  if (totalFail === 0) {
    console.log(paint(C.green, `全部通过${totalSkip ? `（${totalSkip} 项跳过）` : ''}`));
  } else {
    console.log(paint(C.red, `${totalFail} 项异常${totalSkip ? `，${totalSkip} 项跳过` : ''}`));
    console.log(paint(C.dim, '处置顺序见 docs/REGISTRY.md 第三节：先看症状索引，再按锚点稳定级换锚。'));
  }
  process.exit(totalFail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(paint(C.red, `体检脚本自身出错：${e.stack || e.message}`));
  process.exit(2);
});
