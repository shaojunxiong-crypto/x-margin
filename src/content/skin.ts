/**
 * 换肤层：只改「画上去的颜色」，不碰 margin / padding / position / overflow。
 *
 * X 的页面底色是多层 div 一层层画上去的（class 名是构建哈希，没有稳定选择器），
 * 所以用「从主栏往上走一遍祖先链」的方式把底色逐层改成透明——这比猜选择器稳，
 * 也不会误伤登录后才出现的其他面板。改过的元素都记在案，关闭时原样还回去。
 */

import type { FeedWidth, Glass } from '../shared/settings';

export type Theme = 'light' | 'dark';

const touched = new Map<HTMLElement, string>();

/**
 * 半透明玻璃的三档浓度。数字是实测出来的：
 * 86% 基本等于原底色（只在边缘看出背景），72% 能感到颜色但正文仍清晰，58% 背景明显。
 */
const ALPHA: Record<Glass, [dark: number, light: number]> = {
  thick: [0.86, 0.88],
  mid: [0.72, 0.78],
  thin: [0.58, 0.66],
};

export function surface(theme: Theme, glass: Glass = 'mid', strong = true): string {
  const [d, l] = ALPHA[glass];
  const a = strong ? (theme === 'dark' ? d : l) : Math.max(0.42, (theme === 'dark' ? d : l) - 0.1);
  return theme === 'dark' ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
}

const BASE_CSS = `
.xm-bg{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden;
  opacity:var(--xm-bg-o,.85);transition:opacity .35s ease}
.xm-bg[data-mode="off"]{display:none}
.xm-bg canvas,.xm-bg-img{position:absolute;inset:0;width:100%;height:100%;display:block}
.xm-bg canvas{object-fit:cover}
.xm-bg-img{background-size:cover;background-position:center;background-repeat:no-repeat;display:none}
.xm-bg[data-mode="image"] .xm-bg-img{display:block}
.xm-bg[data-mode="image"] canvas{display:none}
/* 压一层极淡的雾，免得高亮背景把白色文字糊掉 */
.xm-bg-scrim{position:absolute;inset:0;background:var(--xm-scrim,rgba(0,0,0,.18));transition:background .35s ease}
.xm-bg[data-soft] .xm-bg-scrim{background:var(--xm-scrim,rgba(0,0,0,.3))}
html.xm-skin,html.xm-skin body{background-color:transparent!important}
html.xm-skin #react-root{background-color:transparent!important}
`;

/**
 * 纯黑模式的文字柔化。
 *
 * X 的「纯黑」（Lights out）是 #000 底 + #f7f9f9 字，对比度 19.9:1 —— 是 WCAG AAA
 * 正文标准（7:1）的 2.8 倍，也明显高于 VS Code 深色主题的 11:1。眼睛觉得扎是必然的。
 *
 * 做法：只把「主文字」这一档压到 #c8ced3（≈13:1，与 X 自己的「昏暗」档同级），
 * 次级文字 #71767b 与链接蓝原封不动，信息层级一点没动。
 *
 * 为什么按内联样式里的色值匹配：X 的文本色全走 React 内联 style，若在容器上一概
 * 覆盖（如 [data-testid="User-Name"]），会把同容器里的 @handle、时间戳一起提亮。
 * 按色值筛只命中「本来就是这个白色」的元素，天然保留层级。
 *
 * 限定 xm-dark：浅色主题底色是白的，压暗文字会直接变成低对比。
 */
const SOFT_CSS = `
html.xm-dark.xm-soft [style*="rgb(247, 249, 249)"],
html.xm-dark.xm-soft [style*="rgb(247,249,249)"],
html.xm-dark.xm-soft [style*="rgb(231, 233, 234)"],
html.xm-dark.xm-soft [style*="rgb(231,233,234)"]{color:var(--xm-soft-fg,#c8ced3)!important}
/* 兜底：少数文本节点没有内联色，靠继承拿颜色（继承自 X 的 #e7e9ea）。
   给容器设色即可，子元素自带内联色的（链接蓝、@handle 灰）依旧用自己的值 —— 
   color 是逐元素声明，父级的 !important 不会覆盖子元素自己的声明，层级不受影响。 */
html.xm-dark.xm-soft [data-testid="tweetText"],
html.xm-dark.xm-soft [data-testid="User-Name"]{color:var(--xm-soft-fg,#c8ced3)!important}
`;

/**
 * 推文浮起：主栏不再是整块板，每条推文自己是一条半透明毛玻璃带。
 *
 * 四件事：
 * 1. 主栏底色透明。X 给整条时间线刷一层不透明底色，换肤时我们自己也给它刷过半透明
 *    玻璃（surface()）—— 就是这层「整块背景」把页面背景挡在外面，推文看起来像贴在
 *    一块板子上。抹成透明，背景才能透进来。
 * 2. 去掉栏框与分隔线。X 在主栏左右各画 1px 竖线（纯黑下实测 rgb(47,51,53)），
 *    每条推文之间还有一条横线；线不断，观感永远是「一整栏」而不是「一条条」。
 * 3. 每条推文铺一层半透明底色。全透明时文字直接压在彩色背景上，一是可读性差，
 *    二是没有体积感、空隙也看不出「分条」。条带是整宽的（不圆角、不描边、
 *    不加阴影 —— 主人明确不要卡片化），只靠底色差与空隙形成分界。
 *    **不用 backdrop-filter**：它把背景平均成一个偏暗的值，实测带内 54、带外 57–92，
 *    条带反而比背景暗，「浮起」就成了「压下去」。半透明底色本身就能透出背景。
 * 4. 上下留白。用 padding 不用 margin：X 的时间线是虚拟滚动，每个 cellInnerDiv
 *    自己就是计量单位，高度靠 getBoundingClientRect 量。margin 不计入 rect（块级
 *    子元素的 margin 还会与父元素合并、跑到父盒外面），后续 cell 的位移就会算短、
 *    互相压住；padding 计入盒高，重新测量时能算对。
 *    上下各 26px → 相邻两条间隔 52px。10px（一个行高）与 20px（两个）都试过，
 *    在彩色背景上都不够「明确断开」，再放一档。
 *
 * 左右不留内边距：推文保持 X 原本的列宽与缩进，只是上下被拉开。
 */
const FLOAT_CSS = `
html.xm-float [data-testid="primaryColumn"],
html.xm-float [data-testid="primaryColumn"]>div{
  background-color:transparent!important;
  border-left:0!important;border-right:0!important;
}
/* .xm-cell 由 JS 打上，不依赖 X 的 data-testid。
   原因：真实页面的推文容器 testid 会随版本变（v0.1.20 之前按 cellInnerDiv 写 CSS，
   在主人的页面上一条都没匹配上，间隔和玻璃带全部静默失效）。JS 直接认 article，
   再往上找「宽度接近主栏」的那层当 cell，无论 X 怎么改结构都能落到正确元素上。 */
/* 间隔只能给 padding，绝不能给 margin。
   v0.1.25 试过 margin:26px 0，主人随即在 DevTools 里看到相邻两条 cell 的盒子**互相重叠** ——
   原因就是垂直 margin：它既不计入父元素高度，又会与父元素发生外边距合并（父层没有
   border/padding/overflow 时直接穿透出去）。结果 cell 的实际占位没变，margin 跑到盒子外面，
   下一条就从上面压过来。padding 计入盒尺寸，父元素高度跟着长，后面的 cell 才会被真正推下去。 */
html.xm-float .xm-cell{
  margin:0!important;
  padding:28px 0!important;
  box-sizing:border-box!important;
  background-color:transparent!important;
  border-bottom:0!important;
}
/* 间隔要「露出页面背景」，靠的是间隔处自己透明：那 28px 留白属于 cell，只要 cell 或它
   内层的 wrapper 带底色，露出来的就是底色而不是背景 —— 所以两层一起抹成透明。
   X 的整格 hover 高亮也挂在这两层，一并消掉。推文内容都在 article 里，不受影响。 */
html.xm-float .xm-cell>div,
html.xm-float .xm-cell>div>div,
html.xm-float .xm-cell>div>div>div{
  background-color:transparent!important;
  border-bottom:0!important;
}
/* 条带：整宽、直角、无描边、无阴影。选择器只认 JS 打的 .xm-art（最外层那条 article），
   不写「>div>article」这种固定深度 —— X 外面套几层 div 每个版本都不一样，写死就静默失效。
   v0.1.26 去掉上下两条内阴影：主人的原话是「这只是边框的显示效果」，
   那两条内阴影就是唯一的「边框感」来源。分条只靠底色差 + 留白，不画任何线。 */
html.xm-float .xm-art{
  background-color:var(--xm-float-bg,rgba(20,22,26,.96))!important;
  box-shadow:none!important;
  border-bottom:0!important;
}
`;

/**
 * 引用推文（quoted tweet）：直角 + 去掉那圈描边。
 *
 * X 给引用卡片画 16px 圆角 + 1px 描边（纯黑下实测 rgb(47,51,54)），在「整宽直角、
 * 不画线」的整体风格里很突兀。这里只做两件事：圆角归零、描边去掉。
 * **底色保留** —— 引用块与推文的区分靠底色差，不靠线。
 *
 * 不写固定深度：X 引用卡片外面套的 div 层数每个版本都在变（v0.1.21 / v0.1.22 两次
 * 都栽在写死「>div>article」上，CSS 空转、一点不报错）。改成 JS 从嵌套 article 出发
 * 往上找「有圆角或有边框」的那层打 .xm-quote，CSS 只认这个 class。
 */
