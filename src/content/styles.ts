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
/* 回退换场的幕布（stage.ts 挂 data-on）。半透明 + 3px 模糊，稳定后淡出。
   ⛔ backdrop-filter 只在 [data-on] 时才有：静止状态挂全屏模糊会常驻一层合成开销。
   ⛔ 层级压在提示浮条(…482000)之下、面板(…483001)之下：换场时浮条与面板不该被压暗。 */
.xm-stage{position:fixed;inset:0;z-index:2147481000;pointer-events:none;
  contain:layout paint;
  background:rgba(9,10,13,.6);
  opacity:0;visibility:hidden;
  transition:opacity .13s ease-out,visibility 0s linear .13s}
.xm-stage[data-on="1"]{opacity:1;visibility:visible;
  -webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);
  /* ⛔ 不能淡入：淡入 130ms 里重建后的头几帧只压暗几个百分点，抖动原样透出来。
     幕布要「瞬时出现、淡出」。撤下 data-on 时按基础规则的 .13s 过渡走，所以这里写 none 不影响淡出。 */
  transition:none}
/* 浅色主题不能压黑：白底忽然变灰比不动更刺眼，改成压白（洗淡） */
html:not(.xm-dark) .xm-stage{background:rgba(250,250,250,.62)}
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
/* 新版（Tailwind 重写版）的正文色不再写内联 style，而是 .text-primary 这个 class
   （实测正文 div 的 class 是「max-w-full text-body font-bold text-primary ...」），
   data-testid="tweetText" / "User-Name" 也都没了 —— 只留旧锚点的话柔化在新版完全不生效。
   0.2.6 补 .text-primary 一条；仍限定在 main article 里，不碰按钮、页签、次级文字。 */
