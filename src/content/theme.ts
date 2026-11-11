/**
 * 主题切换：X 在 web 端把外观口径放在 `night_mode` cookie 里 ——
 *   0 = 白色（默认）、1 = 暗黑（#15202b 深蓝灰）、2 = 昏暗（纯黑）
 * 账号设置页改外观时写的就是这一个 cookie，客户端重新读取后整站换色。
 * 所以扩展这边只需要「写对值 + 刷新」，不必去覆盖 X 成千上万条内联颜色。
 *
 * 两处讲究：
 * 1. 同名 cookie 可能同时存在 host-only（x.com）和 domain（.x.com）两份，
 *    document.cookie 读到哪份不确定 ⇒ 写之前先把两份都删掉，只留一份。
 * 2. X 若在被账号设置反向覆盖，刷新后会回到原值，死循环。用 sessionStorage
 *    记「这个值已经试过」，同一个值只刷一次，宁可停在原样也不无限刷新。
 */

export type ThemeChoice = 'light' | 'dark' | 'auto';
export type Theme = 'light' | 'dark';

const NAME = 'night_mode';
/** 白色 = 0；纯黑（X 的「昏暗」）= 2 */
const VALUE: Record<Theme, string> = { light: '0', dark: '2' };
const TRIED = 'xm:theme-tried';

const systemDark = (): boolean => matchMedia('(prefers-color-scheme: dark)').matches;

/** 选择 + 系统偏好 → 目标 cookie 值 */
export function wantedValue(choice: ThemeChoice): string {
  const t: Theme = choice === 'auto' ? (systemDark() ? 'dark' : 'light') : choice;
  return VALUE[t];
}

/** 选择 → 我们自己的皮肤 / 面板该用的明暗（auto 交给实际渲染判断，避免 cookie 没生效时错配） */
export function resolveTheme(choice: ThemeChoice, actual: Theme): Theme {
  return choice === 'auto' ? actual : choice;
}

function read(): string | null {
  for (const part of document.cookie.split(';')) {
    const s = part.trim();
    if (s.startsWith(`${NAME}=`)) return s.slice(NAME.length + 1);
  }
  return null;
}

function hostDomain(): string {
  return location.hostname.endsWith('twitter.com') ? '.twitter.com' : '.x.com';
}

function clear(): void {
  const past = 'path=/; max-age=0';
  document.cookie = `${NAME}=; ${past}`;
  document.cookie = `${NAME}=; ${past}; domain=${hostDomain()}`;
}

function write(value: string): void {
  clear();
  // 与 X 自己一致写成 domain cookie：x.com / twitter.com 共用一份，避免两份同名打架
  document.cookie = `${NAME}=${value}; path=/; max-age=31536000; SameSite=Lax; domain=${hostDomain()}`;
}

function tried(): string[] {
  try {
    const raw = JSON.parse(sessionStorage.getItem(TRIED) || '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function markTried(value: string): void {
  try {
    sessionStorage.setItem(TRIED, JSON.stringify([...tried().filter((v) => v !== value), value].slice(-4)));
  } catch {
    /* 隐私模式禁用 sessionStorage 时忽略：最多多刷一次 */
  }
}

/**
 * 让 X 的外观对齐到选择。返回 true 表示 cookie 已改正、需要刷新页面才生效。
 * 同一个目标值只尝试一次 —— 刷完仍对不上，说明被账号设置锁住了，不再反复刷。
 */
export function enforceTheme(choice: ThemeChoice): boolean {
  const want = wantedValue(choice);
  if (read() === want) return false;
  // 已经刷过一轮又被顶回来：被账号外观设置锁住了。这时不要再写 cookie，
  // 否则 cookie=目标值、画面=X 自己的值，两边不一致，下次启动还会再刷一次。
  if (tried().includes(want)) return false;
  write(want);
  markTried(want);
  return true;
}

/**
 * 面板里切主题：无条件写 cookie + 整页刷新。
 *
 * ⛔ 不要做「cookie 已经是目标值就跳过刷新」的优化。X 的配色是启动时读 cookie 渲出来的，
 * 运行中只改 cookie 不会让 React 重新读一遍 —— 结果就是面板换了、站点一半新一半旧，
 * 半透明皮肤 / 图标栏 / 字体的取色也跟着错配。整页重载一次最省事也最稳。
 */
export function applyTheme(choice: ThemeChoice): void {
  const want = wantedValue(choice);
  write(want);
  markTried(want);
  reloadForTheme();
}

/** 整页重载（不是 SPA 局部替换）。留一点时间让点击后的选中态画出来 */
export function reloadForTheme(): void {
  setTimeout(() => {
    location.reload();
  }, 150);
}

/** cookie 是否被 X 顶回原值（用于面板里那句提示） */
export function themeStuck(choice: ThemeChoice): boolean {
  return choice !== 'auto' && read() !== wantedValue(choice);
}

export function onSystemThemeChange(fn: () => void): void {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', fn);
}