const QUOTE_CSS = `
/* 主栏左右那两条 1px 竖线：把整条时间线框成一根「栏」，是页面上最显眼的边框 */
html.xm-flat [data-testid="primaryColumn"],
html.xm-flat [data-testid="primaryColumn"]>div{
  border-left:0!important;border-right:0!important;
}
/* 推文之间的水平分割线。真正的线可能画在 cell、它的 wrapper 或更外层容器上，
   所以 JS 会沿祖先链逐层清（内联 important），这里只是同一批元素的 CSS 兜底。 */
html.xm-flat .xm-cell-flat,
html.xm-flat .xm-cell-flat>div,
html.xm-flat .xm-cell-flat>div>div,
html.xm-flat .xm-cell-flat>div>div>div{
  border-bottom:0!important;
}
/* 引用推文卡片：16px 圆角归零、1px 描边去掉；底色保留，块靠底色区分 */
html.xm-flat .xm-quote{
  border-radius:0!important;
  border:0!important;
  box-shadow:none!important;
}
/* 推文里的内嵌图片：X 把圆角画在 <a> 和外面几层 div 上，img 自己是方的。
   JS 从 [data-testid="tweetPhoto"] 往上找带圆角的层打 .xm-photo，这里只认 class；
   末尾再兜一条 img 自身的圆角（个别卡片直接画在 img 上）。 */
html.xm-flat .xm-photo{
  border-radius:0!important;
}
html.xm-flat [data-testid="tweetPhoto"] img{
  border-radius:0!important;
}
/* 卡片封面 / 视频封面（带「来自 xxx.com」的外链卡、纯视频、GIF）：
   这类媒体不叫 tweetPhoto，圆角同样画在包裹它的 <a>、card.layout* 或外层 div 上，
   而且几乎都配 1px 描边。圆角和描边必须一起清 —— 只清圆角的话，图片变方角而
   那圈圆角描边还在，四角会露出卡片底色，比原来更难看。 */
html.xm-flat .xm-media{
  border-radius:0!important;
  border:0!important;
  box-shadow:none!important;
}
html.xm-flat .xm-media img,
html.xm-flat .xm-media video,
html.xm-flat article video{
  border-radius:0!important;
}
`;

/**
 * 推文卡片化：把时间线拆成一张张独立面板（缝隙 + 圆角 + 底色）。
 *
 * 为什么不能用 padding / margin 造缝隙：每条推文是一个
 * `div[data-testid="cellInnerDiv"]`，它是 `position:absolute` +
 * `transform:translateY(y)`，y 由 X 按「它前面所有 cell 的高度累加」算好写死。
 * 只要 cell 变高变矮（加 padding、加 border、加 margin），写死的 y 就和它对不上，
 * 下一条直接压在它身上 —— 之前十几轮改动全部死在这一点上。
 *
 * clip-path 只影响绘制，盒子尺寸、位置、父容器的 min-height 一律不动，
 * X 完全感知不到：inset(上 右 下 左 round 半径) 上下各裁 7px，
 * 相邻两条之间天然留下 14px 的缝。
 *
 * --xm-card-x 管左右内缩。默认 0：卡片与主栏同宽，也就和上面的发帖框（发推面板）
 * 严格对齐 —— 发帖框是主栏满宽、没有左右内边距，卡片一内缩就比它窄，视觉上明显错位。
 * 想要「两侧露出一线底色」的卡片感，把它调成正数即可，但那样就和发帖框对不齐了。
 */
const CELL_CARD_CSS = `
/* 主栏不要整块底板：X 给 primaryColumn 刷的那层底色 + 我们自己换肤刷的 surface()
   都在这一层。CSS 能清 X 的 class 底色，但清不了 surface() 的内联 !important，
   那一半由 applySkin 的 bareColumn 参数跳过。
   注意只写 primaryColumn 这一层 —— 不能再往下写「>div>div」那种按层数的一刀切：
   吸顶的「为你推荐 / 正在关注」标签栏正好也在第 2 层，一起透明掉的话推文会从它底下穿过。
   时间线内部那几层板由 JS 顺着推文的祖先链逐层擦（clearCardWrappers）。 */
html.xm-card [data-testid="primaryColumn"]{
  background-color:transparent!important;
  background-image:none!important;
  border-left:0!important;
  border-right:0!important;
}
/* 每条推文自己是一块：上下各裁 --xm-card-gap（默认 12px，相邻两条合起来 24px 缝隙）。
   左右默认不裁（--xm-card-x = 0）：发帖框是主栏满宽，推文必须同宽才对得上；
   一旦左右内缩，卡片就比发帖框窄一截，同一栏里会出现两条竖边。
   ⛔ clip-path 只能裁、不能加：裁掉的是推文自己的内边距，
   所以「缝隙」与「卡片边到内容」是同一个预算 —— gap + 留白 = article 的上下内边距。
   要让两个都变大，只能先把 article 的内边距抬高（--xm-card-pad，见下一条规则），
   再从中裁 gap。这也是为什么这套改动必须配 reflowCards() 重排 translateY。
   圆角由 --xm-card-r 控制，默认 0（直角）—— 主人要的是「独立嵌入」，不是卡片化。 */
html.xm-card [data-testid="primaryColumn"] [data-testid="cellInnerDiv"]{
  clip-path:inset(var(--xm-card-gap,12px) var(--xm-card-x,0px) var(--xm-card-gap,12px) var(--xm-card-x,0px) round var(--xm-card-r,0px))!important;
  background-color:var(--xm-card-bg,rgba(255,255,255,.055))!important;
}
/* 推文卡片内部的上下留白：X 原生是 padding:12px 16px，卡片边到内容只有 12 − gap，
   gap 一调大就贴边。这里把上下内边距抬到 --xm-card-pad（默认 22px），左边距不动 ——
   左右还要和发帖框对齐。代价是 cell 变高，X 写死的 translateY 失效，靠 reflowCards() 重排。 */
html.xm-card [data-testid="primaryColumn"] article[data-testid="tweet"]{
  padding-top:var(--xm-card-pad,22px)!important;
  padding-bottom:var(--xm-card-pad,22px)!important;
}
/* cell 里那几层 wrapper 自带底色时会把卡片底色盖住，一起透明掉（限定在 cell 内，不会误伤别处） */
html.xm-card [data-testid="primaryColumn"] [data-testid="cellInnerDiv"]>div,
html.xm-card [data-testid="primaryColumn"] [data-testid="cellInnerDiv"]>div>div,
html.xm-card [data-testid="primaryColumn"] [data-testid="cellInnerDiv"]>div>div>div{
  background-color:transparent!important;
}
`;

/** html 上挂的字体变量：只在字号缩放时用 zoom，其他一律走 font-family */
const FONT_CSS = `
html.xm-font body,
html.xm-font body *:not(svg):not(svg *):not(code):not(pre){
  font-family:var(--xm-font)!important;
}
html[data-zoom="110"] #react-root{zoom:1.1}
html[data-zoom="120"] #react-root{zoom:1.2}
html.xm-skin[data-glass="mid"] [data-testid="primaryColumn"],
html.xm-skin[data-glass="mid"] [data-testid="sidebarColumn"],
html.xm-skin[data-glass="mid"] header[role="banner"]{backdrop-filter:blur(10px) saturate(1.3)}
html.xm-skin[data-glass="thin"] [data-testid="primaryColumn"],
html.xm-skin[data-glass="thin"] [data-testid="sidebarColumn"],
html.xm-skin[data-glass="thin"] header[role="banner"]{backdrop-filter:blur(16px) saturate(1.35)}
html.xm-skin header[role="banner"]{backdrop-filter:blur(14px) saturate(1.3)}
`;

/**
 * 布局层：只做「去掉右侧栏」这一件事，且只认 X 的稳定锚点。
 *
 * 为什么不能只 display:none：X 的行容器是 header + main(flex-grow) + sidebar(350px)，
 * 砍掉 sidebar 后 350px 会让 main 变宽，而 600px 的主栏默认贴左 —— 视觉上整页左歪。
 * 给主栏左右 auto 外边距，让它把那截空白平均分掉，回到中线。
 * （若 X 把主栏在交叉轴拉满，auto 外边距自动失效，不会产生副作用。）
 */
const LAYOUT_CSS = `
html.xm-noside [data-testid="sidebarColumn"]{display:none!important}
html.xm-noside main[role="main"]{flex-grow:1}
html.xm-noside [data-testid="primaryColumn"]{margin-left:auto!important;margin-right:auto!important}
/* 推文流加宽：X 原生主栏是 600px，这里用变量顶掉，其余（居中、玻璃、字号）都照旧 */
html.xm-wide main[role="main"]{max-width:none!important}
html.xm-wide [data-testid="primaryColumn"]{
  width:var(--xm-feed-w,720px)!important;
  max-width:var(--xm-feed-w,720px)!important;
  min-width:0!important;
  flex-basis:var(--xm-feed-w,720px)!important;
}
html.xm-wide [data-testid="primaryColumn"] .xm-wide-el{max-width:var(--xm-feed-w,720px)!important}
/* 推广 / 广告推文：X 在推广单元里塞一个 [data-testid="placementTracking"]（曝光追踪），
   它就是唯一稳定锚点 —— 「Ad」是个纯文本标签，CSS 匹配不到。
   三种已知结构一并收掉（cell 包 tracking / tracking 包 article / article 内含 tracking），
   整条 cell 一起 display:none 才不留空白。新渲染的广告由 :has() 自动命中，不需要 JS 补扫。
   :has() 从 Chrome 105 起支持，构建 target 是 chrome110。 */
html.xm-noads [data-testid="cellInnerDiv"]:has([data-testid="placementTracking"]),
html.xm-noads [data-testid="placementTracking"]:has(article[data-testid="tweet"]),
html.xm-noads article[data-testid="tweet"]:has([data-testid="placementTracking"]){display:none!important}
/* 发推面板（时间线顶部「有什么新鲜事？」那一块）：只在主栏内、只认 JS 打的标记。
   认元素的方法见 markComposer()：发推框的 DOM 深度不固定，CSS 的层级选择器会随 X 改版失效，
   所以从 tweetButtonInline 往上爬到「不再包含标签栏 / 推文 cell」的那一层为止。 */
html.xm-nocompose .xm-comp-hide{display:none!important}
/* 左侧栏的发帖按钮：图标栏关掉时也要能藏（.xm-hide 那条规则挂在 html.xm-rail 下，够不着） */
html.xm-hidecompose [data-testid="SideNav_NewTweet_Button"]{display:none!important}
/* 隐藏页面滚动条：只碰根滚动容器（html / body），弹窗、私信、设置页内部的滚动条原样保留 ——
   那些地方没有滚动条就完全看不出「还有内容」。
   两条都得写：scrollbar-width 管 gutter 与新版 overlay 滚动条，::-webkit-scrollbar 管 Windows
   的经典滚动条；只写前者，经典滚动条仍会被画出来（v0.1.48 实测）。 */
html.xm-noscroll,html.xm-noscroll body{scrollbar-width:none!important;scrollbar-gutter:auto!important}
html.xm-noscroll::-webkit-scrollbar,html.xm-noscroll body::-webkit-scrollbar{
  width:0!important;height:0!important;display:none!important}
/* 右下角浮动按钮（Grok / 私信气泡）：X 把两个按钮挂在 body 级的固定层里，压在时间线右下角，
   与内容区重叠。图标栏里的同名导航项 testid 是 AppTabBar_*，这里只认 Drawer 容器，不会误伤。
   属性值的 i 标志是必需的：X 不同版本一个写 DMDrawer、一个写 dmDrawer，写死大小写跨版本就失效。
   ⚠ 私信在 2026 版改名成 Chat，testid 也从 DMDrawer 换成 chat-drawer-*（v0.1.49 只写 DMDrawer，
   结果 Grok 收掉了、聊天气泡还留着）。两套都留：老版本走 DMDrawer，新版本走 chat-drawer。 */
html.xm-nofloat [data-testid="DMDrawer" i],
html.xm-nofloat [data-testid="DMDrawerButton" i],
html.xm-nofloat [data-testid="chat-drawer-root" i],
html.xm-nofloat [data-testid="chat-drawer-main" i],
html.xm-nofloat [data-testid="GrokDrawer" i],
html.xm-nofloat [data-testid="GrokDrawerButton" i]{display:none!important}
/* 白名单落空时的兜底：由 markFloats() 按「语义 + 右下角位置」补打标记，CSS 只认自有 class */
html.xm-nofloat .xm-float-hide{display:none!important}
`;