html.xm-dark.xm-soft main article .text-primary,
html.xm-dark.xm-soft [data-testid="tweetText"],
html.xm-dark.xm-soft [data-testid="User-Name"]{color:var(--xm-soft-fg,#c8ced3)!important}
`;

/**
 * 去线条与直角化。
 * 圆角与描边**不再由 JS 打标记**（0.1.x 的 .xm-quote / .xm-photo / .xm-media 已废弃）：
 * X 悬停 / 懒加载 / 虚拟列表复用时会把包装层整块换掉，标记留在旧节点上，新节点要等
 * 观察器防抖才补，实测鼠标连续移动 2.5 秒有 90.5% 的帧仍是圆角。
 * 现在全部走声明式选择器（见下面「媒体直角化」一段）：节点一建出来就命中，零窗口期。
 * ⛔ 也别写死层级 —— 层级每个版本都在变，能认锚点/结构就认锚点。
 */
const QUOTE_CSS = `
/* 主栏左右两条竖线：旧锚点 primaryColumn 已消失（0.2.5 记），新版主栏是 main。 */
html.xm-flat main,
html.xm-flat main>div{
  border-left:0!important;border-right:0!important;
}
html.xm-flat .xm-cell-flat,
html.xm-flat .xm-cell-flat>div,
html.xm-flat .xm-cell-flat>div>div,
html.xm-flat .xm-cell-flat>div>div>div{
  border-bottom:0!important;
}
/* 媒体直角化：靠结构选择器声明，不靠 JS 打 class。
 * ⛔ 别再改回「JS 打 class + 观察器补扫」：X 在悬停、懒加载、虚拟列表复用时
 * 会换掉图片 / 引用卡的包装层（React 换 key 重建节点），class 留在旧节点上，
 * 新节点得等 MutationObserver 防抖 150ms 后才补。实测鼠标连续移动 2.5 秒，
 * 90.5% 的帧仍是圆角、中间切换 28 次 —— 就是「圆角直角来回切」的真身。
 * 下面这几条是声明式的：节点一建出来就命中，零窗口期（实测 217 帧零圆角）。
 * :has() 的开销与属性选择器同量级（40 条推文反复重算：1.1ms vs 0.4ms）。 */
/* 0.2.5 换锚点：新版没有 primaryColumn / tweetPhoto / video-* / card.* / User-Name / tweetText
 * 这些 testid（实测全为 0 个），原来那组选择器整片落空，媒体圆角因此全回来。
 * 新版按 CDN 路径认媒体：正文图 pbs.twimg.com/media、外链卡封面 pbs.twimg.com/card_img、
 * 头像 pbs.twimg.com/profile_images —— 用 src 前缀刚好把头像排除在外（头像必须保持圆形）。
 * 视频没有 src 可认，直接 :has(video)。圆角落在媒体外层的 div / a 上（实测 28.8 / 14.4 / 16px），
 * 所以选「含媒体的容器」，不是 img 本身。 */
html.xm-flat main article :has(img[src*="pbs.twimg.com/media"]),
html.xm-flat main article :has(img[src*="pbs.twimg.com/card_img"]),
html.xm-flat main article :has(video){
  border-radius:0!important;
}
/* 视频容器另在 ::after 里画一圈带圆角的内描边，跟外壳一起铲平 */
html.xm-flat main article :has(video)::after{border-radius:0!important}
/* 引用卡：新版没有 User-Name / tweetText 可判，改成「article 里还嵌着 article」。
 * 外层容器带 16px 圆角 + 1px 描边，一起清掉。
 * ⛔ 不要写直接子选择器：引用卡外面还裹着 flex 容器，只认直接父层会漏。 */
html.xm-flat main article :has(article){
  border-radius:0!important;
  border:0!important;
  box-shadow:none!important;
}
/* 回复 / 发帖弹层：X 给外壳 16px 圆角 + 大投影，浮在页面上跟「全局直角」明显两套语言。
   只压外壳两档 —— role=dialog 本身、它的直接子层（居中容器）。
   ⛔ 绝不写 [role="dialog"] *：那会把弹层里的头像（9999px）、媒体预览、按钮一起铲平。
   ⛔ 也不加 overflow:hidden 之外的任何改动：弹层内部排版由 X 自己算，动宽高会错位。
   ⛔ 0.2.5：新版没有 data-testid="modalDialog" / "sheetDialog"（实测 0 个），那几组
   选择器连同依赖它们的投影规则一起删了。要加回来先确认 testid 真的还在。 */
html.xm-flat [role="dialog"],
html.xm-flat [role="dialog"]>div{
  border-radius:0!important;
}
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
  clip-path:inset(var(--xm-card-gap,15px) var(--xm-card-x,0px) var(--xm-card-gap,15px) var(--xm-card-x,0px) round var(--xm-card-r,0px))!important;
  background-color:var(--xm-card-bg,rgba(255,255,255,.055))!important;
}
html.xm-card [data-testid="primaryColumn"] article[data-testid="tweet"]{
  padding-top:var(--xm-card-pad,19px)!important;
  padding-bottom:var(--xm-card-pad,19px)!important;
}
/* 通知条目：外层不是 data-testid="tweet"，是 data-testid="notification"，留白规则照给同一套。
   ⛔ 必须走样式表，不能由 JS 写内联：React 每次重渲染都会冲掉 style，
   表现就是「改了完全没效果」；而且条目里的图标是 SVG、没有 img，按头像找会漏掉大半。 */
html.xm-card [data-testid="primaryColumn"] article[data-testid="notification"]{
  padding-top:var(--xm-card-pad,19px)!important;
  padding-bottom:var(--xm-card-pad,19px)!important;
}
/* 二级页页头（通知 / 历史）收起：由 pageHead.ts 打属性，规则写在这里。
   ⛔ 不走内联样式：React 重渲染会把 style 冲掉，属性则不会被它碰。 */
[data-xm-page-head]{
  display:none!important;
}
html.xm-card [data-testid="primaryColumn"] [data-testid="cellInnerDiv"]>div,
html.xm-card [data-testid="primaryColumn"] [data-testid="cellInnerDiv"]>div>div,
html.xm-card [data-testid="primaryColumn"] [data-testid="cellInnerDiv"]>div>div>div{
  background-color:transparent!important;
}
/* 回复链：组内不裁上下，只给首尾各裁一刀。
   ⛔ 中间不能留 gap —— 裁切会切断 X 画在左侧的线程竖线，露出线头。 */
html.xm-card [data-testid="primaryColumn"] [data-testid="cellInnerDiv"].xm-thread-top{
  clip-path:inset(var(--xm-card-gap,15px) var(--xm-card-x,0px) 0 var(--xm-card-x,0px))!important;
}
html.xm-card [data-testid="primaryColumn"] [data-testid="cellInnerDiv"].xm-thread-mid{
  clip-path:inset(0 var(--xm-card-x,0px) 0 var(--xm-card-x,0px))!important;
}
html.xm-card [data-testid="primaryColumn"] [data-testid="cellInnerDiv"].xm-thread-end{
  clip-path:inset(0 var(--xm-card-x,0px) var(--xm-card-gap,15px) var(--xm-card-x,0px))!important;
}
/* 组内每条推文的可视上下留白，统一成独立卡片裁完一刀后的同一数值（pad − gap = 4px）。
   组首只裁上、组尾只裁下，所以被裁的那一侧补回 pad，未裁的一侧直接给净留白；
   中间不裁，两侧都给净留白。这样每条推文都是「上 4、下 4」，不会出现首条上 4 下 19。 */
html.xm-card [data-testid="primaryColumn"] [data-testid="cellInnerDiv"].xm-thread-top article[data-testid="tweet"]{
  padding-top:var(--xm-card-pad,19px)!important;
  padding-bottom:calc(var(--xm-card-pad,19px) - var(--xm-card-gap,15px))!important;
}
html.xm-card [data-testid="primaryColumn"] [data-testid="cellInnerDiv"].xm-thread-mid article[data-testid="tweet"]{
  padding-top:calc(var(--xm-card-pad,19px) - var(--xm-card-gap,15px))!important;
  padding-bottom:calc(var(--xm-card-pad,19px) - var(--xm-card-gap,15px))!important;
}
html.xm-card [data-testid="primaryColumn"] [data-testid="cellInnerDiv"].xm-thread-end article[data-testid="tweet"]{
  padding-top:calc(var(--xm-card-pad,19px) - var(--xm-card-gap,15px))!important;
  padding-bottom:var(--xm-card-pad,19px)!important;
}
/* 「显示回复」这类纯按钮块：文字在格子里垂直居中，底部那 15px 裁切正好切到字上。
   补回 --xm-card-pad 让裁切落在空白处，裁完仍剩 4px，与推文卡片的留白一致。 */
html.xm-card [data-testid="primaryColumn"] [data-testid="cellInnerDiv"].xm-joiner{
  padding-bottom:var(--xm-card-pad,19px)!important;
}
/* 不是组尾的按钮块两头都被裁，上侧也补一截 */
html.xm-card [data-testid="primaryColumn"] [data-testid="cellInnerDiv"].xm-joiner:not(.xm-thread-end){
  padding-top:var(--xm-card-pad,19px)!important;
}
/* 组内补线：X 自己的线只画到 article 的内容区，被 --xm-card-pad 顶开成两截。
   按同一条横坐标补一条贯穿 cell 全高的线接上；clip-path 会顺带裁掉组首/组尾多出来的那截。 */
html.xm-card [data-testid="primaryColumn"] [data-testid="cellInnerDiv"].xm-thread-top::before,
html.xm-card [data-testid="primaryColumn"] [data-testid="cellInnerDiv"].xm-thread-mid::before,
html.xm-card [data-testid="primaryColumn"] [data-testid="cellInnerDiv"].xm-thread-end::before{
  content:"";position:absolute;top:0;bottom:0;left:var(--xm-lx,-99px);
  width:var(--xm-lw,2px);background:var(--xm-lc,transparent);pointer-events:none;
}
/* 组尾那条只补到自己的头像下沿（--xm-le 由 feed.ts 量出）：链到此为止，
   再往下画就是「线扎进回复正文 / 时间戳 / 操作栏」。 */
html.xm-card [data-testid="primaryColumn"] [data-testid="cellInnerDiv"].xm-thread-end::before{
  bottom:auto;height:var(--xm-le,44px);
}
/* 组首同理，只是方向相反：线从头像下沿起步（--xm-ls 由 feed.ts 量出）。
   原来 top:0 会顶到头像上方，只能靠 clip-path 那 15px 兜；详情页首条的
   padding 比列表卡片大，兜不住，头像上方就冒出线头。 */
html.xm-card [data-testid="primaryColumn"] [data-testid="cellInnerDiv"].xm-thread-top::before{
  top:var(--xm-ls,0px);
}
/* 「显示 N 帖子」提示行：原生那条整条不显示，改由 pill.ts 在 body 上挂一条 fixed 窄带
   （.xm-pillbar），从顶栏下沿贴出来，点一下把点击转发给原生按钮。
   为什么不再改原生行的外观：真机页面里还藏着一个 display:none 的
   [data-testid="pillLabel"]，按 pillLabel 认行会把样式打到隐藏节点上
   （v0.1.70 就是这样失效的：改造条出现在隐藏节点处，真提示行仍是品牌粉）。
   ⛔ 原生行是绝对定位的 cell（内联 position:absolute + translateY），
     压成 0 高不会推移后面任何一条，只是让它自己和那 36px 占位一起消失。 */
html.xm-card [data-testid="primaryColumn"] [data-xm-pill]{
  height:0!important;min-height:0!important;max-height:0!important;
  padding:0!important;margin:0!important;
  border:0!important;box-shadow:none!important;background:none!important;
  overflow:hidden!important;clip-path:none!important;
  opacity:0!important;visibility:hidden!important;pointer-events:none!important;
}
/* 「发现更多 / 源自于整个 X」小节条：推文详情页里，回复列表之后接的相关推文流分区标。
   原来是一格「20px 标题 + 13px 副标题」的两行大字，卡片模式按 15px 裁切却不补内边距，
   字头字脚各被削掉一截。按内层结构改成单行（div:has(>h2) 做 flex）在真机上更差 ——
   真机里那层的内外边距、h2 与副标题的层级跟模拟的不一致，flex 落在了错的一层上，
   文字直接顶在裁切边、被切掉半行。
   ⇒ 现在整块不依赖内部结构：内层全部隐藏，只用伪元素画一枚居中的方角小牌。
   与提示浮块同一套语言：方角、44px、页面强调色（这里只取低透明度，做隔断不做按钮）。
   ⛔ 高度锁 74 = 44 浮块 + 上下各 15 裁切；
     真机若自然高度不同，markMoreSection 打完标记会补一次 reflowCards。 */
html.xm-card [data-testid="primaryColumn"] [data-xm-more-sec]{
  height:74px!important;min-height:0!important;max-height:74px!important;
  padding:0!important;margin:0!important;overflow:hidden!important;
  /* 不铺卡片底色：这一格是「隔断」，留成一道真正的缝隙，只让中间那枚小牌浮着，
     否则它又会变成一条横在流里的色带（与提示浮块的「小块」语言冲突）。 */
  background-color:transparent!important;
}
html.xm-card [data-testid="primaryColumn"] [data-xm-more-sec]>*{display:none!important}
/* 省略号小牌：88×44 方角，强调色淡底 + 一圈强调色描边，居中落在可视区。
   ⛔ 不再画贯穿整条的发丝线 —— 那条线会把它变回「一条压在流里的横带」，
     和提示浮块的「小块」语言冲突。
   letter-spacing 会在末尾多留一个字距，用同值 text-indent 抵掉，才真正居中。 */
html.xm-card [data-testid="primaryColumn"] [data-xm-more-sec]::after{
  content:"···";
  position:absolute;left:50%;top:var(--xm-card-gap,15px);
  width:88px;height:44px;box-sizing:border-box;
  transform:translateX(-50%);
  display:flex;align-items:center;justify-content:center;
  border:1px solid var(--xm-page-glow,var(--xm-acc-glow,rgba(128,128,128,.3)));
  border-radius:0;
  background-color:var(--xm-page-soft,var(--xm-acc-soft,rgba(128,128,128,.12)));
  font-family:var(--xm-font,system-ui,-apple-system,"Segoe UI","PingFang SC",sans-serif);
  font-size:20px;font-weight:700;line-height:1;
  letter-spacing:.2em;text-indent:.2em;
  color:var(--xm-page-acc,var(--xm-acc,#1d9bf0));
  pointer-events:none;
}
/* 提示浮块：取 X 自己「已发布」提示的**结构**（实心强调色 + 白字 + 左侧上行箭头 + 光晕）
   但外形按本项目语言收成直角 —— 全站没有圆角，这里也不许有。
   它是「有新内容」的邀约，所以做成浮在顶栏下的一小块，而不是压在内容上的横带。
   ⛔ 强调色取 --xm-page-*（theming.ts 从 X 自己的发帖按钮 / 选中页签下划线采样），
     不是设置里的 --xm-acc：两者可能撞色（实测页面粉 #f91880、设置紫 #7856ff），
     浮块贴在页面里，得跟页面走。--xm-acc 只作采不到时的兜底。
   ⛔ 外壳（.xm-pillbar）只负责定位与承载动画：满主栏宽、无底色、pointer-events:none，
     真正的块是里面那层 .xm-pillbar-in。这样居中是靠 flex 自动算的，不用在 JS 里量宽度。 */
.xm-pillbar{
  position:fixed;z-index:2147482000;left:0;top:0;width:100%;
  height:56px;box-sizing:border-box;margin:0;padding:0;
  display:flex;align-items:center;justify-content:center;
  border:0;background:none;border-radius:0;
  font-family:var(--xm-font,system-ui,-apple-system,"Segoe UI","PingFang SC",sans-serif);
  cursor:pointer;-webkit-user-select:none;user-select:none;
  pointer-events:none;
  opacity:0;visibility:hidden;
  transition:opacity .16s ease,visibility 0s linear .16s;
}
.xm-pillbar[data-on="1"]{opacity:1;visibility:visible;transition:opacity .16s ease}
.xm-pillbar-in{
  pointer-events:auto;
  display:inline-flex;align-items:center;gap:9px;
  height:44px;box-sizing:border-box;padding:0 20px 0 16px;
  border-radius:0;
  background-color:var(--xm-page-acc,var(--xm-acc,#1d9bf0));
  color:#fff;
  font-size:15px;font-weight:700;line-height:20px;letter-spacing:.01em;
  box-shadow:0 6px 22px var(--xm-page-glow,var(--xm-page-soft,rgba(29,155,240,.45))),
             0 2px 10px rgba(0,0,0,.34);
  transform:translateY(-7px) scale(.97);
  transition:transform .18s cubic-bezier(.2,.9,.3,1.35);
}
.xm-pillbar[data-on="1"] .xm-pillbar-in{transform:none}
/* 上行箭头：和 X 的「已发布」提示同构，一眼看出是「有新内容、点它刷新」 */
.xm-pillbar-in::before{
  content:"↑";font-size:19px;font-weight:800;line-height:1;opacity:.96;margin-top:-1px;
}
.xm-pillbar:hover .xm-pillbar-in{filter:brightness(1.06)}
.xm-pillbar:active .xm-pillbar-in{transform:scale(.975)}
html:not(.xm-dark) .xm-pillbar-in{
  box-shadow:0 6px 20px var(--xm-page-soft,rgba(29,155,240,.18)),0 2px 8px rgba(0,0,0,.16);
}
/* X 自己的新推提示：主人 2026-11-22 明确「彻底去掉」，页面上不留任何形态。
   两段保障：
   ① 文案节点本身（pillLabel，新旧两种客户端都带这个 testid）直接隐身 ——
      JS 标记有 400ms 限频，靠这一条保证任何一帧都不会露字；
   ② pill.ts 打到浮层祖先上的 data-xm-toast 整块收掉，并压平高度，
      避免残留一个看不见但占 36~56px 的空白条。 */
[data-testid="pillLabel"]{display:none!important}
[data-xm-toast]{
  display:none!important;
  height:0!important;min-height:0!important;max-height:0!important;
  margin:0!important;padding:0!important;border:0!important;overflow:hidden!important;
}
`;

/** 字体与玻璃：字体族走 --xm-font，正文字号单独覆盖 */
const FONT_CSS = `
html.xm-font body,
html.xm-font body *:not(svg):not(svg *):not(code):not(pre){
  font-family:var(--xm-font)!important;
}
/* 正文字号：X 全站字号是 px 写死在原子类里的（正文 15/20），没有可继承的根字号，只能按语义选择器覆盖。
   内部 span 各自带着字号类，必须一并拉成 inherit —— 否则只有裸文本变大，链接、话题标签还是 15px。 */
[data-testid="tweetText"]{font-size:16px!important;line-height:21px!important}
[data-testid="tweetText"] *{font-size:inherit!important;line-height:inherit!important}
/* 玻璃皮肤：旧版锚点是 primaryColumn / sidebarColumn，新版这两个 testid 都是 0 个，
   data-glass 设了也一直没载体。新版主栏就是 main（背景透明，背后是我们自己的 --xm-bg 渐变），
   模糊打在它身上效果等价。右栏在 xm-noside 下本来就被收掉，aside 仍写一条兜底。
   ⛔ backdrop-filter 会给 main 造一个 containing block —— 实测格子是 li 内的 absolute，
      位置由 translateY 决定，不受影响；若将来改成 fixed 定位必须重新量。 */
html.xm-skin[data-glass="mid"] main,
html.xm-skin[data-glass="mid"] aside,
html.xm-skin[data-glass="mid"] [data-testid="primaryColumn"],
html.xm-skin[data-glass="mid"] [data-testid="sidebarColumn"],
html.xm-skin[data-glass="mid"] header[role="banner"]{backdrop-filter:blur(10px) saturate(1.3)}
html.xm-skin[data-glass="thin"] main,
html.xm-skin[data-glass="thin"] aside,
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
html.xm-noside [data-testid="sidebarColumn"],
html.xm-noside aside{display:none!important}
/* 新版 main 没有 role 属性（实测 null），下面两条旧规则在新版不命中，各补一条同义的裸 main */
html.xm-noside main[role="main"],
html.xm-noside main{flex-grow:1}
html.xm-noside [data-testid="primaryColumn"]{margin-left:auto!important;margin-right:auto!important}
html.xm-wide main[role="main"],
html.xm-wide main{max-width:none!important}
html.xm-wide [data-testid="primaryColumn"]{
  width:var(--xm-feed-w,720px)!important;
  max-width:var(--xm-feed-w,720px)!important;
  min-width:0!important;
  flex-basis:var(--xm-feed-w,720px)!important;
}
html.xm-wide [data-testid="primaryColumn"] .xm-wide-el{max-width:var(--xm-feed-w,720px)!important}
/* 加宽的兜底层：回退时 X 重建主栏，新建的那几层自带 inline max-width:600px，
   JS 打 xm-wide-el 要等下一轮 MutationObserver —— 中间会露 1–2 帧窄布局，
   正文重折行、所有 cell 高度变，随后又被 reflow/锚定纠正，肉眼就是「抖一下」。
   这里按结构直接给「装着 cell 的主栏直系层」上宽度：新节点一出生就是 720，那一帧根本不存在。
   ⛔ 只进两级、且必须含 cellInnerDiv：再深的层属于 cell 内部，动了会改变卡片布局。 */
html.xm-wide [data-testid="primaryColumn"] > div:has([data-testid="cellInnerDiv"]),
html.xm-wide [data-testid="primaryColumn"] > div > div:has([data-testid="cellInnerDiv"]){
  max-width:var(--xm-feed-w,720px)!important;
}
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
/* 新版（2026-11）把右下角收成一个 dock：[data-slot="xds-dock-launcher"] + 同名 panel，
   外面裹一层 bg-modal 的 55px 圆角块。旧白名单一条都不命中（实测 testid 全为空），
   按钮 aria-label 也从 "Grok" 变成 "展开 Grok"。整个 dock 一起收，否则外壳留个白块。 */
html.xm-nofloat [data-slot="xds-dock-launcher"],
html.xm-nofloat div:has(> [data-slot="xds-dock-launcher"]){display:none!important}
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

/**
 * 新版结构（2026-11 · abs.twimg.com/x-web 的 Tailwind 重写版）。
 *
 * 锚点：`main` / `ul > li[data-index]` / `article` / `div[data-post-avatar]`。
 * `data-testid` 几乎全没了（只剩 SearchBox_Search_Input 与 premium-signup-tab）。
 *
 * ⛔ 上面所有旧版规则一条都不删：X 是灰度发布，同一时刻可能两种客户端都在跑，
 *    旧锚点是回退时唯一的活路。
 * ⛔ 这里的 `li[data-index]` 只在命中新版时才有意义 —— 旧版时间线里没有 li，
 *    两套规则并存不会互相干扰。
 * ⛔ 加宽不靠这里的 CSS：主栏宽度由 X 的 `--x-main-column-width` 喂 grid 轨道，
 *    实测写在 main / html 上都无效，必须由 layout.ts 写回定义它的那一层。
 */
const NEW_CSS = `
/* ── 卡片：格子换成 li[data-index]，定位机制仍是 translateY，与 cellInnerDiv 同构 ── */
html.xm-card main li[data-index]{
  clip-path:inset(var(--xm-card-gap,15px) var(--xm-card-x,0px) var(--xm-card-gap,15px) var(--xm-card-x,0px) round var(--xm-card-r,0px))!important;
  background-color:var(--xm-card-bg,rgba(255,255,255,.055))!important;
}
/* 外壳那层 border-b border-divider 在直角模式下要抹掉，否则卡片中间横着一根线 */
html.xm-flat main li[data-index] > div{border-bottom:0!important}
/* 内层三层底色让开，只留 li 上的卡片底色 */
html.xm-card main li[data-index] > div,
html.xm-card main li[data-index] > div > div,
html.xm-card main li[data-index] > div > div > div{background-color:transparent!important}
/* 推文上下留白：被裁掉多少就补回多少 */
html.xm-card main li[data-index] article{
  padding-top:var(--xm-card-pad,19px)!important;
  padding-bottom:var(--xm-card-pad,19px)!important;
}
html.xm-card main{background-color:transparent!important;background-image:none!important}

/* ── 回复链：组内不裁上下，只给首尾各一刀（与旧版同一套间距算法） ── */
html.xm-card main li[data-index].xm-thread-top{
  clip-path:inset(var(--xm-card-gap,15px) var(--xm-card-x,0px) 0 var(--xm-card-x,0px))!important;
}
html.xm-card main li[data-index].xm-thread-mid{
  clip-path:inset(0 var(--xm-card-x,0px) 0 var(--xm-card-x,0px))!important;
}
html.xm-card main li[data-index].xm-thread-end{
  clip-path:inset(0 var(--xm-card-x,0px) var(--xm-card-gap,15px) var(--xm-card-x,0px))!important;
}
html.xm-card main li[data-index].xm-thread-top article{
  padding-top:var(--xm-card-pad,19px)!important;
  padding-bottom:calc(var(--xm-card-pad,19px) - var(--xm-card-gap,15px))!important;
}
html.xm-card main li[data-index].xm-thread-mid article{
  padding-top:calc(var(--xm-card-pad,19px) - var(--xm-card-gap,15px))!important;
  padding-bottom:calc(var(--xm-card-pad,19px) - var(--xm-card-gap,15px))!important;
}
html.xm-card main li[data-index].xm-thread-end article{
  padding-top:calc(var(--xm-card-pad,19px) - var(--xm-card-gap,15px))!important;
  padding-bottom:var(--xm-card-pad,19px)!important;
}
html.xm-card main li[data-index].xm-joiner{padding-bottom:var(--xm-card-pad,19px)!important}
html.xm-card main li[data-index].xm-joiner:not(.xm-thread-end){
  padding-top:var(--xm-card-pad,19px)!important;
}
/* 组内补线：X 的线只画到内容区，被 padding 顶成两截，按同一横坐标补一条贯穿线 */
html.xm-card main li[data-index].xm-thread-top::before,
html.xm-card main li[data-index].xm-thread-mid::before,
html.xm-card main li[data-index].xm-thread-end::before{
  content:"";position:absolute;top:0;bottom:0;left:var(--xm-lx,-99px);
  width:var(--xm-lw,2px);background:var(--xm-lc,transparent);pointer-events:none;
}
html.xm-card main li[data-index].xm-thread-end::before{bottom:auto;height:var(--xm-le,44px)}
html.xm-card main li[data-index].xm-thread-top::before{top:var(--xm-ls,0px)}

/* ── 分区条：标记打在 li 上 ── */
html.xm-card main li[data-index][data-xm-more-sec]{
  height:74px!important;min-height:0!important;max-height:74px!important;
  padding:0!important;margin:0!important;overflow:hidden!important;
  background-color:transparent!important;
}
html.xm-card main li[data-index][data-xm-more-sec] > *{display:none!important}
html.xm-card main li[data-index][data-xm-more-sec]::after{
  content:"···";
  position:absolute;left:50%;top:var(--xm-card-gap,15px);
  width:88px;height:44px;box-sizing:border-box;
  transform:translateX(-50%);
  display:flex;align-items:center;justify-content:center;
  border:1px solid var(--xm-page-glow,var(--xm-acc-glow,rgba(128,128,128,.3)));
  border-radius:0;
  background-color:var(--xm-page-soft,var(--xm-acc-soft,rgba(128,128,128,.12)));
  font-family:var(--xm-font,system-ui,-apple-system,"Segoe UI","PingFang SC",sans-serif);
  font-size:20px;font-weight:700;line-height:1;
  letter-spacing:.2em;text-indent:.2em;
  color:var(--xm-page-acc,var(--xm-acc,#1d9bf0));
  pointer-events:none;
}
/* 原生「显示 N 帖子」行：pill.ts 打属性，这里压平（与旧版同一条策略） */
html.xm-card main li[data-index][data-xm-pill]{
  height:0!important;min-height:0!important;max-height:0!important;
  padding:0!important;margin:0!important;
  border:0!important;box-shadow:none!important;background:none!important;
  overflow:hidden!important;clip-path:none!important;
  opacity:0!important;visibility:hidden!important;pointer-events:none!important;
}

/* ── 直角化：媒体与引用卡见文件上方 QUOTE_CSS 的「媒体直角化」段 ──
   0.2.0 这里曾有三条较弱的新版规则（只认直接子 img / video，漏掉外层 28.8px 的 a），
   0.2.5 已由上面那组 :has(img[src*="pbs.twimg.com/media"]) / :has(article) 取代并删除。
   旧版那组 tweetPhoto / card.* 规则仍保留（灰度回退用）。
   ⛔ 模板字符串里不要写反引号（TS1127/TS1351），这条注释就踩过一次。 */

/* ── 正文字号：新版的正文容器是 div[dir=auto].whitespace-pre-wrap，没有 testid ── */
main article div[dir="auto"].whitespace-pre-wrap{font-size:16px!important;line-height:21px!important}
main article div[dir="auto"].whitespace-pre-wrap *{font-size:inherit!important;line-height:inherit!important}

/* ── 加宽：声明式兜底 ──
   X 把 --x-main-column-width 声明在 shell 的 class 里（Tailwind arbitrary property），
   JS 写内联变量会被它的重渲染反复擦掉 —— 实测 4 秒的补扫窗口内经常读到 600。
   这里用更高特异性直接盖住，节点重建多少次都立刻是设置里的宽度。
   ⛔ 只盖「不含同类后代的那个最外层」：内层自己也带这个 class（max-lg:max-w-(...)），
      两层都设会让 grid 两条轨道同时变宽，右栏被挤出去。 */
html.xm-wide div[class*="--x-main-column-width"]:has(main):not(:has(div[class*="--x-main-column-width"])){
  --x-main-column-width:var(--xm-feed-w,720px)!important;
}
/* 时间线自己还有一层 max-w-(--x-timeline-max-width)，跟着主栏一起放 */
html.xm-wide main{--x-timeline-max-width:var(--xm-feed-w,720px)!important}

/* ── 图标栏（新版）：X 自己折到 72px，我们只补背板、隐藏项与发帖入口 ──
   ⛔ 旧版 header 那套 fixed 竖列在新版没有载体，不能照搬：会连主栏一起压窄。
   ⛔ 折叠与背板都写成声明式，不依赖 JS 打的 class / 内联变量 —— React 重建外壳时
     那两者会一起被冲掉（实测 class 与内联 --x-sidebar-expanded 都留不住），
     而 X 自己也是用 class 里的 arbitrary property 声明该变量的，特异性够、能直接盖。
      72px = 48px 图标 + 两侧 12px，与 X 自己的折叠结果一致。 */
html.xm-rail div[class*="--x-sidebar-expanded"]:has(nav){
  --x-sidebar-expanded:0!important;
  width:72px!important;min-width:72px!important;max-width:72px!important;flex:none!important;
  background:var(--xm-rail-bg,rgba(0,0,0,.86));
  -webkit-backdrop-filter:blur(18px) saturate(1.4);
  backdrop-filter:blur(18px) saturate(1.4);
}
/* JS 补充打的 class（切换/回退时用），保留一份等价规则 */
html.xm-rail .xm-rail-host{
  background:var(--xm-rail-bg,rgba(0,0,0,.86));
  -webkit-backdrop-filter:blur(18px) saturate(1.4);
  backdrop-filter:blur(18px) saturate(1.4);
}
/* ── 栏贴窗口左沿 + 主栏居中：这两个要求互斥，必须把栏从文档流里摘出来。
   X 的外壳是 mx-auto 居中的（实测 vw 1414 时 x=67），里面按 [栏 72][主栏 840][右栏 368] 排满，
   所以「栏贴边」和「主栏居中」不可能同时靠外壳的 margin 解决：
     · 外壳居中 ⇒ 栏在 67，左边空一块；
     · 外壳贴左 ⇒ 栏在 0，但主栏被顶到 72，紧贴栏（用户报的就是这个）。
   做法：栏 position:fixed 钉视口左侧，占位宽度归零；外壳钉左后按
   (100vw − 主栏宽) / 2 补左内边距 ⇒ 主栏落在视口正中，栏独自浮在左边留白里。
   ⛔ 全部挂在 html.xm-rail 下：关掉图标栏即恢复 X 的原生居中，整条可撤销。 */
html.xm-rail div[class*="--x-sidebar-expanded"]:has(nav){
  position:fixed!important;left:0!important;top:0!important;
  height:100dvh!important;z-index:40!important;
}
/* 占位归零：栏已经脱离文档流，否则网格还会从 72px 处起算 */
html.xm-rail div[class~="sm:block"]:has(> div[class*="--x-sidebar-expanded"]){
  width:0!important;min-width:0!important;flex:none!important;
}
html.xm-rail body > div[class*="mx-auto"]:has(main){
  margin-left:0!important;margin-right:auto!important;
  /* ⛔ 必须解掉 X 自带的 max-w-[1024px]。该外壳同时带 overflow-x-clip：
     1024 − padding-left(216.7) 只剩 807 的内容盒，840 的主栏右侧 33px 被直接裁掉
     —— 表现就是推文正文顶到白色卡片右边缘断句、⋯ 菜单整颗消失（2026-11-24 实测：
     vw 1273 时主栏 217–1057，正文右端 1041，超出外壳 17px 被切）。
     放开上限后外壳撑满视口，主栏仍由下条的 padding-left 居中（中心 637 = vw/2）。 */
  max-width:none!important;
  /* 96px 保底：窄窗口下 (vw − 主栏) / 2 会小于栏宽，主栏就贴着栏了 */
  padding-left:max(96px,calc((100vw - var(--xm-feed-w,600px)) / 2))!important;
}
/* ── 底部账号菜单：齿轮按钮 fixed 钉在同一位置，两者并存就是重叠（旧版同样收掉
   SideNav_AccountSwitcher_Button）。新版没有 testid，用 data-slot="xds-menu-trigger" 认；
   ⛔ 不写在 <html> 全局：只在图标栏的外壳内生效，关掉图标栏账号菜单立刻回来。 */
html.xm-rail div[class*="--x-sidebar-expanded"] button[data-slot="xds-menu-trigger"],
html.xm-rail .xm-rail-host button[data-slot="xds-menu-trigger"]{
  display:none!important;
}
/* 隐藏项：特异性要压过 X 自己的 flex / inline-flex，逐类补齐 */
html.xm-rail nav[aria-label="主要"] .xm-hide,
html.xm-rail nav[aria-label="主要"] a[href].xm-hide,
html.xm-rail nav[aria-label="主要"] [role="button"].xm-hide{
  display:none!important;
}
/* 发帖入口：新版是 a[href="/compose/post"]，不带头像也无计数，按 href 认最稳。
   不依赖 xm-rail —— 展开态下也照样该藏（与旧版 SideNav_NewTweet_Button 同一条策略）。
   ⛔ 0.2.6：**不能限定在 nav 里**。实测该按钮在 nav 之外（自有容器 div.px-[12px].pb-[12px]），
      写成 nav[aria-label="主要"] a[href=...] 匹配数为 0 —— 设置开着却一直不生效。
   外层那圈 padding 壳一并收掉，否则隐掉按钮还留 24px 空档。 */
html.xm-hidecompose a[href="/compose/post"],
html.xm-hidecompose div:has(> a[href="/compose/post"]){display:none!important}
/* ── 强调色：让 X 页面自己跟着设置走 ──
   新版把 Tailwind 的 brand 色**编译进 class 的值**（实测覆盖 --color-brand 无效，改完仍是原色），
   所以只能按类名盖。用 class~= 属性选择器，省掉 CSS 里冒号的转义。
   ⛔ 只盖 brand：like 红、repost 绿、premium 金都是语义色，跟强调色无关，不能一起铲。
   ⛔ 不加 main 限定：发帖弹层、导航栏在 main 之外，同样该变。 */
html [class~="text-brand"]{color:var(--xm-acc)!important}
html [class~="hover:text-brand"]:hover{color:var(--xm-acc)!important}
html [class~="bg-brand"]{background-color:var(--xm-acc)!important}
html [class~="border-brand"]{border-color:var(--xm-acc)!important}
`;

const CSS = BASE_CSS + SOFT_CSS + QUOTE_CSS + CELL_CARD_CSS + FONT_CSS + LAYOUT_CSS + RAIL_CSS + NEW_CSS;

let injected = false;

export function injectBase(): void {
  if (injected) return;
  injected = true;
  const s = document.createElement('style');
  s.id = 'xm-base';
  s.textContent = CSS;
  (document.head ?? document.documentElement).append(s);
}
