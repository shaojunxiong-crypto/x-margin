/**
 * 后台只做一件事：替内容脚本截一帧「当前视口」。
 *
 * chrome.tabs.captureVisibleTab 只在扩展进程里存在（内容脚本拿不到），所以走消息转发。
 * 它要求 manifest 里声明 <all_urls> 或 activeTab；我们的按钮在页面里，拿不到 activeTab，
 * 因此声明的是 <all_urls>。这里不注入任何脚本、不读页面内容，只回一张 PNG。
 */

interface ShotReply {
  ok: boolean;
  url?: string;
  err?: string;
}

chrome.runtime.onMessage.addListener(
  (msg: unknown, sender, reply: (r: ShotReply) => void): boolean | void => {
    const m = msg as { type?: string } | null;
    if (!m || m.type !== 'xm:shot') return;
    const onShot = (url?: string): void => {
      const err = chrome.runtime.lastError?.message;
      if (err || !url) reply({ ok: false, err: err || 'capture returned nothing' });
      else reply({ ok: true, url });
    };
    const win = sender.tab?.windowId;
    if (typeof win === 'number') chrome.tabs.captureVisibleTab(win, { format: 'png' }, onShot);
    else chrome.tabs.captureVisibleTab({ format: 'png' }, onShot);
    // 保持消息通道开着，等异步回调回来
    return true;
  },
);