/**
 * 图标导航栏：把 header 从文档流里取出来钉在窗口左边缘，宽度压到 76px，只留图标。
 *
 * 不靠改 X 的内层结构：只压最外层宽度 + 隐藏文字 span + 把导航项压成 52×52 的圆角方块。
 * header 变 fixed 后原来的占位会消失，所以同时在它的父元素上补 padding-left —— 不改父元素
 * 的 display / flex 属性，主栏的居中逻辑（margin:auto）才继续成立。
 */
const RAIL_CSS = `
html.xm-rail header[role="banner"]{
  position:fixed!important;left:0!important;top:0!important;
  width:76px!important;min-width:76px!important;max-width:76px!important;
  height:100vh!important;max-height:100vh!important;
  z-index:40!important;overflow-y:auto!important;overflow-x:hidden!important;
  background:var(--xm-rail-bg,rgba(0,0,0,.86))!important;
  -webkit-backdrop-filter:blur(18px) saturate(1.4);backdrop-filter:blur(18px) saturate(1.4);
  scrollbar-width:none;
}
html.xm-rail header[role="banner"]::-webkit-scrollbar{display:none}
html.xm-rail header[role="banner"]>div,
html.xm-rail header[role="banner"]>div>div,
html.xm-rail header[role="banner"]>div>div>div{width:100%!important;max-width:100%!important}
html.xm-rail header[role="banner"]>div{
  padding-left:0!important;padding-right:0!important;align-items:center!important;
  height:100%!important;
}
html.xm-rail header[role="banner"] h1{margin:0!important}
/* 只去掉文字，图标是 svg，不受影响 */
html.xm-rail header[role="banner"] span{display:none!important}
html.xm-rail header[role="banner"] a[href]{
  width:52px!important;height:52px!important;min-width:0!important;
  padding:0!important;margin:2px auto!important;border-radius:9999px!important;
  display:flex!important;justify-content:center!important;align-items:center!important;
  overflow:hidden!important;
}
/* 只藏 span 不够：文字容器的 margin-left 还在，图标会被挤偏。
   判定必须「以 svg 为准」——只隐藏不含 svg 的直接子 div。
   ⛔ 不能用 :has(span)：真实 X 的图标 div 里带 sr-only 的 span，会连图标一起藏掉。 */
html.xm-rail header[role="banner"] a[href] div:not(.xm-badge){
  margin:0!important;padding:0!important;min-width:0!important;flex:none!important;
}
html.xm-rail header[role="banner"] a[href]>div:not(:has(svg)):not(.xm-badge){display:none!important}
/* 兜底：万一 svg 被 span 包着，那个 span 必须留 */
html.xm-rail header[role="banner"] a[href] span:has(svg){display:block!important}
/* svg 是行内元素，在块级容器里受基线影响会偏上 2px；设成 block 后严格居中 */
html.xm-rail header[role="banner"] a[href] svg{display:block!important}
/* 未读角标（红点 / 数字气泡）：X 用绝对定位的小块画在图标右上角。上面「藏 span、藏不含 svg 的直接子 div」
   会把它一起干掉 —— JS 先给整棵角标子树打 .xm-badge，这里再放行。
   ⛔ 只对 span 用 display:revert，绝不碰 div：角标容器本身是 display:flex 负责把数字居中，
   revert 会把 author 声明一起回滚成 UA 的 block，数字就跑到右边被裁掉。 */
html.xm-rail header[role="banner"] span.xm-badge,
html.xm-rail header[role="banner"] .xm-badge span{display:revert!important}
/* 彩色位图 / emoji 字形统一压成灰阶，跟单色线条图标同一套语言 */
html.xm-rail header[role="banner"] .xm-mono{
  filter:grayscale(1) contrast(1.04)!important;
  opacity:.92!important;
}
html.xm-rail header[role="banner"] [data-testid="SideNav_NewTweet_Button"]{
  width:52px!important;height:52px!important;min-width:0!important;
  padding:0!important;margin:10px auto!important;border-radius:50%!important;
  display:flex!important;align-items:center!important;justify-content:center!important;
}
/* 发帖按钮的文字被隐藏后是空的，补一个笔形图标 */
html.xm-rail header[role="banner"] [data-testid="SideNav_NewTweet_Button"]::after{
  content:"";width:24px;height:24px;display:block;background:currentColor;
  -webkit-mask:var(--xm-pen) center/contain no-repeat;mask:var(--xm-pen) center/contain no-repeat;
}
/* 账户切换按钮（左下角那个圆形头像）：整条去掉，这个位置留给设置齿轮。
   它在 nav 里是「吸底组」（容器带 margin-top:auto），齿轮就插在同一个容器里，
   所以隐藏头像后齿轮天然落到头像原来的位置，不用另算坐标。见 panel.place()。
   要恢复：删掉这一条即可（齿轮会自动回到头像上方，两者并存）。 */
html.xm-rail header[role="banner"] [data-testid="SideNav_AccountSwitcher_Button"]{display:none!important}
/* 齿轮按钮被塞进「账户头像」那个吸底容器里（见 panel.place）。X 那个容器可能是横向 flex，
   齿轮会被摆到头像左边；这里只把「直接含齿轮的那个容器」强制成居中的竖排。
   选择器限定在 nav 内、且只认自有的 .xm-fab，不会误伤 X 的任何结构。 */
html.xm-rail header[role="banner"] nav div:has(> .xm-fab){
  display:flex!important;flex-direction:column!important;align-items:center!important;
}
html.xm-rail header[role="banner"] .xm-fab[data-rail="1"]{flex:none!important}
/* 通用隐藏：必须排在最后，且必须带上 a[href] / [data-testid] 提高特异性 ——
   同文件里 a[href]{display:flex!important} 是 (0,3,3)、本组 (0,3,2) 会输给它。
   这两类组合选择器的优先级都高于 (0,3,2)，才压得住。 */
html.xm-rail header[role="banner"] .xm-hide,
html.xm-rail header[role="banner"] a[href].xm-hide,
html.xm-rail header[role="banner"] [role="button"].xm-hide,
html.xm-rail header[role="banner"] [data-testid].xm-hide{display:none!important}
`;

const PEN_SVG = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23fff' d='M21.1 2.9a2.9 2.9 0 0 0-4.1 0L5.5 14.4V18h3.6L20.6 6.5l.5-1.1v-.3z'/%3E%3Crect fill='%23fff' x='3' y='20' width='18' height='1.8' rx='.9'/%3E%3C/svg%3E\")";

let railHost: HTMLElement | null = null;
let railHostPrev = '';
const RAIL_PAD = '76px';

/**
 * 图标栏开关。header 是 fixed，占位由它的父元素上的 padding-left 补回来。
 * 还原时把 padding 精确还回原值（包括原本为空的情况）。
 */
/**
 * header 里绝大多数图标是 `fill:currentColor` 的单色 svg，会跟着主题走；
 * 但有三类不是：Grok 的彩色品牌图标、某些 emoji 字形、账户头像（img）。
 * 它们保持彩色，落在整条灰阶图标列里就会「跳」。
 * 这里只给「彩色源」打标记，不碰 svg —— svg 本来就不需要处理。
 */
const EMOJI = /\p{Extended_Pictographic}/u;

/** 导航项稳定标识：testid > href > aria-label > 序号 */
function railKey(el: HTMLElement, index: number): string {
  const t = el.getAttribute('data-testid');
  if (t) return `t:${t}`;
  const h = el.getAttribute('href');
  if (h && h !== '/') return `h:${h}`;
  const a = el.getAttribute('aria-label');
  if (a) return `a:${a}`;
  return `i:${index}`;
}

/** 导航项可能是 a[href]，也可能是 role=button 的 div（More / Grok 那类） */
const ITEM_SEL = 'a[href], [role="button"]';
/** 这两个是「按钮」不是导航项：发帖由 hideCompose 单独管，账户头像不该被藏 */
const BTN_ONLY = '[data-testid="SideNav_NewTweet_Button"],[data-testid="SideNav_AccountSwitcher_Button"]';

