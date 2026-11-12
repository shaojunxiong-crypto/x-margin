import type { FeedWidth, Glass, Settings } from '../shared/settings';
import { ACCENTS, BG_IMAGE_KEY, cleanFont, cleanHex, SHADERS } from '../shared/settings';
import { SHADER_NAMES } from './bg/shaders';
import { compressImage } from './bg/background';
import { shaderThumb } from './bg/program';
import { railItems } from './rail';
import { applyAccent } from './theming';
import { themeStuck } from './theme';

interface PanelOptions {
  settings: () => Settings;
  update: (patch: Partial<Settings>) => Promise<void>;
}

export interface PanelApi {
  root: HTMLElement;
  /** 图标栏开 / 关、或 X 重渲染后调用：齿轮按钮挂到图标栏末尾，或退回右下浮动球 */
  place: (railOn: boolean) => void;
}

/** 常见的齿轮设置图标：外圈 8 齿 + 内圆，线条风格与 X 自己的导航图标一致 */
const GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<circle cx="12" cy="12" r="3.1"/>'
  + '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>'
  + '</svg>';

const CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
  + 'stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

/** 面板配色走 CSS 变量（--xm-ui-*），由 theming.applySkin 按 X 实际主题写入。
 *  全直角：面板、卡片、开关、色板、分段控件一律 0 圆角，和主栏推文卡片的直角一致。 */
