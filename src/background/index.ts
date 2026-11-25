/**
 * 后台只做一件事：替内容脚本截一帧「当前视口」。
 *
 * chrome.tabs.captureVisibleTab 只在扩展进程里存在（内容脚本拿不到），所以走消息转发。
 * 它要求 manifest 里声明 <all_urls> 或 activeTab；我们的按钮在页面里，拿不到 activeTab，
 * 因此声明的是 <all_urls>。这里不注入任何脚本、不读页面内容，只回一张 PNG。
 *
 * ⛔ 两个「空闲后第一次必失败」的坑（v0.1.94）：
 *   ① MV3 的 service worker 空闲约 30s 就被终止。内容脚本此刻 sendMessage 会拿到
 *      `Receiving end does not exist` / `message port closed`，而内容脚本原先只有一次调用窗口，
 *      表现就是「弹一句后台不可达，再点一次才好」。⇒ 新增 xm:ping：内容脚本每次取帧前先叫醒，
 *      SW 活着时同步回执（往返 <1ms），已终止时这条消息本身即触发唤醒。
 *   ② 刚唤醒的 SW 里 captureVisibleTab 偶尔瞬时报错（合成器/标签页状态还没就绪）。
 *      ⇒ 这里就地重试一次，间隔 160ms。注意 Chrome 对该 API 有每秒 2 次的频率上限，
 *      所以只允许一次重试、间隔不能太短。
 */

interface ShotReply {
  ok: boolean;
  url?: string;
  err?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 单次取帧。错误一律 reject，交给上面统一重试。 */
function capture(win: number | undefined): Promise<string> {
  return new Promise((resolve, reject) => {
    const cb = (url?: string): void => {
      const err = chrome.runtime.lastError?.message;
      if (err || !url) reject(new Error(err || 'capture returned nothing'));
      else resolve(url);
    };
    if (typeof win === 'number') chrome.tabs.captureVisibleTab(win, { format: 'png' }, cb);
    else chrome.tabs.captureVisibleTab({ format: 'png' }, cb);
  });
}

chrome.runtime.onMessage.addListener(
  (msg: unknown, sender, reply: (r: ShotReply) => void): boolean | void => {
    const m = msg as { type?: string } | null;
    if (!m) return;
    // 心跳：唯一职责是把休眠的 SW 叫醒。同步回执，内容脚本那边几乎零成本。
    if (m.type === 'xm:ping') {
      reply({ ok: true });
      return;
    }
    /**
     * 视频自动播放拦截：真正改 `HTMLMediaElement.prototype.play` 的代码必须跑在**主世界**。
     * 内容脚本在隔离世界，它有独立的原型链，改那边对 X 自己的 React 毫无影响。
     * 用 scripting.executeScript 注入不受页面 CSP 约束；`files` 也不需要 web_accessible_resources。
     * 重复注入无害：脚本内部会判断已安装、只同步一次开关。
     */
    if (m.type === 'xm:autoplay') {
      const tabId = sender.tab?.id;
      if (typeof tabId === 'number') {
        chrome.scripting
          // ⛔ world 必须显式写 'MAIN'：漏了它默认注入到 ISOLATED，等于又改了一遍隔离世界的原型
          .executeScript({ target: { tabId }, world: 'MAIN', files: ['autoplay-main.js'] })
          .catch((e: unknown) => console.warn('[x-margin] 主世界注入失败', e));
      }
      reply({ ok: true });
      return;
    }
    if (m.type !== 'xm:shot') return;
    const win = sender.tab?.windowId;
    void (async () => {
      let last = '';
      for (let i = 0; i < 2; i++) {
        if (i) await sleep(160);
        try {
          reply({ ok: true, url: await capture(win) });
          return;
        } catch (e) {
          last = e instanceof Error ? e.message : String(e);
        }
      }
      reply({ ok: false, err: last || 'capture failed' });
    })();
    // 保持消息通道开着，等异步回调回来
    return true;
  },
);