function railNodes(): HTMLElement[] {
  const header = document.querySelector<HTMLElement>('header[role="banner"]');
  if (!header) return [];
  const scope = header.querySelector('nav') ?? header;
  const pool = [...scope.querySelectorAll<HTMLElement>(ITEM_SEL)]
    .filter((el) => !el.closest(BTN_ONLY) && !el.closest('.xm-fab'));
  // 只留最外层：a 里再套 role=button 时不会算成两项
  const outer = pool.filter((el) => !pool.some((o) => o !== el && o.contains(el)));
  if (outer.length) return outer;
  // 没有 nav 时的退化路径：排除 X logo（href="/"）
  return [...header.querySelectorAll<HTMLElement>('a[href]')].filter((a) => a.getAttribute('href') !== '/');
}

export interface RailItem {
  key: string;
  label: string;
}

/** 枚举左侧导航项，供设置面板勾选。文字被 CSS 隐藏了，但 textContent 仍取得到 */
export function railItems(): RailItem[] {
  return railNodes().map((a, i) => {
    const raw = a.getAttribute('aria-label') || a.textContent || a.getAttribute('href') || '';
    const label = raw.replace(/\s+/g, ' ').trim().slice(0, 10) || `第 ${i + 1} 项`;
    return { key: railKey(a, i), label };
  });
}

function markColored(header: HTMLElement): void {
  const want = new Set<Element>();
  // 位图：头像、品牌 png
  header.querySelectorAll('img, [style*="background-image"]').forEach((el) => want.add(el));
  // 文本 emoji：只标记「直接含 emoji 文本节点」的那一层，避免整块祖先都吃 filter
  header.querySelectorAll<HTMLElement>('div, span').forEach((el) => {
    if (el.closest('svg')) return;
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.nodeValue ?? '')
      .join('');
    if (own && EMOJI.test(own)) want.add(el);
  });
  // 只改动有差异的节点：稳态下零 class 变更，不触发重绘
  header.querySelectorAll('.xm-mono').forEach((el) => { if (!want.has(el)) el.classList.remove('xm-mono'); });
  want.forEach((el) => el.classList.add('xm-mono'));
}

/**
 * 未读角标：X 用「绝对定位的小色块 + 数字 span」画在图标右上角。
 * 图标栏的两条隐藏规则（藏 span、藏不含 svg 的直接子 div）会把它一起干掉 —— 未读数就永远不出现。
 * 这里先认出角标、给整棵子树打 .xm-badge，CSS 再对这棵子树放行。
 *
 * 判据只能用 position:absolute：图标栏开着时角标本身是 display:none，
 * getBoundingClientRect 全是 0，量不出大小。sr-only 的 1px 取值线把它排除掉
 * （放出来会把标签文字露出来）。
 */
function markBadges(header: HTMLElement): void {
  const want = new Set<Element>();
  header.querySelectorAll<HTMLElement>('a[href] *').forEach((el) => {
    if (el.closest('svg')) return;
    const cs = getComputedStyle(el);
    if (cs.position !== 'absolute') return;
    if (cs.width === '1px' || cs.height === '1px') return;
    want.add(el);
    el.querySelectorAll('*').forEach((d) => want.add(d));
  });
  header.querySelectorAll('.xm-badge').forEach((el) => { if (!want.has(el)) el.classList.remove('xm-badge'); });
  want.forEach((el) => el.classList.add('xm-badge'));
}

export function applyRail(on: boolean, theme: Theme, hide: string[] = [], hideCompose = false): void {
  const html = document.documentElement;
  html.classList.toggle('xm-rail', on);
  // 发帖按钮的隐藏不跟着图标栏走：不发推的人，图标栏关掉也不该冒出这个按钮
  html.classList.toggle('xm-hidecompose', hideCompose);
  html.style.setProperty('--xm-rail-bg', theme === 'dark' ? 'rgba(0,0,0,.86)' : 'rgba(255,255,255,.9)');
  html.style.setProperty('--xm-rail-fg', theme === 'dark' ? '#e7e9ea' : '#0f1419');
  html.style.setProperty('--xm-pen', PEN_SVG);

  const header = document.querySelector<HTMLElement>('header[role="banner"]');
  const host = header?.parentElement ?? null;
  const compose = header?.querySelector<HTMLElement>('[data-testid="SideNav_NewTweet_Button"]') ?? null;

  if (railHost && railHost !== host) {
    railHost.style.paddingLeft = railHostPrev;
    railHost = null;
  }
  if (!on || !host) {
    if (railHost) { railHost.style.paddingLeft = railHostPrev; railHost = null; }
    if (!on) {
      header?.querySelectorAll('.xm-mono').forEach((el) => el.classList.remove('xm-mono'));
      header?.querySelectorAll('.xm-hide').forEach((el) => el.classList.remove('xm-hide'));
      header?.querySelectorAll('.xm-badge').forEach((el) => el.classList.remove('xm-badge'));
      header?.querySelectorAll('.xm-badge').forEach((el) => el.classList.remove('xm-badge'));
    }
    return;
  }
  if (railHost !== host) {
    railHost = host;
    railHostPrev = host.style.paddingLeft;
  }
  if (host.style.paddingLeft !== RAIL_PAD) host.style.paddingLeft = RAIL_PAD;
  if (header) { markColored(header); markBadges(header); }
  // 逐项显隐：key 每次现算，X 重排顺序也不会错位
  railNodes().forEach((el, i) => el.classList.toggle('xm-hide', hide.includes(railKey(el, i))));
  // 发帖按钮：不是导航项，单独开关（很多人只用键盘 n 发帖）
  compose?.classList.toggle('xm-hide', hideCompose);
}

let baseInjected = false;
export function injectBase(): void {
  if (baseInjected) return;
  baseInjected = true;
  const s = document.createElement('style');
  s.id = 'xm-base';
  s.textContent = BASE_CSS + SOFT_CSS + FLOAT_CSS + QUOTE_CSS + CELL_CARD_CSS + FONT_CSS + LAYOUT_CSS + RAIL_CSS;
  (document.head ?? document.documentElement).append(s);
}

/** 右下角浮动按钮的 testid 白名单：与 LAYOUT_CSS 里那几条规则保持同一份，改一处要同步另一处 */
const FLOAT_SEL_CHAT = '[data-testid="DMDrawer" i],[data-testid="DMDrawerButton" i],'
  + '[data-testid="chat-drawer-root" i],[data-testid="chat-drawer-main" i]';
const FLOAT_SEL_GROK = '[data-testid="GrokDrawer" i],[data-testid="GrokDrawerButton" i]';
/** 白名单落空时按可见名认。Chat 那条是 2026 版：私信入口改叫 Chat，图标换成对话气泡。
 *  中文界面下 X 会把 Messages 本地化成「私信 / 消息」，几种写法都得收 —— 只写英文等于只对英文界面生效。 */
const FLOAT_LABEL = /^(messages|direct messages?|chat|grok|私信|消息|聊天)$/i;
/** 兜底扫描的上次时间（ms）：见 markFloats 里的 5 秒闸门。初值必须是「很久以前」——
 *  用 0 会让页面加载后的前 5 秒全部被闸门挡掉，正是浮动层刚渲染出来的那段时间。 */
let lastFloatScan = -1e9;

/**
 * 右下角浮动按钮（Grok / 私信气泡）的兜底标记。
 *
 * 主路径是 CSS 白名单（零成本、零误伤）；这个函数只在白名单一个都没命中时才扫 ——
 * X 一旦给这两个按钮换 testid，白名单静默失效，用户看到的就是「开关拨了没反应」。
 * 兜底判据必须两条同时成立：aria-label 命中语义、且盒子真落在视口右下角。
 * 只看语义会误伤：左侧图标栏的私信导航项同名（靠 header 排除），Grok 侧栏里也有同名按钮（靠位置排除）。
 */
export function markFloats(on: boolean): void {
  if (!on) {
    const marked = document.querySelectorAll('.xm-float-hide');
    if (marked.length) marked.forEach((n) => n.classList.remove('xm-float-hide'));
    return;
  }
  // 白名单两个族都命中就不必扫。要求「都命中」而不是「命中一个」—— 只命中一个说明这版
  // X 只给其中一个留了老 testid，另一个照样要兜底，否则会从「两个都藏」退化成「藏一个」。
  if (document.querySelector(FLOAT_SEL_CHAT) && document.querySelector(FLOAT_SEL_GROK)) return;
  // 白名单失效时这条兜底会被 1.5 秒一拍的心跳反复调用：5 秒才真扫一次，
  // 满屏 aria-label 的 rect 读取虽然只强制一次布局，也不该每拍都做。
  const now = performance.now();
  if (now - lastFloatScan < 5000) return;
  lastFloatScan = now;
  const vw = innerWidth;
  const vh = innerHeight;
  // 候选必须含 div[role="button"]：X 有相当一部分「按钮」其实是 div + role，不是真 button
  document.querySelectorAll<HTMLElement>('a[aria-label],button[aria-label],[role="button"][aria-label]').forEach((n) => {
    const label = (n.getAttribute('aria-label') ?? '').trim();
    if (!FLOAT_LABEL.test(label)) return;
    if (n.closest('header[role="banner"]')) return;
    const r = n.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) return;
    if (r.right < vw * 0.75 || r.top < vh * 0.5) return;
    n.classList.add('xm-float-hide');
  });
}

/** 去掉 / 恢复右侧栏、推文流宽度、广告过滤、推文卡片（纯 class 开关，不记账、不改内联样式，随时可逆） */
export function applyLayout(hideSidebar: boolean, feedWidth: FeedWidth = 600, hideAds = true, floatCards = true, cardFeed = true, noScrollbar = true, hideFloats = true): void {
  const html = document.documentElement;
  html.classList.toggle('xm-noside', hideSidebar);
  html.classList.toggle('xm-noscroll', noScrollbar);
  html.classList.toggle('xm-nofloat', hideFloats);
  html.classList.toggle('xm-noads', hideAds);
  html.classList.toggle('xm-float', floatCards);
  html.classList.toggle('xm-card', cardFeed);
  html.style.setProperty('--xm-feed-w', `${feedWidth}px`);
  const wide = feedWidth !== 600;
  html.classList.toggle('xm-wide', wide);
  if (!wide) {
    document.querySelectorAll('.xm-wide-el').forEach((el) => el.classList.remove('xm-wide-el'));
    return;
  }
  widenInner();
}