const CSS = `
.xm-root{--xm-acc:#1d9bf0}
.xm-fab{position:fixed;right:18px;bottom:96px;z-index:2147483000;width:46px;height:46px;border-radius:0;
  border:1px solid var(--xm-ui-line,rgba(255,255,255,.14));background:var(--xm-ui-bg,rgba(20,20,22,.82));
  -webkit-backdrop-filter:blur(18px) saturate(1.35);backdrop-filter:blur(18px) saturate(1.35);
  color:var(--xm-ui-fg,#e7e9ea);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;
  box-shadow:0 10px 30px rgba(0,0,0,.3);transition:transform .16s ease,color .16s ease,background .16s ease}
.xm-fab:hover{transform:translateY(-2px)}
.xm-fab:active{transform:none}
.xm-fab svg{display:block;width:23px;height:23px}
.xm-fab[data-open="1"]{color:var(--xm-acc)}
/* 进入图标栏后跟 X 自己的导航项同尺寸同形状：52px 正圆、无边框无阴影 ——
   这里是寄生在 X 导航里的悬停态，圆角跟随 X，不改直角。
   用 fixed 钉在窗口左下角，不挂进 nav：那条路依赖 X 的账户按钮容器，容器塌陷会连齿轮一起消失。 */
.xm-fab[data-rail="1"]{position:fixed;left:12px;bottom:16px;right:auto;top:auto;margin:0;width:52px;height:52px;
  border:0;border-radius:9999px;background:transparent;box-shadow:none;
  -webkit-backdrop-filter:none;backdrop-filter:none;color:var(--xm-rail-fg,#e7e9ea)}
.xm-fab[data-rail="1"]:hover{transform:none;background:rgba(127,127,127,.18)}
.xm-fab[data-rail="1"] svg{width:26px;height:26px}
.xm-fab[data-rail="1"][data-open="1"]{color:var(--xm-acc)}
.xm-panel{position:fixed;z-index:2147483001;width:334px;max-height:min(80vh,664px);box-sizing:border-box;
  display:flex;flex-direction:column;overflow:hidden;border-radius:0;
  border:1px solid var(--xm-ui-line,rgba(255,255,255,.12));background:var(--xm-ui-bg,rgba(17,17,19,.9));
  -webkit-backdrop-filter:blur(26px) saturate(1.45);backdrop-filter:blur(26px) saturate(1.45);
  box-shadow:0 14px 34px rgba(0,0,0,.5);
  color:var(--xm-ui-fg,#e7e9ea);
  font:13px/1.55 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  opacity:0;visibility:hidden;pointer-events:none;transform:translateY(6px);
  transition:opacity .18s ease,transform .18s ease,visibility .18s}
.xm-panel[data-open="1"]{opacity:1;visibility:visible;pointer-events:auto;transform:none}
.xm-root[data-rail="1"] .xm-panel{left:88px;bottom:18px}
/* 浮动球模式下面板必须让开球体本身（46px + 上下留白），否则打开后点不到关不掉 */
.xm-root[data-rail="0"] .xm-panel{right:18px;bottom:152px;max-height:min(78vh,620px)}
.xm-panel *{box-sizing:border-box}
.xm-hd{display:flex;align-items:center;gap:9px;padding:13px 12px 12px 14px;flex:none;
  border-bottom:1px solid var(--xm-ui-line,rgba(255,255,255,.1))}
.xm-hd-ic{flex:none;width:26px;height:26px;border-radius:0;display:flex;align-items:center;justify-content:center;
  color:var(--xm-acc);background:var(--xm-acc-soft,rgba(29,155,240,.16))}
.xm-hd-ic svg{width:16px;height:16px;display:block}
.xm-hd-t{flex:1;min-width:0;line-height:1.25}
.xm-hd-t b{display:block;font:600 13px/1.25 inherit;letter-spacing:.01em}
.xm-hd-t i{display:block;font-style:normal;font:400 10.5px/1.3 inherit;color:var(--xm-ui-sub,#8b98a5);margin-top:2px}
.xm-x{flex:none;margin-left:4px;width:27px;height:27px;border:0;border-radius:0;background:transparent;
  color:var(--xm-ui-sub,#8b98a5);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;
  transition:background .14s ease,color .14s ease}
.xm-x svg{width:14px;height:14px;display:block}
.xm-x:hover{background:var(--xm-ui-hover,rgba(255,255,255,.08));color:var(--xm-ui-fg,#e7e9ea)}
.xm-body{padding:2px 14px 14px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-width:thin;
  scrollbar-color:var(--xm-ui-line,rgba(255,255,255,.12)) transparent}
.xm-body::-webkit-scrollbar{width:8px}
.xm-body::-webkit-scrollbar-thumb{background:var(--xm-ui-line,rgba(255,255,255,.12));border-radius:0}
.xm-body::-webkit-scrollbar-track{background:transparent}
.xm-sec{margin-top:15px}
.xm-sec-h{display:flex;align-items:center;gap:8px;margin:0 2px 7px}
.xm-sec-h span{font:600 10px/1 inherit;letter-spacing:.16em;text-transform:uppercase;color:var(--xm-ui-dim,#71767b);
  white-space:nowrap}
.xm-sec-l{flex:1;height:1px;background:var(--xm-ui-line,rgba(255,255,255,.1));opacity:.8}
.xm-pcard{border:1px solid var(--xm-ui-line,rgba(255,255,255,.1));border-radius:0;overflow:hidden;
  background:var(--xm-ui-card,rgba(255,255,255,.04))}
.xm-sw{display:flex;align-items:center;gap:10px;padding:9px 11px;cursor:pointer;user-select:none;
  transition:background .14s ease}
.xm-sw+.xm-sw{border-top:1px solid var(--xm-ui-line,rgba(255,255,255,.08))}
.xm-sw:hover{background:var(--xm-ui-hover,rgba(255,255,255,.06))}
.xm-sw:focus-visible{outline:2px solid var(--xm-acc);outline-offset:-2px}
.xm-sw-t{flex:1;min-width:0}
.xm-sw-t b{display:block;font:500 12.5px/1.35 inherit;color:var(--xm-ui-fg,#e7e9ea)}
.xm-sw-t i{display:block;font-style:normal;font:400 10.5px/1.4 inherit;color:var(--xm-ui-sub,#8b98a5);margin-top:1px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xm-tg{flex:none;width:34px;height:20px;border-radius:0;position:relative;
  background:var(--xm-ui-line,rgba(255,255,255,.16));transition:background .16s ease}
.xm-tg::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:0;
  background:#fff;transition:transform .16s ease}
.xm-sw[data-on="1"] .xm-tg{background:var(--xm-acc)}
.xm-sw[data-on="1"] .xm-tg::after{transform:translateX(14px)}
.xm-fld{padding:9px 11px 11px}
.xm-fld+.xm-fld{border-top:1px solid var(--xm-ui-line,rgba(255,255,255,.08))}
.xm-fld-h{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:8px;
  font:500 12.5px/1.3 inherit;color:var(--xm-ui-fg,#e7e9ea)}
.xm-fld-h em{font-style:normal;font:500 10.5px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--xm-ui-sub,#8b98a5)}
/* 强调色色板：方形色块 + 末尾一个原生取色器（彩虹环由 input 自己画） */
.xm-dots{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.xm-dot{width:22px;height:22px;border-radius:0;border:0;padding:0;cursor:pointer;background:var(--c);
  box-shadow:inset 0 0 0 1px rgba(127,127,127,.35);
  transition:box-shadow .14s ease}
.xm-dot:hover{box-shadow:inset 0 0 0 1px rgba(127,127,127,.35),0 0 0 1px var(--xm-ui-sub,#8b98a5)}
.xm-dot[data-on="1"]{box-shadow:inset 0 0 0 1px rgba(127,127,127,.35),0 0 0 2px var(--xm-ui-fg,#e7e9ea)}
.xm-color{flex:none;width:22px;height:22px;padding:3px;border:0;border-radius:0;cursor:pointer;
  -webkit-appearance:none;appearance:none;
  background:conic-gradient(from .25turn,#f91880,#ffd400,#00ba7c,#1d9bf0,#7856ff,#f91880)}
.xm-color::-webkit-color-swatch-wrapper{padding:0}
.xm-color::-webkit-color-swatch{border:0;border-radius:0}
.xm-note{margin:7px 1px 0;font:400 10px/1.45 inherit;color:var(--xm-ui-dim,#71767b)}
.xm-seg{display:flex;gap:3px;padding:3px;border-radius:0;background:var(--xm-ui-seg,rgba(255,255,255,.06))}
/* ⛔ 居中不能只靠 text-align：x.com 的全局 reset 是 button{text-align:inherit}，会继承到 start（左对齐），
   实测文字中心比按钮中心偏左 29.6px。这里用 flex 居中，任何 reset 都盖不掉。 */
.xm-seg button{flex:1;min-width:0;border:0;border-radius:0;background:transparent;cursor:pointer;padding:7px 2px;
  display:flex;align-items:center;justify-content:center;text-align:center;
  font:500 11.5px/1.15 inherit;color:var(--xm-ui-sub,#8b98a5);
  transition:background .14s ease,color .14s ease,box-shadow .14s ease}
.xm-seg button:hover{color:var(--xm-ui-fg,#e7e9ea)}
.xm-seg button[data-on="1"]{background:var(--xm-ui-on,rgba(255,255,255,.14));color:var(--xm-ui-fg,#e7e9ea)}
.xm-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.xm-chip{position:relative;aspect-ratio:4/3;padding:0;overflow:hidden;border-radius:0;cursor:pointer;
  border:1px solid var(--xm-ui-line,rgba(255,255,255,.1));background:rgba(255,255,255,.05) center/cover no-repeat;
  transition:border-color .14s ease,box-shadow .14s ease}
/* 缩略图标签同理：绝对定位盒子定宽，再用 flex 把文字真正摆到中间（不依赖 text-align 继承） */
.xm-chip span{position:absolute;left:0;right:0;bottom:0;padding:4px 0 3px;
  display:flex;align-items:center;justify-content:center;text-align:center;
  font:500 9px/1 inherit;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.72))}
.xm-chip[data-on="1"]{border-color:var(--xm-acc);box-shadow:inset 0 0 0 1px var(--xm-acc)}
/* 强度滑杆：原生 accent-color 的圆钮与直角风格冲突，这里整条自绘 —— 4px 方头轨道 + 方块滑块，
   已填充部分靠 --p（百分比）画渐变，JS 在 input 与初始化时写入 */
.xm-range{-webkit-appearance:none;appearance:none;width:100%;height:16px;margin:0;cursor:pointer;border-radius:0;
  background-color:transparent;
  background-image:linear-gradient(to right,var(--xm-acc) 0,var(--xm-acc) var(--p,50%),
    var(--xm-ui-line,rgba(255,255,255,.16)) var(--p,50%),var(--xm-ui-line,rgba(255,255,255,.16)) 100%);
  background-size:100% 4px;background-position:center;background-repeat:no-repeat}
.xm-range::-webkit-slider-runnable-track{-webkit-appearance:none;appearance:none;height:16px;background:transparent;
  border:0;border-radius:0}
.xm-range::-webkit-slider-thumb{-webkit-appearance:none;width:10px;height:16px;margin:0;border:0;border-radius:0;
  background:var(--xm-acc);box-shadow:0 0 0 2px var(--xm-ui-bg,#111)}
.xm-range::-moz-range-track{height:4px;background:var(--xm-ui-line,rgba(255,255,255,.16));border-radius:0}
.xm-range::-moz-range-progress{height:4px;background:var(--xm-acc);border-radius:0}
.xm-range::-moz-range-thumb{width:10px;height:16px;border:0;border-radius:0;background:var(--xm-acc)}
.xm-in{width:100%;margin-top:8px;padding:8px 10px;border-radius:0;outline:none;
  border:1px solid var(--xm-ui-line,rgba(255,255,255,.14));background:var(--xm-ui-seg,rgba(255,255,255,.05));
  color:var(--xm-ui-fg,#e7e9ea);font:12px/1.3 inherit}
.xm-in::placeholder{color:var(--xm-ui-dim,#71767b)}
.xm-in:focus{border-color:var(--xm-acc)}
.xm-upload{width:100%;margin-top:8px;padding:10px;border-radius:0;cursor:pointer;
  display:flex;align-items:center;justify-content:center;text-align:center;
  border:1px dashed var(--xm-ui-line,rgba(255,255,255,.2));background:transparent;
  color:var(--xm-ui-sub,#8b98a5);font:500 11.5px/1.2 inherit;transition:color .14s ease,border-color .14s ease}
.xm-upload:hover{color:var(--xm-ui-fg,#e7e9ea);border-color:var(--xm-ui-sub,#8b98a5)}
.xm-list{max-height:186px;overflow:auto;scrollbar-width:thin}
.xm-item{display:flex;align-items:center;gap:9px;padding:6px 11px;cursor:pointer;transition:background .12s ease}
.xm-item:hover{background:var(--xm-ui-hover,rgba(255,255,255,.06))}
.xm-item input{flex:none;width:14px;height:14px;margin:0;accent-color:var(--xm-acc);cursor:pointer}
.xm-item span{font:400 12px/1.3 inherit;color:var(--xm-ui-fg,#e7e9ea);overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;opacity:.9}
.xm-item[data-off="1"] span{opacity:.42}
.xm-mini{border:0;background:transparent;color:var(--xm-acc);cursor:pointer;padding:2px 4px;border-radius:0;
  font:500 10px/1 inherit;letter-spacing:.02em}
.xm-mini:hover{background:var(--xm-ui-hover,rgba(255,255,255,.08))}
.xm-ft{margin-top:13px;padding-top:10px;border-top:1px solid var(--xm-ui-line,rgba(255,255,255,.08));
  font:400 10px/1.6 inherit;color:var(--xm-ui-dim,#71767b)}
.xm-ft b{font-weight:500;color:var(--xm-ui-sub,#8b98a5)}
.xm-hide{display:none!important}
`;

