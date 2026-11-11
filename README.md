# X MARGIN

从 [映间 MARGIN](https://github.com/jiuyang5354/bilibili-margin) 里单独摘出来的两个能力，做成只服务 `x.com` 的独立扩展：

- **动态背景**：12 款原创着色器（WebGL，其中「流光」走 WebGPU 计算着色器）+ 本地图片背景 + 强度滑杆 + 固定/随机/关闭
- **字体设置**：X 默认 / 无衬线 / 衬线 / 自定义本机字体，字号 100% / 110% / 120%

还有一项顺手的功能：**推文一键截图** —— 每条推文底部操作栏里、**「收藏」和「分享」之间**常显一枚相机按钮（线性图标，与 X 自带图标同风格）；点一下把整条推文（含图片、互动栏）截成一张 PNG；比一屏高的长推文会自动滚动分帧、拼成完整长图，截图后弹预览，可直接下载或复制到剪贴板。

另加四项布局开关：**去掉右侧栏**（搜索 / 订阅 Premium / 新鲜事 / 推荐关注）、**左侧导航收成图标竖排并贴边固定**、**导航项按需隐藏**、**推文流加宽（600 / 720 / 840）**。全部可随时还原。

除这几项外**不碰 X 的布局**：不改 margin、position、overflow，不动通知页、不动推文内部排版（「推文浮起」只改主栏底色与 cell 的上下留白）。只改「画上去的颜色」「用哪个字体」「主栏多宽」和「推文之间空多少」。

## 安装

```
npm install
npm run build
```

Chrome → `chrome://extensions` → 打开「开发者模式」→「加载已解压的扩展程序」→ 选 `dist/`。

## 设置

设置入口是一个**齿轮图标**：图标栏开启时，它就贴在左侧图标列的最末尾、占据账户头像原来的位置（跟导航图标同尺寸同色，52px 正圆）；关掉图标栏后退回页面右下角的浮动球。点开是设置面板，`Esc` 或点面板外关闭。

面板配色跟着 X 的实际主题走（深色/浅色各一套 CSS 变量），布局、背景、字体分三组，布尔项一律用滑动开关 + 一句说明，枚举项用分段控件。

| 分组 | 选项 | 说明 |
|---|---|---|
| 外观 | 白色 / 黑色 / 跟随系统 | 写 X 自己的 `night_mode` cookie：0 / 2 / 按系统偏好；**改完必定整页刷新**（不刷新会出现半新半旧的花色） |
| 外观 | 文字柔化 | 默认开；深色下把主文字从 `#f7f9f9` 压到 `#c8ced3`，对比度 19.9:1 → 13.2:1 |
| 外观 | 强调色（6 个预设 + 取色器） | 只作用于 X Margin 自己的界面：齿轮、开关、滑块、选中态、色板 |
| 布局 | 隐藏右侧栏 | 默认开；主栏在导航右侧的剩余区域里居中 |
| 布局 | 图标导航栏 | 默认开；左侧导航压成 76px 宽的图标竖列，钉在窗口最左边 |
| 布局 | 隐藏发推入口 | 默认开；时间线顶部的发推面板 + 左侧栏发帖按钮一起收掉（不发推的人用不上；关掉即全部还原） |
| 推文流 | 隐藏推广 | 默认开；带 `placementTracking` 的推广单元整条收起，不留空白 |
| 推文流 | 去掉边框线条 | 常开；主栏左右两条 1px 竖线、推文之间的横向分割线、引用卡片的 16px 圆角与 1px 描边、内嵌图片与**外链卡 / 视频封面**的 16px 圆角，全部去掉。引用卡片与卡片的底色保留 |
| 推文流 | 推文独立成块 | 常开（`layout.cardFeed`，暂强制 `true`）；主栏不再有一整块底板，每条推文裁成一张**直角**独立面板（推文自身上下内边距 22px，再从中裁 12px → 相邻两条合计 24px 缝隙、卡片边到内容 10px；左右 0 内缩，与主栏/发帖框同宽同边；深色下是 88% 的深色实体块）。缝隙用 `clip-path` 裁绘制，内边距改高带来的 `translateY` 偏差由 `reflowCards()` 重排 |
| 推文流 | ~~推文浮起~~ | **已下线（2026-11-11 回退）**：不再改推文流的排版 —— 不改间隔、不改底色、不删分割线。字段 `layout.floatCards` 保留只为兼容旧配置，一律强制 `false` |
| 推文流 | 600 / 720 / 840 | 默认 720；只改主栏宽度，排版规则不动 |
| 导航项 | 复选框列表 | 勾掉的项只是隐藏，随时勾回来；表头显示「可见/总数」，右侧一键「全部显示」 |
| 背景 | 关闭 / 固定 / 随机 / 图片 | 随机会避开上一款，切页不重复 |
| 玻璃浓度 | 厚 / 中 / 薄 | 主栏底色不透明度 86% / 72% / 58%，越薄背景越明显 |
| 着色器 + 强度 | 12 款 / 0–100% | 缩略图现编译现截；强度是背景层整体透明度 |
| 字体 | X 默认 / 无衬线 / 衬线 / 自定义 | 无衬线 = Geist + 思源黑；衬线 = Instrument Serif + 霞鹜新致宋 |
| 字号 | 100 / 110 / 120% | 走 `#react-root` 的 zoom，X 自己的字号设置仍然有效 |

设置存在 `chrome.storage.sync`，多标签页即时同步；图片背景存在 `chrome.storage.local`。

## 实现要点

### 背景怎么铺到 X 底下

`.xm-bg` 是 `position: fixed; inset: 0; z-index: -1` 的一层，塞进 `body` 最前面。z-index 为负才会落在 `#react-root` 的所有内容之下；`html`/`body`/`#react-root` 的底色同时改成透明，否则整页底色会把画布糊死。

### 换肤为什么用 JS 刷内联样式

X 的 class 名是构建哈希，不能当选择器用；可靠锚点只有 `data-testid="primaryColumn"` / `data-testid="sidebarColumn"` / `header[role="banner"]`。所以：

1. 从 `primaryColumn` 沿祖先链往上走，把每一层的 `background-color` 刷成 `transparent`（这些层原本画的就是整页底色）
2. 主栏/侧栏/顶栏刷成对应浓度的 `rgba()`
3. 改过的元素记在 `Map` 里，关闭背景时逐个还原（包括原本为空的情况）

X 换主题或重新挂载会把这些内联样式冲掉，所以每 1.5 秒检查一次祖先链还在不在，掉就重刷；同一个节拍里顺便重读主栏渲染色判断明暗主题（比 `prefers-color-scheme` 准，X 的主题不一定跟着系统走）。

### 主题为什么是写 cookie，而不是自己刷颜色

X 的主题不是靠一层 CSS 变量撑起来的：正文颜色、底纹、分割线大多是 React 写进 `style` 里的内联 RGB，一个个覆盖既不现实也会漏。X 自己在「设置 → 显示」里切换外观时，写的是 `night_mode` cookie（`0` 白色 / `1` 暗黑 / `2` 昏暗，即纯黑），客户端启动时读它决定整站配色。所以扩展只做两件事：**把 cookie 写成想要的值，然后整页刷新**，剩下的交给 X 自己。

**切换时无条件刷新，不做「cookie 值没变就跳过」的优化。** 这个优化看着合理，实际会踩坑：X 的配色是**启动时**读 cookie 渲出来的，运行中改 cookie 不会让 React 重算。典型触发场景是「黑色 ↔ 跟随系统（系统正好是深色）」——两者目标值都是 `2`，cookie 没变就不刷，于是面板选中态变了、站点配色纹丝不动；半透明皮肤、图标栏、字号取色也会跟着错配，出现一半新一半旧。所以判断条件是「用户点了不同的选项」，不是「cookie 值变了」。

两个实现细节：

- **同名 cookie 可能有两份**（host-only 的 `x.com` 和 domain 的 `.x.com`），`document.cookie` 读到哪份不确定。写之前先把两种都删掉，再统一写成 `.x.com` 的那份。
- **防死循环**：如果 X 被账号里的外观设置反向覆盖，刷新后会回到原值，逻辑就会无限刷。用 `sessionStorage` 记「这个值已经试过」，同一个值只刷一次；仍对不上就**停止写 cookie**（避免 cookie 与画面不一致），并在面板里提示「可能被账号设置锁定」。启动时的纠偏走这套守卫，用户主动切换则无条件刷一次。

`黑色` 对应 `night_mode=2`（纯黑）。X 的 `1`（暗黑，深蓝灰 #15202b）这一档没有单独放开关，需要的话可以加。

强调色只覆盖我们自己的 UI —— 它是 `--xm-acc` 一个变量，从齿轮、开关、滑块到选中描边全部继承。**没有**去改 X 站内的品牌蓝：X 的蓝散落在几百条内联样式和构建哈希类名里，只改到一半会比不改更难看。

### 去掉右侧栏为什么还要补一条居中

只写 `display:none` 会出问题：X 的行容器是 `header + main(flex-grow) + sidebar(350px)`，砍掉 sidebar 后那 350px 全给了 `main`，而 600px 的主栏默认贴左，整页会明显左歪。所以给 `main[role="main"]` 补 `flex-grow:1`，再给主栏补 `margin-left/right:auto` —— 主栏把那截空白平均分掉，回到中线。

三档窗口宽度实测（主栏宽 601px 不变）：

| 视口 | 主栏左边界 | 主栏右边界 | 导航到主栏间隙 | 主栏到窗口右 |
|---|---|---|---|---|
| 1094 | 385 | 986 | 110 | 108 |
| 1440 | 558 | 1159 | 208 | 281 |
| 1920 | 798 | 1399 | 208 | 521 |

后两行的「主栏到窗口右」比左侧看着大，是因为容器 `max-width: 1290px` 居中后两边各有一段对称留白（1440 下 75、1920 下 315），扣掉这段，左右间隙都是 208。1094 下容器撑满，直接对称。

若 X 把主栏在交叉轴拉满，`margin:auto` 会自动失效，不会产生副作用。

### 导航项裁剪怎么做的

面板里「导航项」是一份运行时枚举出来的勾选列表，key 取 `data-testid` → `href` → `aria-label` → 序号，逐项加 `.xm-hide`（`display:none`）。**不按位置索引**，所以 X 重排顺序、插入新入口都不会错位。

枚举范围是 `nav` 里所有 `a[href]` **和** `[role="button"]`，只保留最外层（`a` 里再套 `role=button` 不会算成两项），并排除 `SideNav_NewTweet_Button` / `SideNav_AccountSwitcher_Button` —— 一个是发帖按钮（单独开关），一个是账户切换按钮（整条被隐藏，见下）。

首次启用时会给一份默认值：保留最上面 5 个图标，其余收起。预置带版本号（`railSeedV`），涨版本时**合并**重跑一次，不会覆盖你手动勾过的项。

四条踩过的坑：

- `display:none` 必须写成 `a[href].xm-hide` / `[data-testid].xm-hide`。本文件里 `a[href]{display:flex!important}` 是 `(0,3,3)`，光写 `.xm-hide` 是 `(0,3,2)`，**特异性输给它**——class 加上了、但计算值还是 `flex`。
- 注释里不能出现反引号：`RAIL_CSS` 是模板字符串，写进注释会直接把字符串截断。
- X logo 在 `h1` 里、不在 `nav` 内。所以「保留 5 个」在 nav 侧只对应 4 项，预置时按 `logoInNav` 动态减一。
- 预置的触发条件不能写成 `items.length >= keep + 2`：nav 侧只有 `keep + 1` 项时永远等不到，等于永不预置。

### 设置入口为什么钉在窗口左下角

齿轮放在我们自己的 `.xm-root` 里，图标栏模式下用 `position:fixed; left:12px; bottom:16px` 钉到窗口左下角（栏宽 76px、按钮 52px，居中即 12px）。

**不要再塞进 `header nav`**：那条路要借「账户头像」那个带 `margin-top:auto` 的吸底容器定位。v0.1.40 把账户按钮 `display:none` 之后，容器塌陷/被 `overflow` 裁切，实机表现就是——头像没了，齿轮也跟着不见了。`fixed` 只认视口，跟 X 的 DOM 怎么改都无关；`.xm-root` 上没有 `transform`/`filter`，不会破坏 fixed 的包含块。

`place(railOn)` 现在只切 `data-rail` 和确保按钮挂在自己的 root 里，节点不离开 root，X 重渲染 nav 也清不掉它。关掉图标栏时 `place(false)` 把 `data-rail` 置 0，回到右下角浮动球。

面板本身也分两套定位：图标栏开着时贴左（`left:88px`，避让 76px 的栏），关掉时贴右下 —— 且必须 `bottom:152px` 让开球体（46px + 上下留白），否则面板打开后正好盖住按钮，点不到关不掉。

### 未读角标为什么会被吃掉

图标栏靠两条规则压掉文字：`header span{display:none}` 和 `a[href] > div:not(:has(svg)){display:none}`。X 的未读角标（通知数、私信点）正好是一个**绝对定位的小 div + 里面的数字 span**——两条规则各打一枪，角标就整个消失，表现为「有新消息但铃铛上没有红点」。

修法是「先认出来再放行」：`markBadges()` 扫 `a[href] *`，把 `position:absolute` 且不是 1px（sr-only 盒）的元素整棵子树打上 `.xm-badge`，CSS 再用 `span.xm-badge` / `.xm-badge span{display:revert}` 把 span 放出来。

两个约束：

- **判据只能用 `position:absolute`，不能用尺寸**：图标栏开着时角标本身是 `display:none`，`getBoundingClientRect()` 全是 0。
- **`display:revert` 只给 span，绝不给 div**：角标容器靠 `display:flex` 把数字居中，`revert` 会把 author 声明一起回滚成 UA 的 `block`，数字直接跑到右边被裁掉。

### 黑色模式为什么刺眼

X 的「纯黑」（Lights out）配色是 `#000` 底 + `#f7f9f9` 字，实测对比度 **19.9:1**。WCAG AAA 对正文的要求是 7:1，X 自己的「昏暗」档是 13.5:1，VS Code 深色主题约 11:1 —— 纯黑模式是它们的近两倍。这是 X 的设计取向，不是扩展造成的（扩展只动底色层，文字色全是 X 的）。

「文字柔化」把这一个色阶压到 `#c8ced3`（200,206,211），对比度 **13.2:1**，与 X 自己的 Dim 档同级。做法上有个关键取舍：

- **按内联色值匹配**（`[style*="rgb(247, 249, 249)"]`），而不是在 `[data-testid="User-Name"]` 这类容器上一概覆盖。容器级覆盖会把同容器里的 `@handle`、时间戳（`#71767b`）一起提亮，信息层级就毁了；按色值筛只命中「本来就是这个白」的元素。
- 再给 `tweetText` / `User-Name` 加一条兜底，接住少数没有内联色、靠继承拿颜色的节点。父级 `color !important` 不会覆盖子元素自己声明的颜色，所以链接蓝、@handle 灰都不受影响。
- **限定 `html.xm-dark`**：浅色主题底色是白的，压暗文字直接变低对比。

可调：`--xm-soft-fg`，想更柔可以在面板之外改成 `#bec4c9`（对比度 11.9:1）。

### （已下线）推文浮起：历史设计留档

> 2026-11-11 主人裁定「对排版的修改全部回退」，本节只作为踩坑记录保留，代码不再生效。

「推文浮起」做四件事，**不加圆角、不加描边、不加投影**（主人明确不要卡片化）：

1. **主栏底色抹成透明。** X 给整条时间线刷一层不透明底色，换肤时我们自己也会给它刷一层半透明玻璃（`surface()`）—— 就是这层「整块背景」把页面背景挡在外面，推文看起来像贴在一块板子上。抹成透明，背景才透得进来。
2. **去掉栏框与分割线。** X 在 `[data-testid="primaryColumn"]` 左右各画 1px 竖线（纯黑下实测 `rgb(47,51,53)`），每条推文之间还有一条横线；线不断，观感永远是「一整栏」而不是「一条条」。
3. **每条推文一块整宽实心底色**（深色 `rgba(20,22,26,.96)` / 浅色 `rgba(255,255,255,.95)`，**不加 `backdrop-filter`、不加内阴影**）。参照主人给的排版示意：一条条实心块铺在背景上，块与块之间留白露出背景。半透明（16% 白）在花背景上太透，条与条之间分不出来，所以浓度拉到接近不透明；块本身仍是整宽直角、不圆角不描边。`backdrop-filter` 会把背景平均成一个偏暗的值 —— 实测带内 54、带外 57–92，条带反而比背景暗，「浮起」变成「压下去」，所以去掉。v0.1.24 曾在带子上下各画一条内阴影（提亮 + 压暗），主人一句话点破：「这只是边框的显示效果」—— 那条线就是唯一的「边框感」来源，v0.1.26 一并删掉，分条只靠底色差与留白。
4. **上下留白 56px。** 相邻两条之间空出 56px，那一段是纯背景。

**间隔只能用 padding，绝不能用 margin —— 这一条是被真机打回来的。** v0.1.25 按建议把 26px 留白改成 `margin:26px 0`，主人随即在 DevTools 里看到相邻两条 cell 的盒子**互相重叠**：盒高 661.5，下一条的顶边跑到了上一条内部。原因是垂直 margin 既不计入父元素高度，又会与父元素发生外边距合并（父层没有 border/padding/overflow 时直接穿透出去）—— 占位没变，margin 跑到盒子外面，下一条就从上面压过来。padding 计入盒尺寸，父元素高度跟着长，后面的 cell 才会被真正推下去。

具体尺寸：cell 上下各 28px（合计 56px），左右 0 —— 推文保持 X 原本的列宽与缩进。分割线位置不确定（可能画在 cell、内层 wrapper、更外层容器或 article 上），沿**祖先链**从 cell 一路清到主栏，一层不留：CSS 只覆盖前三层，真正画在外层容器上的那条只能靠 JS 清。只清底边。

**间隔处的底色必须两层一起清。** 那 28px 留白属于单元格本身，只要单元格或它那层 wrapper 带底色，空隙里露出来的就是这块底色而不是页面背景 —— 所以 `.xm-cell` 与它的直接子 div 都设 `background-color: transparent`。X 的整格 hover 高亮也挂在这两层上，一并消掉（否则鼠标一扫，背景又被盖回去）。

**底板不止一层，得沿祖先链逐层戳透。** 白色/黑色底板常常同时挂在 `primaryColumn`、它的直接子 div、时间线容器上，而且 X 写的是**内联样式**，`paint()` 写的更是内联 `!important` —— 内联 important 的优先级高于任何样式表 `!important`，CSS 一律盖不住。所以 `clearFloatWrappers()` 走 JS 清三层：

1. 每条推文的祖先链：cell → `primaryColumn`；
2. `primaryColumn` 内部所有「整宽」容器（宽 ≥ 主栏 85%、高 ≥ 36px、背景不透明；`article` 里的元素一律跳过）—— sticky 顶栏、时间线外层 section、X 临时插的覆盖层都在这一层；
3. `primaryColumn` 的祖先一路到 `body`。

原值（底色 + 底图）都记着，关掉浮起时还原。1.5 秒的补扫只跑第 1 层（便宜），第 2、3 层每 5 秒一次。

**选择器不能只认 `data-testid`，也不能写死深度。** 这里踩过两次：① v0.1.20 之前整块功能都写在 `[data-testid="cellInnerDiv"]:has(article)` 上，真实页面里一条都没匹配上，间隔和玻璃带全都没渲染，而且**完全不报错**；② v0.1.21 改用 `.xm-cell>div>article` 这种固定深度，X 的推文外面其实套了两层 div，玻璃带依旧不渲染，只剩透明和留白生效 —— 观感就是「文字直接压在花背景上」。

现在由 JS 认元素：从 `article` 出发往上找「宽度接近主栏」的那一层打 `.xm-cell`（有 `cellInnerDiv` 时优先用它，那是虚拟滚动的计量单位），最外层那条 `article` 打 `.xm-art`。CSS 只认这两个标记，X 怎么改结构都能落到正确元素上。

**为什么主栏透明要写在 JS 里**：换肤的 `paint()` 用的是 `el.style.setProperty('background-color', color, 'important')` —— **内联 important 的优先级高于任何样式表的 `!important`**，CSS 写了也白写。所以 `applySkin()` 多了一个 `float` 参数：浮起开启时直接给主栏刷 `transparent`，不开时才刷玻璃浓度。样式表里那条 `background-color: transparent` 只作兜底（背景关闭、没有内联样式时用）。

### 广告怎么认出来的

X 的广告（promoted tweet）在 DOM 里**没有稳定的 class**（全是构建哈希），「Ad」也只是个纯文本标签 —— CSS 匹配不到文本，按文本匹配又容易误伤正文里出现 "Ad" 的正常推文。真正稳定的锚点是 `[data-testid="placementTracking"]`：广告单元都要挂一个曝光追踪容器，否则广告主没数据。社区里的去广告脚本（x-ad-filter、各种 userscript）用的都是它。

三条规则覆盖三种已知嵌套，并且**隐藏整条 `cellInnerDiv`** 而不是里面的标签（只藏标签会留下一个空白格）：

```css
html.xm-noads [data-testid="cellInnerDiv"]:has([data-testid="placementTracking"]),
html.xm-noads [data-testid="placementTracking"]:has(article[data-testid="tweet"]),
html.xm-noads article[data-testid="tweet"]:has([data-testid="placementTracking"]) { display: none !important }
```

为什么用 CSS `:has()` 而不用 JS 扫：X 的时间线是虚拟滚动，cell 随时增删，`MutationObserver` 扫一遍再打 class 永远慢半拍（会闪一下），而 `:has()` 是样式系统实时求值，新插入的广告当帧就没了。`:has()` 从 Chrome 105 起支持，构建 target 是 chrome110。

不按文本匹配「推广 / 广告 / Ad」是**故意**的：正文里出现这些词的正常推文太多，为了多抓几个边缘广告去赌误杀不值得。真遇到 `placementTracking` 没覆盖的广告位，再单独加定位规则。

### 去边框线条：三处线，三种清法

页面上原本有三类线，性质不同，清法也不同：

| 线 | 在哪 | 清法 |
|---|---|---|
| 主栏左右两条 1px 竖线 | `primaryColumn`（把整条时间线框成一根「栏」） | CSS `border-left/right:0` —— 这类线一定画在这一层，不用认结构 |
| 推文之间的横向分割线 | 可能画在 cell、cell 的 wrapper 或更外层容器 | JS 沿祖先链从 cell 一路清到主栏（内联 `border-bottom:0`），CSS 只覆盖前三层 |
| 引用卡片的 16px 圆角 + 1px 描边 | 引用卡片外层（层数每个版本都变） | 两个入口：① 从嵌套 `article` 往上**到外层 `article` 之间的每一层都打** `.xm-quote`（结构式，不看此刻有没有圆角）；② 卡片内没有嵌套 `article` 时，从卡片里的 `tweetText` 往上找「含 `User-Name` + 圆角 ≤100px + 宽 ≥150px」的层 |
| 内嵌图片的 16px 圆角 | `<a>` 与外面几层 div 上（圆角不在 `img` 上，靠 `overflow:hidden` 裁切） | JS 从 `[data-testid="tweetPhoto"]` 一路上到 `article` 逐层打 `.xm-photo`（结构式） |
| 外链卡 / 视频封面的 16px 圆角 + 1px 描边 | 同上，但封面不叫 `tweetPhoto`（`img` / `video` / 背景图三种写法） | JS 以「媒体本身」为种子逐层上溯打 `.xm-media`；半径只用来认全圆（跳过头像 / 圆标），宽 <100px 的种子跳过 |

引用卡片的**底色留着** —— 块与块的区分靠底色，不靠线。

### 圆角标记为什么不能「按当前样式判」

旧实现每 1.5 秒跑一次 `applyFlat`，**开头先把 `.xm-quote / .xm-photo / .xm-media` 全部摘掉**，再按「这一层此刻有没有圆角」重新判一遍。两个后果叠加，就是鼠标一移、圆角与直角来回切：

- 摘掉的那一瞬，X 原生的 16px 圆角与 1px 描边回位；这一轮若没判回来，这一帧就变成常驻；
- hover 时 X 会换包装层 / 改计算样式，新节点上没有标记，而旧判据又要求「此刻 `radius > 0`」—— 判不出来，只能等鼠标移开。

v0.1.46 改三处：

1. **幂等**：开启期间只补加、不摘除；只有关掉时才清标记。静置 3.2 秒实测 class 变更 **0 次**（旧实现 ≥2 次）；
2. **结构式判据**：`tweetPhoto` / 媒体种子到 `article` 之间、引用层到外层 `article` 之间的每一层都标记，`border-radius` 只剩「认出全圆头像」一个用途；
3. **事件补扫**：`pointerover` / `pointermove` 触发，**推迟 140ms** 再扫 —— X 的节点替换发生在事件之后，同步扫只会扫到还没被换掉的旧节点（实测第二次 hover 就漏）。

验证脚本 `.workbuddy/quark-hoverflat.mjs`：hover 时把图片包装层与引用卡整个替换成新节点，断言 400ms 内标记补回、圆角 `0px`、缩略图描边 `0px`；连做两轮；头像始终 `9999px`。

做法与推文浮起同一个教训：**不写固定深度**。X 引用卡片外面套的 div 层数每个版本都在变（v0.1.21 / v0.1.22 两次都栽在写死「>div>article」上，CSS 空转、不报错），所以由 JS 从嵌套 `article` 出发往上走，凡是带圆角或带边框的祖先都打 `.xm-quote`，CSS 只认这个 class：

```css
html.xm-flat .xm-quote{border-radius:0!important;border:0!important;box-shadow:none!important}
```

只走**祖先**，不碰后代 —— 卡片里的头像常是 `border-radius:9999px` 的全圆，误伤会把头像削成方块（验证里专门量了这一项：改完后头像仍是 `9999px`）。走到外层 `article` 就停，绝不上溯到整条时间线。X 重建节点后 class 会丢，所以跟着 1.5 秒的低频补扫重打；已带标记的直接跳过，只有真正需要判断的那几层才调 `getComputedStyle`。

### 引用卡片有两种结构，两个入口都得认

X 现在两种引用卡片同时存在：

1. **卡片里有嵌套 `article`**（老结构）—— 从 `article article` 往上找；
2. **卡片里没有嵌套 `article`**（v0.1.32 补的结构）：卡片是一个 `div[role="link"][tabindex="0"]`，圆角与描边就挂在它身上，里面只有 `User-Name` + `tweetText`。这种结构按第 1 条完全认不到，圆角一直在。

第 2 种从卡片内的 `tweetText` 往上走，同时满足三条才认定是卡片容器：**含 `User-Name`**、**圆角在 1–100px 之间**、**宽度 ≥150px**。上限 100 把头像那种 `9999px` 全圆挡在外面，下限 150 把小的圆形徽标挡在外面，`article` 仍然是硬边界。

验证脚本 `.workbuddy/quark-quote2.mjs`：按真实层次铺两张无 `article` 的引用卡片，夸克内核实测两张卡片的 `border-radius` 与 `border` 全部 `0px` / `0px none`，卡片内头像仍 `9999px`，纯文字推文正文没有被误标。

### 内嵌图片的圆角清在哪一层

X 时间线里的图片块（`[data-testid="tweetPhoto"]`）是一串嵌套：`div(max-width) > div(16px 圆角 + overflow:hidden) > div > div > a(16px) > div(裁切框, 16px) > div > div[tweetPhoto] > img`。**圆角画在外层容器和 `<a>` 上，`img` 自己是方的**，只是被 `overflow:hidden` 裁出圆角 —— 所以对着 `img` 改圆角是白改。

清法与引用卡片同构：从 `tweetPhoto` 出发往上走，凡是 `border-radius > 0` 的层打 `.xm-photo`，CSS 只认这个 class；到 `article` 或 `.xm-quote` 就停，不越过推文边界、也不会把引用卡片那层重复标记。另补一条 `html.xm-flat [data-testid="tweetPhoto"] img{border-radius:0}` 兜底个别直接画在 `img` 上的卡片。

```css
html.xm-flat .xm-photo{border-radius:0!important}
```

验证脚本 `.workbuddy/quark-media.mjs`：按真实层次铺两处图片（推文里 + 引用里），夸克内核实测 `mediaCard / mediaLink / mediaBox` 三层全部 `0px`、`img` 为 `0px`、引用卡片仍 `0px`、卡片内头像仍 `9999px`。

### 带链接的封面图（「来自 xxx.com」那种外链卡）是另一套

外链卡、纯视频、GIF 的封面**不叫 `tweetPhoto`**，所以上面那套锚点一个都命不中 —— 用户看到的就是「普通图片方了，卡片封面还是圆的」。

三种画法都要覆盖：

| 封面写法 | 例 |
|---|---|
| `<img>` | 外链卡封面（`card.layoutLarge.media` 里的图）、GIF |
| `<video>` / `[data-testid^="video"]` | 视频 |
| `div` + 内联 `background-image` | X 大量用这种画封面，`tweetPhoto` 里也常见 |

清法不是按 `data-testid` 认，而是**以「被画出来的媒体」为种子往上走**：种子取 `article` 里的 `img` / `video` / `[style*="background-image"]` / `[data-testid^="card."]` / `[data-testid="tweetPhoto"]`，凡是 `border-radius` 落在 1–100px 的层打 `.xm-media`，到 `article` 或 `.xm-quote` 停、上限 12 层。两道过滤保住头像与圆标：

1. **种子自身宽 < 100px 直接跳过** —— 头像 40–48px、表情图、小图标都在这一档；
2. **层自身是正方形且半径 ≥ 边长/2（全圆）也跳过** —— 头像内层容器常写 50%，只会被第 1 条挡住外层，内层要靠这条。

半径上限 100 再兜一层：`9999px` 这种写法只有头像会用。

```css
/* 圆角与描边必须一起清：只清圆角的话图片变方角、那圈圆角描边还在，四角会露卡片底色 */
html.xm-flat .xm-media{border-radius:0!important;border:0!important;box-shadow:none!important}
```

验证脚本 `.workbuddy/quark-cardmedia.mjs`：mock 里铺四种（`tweetPhoto` 回归 / 外链卡圆角在 `a`+`wrapper` / 外链卡圆角在 `card.layout*` / 视频背景图），外加 40px 圆形头像。实测四张卡从封面图一路到最外层全部 `0px` / `border 0px none`，头像 `9999px` 未动，`data-xm-flat-media` = 7 层。

### 推文独立成块：盒高、translateY 与重排

每条推文是一个 `div[data-testid="cellInnerDiv"]`，它是 `position:absolute` + `transform:translateY(y)`，**这个 `y` 由 X 按「它前面所有 cell 的高度累加」算好写死**。所以：

| 做法 | 结果 |
|---|---|
| 加 `padding` / `border`（不管） | cell 变高，下一条的 `translateY` 不变 → 直接压在下一条身上 |
| 加 `margin` | 绝对定位元素的外边距不参与兄弟排布，白加 |
| 加 `padding` + `reflowCards()` | **可行**：改完高度立刻按实际值重排 `translateY`，并同步容器 `min-height` |

纯 `clip-path` 方案（只切绘制、不动盒子）最省事，但它受推文自身内边距限制，缝隙与留白此消彼长；要两个都大就必须动高度，也就必须配重排。两条路并存，现行版本是「两者合用」。

```css
html.xm-card [data-testid="primaryColumn"] [data-testid="cellInnerDiv"]{
  clip-path:inset(var(--xm-card-gap,12px) var(--xm-card-x,0px) var(--xm-card-gap,12px) var(--xm-card-x,0px) round var(--xm-card-r,0px))!important;
  background-color:var(--xm-card-bg,rgba(255,255,255,.11))!important;
}
html.xm-card [data-testid="primaryColumn"] article[data-testid="tweet"]{
  padding-top:var(--xm-card-pad,22px)!important;
  padding-bottom:var(--xm-card-pad,22px)!important;
}
```

`inset(上 右 下 左 round 半径)`：上下各裁 `--xm-card-gap`（默认 12px，相邻两条天然留 24px 缝）；**左右不裁**（`--xm-card-x` 默认 `0`）。第二条规则把推文自己的上下内边距抬到 `--xm-card-pad`（默认 22px），卡片边到内容就是 `22 − 12 = 10px`。圆角由 `--xm-card-r` 控制，**默认 `0`（直角）** —— 要的是「每条独立嵌在页面里」，不是卡片化。cell 里那几层 wrapper 常自带底色，会把卡片底色盖掉，一起透明。

### 为什么左右必须裁 0：要和发帖框对齐

顶部发帖框（composer）是**主栏满宽**、没有左右外边距，只有内容 16px 内边距。推文 article 同样是 16px 内边距，所以文字本来就是齐的；一旦卡片左右再各裁 8px，卡片的**外边框**就比发帖框窄 16px，同一栏里同时出现两条竖边，肉眼一眼能看出错位（截图实测：主栏 720，发帖框 720，卡片只有 704）。

所以 `--xm-card-x` 默认 `0`：卡片绘制边 = cell 边 = 主栏边 = 发帖框边，四者重合。想换回「两侧露出一线底色」的卡片感，把它设成正数即可，但那样就一定和发帖框对不齐。

验证脚本 `.workbuddy/quark-align.mjs`：mock 里放一个满宽发帖框 + 三条 cell，实测 `--xm-card-x:0` 时卡片绘制边与发帖框左右边差 **0 / 0 px**；改回 `8px` 立刻变成 +8 / −8；两种情况下 cell 高度仍 168/168/168、`translateY` 仍 0/168/336。

### 缝隙与留白：同一个预算，必须一起算

`clip-path` 只能裁、不能加。它裁掉的是**推文自己的内边距**，所以有两个量永远此消彼长：

```
缝隙 = 2 × gap        卡片边到内容 = pad − gap
```

X 原生 `article` 的上下内边距只有 12px，于是「缝隙 20px」必然只剩「2px 留白」——内容几乎贴边。想两个都大，只能先把 `pad` 抬上去（22px），再从中裁 `gap`：

| pad | gap | 缝隙 | 卡片边到内容 |
|---|---|---|---|
| 12（X 原生） | 10 | 20px | 2px（旧版，贴边） |
| **22（现行）** | **12** | **24px** | **10px** |
| 22 | 14 | 28px | 8px |
| 26 | 14 | 28px | 12px（更高，单条更占屏） |

**代价**：`pad` 一变，cell 就变高，而 X 把每条 cell 的 `translateY` 写死在行内、不会重算 —— 第二条开始会整片压上来。所以这套参数必须配 `reflowCards()`（见下节），不是纯 CSS 能搞定的。

### reflowCards()：把写死的 translateY 重排回去

X 的虚拟列表用 `translateY` 定位每条 `cellInnerDiv`，值来自它内部记录的高度累加。我们改了 article 内边距后：

1. 按 DOM 顺序累加每条 cell 的 `offsetHeight`；
2. 逐条写回 `translateY`，带 `!important`（X 之后重设行内样式也压不掉，位置由我们负责）；
3. 第一条的原始 Y 作基准，不整体上移；
4. 同步时间线容器的 `min-height`，否则最后几条滚不到；
5. `display:none` 的 cell（广告 / 折叠项）高度为 0，跳过不计。

调用时机：`sync()` 后一帧、每 500ms 的 tick、以及 `scroll`/`resize`（rAF 合并）—— 图片加载完会改 cell 高度，跟不上就会叠住。函数幂等：位置正确时一次不写。

验证脚本 `.workbuddy/quark-pad.mjs`：mock 里故意给错 `translateY`（0/168/336，实际每条 134px），扩展加载后实测重排为 **0/134/268**、相邻盒子首尾相接（−0.33px 亚像素）、容器 `min-height` 402px、`clip` 为 `inset(12px 0px)`、`padding` 22/22（左右仍 16）。

### 发推面板：不发推就整块收掉

「有什么新鲜事？」那一块对只看不写的人是纯浪费，`layout.hideCompose` 默认开，面板和左侧栏的发帖按钮一起收掉。

**不能用 CSS 指层级**：这块 DOM 的嵌套深度随 X 改版和页面（主页 / 列表 / 搜索）变化，`primaryColumn>div>div` 一旦打偏，轻则面板还在、重则把标签栏或整条时间线一起藏掉。改成「以发帖按钮定界」的爬升（`markComposer()`）：

1. 锚点：文本域 `[data-testid="tweetTextarea_0"]`（还有 `…RichTextInputContainer` 兜底），定位主栏 `primaryColumn`；
2. 定界尺：行内发帖按钮 `[data-testid="tweetButtonInline"]` —— **它只存在于面板内**；
3. 第 1 步，从文本域往上，升到「同时包着文本域与发帖按钮」的最近祖先 —— 面板的公共父层；
4. 第 2 步，继续往上，直到这一层**开始把不属于面板的东西包进来**：出现不在当前层里的 `cellInnerDiv`（时间线）、或出现当前层之外的 `role="tablist"`（顶部标签栏）。取最后一个「干净」的祖先打上 `.xm-comp-hide`。

**三次踩坑全在「停得太早」**：

| 版本 | 判据 | 结果 | 线上表现 |
|---|---|---|---|
| v0.1.36 | 按钮锚点 + 见 tablist 就停 | 停在下拉工具栏的 `ScrollSnap-List` 上 | 只藏了发帖按钮，面板还在 |
| v0.1.37 | 文本域锚点 + 每层都要含 `toolBar` | 第一层就没有 `toolBar`，`best` 恒为 null | 零标记，面板完整保留 |
| v0.1.38 | 文本域锚点 + `cellInnerDiv` 当边界 | X 把**输入区单独包进一个 cell**、工具栏是 cell 的兄弟 → 停在 cell | 输入框没了，头像+图标+发帖按钮还在 |
| **v0.1.39** | 以「仍包着发帖按钮」定界，外来 cell / tablist 才算越界 | 命中整个面板包裹层 | 整块消失 |

第四条尤其值得记：**`cellInnerDiv` 不能当边界**。X 把发推面板的输入区放进一个 cell 里渲染，工具栏留在 cell 外面；一旦判到 cell 就停，藏掉的正好是「输入框那一半」，工具栏原样留在页面上 —— 截图看着就像「消了一半」。现在的判据对「composer 在 cell 内」「工具栏在 cell 外」两种结构都成立。

第五条（v0.1.43）是**详情页**：`/用户名/status/…` 里主帖、回复框、回复列表共用同一个容器。回复列表放在**兄弟**容器里，而「外来 cell」那条判据只查 `p` 的后代、查不到兄弟里的 cell ⇒ 爬升一路通过，最后一层把主帖一起包了进去，点开推文只剩回复。修法是加一条不依赖结构位置的硬边界：**发推面板里不可能有推文，`p` 一旦包含 `article[data-testid="tweet"]` 就立刻停**；落笔前再校验一次 `best` 自身不含推文，否则写 `xmComp=guard` 并放弃标记 —— 宁可面板不藏，也不能藏掉内容。

排查用：`document.documentElement.dataset.xmComp` 会写 `ok` / `miss`（没找到公共父层）/ `col`（边界算到了主栏自身）。console 里看这一项就知道卡在哪一步。

实测（`.workbuddy/quark-composer.mjs`，mock 按真实结构还原：输入区在 `cellInnerDiv` 内、工具栏是兄弟、五个标签、三条推文 cell）：

| 判据 | 命中元素 | 效果 |
|---|---|---|
| v0.1.38：`cellInnerDiv` 当边界 | `inputCell`（输入区那个 cell） | 输入框没了，工具栏还在 |
| v0.1.39：以发帖按钮定界 | `cwrap`（整个面板包裹层） | `display:none`，宽高归 0 |

开 → 面板 `display:none`、顶部标签栏仍是 `flex`（53px）、三条推文 cell 168/168/168 且 `translateY` 不变、第一条推文顶到 54px 紧贴标签栏；关 → `display:block`、左侧发帖按钮回来、`html` 上的两个 class 干净移除。

### 主栏不能再有整块底板，而且只能顺着推文的祖先链去擦

缝隙里露出来的东西，取决于**推文背后还剩几层底板**。X 的底色是好几层 div 一层层画上去的，主栏还得再加一层我们自己的换肤 `surface()`。只要还剩一层不透明，缝隙里看到的就还是「板」，不是壁纸。

两处都要动：

1. **换肤那层**：`surface()` 是内联 `!important`，样式表打不过（实测：加 `html.xm-card [data-testid="primaryColumn"]{background-color:transparent!important}` 之后，主栏仍是 `rgba(0,0,0,.72)`）。所以 `applySkin` 加了 `bareColumn` 参数，打开时不刷主栏，直接 `paint(col, 'transparent')`。
2. **时间线内部那几层**：**不能**用 `primaryColumn>div>div…` 按层数一刀切 —— 吸顶的「为你推荐 / 正在关注」标签栏正好也在第 2 层，一起透明掉以后推文滚动会从它底下穿过去，糊成一片。改成 `clearCardWrappers()`：顺着**每条推文的祖先链**往上擦（cell 的父层 → 时间线容器 → 主栏），遇到 `position:sticky / fixed` 就停手。标签栏是主栏的**兄弟**，不在任何推文的祖先链上，天然不会碰到（实测擦完后标签栏仍是 `rgb(0,0,0)`，时间线容器是 `rgba(0,0,0,0)`）。

擦的时候从 cell 的**父层**开始，不擦 cell 本身 —— 卡片底色就画在 cell 上，内联 `!important` 会压过样式表，擦掉就没卡片了。

卡片底色分两套：有壁纸时用实体块（深 `rgba(18,20,24,.88)` / 浅 `rgba(255,255,255,.90)`）；背景关闭时主栏透明后页面是纯色，实体块会和页面同色、缝隙彻底看不见，改用很淡的明度差（深 `rgba(255,255,255,.06)` / 浅 `rgba(0,0,0,.03)`）。由 `paintUI(theme, withBg)` 决定。

验证脚本 `.workbuddy/quark-card.mjs` / `.workbuddy/quark-bare.mjs`：mock 三条 `translateY = 0/168/336` 的 cell，夸克内核实测开启前后 **cell 高度 168/168/168 与 translateY 全部不变**，`clip-path` 生效（`inset(7px 8px)`，无 `round`）、主栏与时间线容器 `rgba(0,0,0,0)`、标签栏 `rgb(0,0,0)` 保留，console 零错误。

### 推文流加宽怎么做的
主栏宽度走 CSS 变量 `--xm-feed-w`，一条规则顶掉 `primaryColumn` 的 `width/max-width/flex-basis`，不动任何 margin / padding / position。默认 720，关掉（切回 600）时变量和 `xm-wide` class 一起撤掉。

X 有些内层容器把 `600px` 写死在 `max-width` 上，主栏放宽后它们会成为瓶颈。所以额外做一层标记：主栏内计算值落在 `520–660px` 的 `div` 逐个加 `.xm-wide-el`，把 `max-width` 顶到变量。

**标记不能扫全列。** 最初是 `col.querySelectorAll('div')` 逐个读 `getComputedStyle` —— 一条二十条的流就是上千次样式计算，贵到只能 4 秒轮询一次。而回退 / 路由切换时主栏内部是**整棵重建**的，新容器不带标记，于是能挂着好几秒的「窄推流」。改成**沿 cell 的祖先链上溯**（限宽层必定是 cell 的祖先，一条链 ≤ 12 层就够）：成本从 O(全列 div) 降到 O(链长)，可以跟着 DOM 变更即时跑。

触发也随之改变：`MutationObserver` 盯主栏子树的 `childList`，重建后 60ms 内补扫；`popstate` / `pageshow` 额外补一次（它们早于 X 挂新 DOM，真正吃到新节点的是观察器回调）。实测重建后 **15–47ms** 恢复 720（旧实现 0–4000ms）。

### 回退后为什么「位置丢了」，怎么钉回去
不是滚动被重置，而是**内容在脚下改了高度**。时间线是虚拟列表：每个 cell 绝对定位，纵向位置由「前面所有 cell 的高度累加」算出来。回退时主栏内部重建，加宽层晚一两帧才补上 → 宽度一变正文重新折行 → 每条 cell 高度全变 → **`scrollY` 一步没动，但原来那条推文已经不在那个高度上了**。

所以纠正的对象不是 `scrollY`，而是「那条推文相对视口的位置」（`src/content/anchor.ts`）：

1. 滚动停 180ms 后，记下视口顶部第一条推文的 status id 与它的 `rect.top`，**按路径分桶**存 `sessionStorage`。分桶是必须的：从时间线点进详情页，详情页也会滚、也会记，不分桶会把详情页的位置当成时间线的；
2. `popstate` / `pageshow(persisted)` / 整页回退加载（导航类型 `back_forward`）后，等这条推文重新出现，用 `scrollBy` 把它摆回原来的 `top`；
3. 只在校正窗口内（SPA 2.6s、整页 6s）、漂移 > 8px 时动，最多盯到窗口结束；**用户一动滚轮 / 触摸 / 按键立刻收手**，绝不和手指抢滚动。

两个细节：推文 id 不能取第一个 `/status/` 链接（引用推文里也有，文档序在前，会把别人的 id 当成这条的）；跳动必须先临时把 `scroll-behavior` 压成 `auto` 并强制一次布局 —— X 给 `html` 设了 `smooth`，否则校正量在下一帧才走完，和自己的循环打架。

验证脚本 `.workbuddy/quark-back.mjs`：mock 拆掉整个 `.cap` 换新（模拟 X 重建），断言 ① 720 在 200ms 内回来且之后 1.2 秒不来回跳；② 回退前记 `{id:1010, top:-29}`，重建后每条变高 200→240，最终该推文 `top` 仍是 `-29`（`scrollY=2430`）；③ 恢复期间派发 `wheel`，位置不再被抢。

### 推文截图：像素从哪来

**不走 DOM 重绘**（html2canvas 那类）。X 的样式全部由构建哈希的 class + CSS 变量撑着，克隆一份再画到 canvas，字体、`object-fit`、渐变、引用卡、圆角几乎必然走形；外链图还有跨域污染 canvas 的问题。改成**直接拿浏览器画好的像素**：

1. 内容脚本量出推文的 `getBoundingClientRect()`；
2. 通过 `chrome.runtime.sendMessage` 请后台调 `chrome.tabs.captureVisibleTab`（这个 API 只在扩展进程存在），拿回当前视口的一张 PNG；
3. 在内容脚本里开 canvas，按 rect 把推文那一块裁下来。

所见即所得，没有跨域问题，也不依赖 X 的 DOM 结构 —— X 改版不会让截图变形。按钮位置同样不用算坐标（见下）。

**权限：必须声明 `<all_urls>`。** `captureVisibleTab` 的权限检查只认 `<all_urls>` 或 `activeTab`，而 `activeTab` 只能由「点扩展图标 / 快捷键 / 右键菜单」授予 —— 我们的按钮在页面里，拿不到。实测把 `host_permissions` 收窄到 `https://x.com/*` 时，API 直接拒绝、截图流程卡在等预览。（代码本身仍只在 x.com 注入内容脚本，后台只做「截一帧」这一件事。）

**按钮不绝对定位，直接排进操作栏。** 用 `insertBefore` 把按钮插到推文底部 `[role="group"]` 里「收藏」按钮的下一格，它就是一个普通 flex item：34×34、`border-radius:9999px`，与 X 自己的图标等高等宽，间距由 X 的 flex 布局给 —— 卡片模式改了上下内边距、窗口缩放都不用重算坐标。按钮**常显**（不再依赖 hover），截图期间才临时收掉。

挑 group 有个坑：**不能取第一个**。引用推文内部也有自己的 `[role="group"]`，按文档序排在前面；判据必须是「这个 group 的最近 `article` 祖先就是当前推文」。收藏按钮外面还可能套一层 `div`，要往上爬到 group 的直属子节点再取 `nextSibling` 当插入点。

**长推文要分帧，四个坑都在细节里**：

| 问题 | 处理 |
|---|---|
| 一屏装不下 | 按「视口高度 − 6」切段，每段滚到该段顶部贴齐视口顶再截 |
| 吸顶标签栏压住段首 | 截图前用 `elementsFromPoint` 找出「贴顶、`sticky/fixed`、宽度覆盖主栏」的层，整段期间 `visibility:hidden`（sticky 在流里占位，隐藏不引起重排） |
| 段与段重叠/漏行 | 目标高度用「累计边界相减」`round((done+h)·s) − round(done·s)`，而不是每段各自 `round(h·s)`；`s=1.5` 这类非整数倍率下后者会差 1 行 |
| 滚动后帧顶那一行是脏的 | 每段多滚 3px（`LEAD`），让裁剪线落在帧顶下方，接缝处不会留一条 1px 黑线 |

截图期间 `html` 上加 `.xm-shotting`：把自己的相机按钮、提示条一概藏掉（**自己的浮层也会入镜** —— 第一版就把进度提示条拍进了长图中段），并把 `scroll-behavior` 临时改成 `auto`；结束后滚回原位、还原内联样式。进度改写到**标签页标题**（浏览器 UI 不参与截图）。

**预览浮层的三个细节**：整套浮层**直角、无圆角**（面板、图片、关闭键、底部按钮一律 0）；下载走 blob URL；复制用 `navigator.clipboard.write` + `ClipboardItem`，放在预览里的按钮上而不是截图完成时 —— 剪贴板写入要求「用户手势」，异步截图之后再写会丢手势。主按钮文字色按强调色亮度二选一（`--xm-acc` 里有明黄，白字会看不见）。

验证脚本 `.workbuddy/quark-shot.mjs`：mock 三条推文，其中一条 2400px、内部分 8 条纯色色带。断言覆盖：按钮在操作栏内、位于「收藏」之后「分享」之前、与该行垂直居中、`opacity=1`（不 hover 也可见）；canvas 尺寸 = CSS 尺寸 × dpr；**8 条色带逐点采样颜色全等**，两处接缝 ±4px 内颜色连续（无黑线）；截图后 `scrollY` 还原、`xm-shotting` 无残留；下载文件名、剪贴板写入、console 零错误。

### 彩色图标为什么要去色

导航列里绝大多数图标是 `fill:currentColor` 的单色 svg，会跟着主题走；但 Grok 的品牌图标、部分 emoji 字形、账户头像都是**彩色源**，落在灰阶图标列里会「跳」。插件会找出 `img`、带 `background-image` 的元素、以及直接含 emoji 文本节点的容器，给它们加 `.xm-mono`（`grayscale` + `opacity:.9`）。svg 一律不碰。

### 图标栏为什么不改内层结构

只动三样：最外层 header 的 `position/width`、所有文字 `span` 的 `display`、导航项 `a` 与两个 `data-testid` 按钮的尺寸。中间那堆构建哈希的 div 一个不碰，所以 X 换布局时受影响面最小。

**判定必须「以 svg 为准」**：隐藏文字容器用的是 `a[href] > div:not(:has(svg))` —— 只藏不含 svg 的容器。**不能用 `:has(span)`**：真实 X 的图标 `div` 里除了 svg 还有一个 sr-only 的 `span`，用 span 判定会把整个图标容器一起 `display:none`，表现为「图标全消失、只剩空按钮」。这条踩过，见 v0.1.2 修复记录。

header 变 `fixed` 后原来的 275px 占位会消失，主栏会整体左移。补位用的是**给 header 的父元素加 `padding-left: 76px`**，而不是改父元素的 `display`/`flex` —— 父元素的 flex 属性一改，主栏的 `margin:auto` 居中就不成立了。

发帖按钮的文字被隐藏后是个空按钮，所以用 `::after` + `mask` 补了一个笔形图标（`currentColor` 跟随按钮前景色，深浅主题都对）。

**账户切换按钮（左下角那个圆形头像）已整条隐藏**，位置让给设置齿轮。它和发帖按钮不同：发帖按钮是「可能用不上」，账户按钮是「永远不需要的装饰」——点开它只是为了切号/登出，而换号要走 X 自己的完整流程，留着只是占位。规则只有一条 `[data-testid="SideNav_AccountSwitcher_Button"]{display:none}`，挂在 `html.xm-rail` 下：关掉图标栏就自动恢复，删掉这一行也能恢复。

**齿轮用 `position:fixed` 钉在窗口左下角**，不再挂进 `nav`。早先的写法是塞进账户头像那个吸底容器，靠 X 的 flex 排布定位；账户按钮隐藏后容器塌陷，齿轮跟着一起消失（v0.1.40 实机反馈）。`fixed` 只认视口：栏宽 76px、按钮 52px，居中即 `left:12px`，底部留 16px，与 X 的 DOM 结构彻底解耦。

路由切换会重建 header 的父元素，补位 padding 会丢，所以 1.5 秒的兜底节拍里会重新调一次 `applyRail()`（幂等，padding 没丢就什么都不做）。

### 字号为什么用 zoom

X 的字号是写死的 px，改 `html { font-size }` 没有意义；`zoom` 是唯一能等比放大又不破坏虚拟列表测量的一致性做法。作用在 `#react-root` 上，我们的背景层和设置面板在它外面，不受影响。

### 「流光」单独打包

WebGPU 那套（vgpu + 4 个 wgsl）约 200KB，只有选到它时才由内容脚本 `import(chrome.runtime.getURL('flux.js'))` 动态加载；机器没有 WebGPU 或加载失败就自动退回同名的 WebGL 近似版。

## 与原项目的差异

| | 映间 MARGIN | X MARGIN |
|---|---|---|
| 着色器 | 13 款（含「汇流」） | 12 款（去掉依赖 B 站搜索栏的「汇流」） |
| 液态玻璃透镜 | 有（卡片做折射） | 无 |
| 开场动画 / 天气 / 命令面板 / 播放器 | 有 | 无 |
| 注入方式 | WebGL canvas + 大量站点级 UI | 只注入背景层 + 一块设置面板 |

## 已知限制

- 只在 `data-testid` 结构对得上的页面生效；X 大改版可能要让 `skin.ts` 里的锚点跟着改
- 图标栏隐藏的是 header 内**所有** `span`，通知角标数字若用 `span` 包裹也会一并隐藏（图标本身是 svg，不受影响）
- 图标容器的判定依赖 `:has()`（Chrome 105+，MV3 最低要求已满足）
- 表单页（登录、发推弹窗）沿用 X 原底色，不做半透明——半透明编辑框打字会花
- 「薄」档 + 高亮背景（如「天光」「颗粒」）时，长文阅读会有点晃眼，换「中/厚」或降强度