/**
 * 发推面板（时间线顶部那块「有什么新鲜事？」）：不发推的人用不上，整块收掉。
 *
 * 为什么不能用 CSS 写死层级：发推框在主栏里的嵌套深度随 X 改版和页面（主页 / 列表 / 搜索）
 * 变化，`primaryColumn>div>div` 这种指法随时会打偏，打偏的后果是把标签栏或整条时间线一起藏了。
 * 改成从锚点往上爬，取「只属于发推框」的最大容器。
 *
 * 四个坑（v0.1.37 → v0.1.39，全是「停得太早」）：
 * ① 锚点不能用 `tweetButtonInline`。那个按钮在底部工具栏里，工具栏的图标行本身就是一个
 *    `role="tablist"`（`data-testid="ScrollSnap-List"`），从按钮往上第一层就撞上它，
 *    结果只把「发帖」按钮那一小块藏了，整个面板还在。
 * ② 「遇到 tablist 就停」要排除面板自己的 tablist，否则同上。
 * ③ **不能要求每一层都含 toolBar**。文本域到工具栏之间隔着六七层纯包裹，第一层就没有
 *    toolBar，best 一直是 null，一个标记都没打上。
 * ④ **不能用 `cellInnerDiv` 当边界**。X 会把输入区单独包进一个 cell：输入区在 cell 里、
 *    底部工具栏是 cell 的兄弟。判到 cell 就停，结果是「输入框没了、头像+图标+发帖按钮还在」
 *    —— 一半面板留在页面上。
 *
 * 所以定界改成「以发帖按钮为准」：按钮只存在于面板内，凡是还包着它的祖先都还在面板里；
 * 只有某层**开始把不属于面板的东西包进来**（别的推文 cell、别的 tablist）才停。
 *
 * 必须在主栏内：弹窗发推框不在 primaryColumn 里，closest 返回 null，原样不动。
 */
export function markComposer(hide: boolean): void {
  document.querySelectorAll('.xm-comp-hide').forEach((el) => el.classList.remove('xm-comp-hide'));
  document.documentElement.classList.toggle('xm-nocompose', hide);
  const html = document.documentElement;
  delete html.dataset.xmComp;
  if (!hide) return;
  const col = document.querySelector('[data-testid="primaryColumn"]');
  const btn = col?.querySelector<Element>('[data-testid="tweetButtonInline"]');
  // 主锚点 + 两层兜底（X 换 testid 时还能命中）
  let area: Element | null = null;
  for (const sel of [
    '[data-testid="tweetTextarea_0"]',
    '[data-testid="tweetTextarea_0RichTextInputContainer"]',
  ]) {
    const el = col?.querySelector(sel);
    if (el) { area = el; break; }
  }
  if (!col || !btn) return;
  if (!area) area = btn;

  // 第 1 步：升到「同时包着输入框与发帖按钮」的最近祖先 —— 面板的公共父层
  let best: Element | null = area;
  while (best && best !== col && !best.contains(btn)) best = best.parentElement;
  if (!best || best === col) { html.dataset.xmComp = 'miss'; return; }

  // 第 2 步：继续往上，直到这层开始包进「面板以外」的东西
  for (let i = 0; i < 14; i++) {
    const p: Element | null = best.parentElement;
    if (!p || p === col) break;
    if (!p.contains(btn)) break;
    // ⛔ 发推面板里绝不可能有推文。一旦这一层开始包含 article[data-testid="tweet"]，
    //    说明 best 正要跨进「推文」的地盘，立刻停 —— 这是唯一一条不依赖结构位置的硬边界。
    //    详情页就是这个坑（v0.1.43 实机：原推文整条消失）：主帖与回复框在同一个容器里，
    //    回复列表在**兄弟**容器里，下面的 foreignCell 只查 p 的后代、查不到兄弟里的 cell，
    //    于是 best 一路升到「含主帖的那一层」，把原推文连锅端走。
    if (p.querySelector('article[data-testid="tweet"]')) break;
    // 出现了不在当前面板层里的推文 cell → 已经把时间线包进来了
    const foreignCell = Array.from(p.querySelectorAll('[data-testid="cellInnerDiv"]')).some((c) => !best!.contains(c));
    if (foreignCell) break;
    // 出现了面板之外的 tablist（顶部标签栏）→ 同上
    const foreignTab = Array.from(p.querySelectorAll('[role="tablist"]')).some((t) => !best!.contains(t));
    if (foreignTab) break;
    best = p;
  }
  if (best === col) { html.dataset.xmComp = 'col'; return; }
  // 最后一道校验：宁可什么都不藏，也不能藏到推文
  if (best.querySelector('article[data-testid="tweet"]')) { html.dataset.xmComp = 'guard'; return; }
  best.classList.add('xm-comp-hide');
  html.dataset.xmComp = 'ok';
}

/**
 * X 有些内层容器把 600px 写死在 max-width 上，主栏放宽后它们会成为瓶颈。
 *
 * 旧版扫主栏里**每一个 div** 再读计算样式：一条二十条的流就是上千次 getComputedStyle，
 * 贵到只能 4 秒轮询一次。而回退 / 路由切换时主栏内部是整棵重建的，新容器不带标记，
 * 于是「先窄后宽」能挂好几秒 —— 宽度一变正文重折行、cell 高度全变，滚动位置跟着丢。
 *
 * 现在只沿「cell 的祖先链」上溯：限宽层必定是 cell 的祖先，一条链就够了。
 * 成本从 O(全列 div) 降到 O(链长)，可以跟着 DOM 变更即时跑（见 main.ts 的 bindWide）。
 * 仍然只认「计算值落在 520–660」的层，不碰 margin/padding/position。
 */
export function widenInner(): void {
  const col = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]');
  if (!col) return;

  // 种子：前两个 cell（共享祖先链，取两个是防「第一条挂在别的子树里」）；
  // 还没有 cell 的骨架期退化成「主栏第一条子链」，这样开屏也是宽的。
  const seeds: HTMLElement[] = [];
  const cells = col.querySelectorAll<HTMLElement>('[data-testid="cellInnerDiv"]');
  for (let i = 0; i < Math.min(2, cells.length); i++) seeds.push(cells[i]);
  if (!seeds.length) {
    let el = col.firstElementChild as HTMLElement | null;
    for (let i = 0; i < 4 && el; i++) {
      seeds.push(el);
      el = el.firstElementChild as HTMLElement | null;
    }
  }

  const chain = new Set<HTMLElement>();
  for (const seed of seeds) {
    let el: HTMLElement | null = seed;
    for (let i = 0; el && el !== col && i < 12; i++, el = el.parentElement) {
      if (el.tagName === 'ARTICLE') break; // 已经进到推文内部，再往上不是布局层
      chain.add(el);
    }
  }

  const want = new Set<Element>();
  chain.forEach((el) => {
    // 已标记的不能再读计算值：标记后 max-width 变成 720，会被判成「不在 520–660」而摘掉 → 来回跳
    if (el.classList.contains('xm-wide-el')) { want.add(el); return; }
    const mw = parseFloat(getComputedStyle(el).maxWidth);
    if (mw >= 520 && mw <= 660) want.add(el);
  });

  document.querySelectorAll('.xm-wide-el').forEach((el) => {
    if (!want.has(el) && col.contains(el)) el.classList.remove('xm-wide-el');
  });
  want.forEach((el) => { if (!el.classList.contains('xm-wide-el')) el.classList.add('xm-wide-el'); });
}

/** 读 X 实际渲染出来的底色判断明暗（比 meta / prefers-color-scheme 准） */
export function detectTheme(): Theme {
  const probe = (el: Element | null): number | null => {
    if (!el) return null;
    const c = getComputedStyle(el).backgroundColor;
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c);
    if (!m) return null;
    const [r, g, b, a] = [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
    if (a < 0.1) return null;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };
  const col = document.querySelector('[data-testid="primaryColumn"]');
  const l = probe(col) ?? probe(document.body) ?? 0;
  return l < 0.5 ? 'dark' : 'light';
}

function paint(el: HTMLElement, color: string): void {
  if (!touched.has(el)) touched.set(el, el.style.getPropertyValue('background-color'));
  el.style.setProperty('background-color', color, 'important');
}

function restore(): void {
  for (const [el, prev] of touched) {
    if (prev) el.style.setProperty('background-color', prev);
    else el.style.removeProperty('background-color');
  }
  touched.clear();
}

/**
 * 推文浮起：把主栏区域里所有「挡在背景前面」的底板戳透。
 *
 * 为什么必须走 JS：X 的白底/黑底是内联样式刷的，而 `paint()` 写的是**内联 important**，
 * 内联 important 的优先级高于样式表里任何 !important，CSS 一律盖不住。
 *
 * 为什么要清三层（v0.1.20 补的教训）：
 * 1. 每条推文的祖先链 cellInnerDiv → primaryColumn。时间线容器、虚拟滚动 wrapper 各带一层底。
 * 2. **primaryColumn 内部所有「整宽」容器**。这一层最容易漏：sticky 顶栏、时间线外层 section、
 *    X 偶尔插的整宽占位/覆盖层，都可能不是某条推文的祖先，CSS 选择器也写不到。判据是
 *    宽度 ≥ 主栏 85% 且高度 ≥ 36px 且背景不透明；article 里的东西（图片、引用卡）一律跳过。
 * 3. primaryColumn 的祖先一路到 body。整页表面层。
 *
 * 三个都清完，页面背景（z-index:-1 的 .xm-bg）才能从主栏整条透上来；漏任何一层，
 * 视觉上就是「推文贴在一块白板上」，玻璃带和留白全都看不出来。
 *
 * 记录原值（底色 + 底图），关闭浮起时原样还回去。虚拟滚动新插入的 cell 由低频补扫覆盖。
 */
interface PrevBg { color: string; image: string }
const wrappers = new Map<HTMLElement, PrevBg>();

