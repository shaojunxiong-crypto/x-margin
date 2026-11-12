/* 生成扩展图标：黑底 + X 字标，输出 16 / 32 / 48 / 128 四档 PNG 到 public/icons/。
   字标用 X 官方 logo 的轮廓（1200×1227 viewBox），纯矢量渲染，不依赖位图放大。
   用法：node scripts/make-icons.mjs */
import { chromium } from 'file:///C:/Users/shaoj/WorkBuddy/bilibili-margin/node_modules/playwright/index.mjs';
import path from 'node:path';
import fs from 'node:fs';

const OUT = path.resolve('public/icons');
const QUARK = 'C:/Users/shaoj/AppData/Local/Programs/Quark/quark.exe';
const PATH = 'M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1227H105.866'
  + 'L515.491 750.218L842.672 1227H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944'
  + 'H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.828Z';

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: QUARK, headless: true });
for (const size of [16, 32, 48, 128]) {
  // 小尺寸给字标更大的占比、笔画也略加粗（同色描边），否则 16px 下糊成一团灰
  const w = size === 16 ? 0.76 : size === 32 ? 0.72 : 0.6;
  const stroke = size === 16 ? 70 : size === 32 ? 50 : 30;
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:${size}px;height:${size}px;background:#000}
    svg{display:block}
  </style></head><body>
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <rect width="${size}" height="${size}" fill="#000"/>
      <g transform="translate(${(size - size * w) / 2} ${(size - size * w * 1227 / 1200) / 2}) scale(${(size * w) / 1200})">
        <path d="${PATH}" fill="#fff" stroke="#fff" stroke-width="${stroke}" stroke-linejoin="round"/>
      </g>
    </svg>
  </body></html>`);
  await page.screenshot({ path: path.join(OUT, `icon-${size}.png`) });
  await page.close();
  console.log(`icon-${size}.png`);
}
await browser.close();
