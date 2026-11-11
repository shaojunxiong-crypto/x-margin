import type { Background, ShaderId } from '../../shared/settings';
import { BG_IMAGE_KEY } from '../../shared/settings';
import { PALETTES } from './shaders';
import type { FluxField } from './flux';
import { setupQuad, ShaderProgram } from './program';
import { SHADER_IDS } from './shaders';

const LAST_KEY = 'xm:last-shader';

/**
 * 背景层：固定全屏铺在 X 的内容之下。
 * WebGL 着色器（半分辨率、跟随刷新率、持续掉帧降到 30fps、隐藏时暂停）或自定义图片。
 * 与 B 站版的差别：没有液态玻璃透镜、没有汇流叠层、没有开场动画——那些都依赖站点自己的 DOM 结构。
 */
export class BackgroundLayer {
  readonly el = document.createElement('div');
  private canvas = document.createElement('canvas');
  private img = document.createElement('div');
  private scrim = document.createElement('div');
  private gl: WebGLRenderingContext | null = null;
  private prog: ShaderProgram | null = null;
  private raf = 0;
  private last = 0;
  private start = performance.now();
  private current: ShaderId | null = null;
  private theme: 'light' | 'dark' = 'dark';
  private cfg: Background | null = null;

  constructor() {
    this.el.className = 'xm-bg';
    this.el.setAttribute('aria-hidden', 'true');
    this.img.className = 'xm-bg-img';
    this.scrim.className = 'xm-bg-scrim';
    this.el.append(this.canvas, this.img, this.scrim);
    document.addEventListener('visibilitychange', () => (document.hidden ? this.stop() : this.loop()));
    new ResizeObserver(() => this.resize()).observe(this.el);
  }

  /** 昼夜切换的调色板插值 */
  private fadeMs = 900;
  private kFrom = 0; private kTo = 0; private kT0 = 0;
  private kNow(now: number): number {
    if (!this.kT0) return this.kTo;
    const x = Math.min(1, (now - this.kT0) / this.fadeMs);
    if (x >= 1) { this.kT0 = 0; return this.kTo; }
    const e = x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    return this.kFrom + (this.kTo - this.kFrom) * e;
  }

  async apply(cfg: Background, theme: 'light' | 'dark'): Promise<void> {
    const first = !this.cfg;
    const prevMode = this.cfg?.mode;
    this.cfg = cfg;
    const target = theme === 'dark' ? 1 : 0;
    if (!first && theme !== this.theme) { this.kFrom = this.kNow(performance.now()); this.kTo = target; this.kT0 = performance.now(); }
    else { this.kFrom = this.kTo = target; this.kT0 = 0; }
    this.theme = theme;
    this.el.dataset.mode = cfg.mode;
    this.el.style.setProperty('--xm-bg-o', String(cfg.intensity));
    if (cfg.mode === 'off') { this.stop(); return; }
    if (cfg.mode === 'image') {
      this.stop();
      const r = await chrome.storage.local.get(BG_IMAGE_KEY);
      const url = r[BG_IMAGE_KEY] as string | undefined;
      this.img.style.backgroundImage = url ? `url("${url}")` : '';
      if (!url) this.el.dataset.mode = 'off';
      return;
    }
    let id: ShaderId = cfg.shader;
    if (cfg.mode === 'random') {
      if (first || prevMode !== 'random' || !this.current) {
        const prev = localStorage.getItem(LAST_KEY);
        const allowed = cfg.pool?.length ? SHADER_IDS.filter((s) => cfg.pool!.includes(s)) : SHADER_IDS;
        const pool = allowed.length > 1 ? allowed.filter((s) => s !== prev) : allowed;
        id = pool[Math.floor(Math.random() * pool.length)] ?? cfg.shader;
        localStorage.setItem(LAST_KEY, id);
      } else id = this.current;
    }
    this.use(id);
    this.draw(performance.now());
    this.loop();
  }

  /** 换背景图但设置没变（mode 本来就是 image）时，重新读一次存储 */
  reloadImage(): void {
    if (this.cfg?.mode !== 'image') return;
    void chrome.storage.local.get(BG_IMAGE_KEY).then((r) => {
      const url = r[BG_IMAGE_KEY] as string | undefined;
      this.img.style.backgroundImage = url ? `url("${url}")` : '';
      if (!url) this.el.dataset.mode = 'off';
    });
  }

  destroy(): void { this.stop(); this.flux?.dispose(); this.flux = null; this.el.remove(); }

  /** 没有显卡加速（SwiftShader / llvmpipe）时：只画静止一帧，不做动画 */
  private soft = false;

  private use(id: ShaderId): void {
    if (!this.gl) {
      this.gl = this.canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' });
      if (!this.gl) { this.el.dataset.mode = 'off'; return; }
      setupQuad(this.gl);
      this.soft = isSoftwareGl(this.gl);
      if (this.soft) this.el.dataset.soft = '';
    }
    if (id === this.current && this.prog) return;
    if (this.prog) this.gl.deleteProgram(this.prog.prog);
    if (this.flux && id !== 'flux') { this.flux.dispose(); this.flux = null; if (this.fluxTex) { this.gl.deleteTexture(this.fluxTex); this.fluxTex = null; } }
    this.prog = new ShaderProgram(this.gl, id);
    this.prog.bind();
    this.current = id;
    this.el.dataset.shader = id;
    this.resize();
  }