/**
 * 推文祖先链上的横向分割线原值。
 *
 * 为什么光清 `.xm-cell` 内部不够：X 的 1px 分割线不一定画在 cell 里，可能画在 cell 外面那层
 * 容器上。那种线在留白正中间，肉眼读出来就是「一条边框」，正是主人一直说的「这只是边框的
 * 显示效果」。所以沿祖先链从 cell 一路清到主栏，一层都不留。
 */
const lines = new Map<HTMLElement, string>();

function wipeLine(el: HTMLElement): void {
  if (!lines.has(el)) lines.set(el, el.style.getPropertyValue('border-bottom'));
  if (el.style.getPropertyValue('border-bottom') !== '0 solid transparent') {
    el.style.setProperty('border-bottom', '0 solid transparent', 'important');
  }
}

/** computed 背景色的 alpha；解析不出来按 0 处理 */
function bgAlpha(c: string): number {
  if (!c || c === 'transparent') return 0;
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (!m) return 0;
  const parts = m[1].split(',').map((x) => x.trim());
  return parts.length > 3 ? Number(parts[3]) || 0 : 1;
}

/** 抹掉一层底色：color 与 image 都清（有的底板是渐变画的，只清 color 不管用） */
function wipeBg(el: HTMLElement): void {
  if (!wrappers.has(el)) {
    wrappers.set(el, {
      color: el.style.getPropertyValue('background-color'),
      image: el.style.getPropertyValue('background-image'),
    });
  }
  if (el.style.getPropertyValue('background-color') !== 'transparent') {
    el.style.setProperty('background-color', 'transparent', 'important');
  }
  const img = el.style.getPropertyValue('background-image');
  if (img && img !== 'none') el.style.setProperty('background-image', 'none', 'important');
}

/**
 * @param on   浮起开关
 * @param deep 是否连「整宽容器」一起扫。全量扫描要读几百个元素的计算样式，只在
 *             settings 变化 / 首屏时做；1.5s 的补扫只补新插入推文的祖先链，避免掉帧。
 */
const CELL_CLS = 'xm-cell';
const ART_CLS = 'xm-art';

/**
 * 给每条推文标记它的「单元格」（`.xm-cell`）和「推文本体」（`.xm-art`）。
 *
 * 为什么不用 `data-testid="cellInnerDiv"`：那是 X 内部的实现细节，版本一换就没了。
 * v0.1.20 之前 CSS 全靠它命名，在主人的真实页面上一条都没匹配上 —— 表现就是
 * 没有间隔、没有玻璃带，而且**完全不报错**，只能看截图才发现。
 *
 * 为什么连 article 也要单独打标记：v0.1.21 用的是 `.xm-cell>div>article` 这种固定深度
 * 选择器，而 X 的推文外面套了两层 div（cellInnerDiv > div > div > article），深度对不上，
 * 玻璃带依旧不渲染。CSS 里没有「最近祖先」这种表达，深度又不能写死，索性由 JS 认准
 * 最外层那条 article 直接打标记，CSS 只认 `.xm-art`。
 */
function markFloatCells(col: HTMLElement): HTMLElement[] {
  const cw = col.getBoundingClientRect().width || 0;
  const arts = [...col.querySelectorAll<HTMLElement>('article')].filter(
    (a) => !a.parentElement?.closest('article'),
  );
  const cells: HTMLElement[] = [];
  for (const a of arts) {
    if (!a.classList.contains(ART_CLS)) a.classList.add(ART_CLS);
    let cell: HTMLElement | null = a.closest<HTMLElement>('[data-testid="cellInnerDiv"]');
    if (!cell) {
      let el: HTMLElement | null = a.parentElement;
      for (let i = 0; el && el !== col && i < 6; i++, el = el.parentElement) {
        const r = el.getBoundingClientRect();
        if (cw > 0 && r.width >= cw * 0.9 && r.height >= 40) { cell = el; break; }
      }
    }
    if (!cell) cell = a.parentElement;
    if (!cell) continue;
    if (!cell.classList.contains(CELL_CLS)) cell.classList.add(CELL_CLS);
    cells.push(cell);
  }
  return cells;
}

export function clearFloatWrappers(on: boolean, deep = true): void {
  if (!on) {
    document.querySelectorAll<HTMLElement>('.' + CELL_CLS).forEach((el) => el.classList.remove(CELL_CLS));
    document.querySelectorAll<HTMLElement>('.' + ART_CLS).forEach((el) => el.classList.remove(ART_CLS));
    for (const [el, prev] of wrappers) {
      if (!el.isConnected) continue;
      if (prev.color) el.style.setProperty('background-color', prev.color);
      else el.style.removeProperty('background-color');
      if (prev.image) el.style.setProperty('background-image', prev.image);
      else el.style.removeProperty('background-image');
    }
    wrappers.clear();
    for (const [el, prev] of lines) {
      if (!el.isConnected) continue;
      if (prev) el.style.setProperty('border-bottom', prev);
      else el.style.removeProperty('border-bottom');
    }
    lines.clear();
    return;
  }
  const col = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]');
  if (!col) return;

  // 1) 每条推文的祖先链：cell → primaryColumn（底色和横线一起清）
  markFloatCells(col).forEach((cell) => {
    for (let el: HTMLElement | null = cell; el; el = el.parentElement) {
      wipeBg(el);
      if (el !== col) wipeLine(el);
      if (el === col) break;
    }
  });

  // 2) primaryColumn 内部所有整宽容器（不是推文祖先的那些）
  const cw = col.getBoundingClientRect().width;
  if (deep && cw > 200) {
    col.querySelectorAll<HTMLElement>('div,section,main,header,aside').forEach((el) => {
      if (el === col || (el.closest && el.closest('article'))) return;
      const r = el.getBoundingClientRect();
      if (r.width < cw * 0.85 || r.height < 36) return;
      const cs = getComputedStyle(el);
      const hasImg = cs.backgroundImage !== 'none' && cs.backgroundImage !== '';
      if (bgAlpha(cs.backgroundColor) < 0.02 && !hasImg) return;
      wipeBg(el);
    });
  }

  // 3) primaryColumn 的祖先一路到 body
  for (let el = col.parentElement; el && el !== document.documentElement; el = el.parentElement) wipeBg(el);

  // 4) 量相邻两条的实际间距，padding 撑不开就自动退回紧凑模式
  if (deep) checkFloatGap();
}

/**
 * 「推文独立成块」用的主栏透明。
 *
 * 为什么不用 CSS 按层数清（`primaryColumn>div>div…`）：吸顶的「为你推荐 / 正在关注」
 * 标签栏正好也在那几层里，一起透明掉以后推文滚动时会从它底下穿过去，糊成一片。
 *
 * 改成顺着每条推文的祖先链往上擦：cell → 时间线容器 → 主栏。标签栏是主栏的
 * **兄弟**，不在任何推文的祖先链上，天然不会碰到。再遇到 sticky / fixed 就停手，
 * 免得把吸顶元素自己的底板也擦掉。
 *
 * 从 cell 的父层开始擦，**不擦 cell 本身** —— 卡片底色就画在 cell 上，
 * 内联 !important 会压过样式表，擦掉就没卡片了。
 */
const cardWrappers = new Map<HTMLElement, PrevBg>();

function wipeCardBg(el: HTMLElement): void {
  if (!cardWrappers.has(el)) {
    cardWrappers.set(el, {
      color: el.style.getPropertyValue('background-color'),
      image: el.style.getPropertyValue('background-image'),
    });
  }
  if (el.style.getPropertyValue('background-color') !== 'transparent') {
    el.style.setProperty('background-color', 'transparent', 'important');
  }
  const img = el.style.getPropertyValue('background-image');
  if (img && img !== 'none') el.style.setProperty('background-image', 'none', 'important');
}

export function clearCardWrappers(on: boolean): void {
  if (!on) {
    for (const [el, prev] of cardWrappers) {
      if (!el.isConnected) continue;
      if (prev.color) el.style.setProperty('background-color', prev.color);
      else el.style.removeProperty('background-color');
      if (prev.image) el.style.setProperty('background-image', prev.image);
      else el.style.removeProperty('background-image');
    }
    cardWrappers.clear();
    return;
  }
  const col = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]');
  if (!col) return;

  col.querySelectorAll<HTMLElement>('[data-testid="cellInnerDiv"]').forEach((cell) => {
    for (let el: HTMLElement | null = cell.parentElement; el; el = el.parentElement) {
      if (el === col) {
        wipeCardBg(el);
        break;
      }
      // 已擦过就跳过继续往上，不 break —— X 可能在这中间新插一层
      if (cardWrappers.has(el) && el.style.getPropertyValue('background-color') === 'transparent') continue;
      const pos = getComputedStyle(el).position;
      if (pos === 'sticky' || pos === 'fixed') break;
      wipeCardBg(el);
    }
  });

  // 主栏外面那几层整页底色也一起透，否则还是挡在壁纸前面
  for (let el = col.parentElement; el && el !== document.documentElement; el = el.parentElement) {
    const pos = getComputedStyle(el).position;
    if (pos === 'sticky' || pos === 'fixed') break;
    wipeCardBg(el);
  }
}

const QUOTE_CLS = 'xm-quote';
const PHOTO_CLS = 'xm-photo';
const MEDIA_CLS = 'xm-media';
const FLAT_CELL_CLS = 'xm-cell-flat';
/** 本函数清过的 border-bottom 原值（与「推文浮起」的 lines 分开存，互不覆盖） */
const flatLines = new Map<HTMLElement, string>();

function wipeFlatLine(el: HTMLElement): void {
  if (!flatLines.has(el)) flatLines.set(el, el.style.getPropertyValue('border-bottom'));
  if (el.style.getPropertyValue('border-bottom') !== '0 solid transparent') {
    el.style.setProperty('border-bottom', '0 solid transparent', 'important');
  }
}

