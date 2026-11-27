import { build } from 'vite';
import { wgslVitePlugin } from '@vgpu/wgsl/loader-vite';
import { cp, rm, mkdir, readFile } from 'node:fs/promises';

// 版本号双写（package.json 与 public/manifest.json）：两边不一致时直接失败。
// ⛔ 以前没人管，装上去的扩展版本和面板页脚显示的版本迟早会对不上，
//    排查时先怀疑「是不是没重新 build」就白绕一圈。
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const man = JSON.parse(await readFile('public/manifest.json', 'utf8'));
if (pkg.version !== man.version) {
  console.error(`✗ 版本号不一致：package.json ${pkg.version} / manifest.json ${man.version}`);
  process.exit(1);
}

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });

// 内容脚本：单文件 IIFE，不拆 chunk（MV3 内容脚本里 import 相对路径很麻烦）
await build({
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  plugins: [wgslVitePlugin({ minify: { whitespace: true } })],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome110',
    minify: !process.env.NOMIN,
    lib: { entry: 'src/content/main.ts', name: 'xm_content', formats: ['iife'], fileName: () => 'content.js' },
  },
});

// 主世界脚本：视频自动播放拦截。content script 在隔离世界，改原型无效，
// 必须由后台用 chrome.scripting 注入到 X 自己的上下文里。
await build({
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome110',
    minify: !process.env.NOMIN,
    lib: { entry: 'src/mainworld/autoplay.ts', name: 'xm_autoplay', formats: ['iife'], fileName: () => 'autoplay-main.js' },
  },
});

// 流光（WebGPU / vgpu，约 200KB）单独打包：只有选中这款背景时才动态 import
await build({
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  plugins: [wgslVitePlugin({ minify: { whitespace: true } })],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome113',
    minify: !process.env.NOMIN,
    lib: { entry: 'src/content/bg/flux/index.ts', formats: ['es'], fileName: () => 'flux.js' },
  },
});

// 后台：只负责 captureVisibleTab（内容脚本拿不到这个 API），单文件 IIFE
await build({
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome110',
    minify: !process.env.NOMIN,
    lib: { entry: 'src/background/index.ts', name: 'xm_bg', formats: ['iife'], fileName: () => 'background.js' },
  },
});

await cp('public', 'dist', { recursive: true });
console.log('built → dist/');
