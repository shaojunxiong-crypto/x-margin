/**
 * 注入 X 页面的全部样式表。
 *
 * 所有规则都挂在 html 的开关类上（xm-skin / xm-card / xm-rail …），
 * 关闭开关即整块失效，不需要回滚任何内联样式。
 */

/** 背景层与整页透明 */
const BASE_CSS = `
.xm-bg{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden;
  opacity:var(--xm-bg-o,.85);transition:opacity .35s ease}
.xm-bg[data-mode="off"]{display:none}
.xm-bg canvas,.xm-bg-img{position:absolute;inset:0;width:100%;height:100%;display:block}
.xm-bg canvas{object-fit:cover}
.xm-bg-img{background-size:cover;background-position:center;background-repeat:no-repeat;display:none}
.xm-bg[data-mode="image"] .xm-bg-img{display:block}
.xm-bg[data-mode="image"] canvas{display:none}
.xm-bg-scrim{position:absolute;inset:0;background:var(--xm-scrim,rgba(0,0,0,.18));transition:background .35s ease}
.xm-bg[data-soft] .xm-bg-scrim{background:var(--xm-scrim,rgba(0,0,0,.3))}
html.xm-skin,html.xm-skin body{background-color:transparent!important}
html.xm-skin #react-root{background-color:transparent!important}
`;

/**
 * 纯黑模式下的文字柔化：只压「主文字」这一档（#f7f9f9 → #c8ced3），
 * 次级文字与链接蓝不动，信息层级不变。
 * 按内联色值筛选是因为 X 的文本色全是内联 style，按容器覆盖会连 @handle、时间戳一起提亮。
 */
const SOFT_CSS = `
html.xm-dark.xm-soft [style*="rgb(247, 249, 249)"],
html.xm-dark.xm-soft [style*="rgb(247,249,249)"],
html.xm-dark.xm-soft [style*="rgb(231, 233, 234)"],
html.xm-dark.xm-soft [style*="rgb(231,233,234)"]{color:var(--xm-soft-fg,#c8ced3)!important}
html.xm-dark.xm-soft [data-testid="tweetText"],
html.xm-dark.xm-soft [data-testid="User-Name"]{color:var(--xm-soft-fg,#c8ced3)!important}
`;

/**
 * 去线条与直角化。圆角/描边的元素一律由 JS 打标记（.xm-quote / .xm-photo / .xm-media），
 * CSS 只认自有 class —— X 的嵌套深度每个版本都在变，写死层级会静默失效。
 */
const QUOTE_CSS = `
html.xm-flat [data-testid="primaryColumn"],
html.xm-flat [data-testid="primaryColumn"]>div{
  border-left:0!important;border-right:0!important;
}
html.xm-flat .xm-cell-flat,
html.xm-flat .xm-cell-flat>div,
html.xm-flat .xm-cell-flat>div>div,
html.xm-flat .xm-cell-flat>div>div>div{
  border-bottom:0!important;
}
html.xm-flat .xm-quote{
  border-radius:0!important;
  border:0!important;
  box-shadow:none!important;
}
html.xm-flat .xm-photo{border-radius:0!important}
html.xm-flat [data-testid="tweetPhoto"] img{border-radius:0!important}
html.xm-flat .xm-media{
  border-radius:0!important;
  border:0!important;
  box-shadow:none!important;
}
html.xm-flat .xm-media img,
html.xm-flat .xm-media video,
html.xm-flat article video{border-radius:0!important}
`;

/**
 * 推文独立成块。
 * 缝隙不能用 margin / padding 造：cell 是 absolute + translateY，高度一变 X 写死的 y 就错位。
 * 改用 clip-path 只裁绘制，盒子尺寸不动；代价是 article 内边距被裁掉一部分，
 * 所以要把内边距先抬高（--xm-card-pad），再由 reflowCards() 重排 translateY。
 */
const CELL_CARD_CSS = `
html.xm-card [data-testid="primaryColumn"]{
  background-color:transparent!important;
  background-image:none!important;
  border-left:0!important;
  border-right:0!important;
}
html.xm-card [data-testid="primaryColumn"] [data-testid="cellInnerDiv"]{
  clip-path:inset(var(--xm-card-gap,12px) var(--xm-card-x,0px) var(--xm-card-gap,12px) var(--xm-card-x,0px) round var(--xm-card-r,0px))!important;
  background-color:var(--xm-card-bg,rgba(255,255,255,.055))!important;
}
html.xm-card [data-testid="primaryColumn"] article[data-testid="tweet"]{
  padding-top:var(--xm-card-pad,22px)!important;
  padding-bottom:var(--xm-card-pad,22px)!important;
}
html.xm-card [data-testid="primaryColumn"] [data-testid="cellInnerDiv"]>div,
html.xm-card [data-testid="primaryColumn"] [data-testid="cellInnerDiv"]>div>div,
html.xm-card [data-testid="primaryColumn"] [data-testid="cellInnerDiv"]>div>div>div{
  background-color:transparent!important;
}
`;

/** 字体与玻璃：字号缩放走 zoom，其余一律 font-family */
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
 * 布局：去右栏、加宽、去广告、发推面板、滚动条、浮动按钮。
 * 去右栏后必须给主栏 auto 外边距，否则 350px 的空白全堆在右边，整页左歪。
 */
