/**
 * 需求探针 —— docs/REGISTRY.md 第六节的实现。
 *
 * 解决的问题：X 改版时样式照常注入、一条选择器都不命中，**控制台不报错**，
 * 只能等主人肉眼发现。15 次修补里没有一次是代码抛错，全是这种静默失效。
 *
 * 设计三原则（改之前先读 docs/REGISTRY.md 第六节）：
 *   ① 条件判据必须能「跳过」而不是「报红」：纯文字流没有图、时间线没有引用卡都正常；
 *   ② 只查「从有变 0」，不查样式美丑 —— 值对不对是主观的，锚点归零是客观的；
 *   ③ 全量扫描限频，且只做 querySelectorAll + computedStyle，不写任何样式。
 *
 * ⛔ 探针绝不改 DOM / 样式。它红了的处置方式在 docs/REGISTRY.md 第三节矩阵里。
 *
 * ⛔ **探针必须走 sel.ts 的兼容层，不许自己写锚点。** 2026-11-25 实测踩到：X 在部分
 *    路由/账号上跑的是**旧版结构**（`data-testid="cellInnerDiv"` + `article[data-testid="tweet"]`，
 *    新版 `li[data-index]` 为 0）。探针当时只写了新版选择器，于是功能明明正常、它却报红 ——
 *    一个会假警报的诊断比没有诊断更坏，因为它教会人忽略红色。
 */

import { cells, tweets } from './sel';

/** 探针需要知道的两个设置：卡片模式、强调色（其余判据与设置无关） */
export interface ProbeCtx {
  cardFeed: boolean;
  accent: string;
}

export type ProbeState = 'ok' | 'fail' | 'skip';

export interface Probe {
  id: string;
  /** 需求号，对应 docs/REGISTRY.md 第一节 */
  req: string;
  name: string;
  /** 展示用的短判据 */
  rule: string;
  /** 失效时主人会看到什么（面板与排查脚本都显示这句） */
  symptom: string;
  /** true = 正常；false = 异常；null = 本页不适用（跳过，不报警） */
  test: (ctx: ProbeCtx) => boolean | null;
  /**
   * 连续失败几轮才报红，默认 1。
   *
   * 给「值级」判据用：R6 查的是内联字面量颜色，X 新渲染出来的节点会先带品牌蓝，
   * 下一次心跳（≤1.5s）才被 paintBrand 改掉 —— 单轮采样必然偶发假红
   * （2026-11-25 实测首页：第 3 秒红、第 4.2 秒全绿）。结构级判据（锚点在不在）
   * 不会这样抖，保持 1 轮，抓得越快越好。
   */
  confirm?: number;
}

export interface ProbeResult extends Omit<Probe, 'test'> {
  state: ProbeState;
}

/** X 的默认品牌蓝。设置里用这个色时，R6 的替换是空操作，跳过不报 */
const X_BLUE = '#1d9bf0';

/** 元素自身的圆角是否「已经抹平」。只认元素本身，不往子节点走 —— 头像 9999px 不该被误判 */
function flat(el: Element): boolean {
  const r = parseFloat(getComputedStyle(el).borderRadius);
  return !Number.isFinite(r) || r <= 0.5;
}

/** 从起点沿祖先链往上找「带圆角的那一层」，到边界就停。返回第一个不平的层，全平则返回 null */
function roundAncestor(start: Element, stopAt: string, maxDepth = 6): Element | null {
  let el: Element | null = start.parentElement;
  for (let i = 0; i < maxDepth && el; i++) {
    if (!flat(el)) return el;
    if (el.matches(stopAt)) return null;
    el = el.parentElement;
  }
  return null;
}

