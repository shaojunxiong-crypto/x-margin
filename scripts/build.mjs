import { build } from 'vite';
import { wgslVitePlugin } from '@vgpu/wgsl/loader-vite';
import { cp, rm, mkdir } from 'node:fs/promises';

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