export function createPanel(opts: PanelOptions): PanelApi {
  const style = document.createElement('style');
  style.id = 'xm-panel-css';
  style.textContent = CSS;

  const fab = document.createElement('button');
  fab.className = 'xm-fab';
  fab.type = 'button';
  fab.title = 'X Margin 设置';
  fab.setAttribute('aria-label', 'X Margin 设置');
  fab.setAttribute('aria-expanded', 'false');
  fab.innerHTML = GEAR;

  const panel = document.createElement('div');
  panel.className = 'xm-panel';

  const root = document.createElement('div');
  root.className = 'xm-root';
  root.dataset.rail = '0';
  root.append(style, panel, fab);

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // —— 控件 ——

  function section(title: string, action?: HTMLElement): HTMLElement {
    const box = el('div', 'xm-sec');
    const head = el('div', 'xm-sec-h');
    head.append(el('span', undefined, title), el('div', 'xm-sec-l'));
    if (action) head.append(action);
    const card = el('div', 'xm-pcard');
    box.append(head, card);
    body.append(box);
    return card;
  }

  /** 开关行：标题 + 一句说明 + 滑动开关，比「去掉 / 保留」两个按钮好读 */
  function sw(card: HTMLElement, title: string, desc: string, on: boolean, onChange: (v: boolean) => void): void {
    const row = el('div', 'xm-sw');
    row.dataset.on = on ? '1' : '0';
    row.setAttribute('role', 'switch');
    row.setAttribute('aria-checked', String(on));
    row.tabIndex = 0;
    const txt = el('div', 'xm-sw-t');
    txt.append(el('b', undefined, title), el('i', undefined, desc));
    row.append(txt, el('span', 'xm-tg'));
    const fire = () => onChange(row.dataset.on !== '1');
    row.onclick = fire;
    row.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); }
    };
    card.append(row);
  }

  function field(card: HTMLElement, title: string, note?: string): { box: HTMLElement; head: HTMLElement } {
    const box = el('div', 'xm-fld');
    const head = el('div', 'xm-fld-h');
    head.append(el('span', undefined, title));
    if (note) head.append(el('em', undefined, note));
    box.append(head);
    card.append(box);
    return { box, head };
  }

  function seg<T extends string | number>(
    host: HTMLElement, items: [T, string][], current: T, onPick: (v: T) => void,
  ): HTMLElement {
    const box = el('div', 'xm-seg');
    for (const [v, label] of items) {
      const b = el('button', undefined, label);
      b.type = 'button';
      if (String(v) === String(current)) b.dataset.on = '1';
      b.onclick = () => onPick(v);
      box.append(b);
    }
    host.append(box);
    return box;
  }

  let thumbTimer = 0;
  let body: HTMLElement;

  function render(): void {
    const s = opts.settings();
    root.style.setProperty('--xm-acc', s.accent);
    const keepScroll = body ? body.scrollTop : 0;
    panel.textContent = '';

    // —— 头部 ——
    const head = el('div', 'xm-hd');
    const ic = el('div', 'xm-hd-ic');
    ic.innerHTML = GEAR;
    const ht = el('div', 'xm-hd-t');
    const glassCn = s.bg.glass === 'thick' ? '厚玻璃' : s.bg.glass === 'thin' ? '薄玻璃' : '中玻璃';
    const summary = [
      `${s.layout.feedWidth}px`,
      s.layout.hideSidebar ? '无右栏' : '双栏',
      s.bg.mode === 'off' ? null : s.bg.mode === 'image' ? '图片背景' : glassCn,
    ].filter(Boolean).join(' · ');
    ht.append(el('b', undefined, 'X Margin'), el('i', undefined, summary));
    const close = el('button', 'xm-x');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭');
    close.innerHTML = CLOSE;
    close.onclick = () => toggle(false);
    head.append(ic, ht, close);

    body = el('div', 'xm-body');
    panel.append(head, body);

    // —— 外观：主题（写 X 自己的 night_mode）+ 强调色 ——
    let card = section('外观');
    {
      const zh = s.theme === 'light' ? '白色' : s.theme === 'dark' ? '黑色' : '跟随系统';
      const f = field(card, '主题', zh);
      seg<'light' | 'dark' | 'auto'>(
        f.box,
        [['light', '白色'], ['dark', '黑色'], ['auto', '跟随系统']],
        s.theme,
        (v) => { void opts.update({ theme: v }).then(render); },
      );
      if (themeStuck(s.theme)) {
        f.box.append(el('div', 'xm-note', 'X 又把主题改回去了 —— 可能是账号里的外观设置优先，'
          + '可先在 X 设置 → 显示 里关掉「跟随系统」再试。'));
      } else {
        f.box.append(el('div', 'xm-note', '切换后整页刷新一次（编辑器里没发出去的内容会丢）'));
      }
    }
    sw(card, '文字柔化', '深色下把正文白压暗一档，不那么扎眼', s.softText, (v) => {
      void opts.update({ softText: v }).then(render);
    });
    {
      const f = field(card, '强调色', s.accent.toUpperCase());
      const dots = el('div', 'xm-dots');
      for (const a of ACCENTS) {
        const b = el('button', 'xm-dot');
        b.type = 'button';
        b.title = a.name;
        b.setAttribute('aria-label', a.name);
        b.style.setProperty('--c', a.hex);
        if (a.hex.toLowerCase() === s.accent.toLowerCase()) b.dataset.on = '1';
        b.onclick = () => { void opts.update({ accent: a.hex }).then(render); };
        dots.append(b);
      }
      const pick = el('input', 'xm-color');
      pick.type = 'color';
      pick.value = s.accent;
      pick.title = '自定义';
      pick.setAttribute('aria-label', '自定义强调色');
      // 取色器拖动时会连续触发 input：先直接上色预览，等松手（change）再落盘重绘
      pick.oninput = () => {
        const hex = cleanHex(pick.value);
        applyAccent(hex);
        root.style.setProperty('--xm-acc', hex);
        dots.querySelectorAll<HTMLElement>('.xm-dot').forEach((d) => delete d.dataset.on);
      };
      pick.onchange = () => { void opts.update({ accent: cleanHex(pick.value) }).then(render); };
      dots.append(pick);
      f.box.append(dots);
    }

    // —— 布局 ——
    card = section('布局');
    sw(card, '隐藏右侧栏', '搜索、趋势、推荐关注整栏收起', s.layout.hideSidebar, (v) => {
      void opts.update({ layout: { ...s.layout, hideSidebar: v } }).then(render);
    });
    sw(card, '图标导航栏', '左侧导航压成竖排图标，贴边固定', s.layout.railNav, (v) => {
      void opts.update({ layout: { ...s.layout, railNav: v } }).then(render);
    });
    sw(card, '隐藏发推入口', '顶部发推面板和发帖按钮一起收掉', s.layout.hideCompose, (v) => {
      void opts.update({ layout: { ...s.layout, hideCompose: v } }).then(render);
    });
    sw(card, '隐藏滚动条', '去掉窗口滚动条，弹窗内保留', s.layout.noScrollbar, (v) => {
      void opts.update({ layout: { ...s.layout, noScrollbar: v } }).then(render);
    });
    sw(card, '隐藏浮动按钮', '右下角 Grok 与私信气泡', s.layout.hideFloats, (v) => {
      void opts.update({ layout: { ...s.layout, hideFloats: v } }).then(render);
    });

    card = section('推文流');
    sw(card, '隐藏推广', '广告推文整条收起，不留空白', s.layout.hideAds, (v) => {
      void opts.update({ layout: { ...s.layout, hideAds: v } }).then(render);
    });
    {
      const f = field(card, '宽度', `${s.layout.feedWidth}px`);
      seg<FeedWidth>(f.box, [[600, '600'], [720, '720'], [840, '840']], s.layout.feedWidth, (v) => {
        void opts.update({ layout: { ...s.layout, feedWidth: v } }).then(render);
      });
    }

    // —— 导航项：只在图标栏开启时才有意义 ——
    if (s.layout.railNav) {
      const items = railItems();
      if (items.length) {
        const all = el('button', 'xm-mini', '全部显示');
        all.type = 'button';
        all.onclick = () => {
          void opts.update({ layout: { ...s.layout, railHide: [], railSeedV: 2 } }).then(render);
        };
        const shown = items.filter((it) => !s.layout.railHide.includes(it.key)).length;
        const c2 = section(`导航项 ${shown}/${items.length}`, all);
        const list = el('div', 'xm-list');
        for (const it of items) {
          const on = !s.layout.railHide.includes(it.key);
          const row = el('label', 'xm-item');
          if (!on) row.dataset.off = '1';
          const cb = el('input');
          cb.type = 'checkbox';
          cb.checked = on;
          cb.onchange = () => {
            const next = new Set(s.layout.railHide);
            if (cb.checked) next.delete(it.key); else next.add(it.key);
            void opts.update({ layout: { ...s.layout, railHide: [...next], railSeedV: 2 } }).then(render);
          };
          row.append(cb, el('span', undefined, it.label));
          list.append(row);
        }
        c2.append(list);
      }
    }

    // —— 背景 ——
    card = section('背景');
    {
      const f = field(card, '模式');
      seg<'off' | 'fixed' | 'random' | 'image'>(
        f.box,
        [['off', '关闭'], ['fixed', '固定'], ['random', '随机'], ['image', '图片']],
        s.bg.mode,
        (v) => { void opts.update({ bg: { ...s.bg, mode: v } }).then(render); },
      );
    }
    if (s.bg.mode !== 'off') {
      const f = field(card, '玻璃浓度', s.bg.glass === 'thick' ? '厚' : s.bg.glass === 'thin' ? '薄' : '中');
      seg<Glass>(f.box, [['thick', '厚'], ['mid', '中'], ['thin', '薄']], s.bg.glass, (v) => {
        void opts.update({ bg: { ...s.bg, glass: v } }).then(render);
      });
    }

    if (s.bg.mode === 'fixed' || s.bg.mode === 'random') {
      const f = field(card, '着色器', SHADER_NAMES[s.bg.shader] ?? '');
      const grid = el('div', 'xm-grid');
      for (const id of SHADERS) {
        const chip = el('button', 'xm-chip');
        chip.type = 'button';
        chip.title = SHADER_NAMES[id] ?? id;
        chip.append(el('span', undefined, SHADER_NAMES[id] ?? id));
        if (s.bg.shader === id) chip.dataset.on = '1';
        chip.onclick = () => { void opts.update({ bg: { ...s.bg, shader: id, mode: s.bg.mode } }).then(render); };
        grid.append(chip);
      }
      f.box.append(grid);
      // 缩略图要编译着色器，等面板真的画出来再算，先给个空位
      clearTimeout(thumbTimer);
      thumbTimer = window.setTimeout(() => {
        const chips = Array.from(grid.querySelectorAll<HTMLElement>('.xm-chip'));
        SHADERS.forEach((id, i) => {
          const url = shaderThumb(id, 'dark');
          if (url && chips[i]) chips[i].style.backgroundImage = `url(${url})`;
        });
      }, 60);

      const f2 = field(card, '强度', `${Math.round(s.bg.intensity * 100)}%`);
      const range = el('input', 'xm-range');
      range.type = 'range'; range.min = '0'; range.max = '100'; range.step = '1';
      range.value = String(Math.round(s.bg.intensity * 100));
      const paint = () => range.style.setProperty('--p', `${range.value}%`);
      paint();
      range.oninput = () => {
        f2.head.querySelector('em')!.textContent = `${range.value}%`;
        paint();
        document.querySelector<HTMLElement>('.xm-bg')?.style.setProperty('--xm-bg-o', String(Number(range.value) / 100));
      };
      range.onchange = () => { void opts.update({ bg: { ...s.bg, intensity: Number(range.value) / 100 } }); };
      f2.box.append(range);
    }

    if (s.bg.mode === 'image') {
      const f = field(card, '自定义图片');
      const btn = el('button', 'xm-upload', '选择本地图片（自动压缩到长边 2400px）');
      btn.type = 'button';
      const file = el('input');
      file.type = 'file'; file.accept = 'image/*'; file.className = 'xm-hide';
      btn.onclick = () => file.click();
      file.onchange = async () => {
        const picked = file.files?.[0];
        if (!picked) return;
        btn.textContent = '压缩中…';
        const url = await compressImage(picked);
        await chrome.storage.local.set({ [BG_IMAGE_KEY]: url });
        dispatchEvent(new CustomEvent('xm:bg-image'));
        render();
      };
      f.box.append(btn, file);
    }

    // —— 字体 ——
    card = section('字体');
    {
      const f = field(card, '字体族');
      seg<'x' | 'sans' | 'serif' | 'custom'>(
        f.box,
        [['x', 'X 默认'], ['sans', '无衬线'], ['serif', '衬线'], ['custom', '自定义']],
        s.font.choice,
        (v) => { void opts.update({ font: { ...s.font, choice: v } }).then(render); },
      );
      if (s.font.choice === 'custom') {
        const inp = el('input', 'xm-in');
        inp.type = 'text';
        inp.placeholder = '本机已装的字体名，如 微软雅黑';
        inp.value = s.font.custom;
        let t = 0;
        inp.oninput = () => {
          clearTimeout(t);
          t = window.setTimeout(() => { void opts.update({ font: { ...s.font, custom: cleanFont(inp.value) } }); }, 350);
        };
        f.box.append(inp);
      }
    }
    const ver = chrome.runtime?.getManifest?.().version ?? '';
    const ft = el('div', 'xm-ft');
    ft.innerHTML = '全部改动即时生效，关掉即还原。<b>'
      + `v${ver}` + '</b>';
    body.append(ft);

    if (keepScroll) body.scrollTop = keepScroll;
  }

  function toggle(force?: boolean): void {
    const open = force ?? panel.dataset.open !== '1';
    panel.dataset.open = open ? '1' : '0';
    fab.dataset.open = open ? '1' : '0';
    fab.setAttribute('aria-expanded', String(open));
    if (open) {
      place(root.dataset.rail === '1');
      render();
    }
  }

  fab.onclick = (e) => { e.stopPropagation(); toggle(); };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.dataset.open === '1') toggle(false);
  });
  // capture 阶段判「点在面板里」：面板每次设置都会整体重绘，冒泡阶段拿到的 target 可能已被移除
  document.addEventListener('click', (e) => {
    if (panel.dataset.open !== '1') return;
    const t = e.target as Node | null;
    if (!t || !t.isConnected) return;
    if (panel.contains(t) || fab.contains(t)) return;
    toggle(false);
  }, true);

  /**
   * 图标栏开着时齿轮钉在窗口左下角（与图标列同一条竖线），否则退回右下角浮动球。
   * 位置完全由 CSS 的 fixed 决定，不借 X 的任何容器 —— 借了就会在 X 重渲染时一起消失。
   */
  function place(railOn: boolean): void {
    fab.dataset.rail = railOn ? '1' : '0';
    root.dataset.rail = railOn ? '1' : '0';
    // 始终留在自己的 root 里：X 重渲染 header / nav 不会把它清掉
    if (fab.parentElement !== root) root.append(fab);
  }

  place(document.documentElement.classList.contains('xm-rail'));
  render();
  return { root, place };
}