export const PROBES: Probe[] = [
  {
    id: 'R1-1',
    req: 'R1',
    name: '主栏',
    rule: 'main 存在',
    symptom: '整页像没装扩展（版式、卡片、主题全失效）',
    test: () => document.querySelectorAll('main').length > 0,
  },
  {
    id: 'R1-2',
    req: 'R1',
    name: '右栏',
    rule: 'aside 或 sidebarColumn 存在',
    symptom: '去右栏失效，右侧搜索/推荐栏回来了，主栏不再居中',
    // 旧版右栏是 [data-testid="sidebarColumn"]；新版是 aside。两写是灰度期的必需
    test: () =>
      document.querySelectorAll('aside, [data-testid="sidebarColumn"]').length > 0,
  },
  {
    id: 'R1-3',
    req: 'R1',
    name: '左导航',
    rule: 'nav[aria-label] 或 header[role=banner]',
    symptom: '图标栏失效：栏没折叠、文字回来了、齿轮位置偏掉',
    test: () =>
      document.querySelectorAll('nav[aria-label="主要"], header[role="banner"]').length > 0,
  },
  {
    id: 'R2-1',
    req: 'R2',
    name: '时间线格子',
    rule: 'cells() 命中（cellInnerDiv / li[data-index]）',
    symptom: '卡片化失效：推文连成一片、没有缝隙、裁切全乱',
    // 走 cells()：旧版 cellInnerDiv、新版 li[data-index]，两套都会命中
    test: () => cells().length > 0,
  },
  {
    id: 'R2-2',
    req: 'R2',
    name: '推文本体',
    rule: 'tweets() 命中（article）',
    symptom: '分组、补线、位置锚定一起失效（article 换成别的标签了）',
    test: () => tweets().length > 0,
  },
  {
    id: 'R2-3',
    req: 'R2',
    name: '卡片裁切',
    rule: '首个格子 clip-path ≠ none',
    symptom: '推文上下不裁了：间距变大、相邻卡片露出对方的边',
    test: (ctx) => {
      if (!ctx.cardFeed) return null;
      const cell = cells()[0];
      if (!cell) return null;
      return getComputedStyle(cell).clipPath !== 'none';
    },
  },
  {
    id: 'R3-1',
    req: 'R3',
    name: '引用卡直角',
    rule: '嵌套 article / role=link 含 tweetText，圆角=0',
    symptom: '引用推文又变回圆角 + 浅色描边',
    test: () => {
      // 两套结构并存（README「引用卡片有两种结构」）：旧版嵌套 article、新版 div[role=link]。
      // 只认「含 tweetText 的 role=link」——媒体卡、外链卡也带 role=link，不能一并判。
      const nested = Array.from(document.querySelectorAll('main article article')).slice(0, 5);
      const linked = Array.from(document.querySelectorAll('main article div[role="link"]'))
        .filter((e) => e.querySelector('[data-testid="tweetText"]'))
        .slice(0, 5);
      if (!nested.length && !linked.length) return null; // 本页没有引用卡，跳过
      // 旧版圆角在包裹层上：从嵌套 article 往上走到外层 article，途经层都得平
      const okNested = nested.every((q) => flat(q) && roundAncestor(q, 'article') === null);
      return okNested && linked.every(flat);
    },
  },
  {
    id: 'R3-2',
    req: 'R3',
    name: '正文图直角',
    rule: 'pbs…/media 图的圆角容器 圆角=0',
    symptom: '推文图片 / 视频封面又变回圆角',
    test: () => {
      const imgs = Array.from(document.querySelectorAll('main img[src*="pbs.twimg.com/media"]')).slice(0, 6);
      if (!imgs.length) return null; // 纯文字流，跳过
      return imgs.every((img) => roundAncestor(img, 'article') === null);
    },
  },
  {
    id: 'R6-1',
    req: 'R6',
    name: '品牌色替换',
    rule: '设置色 ≠ X 蓝时，页面内 rgb(29,155,240) 为 0',
    symptom: '强调色失效：下划线、链接、按钮还是默认蓝',
    // 值级判据，会抖（见 Probe.confirm 注释）：要连续三轮（≈9s）都蓝才报
    confirm: 3,
    test: (ctx) => {
      if (ctx.accent.trim().toLowerCase() === X_BLUE) return null; // 用默认蓝时替换是空操作
      // 内联样式的写法两种都见过（有无空格），一起数。
      // ⛔ 只数「看得见」的：实测详情页有一个 0×0 的隐藏节点带着品牌色内联值（2026-11-25），
      //    不滤掉就是恒定假警报。
      const visible = [...document.querySelectorAll(
        '[style*="rgb(29, 155, 240)"],[style*="rgb(29,155,240)"]',
      )].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      });
      // 旧版走的是 class 覆盖（text-brand / bg-brand）：computed 颜色仍是品牌蓝，同样算没换
      const stillBlue = [...document.querySelectorAll('[class~="text-brand"],[class~="bg-brand"]')]
        .filter((e) => {
          const cs = getComputedStyle(e);
          return /29,\s*155,\s*240/.test(`${cs.color} ${cs.backgroundColor}`);
        });
      return visible.length === 0 && stillBlue.length === 0;
    },
  },
  {
    id: 'R8-1',
    req: 'R8',
    name: '状态链接',
    rule: 'a[href*="/status/"] 存在',
    symptom: '回退后位置丢失、幕布迟迟不揭（锚定认不出推文 id）',
    test: () => document.querySelectorAll('a[href*="/status/"]').length > 0,
  },
];

/** 连续失败计数（只有声明了 confirm>1 的探针会用到）。换路由就清空，避免跨页带账 */
const strikes = new Map<string, number>();
let lastRoute = '';

/** 跑一遍全部探针。异常一律记为该条 fail，不让一条探针把整轮带崩 */
export function runProbes(ctx: ProbeCtx): ProbeResult[] {
  const route = location.pathname + location.search;
  if (route !== lastRoute) { lastRoute = route; strikes.clear(); }

  return PROBES.map((p) => {
    let state: ProbeState;
    try {
      const r = p.test(ctx);
      state = r === null ? 'skip' : r ? 'ok' : 'fail';
    } catch {
      state = 'fail';
    }
    const need = p.confirm ?? 1;
    if (state === 'fail' && need > 1) {
      const n = (strikes.get(p.id) ?? 0) + 1;
      strikes.set(p.id, n);
      // 还没到阈值就先按正常报：单轮抖动不该把人从红色警报里叫起来
      if (n < need) state = 'ok';
    } else {
      strikes.delete(p.id);
    }
    return { id: p.id, req: p.req, name: p.name, rule: p.rule, symptom: p.symptom, state };
  });
}

/**
 * 结果落到 `html.dataset.xmProbe`：
 * 全部正常 → `ok`；有异常 → 逗号分隔的 id（`R2-1,R3-1`）。
 * 排查脚本与面板都读这一个值，不必各自重算。
 */
export function publishProbes(results: ProbeResult[]): void {
  const bad = results.filter((r) => r.state === 'fail').map((r) => r.id);
  document.documentElement.dataset.xmProbe = bad.length ? bad.join(',') : 'ok';
}