/**
 * 「去边框线条」：推文之间的横线、引用卡片的圆角与描边，全部抹掉。
 * 主栏左右那两条竖线由 CSS 直接清（`border-left/right:0`），这类线一定画在
 * primaryColumn 上，不需要认结构。
 *
 * 横线要清的原因：X 的 1px 分割线不一定画在 cell 内，可能画在 cell 外面那层容器上，
 * CSS 只能写到固定深度。所以沿祖先链从 cell 一路清到主栏，一层不留。
 * 记录原值，关掉时原样还回去。
 *
 * 引用卡片：判定完全基于计算样式，不猜结构 —— 从「推文里的推文」（嵌套 article）
 * 出发往上走，凡是带圆角（border-radius > 0）或带边框（width > 0 且 style 不是 none）
 * 的祖先，一律打上 .xm-quote。只走**祖先**：卡片里的头像、媒体缩略图都是后代，
 * 它们本来就该是圆的（头像常是 9999px），误伤会把头像削成方块。
 * 走到外层 article 就停，绝不上溯到整条时间线。
 *
 * X 重建节点后 class 会丢，所以跟着低频补扫反复跑；已带标记的直接跳过，
 * 只有真正需要判断的元素才调 getComputedStyle。
 */
export function applyFlat(on: boolean): void {
  const html = document.documentElement;
  html.classList.toggle('xm-flat', on);
  // 只有「关掉」时才摘标记。开着的时候**绝不先摘再重加**（v0.1.46）：
  // 旧实现每轮扫描都先把三类标记全摘掉，摘与加之间只要落下一帧绘制，
  // X 原生的 16px 圆角与 1px 描边就会闪出来；hover 那轮判不回来，这一帧就变常驻，
  // 表现成「鼠标一动，圆角/直角来回切」。
  for (const cls of [QUOTE_CLS, PHOTO_CLS, MEDIA_CLS, FLAT_CELL_CLS]) {
    if (!on) document.querySelectorAll<HTMLElement>('.' + cls).forEach((el) => el.classList.remove(cls));
  }
  if (!on) {
    for (const [el, prev] of flatLines) {
      if (!el.isConnected) continue;
      if (prev) el.style.setProperty('border-bottom', prev);
      else el.style.removeProperty('border-bottom');
    }
    flatLines.clear();
    return;
  }
  const col = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]');
  if (!col) return;

  const cw = col.getBoundingClientRect().width || 0;
  // 只取最外层推文（引用推文里还有一层 article，不能当成独立的一条）
  const arts = [...col.querySelectorAll<HTMLElement>('article')].filter((a) => !a.parentElement?.closest('article'));

  // 1) 每条推文的单元格：标记它，并清掉它到主栏之间所有层的横线
  arts.forEach((a) => {
    let cell: HTMLElement | null = a.closest<HTMLElement>('[data-testid="cellInnerDiv"]');
    if (!cell) {
      let el: HTMLElement | null = a.parentElement;
      for (let i = 0; el && el !== col && i < 6; i++, el = el.parentElement) {
        const r = el.getBoundingClientRect();
        if (cw > 0 && r.width >= cw * 0.9 && r.height >= 40) { cell = el; break; }
      }
    }
    if (!cell) return;
    cell.classList.add(FLAT_CELL_CLS);
    for (let el: HTMLElement | null = cell; el && el !== col; el = el.parentElement) wipeFlatLine(el);
  });

  // 2) 引用卡片：从嵌套 article 往上，带圆角或边框的层全部标记
  const nested = col.querySelectorAll<HTMLElement>('article article, [data-testid="tweet"] [data-testid="tweet"]');
  nested.forEach((node) => {
    let el: HTMLElement | null = node.parentElement;
    for (let i = 0; el && el !== col && i < 8; i++, el = el.parentElement) {
      if (el.tagName === 'ARTICLE') break; // 到外层推文就停
      // 判据改成**结构式**：从引用层到外层推文之间的每一层都标记，不再问「这一层此刻有没有圆角」。
      // 按旧判据，hover 时 X 一旦改了这些层的计算样式（换包装层、改 hover 态），这一轮就判不出来，
      // 标记掉了 → 圆角回来；鼠标移开又判得出来 → 变直角，就是主人看到的「来回切」。
      // 这些层本来只包着卡片，清零圆角/描边不会伤到卡片里的头像（那是后代，不在祖先链上）。
      if (!el.classList.contains(QUOTE_CLS)) el.classList.add(QUOTE_CLS);
    }
  });
  // 2b) 引用卡片（卡片内部没有嵌套 article 的那种结构）：从卡片里的正文块往上走，
  //     用「含 User-Name + 16px 级圆角 + 宽度 ≥150px」三条一起认定卡片容器。
  //     只走祖先；半径上限 100 把头像那种 9999px 全圆挡在外面，宽度下限把小的圆形徽标挡在外面。
  col.querySelectorAll<HTMLElement>('[data-testid="tweetText"]').forEach((node) => {
    let el: HTMLElement | null = node.parentElement;
    for (let i = 0; el && el !== col && i < 10; i++, el = el.parentElement) {
      if (el.tagName === 'ARTICLE') break; // 到所属推文就停
      if (el.classList.contains(QUOTE_CLS)) continue;
      const cs = getComputedStyle(el);
      const radius = Math.max(
        parseFloat(cs.borderTopLeftRadius) || 0,
        parseFloat(cs.borderBottomRightRadius) || 0,
      );
      if (radius <= 0 || radius > 100) continue;
      if (!el.querySelector('[data-testid="User-Name"]')) continue;
      if (el.getBoundingClientRect().width < 150) continue;
      el.classList.add(QUOTE_CLS);
    }
  });

  // 3) 内嵌图片：X 的圆角不在 img 上，而在 <a> 与外面几层 div 上（还常配 overflow:hidden 裁切），
  //    所以从 tweetPhoto 出发往上找带圆角的层。到 article 或引用卡片就停，绝不越过推文边界。
  const media = col.querySelectorAll<HTMLElement>('[data-testid="tweetPhoto"]');
  media.forEach((node) => {
    let el: HTMLElement | null = node;
    for (let i = 0; el && el !== col && i < 12; i++, el = el.parentElement) {
      if (el.tagName === 'ARTICLE' || el.classList.contains(QUOTE_CLS)) break;
      // 结构式：tweetPhoto 到 article 之间的每一层都标记，不看「此刻有没有圆角」。
      // 图片 hover 时 X 会换包装层 / 改计算样式，按旧判据那一轮就漏标，圆角随即回来。
      if (!el.classList.contains(PHOTO_CLS)) el.classList.add(PHOTO_CLS);
    }
  });

  // 4) 卡片封面 / 视频封面（带「来自 xxx.com」的外链卡、纯视频、GIF）：
  //    这类媒体不叫 tweetPhoto —— 封面是卡片里的一个 <img>（有时是 div 背景图），
  //    圆角画在包裹它的 <a> / card.layout* / 外层 div 上，还配一圈 1px 描边。
  //    种子取 article 里的「媒体」，往上找带圆角的层。封面有三种写法，都要覆盖：
  //      · <img>                       —— 外链卡封面、GIF
  //      · <video> / videoComponent    —— 视频
  //      · div + 内联 background-image —— X 大量用这种画封面（tweetPhoto 里也常见）
  //    两道过滤挡住头像与圆标：
  //    ① 种子自身实测宽 < 100px → 跳过（头像 40–48px、表情图、小图标都在这一档）
  //    ② 层自身是正方形且半径 ≥ 边长/2（即全圆）→ 跳过（头像内层容器常写 50%）
  //    半径上限 100 再兜一层：9999px 那种写法只有头像会用。
  //    走到 article 或引用卡片就停。
  const seeds = col.querySelectorAll<HTMLElement>(
    'article img, article video, article [style*="background-image"],' +
      ' article [data-testid^="card."], article [data-testid^="video"], article [data-testid="tweetPhoto"]',
  );
  seeds.forEach((seed) => {
    const selfSize = seed.getBoundingClientRect();
    const painted =
      seed.tagName === 'IMG' ||
      seed.tagName === 'VIDEO' ||
      (seed.getAttribute('style') || '').includes('background-image');
    if (painted && selfSize.width < 100) return; // 头像 / 小图标
    let el: HTMLElement | null = seed;
    for (let i = 0; el && el !== col && i < 12; i++, el = el.parentElement) {
      if (el.tagName === 'ARTICLE' || el.classList.contains(QUOTE_CLS)) break;
      if (el.classList.contains(MEDIA_CLS)) continue;
      const cs = getComputedStyle(el);
      const radius = Math.max(
        parseFloat(cs.borderTopLeftRadius) || 0,
        parseFloat(cs.borderBottomRightRadius) || 0,
      );
      // 结构式：这一层现在有没有圆角都要清（hover 会把它改掉，按「有圆角才标」就会漏）。
      // 半径只剩一个用途 —— 认出全圆，把头像 / 圆形徽标排除在外。
      if (radius > 100) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && Math.abs(r.width - r.height) <= 4 && radius >= Math.min(r.width, r.height) / 2 - 1) {
        continue; // 全圆：头像 / 圆形徽标
      }
      el.classList.add(MEDIA_CLS);
    }
  });

  // 诊断用：一行就能看到「认到几条推文 / 当前挂着多少个标记」。
  // ⚠️ 统计的是**总数**不是本轮新增：applyFlat 现在幂等，增量基本恒为 0，写增量会看不出有没有生效。
  html.dataset.xmFlatCells = String(arts.length);
  html.dataset.xmFlatQuotes = String(col.querySelectorAll('.' + QUOTE_CLS).length);
  html.dataset.xmFlatPhotos = String(col.querySelectorAll('.' + PHOTO_CLS).length);
  html.dataset.xmFlatMedia = String(col.querySelectorAll('.' + MEDIA_CLS).length);
}

/**
 * padding 到底有没有真的把两条推文拉开？
 *
 * 口径必须量 **article 之间**：padding 是加在 cell 内部的，两个相邻 cell 的边框始终紧贴
 * （cell 的 rect 间距恒为 0），量 cell 只会得出 0，误判成「没生效」。真正的视觉间隔 =
 * 后一条 article 的 top − 前一条 article 的 bottom。
 * 结果写进 `<html data-xm-gap>`，不自动改样式：实测 X 是普通流布局，padding 生效即 56px，
 * 自动降级反而可能因为一次测量时机不对把留白永久关掉。
 */