const LAYOUT_CSS = `
html.xm-noside [data-testid="sidebarColumn"]{display:none!important}
html.xm-noside main[role="main"]{flex-grow:1}
html.xm-noside [data-testid="primaryColumn"]{margin-left:auto!important;margin-right:auto!important}
html.xm-wide main[role="main"]{max-width:none!important}
html.xm-wide [data-testid="primaryColumn"]{
  width:var(--xm-feed-w,720px)!important;
  max-width:var(--xm-feed-w,720px)!important;
  min-width:0!important;
  flex-basis:var(--xm-feed-w,720px)!important;
}
html.xm-wide [data-testid="primaryColumn"] .xm-wide-el{max-width:var(--xm-feed-w,720px)!important}
/* 推广：placementTracking 是唯一稳定锚点（「Ad」只是文本）。三种嵌套都要收，整条 cell 一起藏才不留空。 */
html.xm-noads [data-testid="cellInnerDiv"]:has([data-testid="placementTracking"]),
html.xm-noads [data-testid="placementTracking"]:has(article[data-testid="tweet"]),
html.xm-noads article[data-testid="tweet"]:has([data-testid="placementTracking"]){display:none!important}
html.xm-nocompose .xm-comp-hide{display:none!important}
html.xm-hidecompose [data-testid="SideNav_NewTweet_Button"]{display:none!important}
/* 滚动条：只碰根容器，弹窗与列表内部保留。两条缺一不可 —— 只写 scrollbar-width 时 Windows 的经典滚动条还在。 */
html.xm-noscroll,html.xm-noscroll body{scrollbar-width:none!important;scrollbar-gutter:auto!important}
html.xm-noscroll::-webkit-scrollbar,html.xm-noscroll body::-webkit-scrollbar{
  width:0!important;height:0!important;display:none!important}
/* 右下角浮动按钮。i 标志必需：不同版本大小写不一致（DMDrawer / dmDrawer）；
   私信入口在 2026 版改名 Chat，testid 换成 chat-drawer-*，两套并存。 */
html.xm-nofloat [data-testid="DMDrawer" i],
html.xm-nofloat [data-testid="DMDrawerButton" i],
html.xm-nofloat [data-testid="chat-drawer-root" i],
html.xm-nofloat [data-testid="chat-drawer-main" i],
html.xm-nofloat [data-testid="GrokDrawer" i],
html.xm-nofloat [data-testid="GrokDrawerButton" i]{display:none!important}
html.xm-nofloat .xm-float-hide{display:none!important}
`;

/**
 * 图标导航栏：header 改成 76px 宽的 fixed 竖列，只留图标。
 * header 脱离文档流后占位由父元素的 padding-left 补回，不改父元素的 display / flex，
 * 主栏的 margin:auto 居中才继续成立。
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
html.xm-rail header[role="banner"] span{display:none!important}
html.xm-rail header[role="banner"] a[href]{
  width:52px!important;height:52px!important;min-width:0!important;
  padding:0!important;margin:2px auto!important;border-radius:9999px!important;
  display:flex!important;justify-content:center!important;align-items:center!important;
  overflow:hidden!important;
}
/* 隐藏文字容器要以 svg 为准。⛔ 不能写 :has(span)：图标 div 里带 sr-only 的 span，会连图标一起藏。 */
html.xm-rail header[role="banner"] a[href] div:not(.xm-badge){
  margin:0!important;padding:0!important;min-width:0!important;flex:none!important;
}
html.xm-rail header[role="banner"] a[href]>div:not(:has(svg)):not(.xm-badge){display:none!important}
html.xm-rail header[role="banner"] a[href] span:has(svg){display:block!important}
html.xm-rail header[role="banner"] a[href] svg{display:block!important}
/* 未读角标：上面两条会把它一起藏掉，JS 给整棵子树打 .xm-badge 后在这里放行。
   ⛔ 只对 span 用 revert，绝不碰 div —— 角标容器靠 flex 居中，revert 会让数字跑出可视区。 */
html.xm-rail header[role="banner"] span.xm-badge,
html.xm-rail header[role="banner"] .xm-badge span{display:revert!important}
html.xm-rail header[role="banner"] .xm-mono{
  filter:grayscale(1) contrast(1.04)!important;
  opacity:.92!important;
}
html.xm-rail header[role="banner"] [data-testid="SideNav_NewTweet_Button"]{
  width:52px!important;height:52px!important;min-width:0!important;
  padding:0!important;margin:10px auto!important;border-radius:50%!important;
  display:flex!important;align-items:center!important;justify-content:center!important;
}
html.xm-rail header[role="banner"] [data-testid="SideNav_NewTweet_Button"]::after{
  content:"";width:24px;height:24px;display:block;background:currentColor;
  -webkit-mask:var(--xm-pen) center/contain no-repeat;mask:var(--xm-pen) center/contain no-repeat;
}
/* 账户头像整条去掉：齿轮按钮 fixed 钉在同一位置（见 panel.place），两者并存会重叠。 */
html.xm-rail header[role="banner"] [data-testid="SideNav_AccountSwitcher_Button"]{display:none!important}
/* 通用隐藏必须排最后：同文件 a[href]{display:flex!important} 是 (0,3,3)，
   单类 .xm-hide (0,3,2) 会输给它，所以这里逐类补特异性。 */
html.xm-rail header[role="banner"] .xm-hide,
html.xm-rail header[role="banner"] a[href].xm-hide,
html.xm-rail header[role="banner"] [role="button"].xm-hide,
html.xm-rail header[role="banner"] [data-testid].xm-hide{display:none!important}
`;

const CSS = BASE_CSS + SOFT_CSS + QUOTE_CSS + CELL_CARD_CSS + FONT_CSS + LAYOUT_CSS + RAIL_CSS;

let injected = false;

export function injectBase(): void {
  if (injected) return;
  injected = true;
  const s = document.createElement('style');
  s.id = 'xm-base';
  s.textContent = CSS;
  (document.head ?? document.documentElement).append(s);
}