  private resize(): void {
    const w = this.el.clientWidth || innerWidth, h = this.el.clientHeight || innerHeight;
    // 背景本身很柔和：缓冲区最宽 640px，再由 CSS 放大，肉眼无差，GPU 负担小很多
    const scale = Math.min(0.5, 640 / Math.max(1, w));
    const W = Math.max(1, Math.round(w * scale)), H = Math.max(1, Math.round(h * scale));
    if (this.canvas.width !== W) this.canvas.width = W;
    if (this.canvas.height !== H) this.canvas.height = H;
    this.gl?.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.draw(performance.now());
  }

  private draw(now: number): void {
    if (!this.gl || !this.prog || !this.cfg || this.cfg.mode === 'off' || this.cfg.mode === 'image') return;
    const w = this.canvas.width, h = this.canvas.height;
    const t = (now - this.start) / 1000;
    const k = this.kNow(now);
    if (this.current === 'flux') this.stepFlux(w, h, t, k);
    this.prog.bind();
    this.prog.draw(w, h, t, k);
  }

  private flux: FluxField | null = null;
  private fluxLoading = false;
  private fluxFailed = false;
  private fluxTex: WebGLTexture | null = null;
  /** 流光款：先让 WebGPU 推进一帧，再把结果上传成纹理交给 GL 程序 */
  private stepFlux(w: number, h: number, t: number, k: number): void {
    const gl = this.gl!, prog = this.prog!;
    if (!this.flux) {
      if (this.soft || this.fluxLoading || this.fluxFailed || !('gpu' in navigator)) return;
      this.fluxLoading = true;
      import(/* @vite-ignore */ chrome.runtime.getURL('flux.js'))
        .then(async (mod: { FluxField: new () => FluxField }) => {
          const f = new mod.FluxField();
          const ok = await f.start();
          if (!ok) this.fluxFailed = true;
          if (!ok || this.current !== 'flux') { f.dispose(); return; }
          this.flux = f;
          this.draw(performance.now());
        })
        .catch((e) => { this.fluxFailed = true; console.info('[X-MARGIN] 流光加载失败，使用 WebGL 版', e); })
        .finally(() => { this.fluxLoading = false; });
      return;
    }
    const L = PALETTES.light.flux!, D = PALETTES.dark.flux!;
    const m = (a: readonly number[], b: readonly number[]) => a.map((v, i) => v + (b[i] - v) * k) as unknown as [number, number, number];
    const ok = this.flux.render(w, h, t, { bg: m(L.bg, D.bg), c1: m(L.c[0], D.c[0]), c2: m(L.c[1], D.c[1]), c3: m(L.c[2], D.c[2]) }, k);
    if (!ok) { prog.tex = null; if (!this.flux.ready) { this.flux.dispose(); this.flux = null; this.fluxFailed = true; } return; }
    if (!this.fluxTex) {
      this.fluxTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.fluxTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fluxTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, this.flux.canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    prog.tex = this.fluxTex;
  }

  /** 正常时每个 rAF 都画；持续超预算就把帧率降到 30fps，恢复平稳后再放回去 */
  private frameMs = 0;
  private nextFrame = 0;
  private slow = 0;
  private fastRun = 0;
  private rafTime = 0;
  private refreshMs = 1000 / 60;

  private loop = (): void => {
    if (this.soft || document.hidden) return;
    if (this.raf || !this.cfg || (this.cfg.mode !== 'random' && this.cfg.mode !== 'fixed')) return;
    const tick = (now: number) => {
      this.raf = 0;
      const rafGap = this.rafTime ? now - this.rafTime : 0;
      this.rafTime = now;
      if (rafGap > 1 && rafGap < this.refreshMs) this.refreshMs = rafGap;
      if (now + 0.1 >= this.nextFrame) {
        const gap = this.last ? now - this.last : 0;
        this.last = now;
        const t0 = performance.now();
        this.draw(now);
        const cost = performance.now() - t0;
        const budget = Math.min(6, this.refreshMs * 0.6);
        const expected = Math.max(this.refreshMs, this.frameMs);
        if (cost > budget || (gap > 0 && gap < 200 && gap > expected * 1.8)) this.slow = Math.min(31, this.slow + 1);
        else this.slow = Math.max(0, this.slow - 0.25);
        if (this.slow > 30 && this.frameMs < 30) { this.frameMs = 1000 / 30; this.slow = 0; }
        else if (this.frameMs > 30 && this.slow === 0 && gap > 0 && gap <= expected + this.refreshMs + 0.1) { this.fastRun++; if (this.fastRun > 600) { this.frameMs = 0; this.fastRun = 0; } }
        else this.fastRun = 0;
        if (this.frameMs) {
          if (!this.nextFrame || now - this.nextFrame > this.frameMs * 2) this.nextFrame = now;
          this.nextFrame += this.frameMs;
        } else this.nextFrame = 0;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  };

  private stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.nextFrame = 0;
    this.last = this.rafTime = 0;
    this.refreshMs = 1000 / 60;
    this.fastRun = 0;
  }
}

/** 压缩上传的图片为 JPEG dataURL（最长边 2400px） */
export async function compressImage(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

function isSoftwareGl(gl: WebGLRenderingContext): boolean {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const r = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(r);
}