function checkFloatGap(): void {
  const arts = [...document.querySelectorAll<HTMLElement>('.' + ART_CLS)];
  if (arts.length < 2) return;
  const a = arts[0].getBoundingClientRect();
  const b = arts[1].getBoundingClientRect();
  if (a.height < 1 || b.height < 1) return;
  document.documentElement.dataset.xmGap = String(Math.round(b.top - a.bottom));
}

/** 设置面板的配色：跟着 X 的实际主题走，深色 / 浅色各一套（早先写死深色，浅色主题下很突兀） */
const UI: Record<Theme, Record<string, string>> = {
  dark: {
    '--xm-ui-fg': '#e7e9ea',
    '--xm-ui-sub': '#8b98a5',
    '--xm-ui-dim': '#6b7480',
    '--xm-ui-bg': 'rgba(17,17,19,.9)',
    '--xm-ui-card': 'rgba(255,255,255,.04)',
    '--xm-ui-line': 'rgba(255,255,255,.11)',
    '--xm-ui-hover': 'rgba(255,255,255,.07)',
    '--xm-ui-seg': 'rgba(255,255,255,.06)',
    '--xm-ui-on': 'rgba(255,255,255,.15)',
    /* 推文块（深色）：接近不透明的深灰，像一张张实心卡片铺在背景上。
       半透明（16% 白）在花背景上太透，条与条之间分不出来；参照主人给的排版示意，
       要的是「实体块 + 块间留白」，所以浓度拉到 96%。 */
    '--xm-float-bg': 'rgba(20,22,26,.96)',
    /* 推文卡片（深色）：主栏现在完全透明，卡片自己就是一块底板。
       压到 88% 深色 —— 11% 白在半透明主栏上能用，但主栏一透明就糊成一层雾，
       文字对比度掉得厉害；留 12% 透气，又能看清壁纸。 */
    '--xm-card-bg': 'rgba(18,20,24,.88)',
    '--xm-card-x': '0px',
    /* 缝隙 = 2×gap，卡片边到内容 = pad − gap */
    '--xm-card-gap': '12px',
    '--xm-card-pad': '22px',
  },
  light: {
    '--xm-ui-fg': '#0f1419',
    '--xm-ui-sub': '#536471',
    '--xm-ui-dim': '#75858f',
    '--xm-ui-bg': 'rgba(252,252,253,.93)',
    '--xm-ui-card': 'rgba(0,0,0,.028)',
    '--xm-ui-line': 'rgba(0,0,0,.1)',
    '--xm-ui-hover': 'rgba(0,0,0,.045)',
    '--xm-ui-seg': 'rgba(0,0,0,.045)',
    '--xm-ui-on': '#ffffff',
    /* 推文块（浅色）：接近纯白的实体块，块与块之间露出页面背景 */
    '--xm-float-bg': 'rgba(255,255,255,.95)',
    /* 推文卡片（浅色）：白底实体块，块与缝隙靠明度差分开 */
    '--xm-card-bg': 'rgba(255,255,255,.90)',
    '--xm-card-x': '0px',
    '--xm-card-gap': '12px',
    '--xm-card-pad': '22px',
  },
};

function paintUI(theme: Theme, withBg = true): void {
  const html = document.documentElement;
  for (const [k, v] of Object.entries(UI[theme])) html.style.setProperty(k, v);
  // 卡片底色分两套：
  //   有壁纸 → 实体块（88% 深 / 90% 白），块与缝的差靠不透明度；
  //   没壁纸 → 主栏透明后页面是纯色，实体块会和页面同色、缝隙彻底看不见，
  //            这时只要一点点明度差（深色提亮 6%，浅色压暗 3%）。
  html.style.setProperty(
    '--xm-card-bg',
    withBg
      ? theme === 'dark' ? 'rgba(18,20,24,.88)' : 'rgba(255,255,255,.90)'
      : theme === 'dark' ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.03)',
  );
  // 柔化规则挂在 html.xm-dark 上：浅色主题不参与
  html.classList.toggle('xm-dark', theme === 'dark');
}

/** #rrggbb → rgba()（强调色的浅底 / 描边都从主色算出来，不另设第二个色值） */
function alpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * 强调色：开关、滑块、选中态、齿轮、面板里的小按钮全用 --xm-acc。
 * 挂在 <html> 上，面板与内容层都能继承；同时给两个派生色，省得各处自己算透明度。
 */
export function applyAccent(hex: string): void {
  const st = document.documentElement.style;
  st.setProperty('--xm-acc', hex);
  st.setProperty('--xm-acc-soft', alpha(hex, 0.16));
  st.setProperty('--xm-acc-glow', alpha(hex, 0.45));
}

/**
 * 把 X 的底色换成半透明玻璃。on=false 时原样还原。
 * 从主栏往上走祖先链：全部透明，只有「真正承载内容的表面」留半透明玻璃。
 *
 * float=true（推文浮起）：主栏不铺玻璃，直接透明 —— 让页面背景整条透上来。
 * 这里必须走 JS 而不是样式表：paint() 写的是**内联 important**，
 * 内联 important 的优先级高于任何样式表的 !important，CSS 根本盖不住它。
 */
/**
 * @param bareColumn 主栏不刷底板：推文浮起 / 推文独立成块时都要，否则整条时间线
 *                   还是贴在一块板上，缝隙里看到的只是这块板。
 */
export function applySkin(theme: Theme, on: boolean, glass: Glass = 'mid', softText = true, bareColumn = false): void {
  const html = document.documentElement;
  html.classList.toggle('xm-skin', on);
  html.classList.toggle('xm-soft', softText);
  html.dataset.glass = glass;
  document.documentElement.style.setProperty('--xm-scrim', theme === 'dark' ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.22)');
  // 面板配色与背景开关无关：背景关了面板照样要跟着主题走；卡片底色要看有没有壁纸
  paintUI(theme, on);
  restore();
  if (!on) return;

  const col = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]');
  if (col) {
    // 祖先链透明：这些层原本画的就是整页底色
    for (let el = col.parentElement; el && el !== document.documentElement; el = el.parentElement) paint(el, 'transparent');
    paint(col, bareColumn ? 'transparent' : surface(theme, glass));
  }
  const side = document.querySelector<HTMLElement>('[data-testid="sidebarColumn"]');
  if (side) {
    for (let el = side.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      if (!touched.has(el)) paint(el, 'transparent');
    }
    paint(side, surface(theme, glass, false));
  }
  // 顶栏：保留毛玻璃，底色半透明
  const bar = document.querySelector<HTMLElement>('header[role="banner"]');
  if (bar) {
    paint(bar, surface(theme, glass, false));
  }
}

/** 字体：choice 决定字体栈，custom 用本机字体名，scale 走 zoom */
export function applyFont(choice: 'x' | 'sans' | 'serif' | 'custom', custom: string, scale: 100 | 110 | 120): void {
  const html = document.documentElement;
  const stacks: Record<'sans' | 'serif', string> = {
    sans: '"Geist","Margin Sans SC",system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
    serif: '"Instrument Serif","Margin Serif SC",Georgia,"Songti SC",serif',
  };
  let stack = '';
  if (choice === 'sans') stack = stacks.sans;
  else if (choice === 'serif') stack = stacks.serif;
  else if (choice === 'custom' && custom) stack = `"${custom}",system-ui,sans-serif`;

  html.classList.toggle('xm-font', Boolean(stack));
  if (stack) html.style.setProperty('--xm-font', stack);
  else html.style.removeProperty('--xm-font');
  if (scale === 100) html.removeAttribute('data-zoom');
  else html.dataset.zoom = String(scale);
}

/**
 * 推文卡片重排：把每条 cell 的 translateY 按「实际高度累加」重写。
 *
 * 为什么需要：我们给 article 加大了上下内边距（--xm-card-pad），cell 变高；
 * 而 X 的虚拟列表把每条 cell 的 translateY **写死在行内**，它不会因为我们改高度而重算，
 * 结果就是第二条开始整体压上来 / 错位。
 *
 * 做法：按 DOM 顺序累加 offsetHeight，逐条写 translateY；第一条的原始 Y 作基准，
 * 保证不把整条时间线往上或往下挪。写的时候带 `important`：X 之后再怎么重设行内样式
 * 也压不掉（反过来也意味着位置完全由这里负责，所以 tick / scroll 里要反复调，幂等）。
 *
 * 只碰 `cellInnerDiv` 与时间线容器，不碰 article 内部，也不碰任何 X 的 class。
 */
const TY_RE = /translateY\((-?[\d.]+)px\)/;

export function reflowCards(): void {
  const col = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]');
  if (!col) return;
  const cells = Array.from(col.querySelectorAll<HTMLElement>('[data-testid="cellInnerDiv"]'));
  if (cells.length < 2) return;

  const m0 = TY_RE.exec(cells[0].style.transform || '');
  const base = m0 ? parseFloat(m0[1]) : 0;
  let acc = base;
  let moved = 0;
  for (const c of cells) {
    const h = c.offsetHeight;
    if (h === 0) continue; // 广告 / 折叠项：不占位，也不动它
    const cur = TY_RE.exec(c.style.transform || '');
    const y = cur ? parseFloat(cur[1]) : null;
    if (y === null || Math.abs(y - acc) > 0.5) {
      c.style.setProperty('transform', `translateY(${acc.toFixed(3)}px)`, 'important');
      moved++;
    }
    acc += h;
  }

  // 容器高度：X 靠它算可滚动范围，不跟着撑开的话最后几条滚不到
  const wrap = cells[0].parentElement;
  if (wrap && wrap !== col && base === 0) {
    const need = Math.round(acc);
    const cur = parseFloat(wrap.style.minHeight) || 0;
    if (Math.abs(cur - need) > 0.5) wrap.style.setProperty('min-height', `${need}px`, 'important');
  }

  document.documentElement.dataset.xmReflow = `${cells.length}/${moved}`;
}
