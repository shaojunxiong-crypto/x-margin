/**
 * 打包进扩展的字体子集（GB2312 6763 字 + 常用标点/符号）：
 * - Geist / Geist Mono（Vercel，OFL）：西文与数字
 * - Margin Sans SC：思源黑体 Noto Sans SC 可变字重 400–700 子集（OFL）
 * - Instrument Serif（OFL）：标题里的西文与数字；size-adjust 让它与中文宋体等高
 * - Margin Serif SC：霞鹜新致宋 LXGW Neo ZhiSong 子集（IPA 1.0）
 * 两款中文字体各分 34 片（scripts/slice-fonts.py → fonts/sc/ + fonts/margin-sc.css），
 * 浏览器只下载用到的切片；切片表走 <link>，不占入口脚本体积。
 * Chrome 不认 shadow root 里的 @font-face，所以注册在 document 上。
 */
export function injectFonts(): void {
  if (document.getElementById('margin-fonts')) return;
  const u = (f: string) => chrome.runtime.getURL(`fonts/${f}`);
  const face = (family: string, file: string, weight: string, style = 'normal', extra = '') =>
    `@font-face{font-family:"${family}";src:url("${u(file)}") format("woff2");font-weight:${weight};font-style:${style};font-display:swap${extra}}`;
  const s = document.createElement('style');
  s.id = 'margin-fonts';
  s.textContent = [
    face('Geist', 'Geist.woff2', '100 900'),
    face('Geist Mono', 'GeistMono.woff2', '100 900'),
    // 只覆盖拉丁字符，中文自动落到 Margin Serif SC
    face('Instrument Serif', 'InstrumentSerif.woff2', '400', 'normal', ';size-adjust:112%;unicode-range:U+0020-002F,U+003A-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215'),
    face('Instrument Serif', 'InstrumentSerif-Italic.woff2', '400', 'italic', ';size-adjust:112%;unicode-range:U+0020-002F,U+003A-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215'),
  ].join('');
  const sc = document.createElement('link');
  sc.id = 'margin-fonts-sc';
  sc.rel = 'stylesheet';
  sc.href = u('margin-sc.css');
  (document.head ?? document.documentElement).append(s, sc);
}
