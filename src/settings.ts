export type ThemeSetting = 'system' | 'light' | 'dark';
export type ColumnKey = 'kind' | 'name' | 'type' | 'status' | 'size' | 'time' | 'url';

export const ALL_COLUMNS: ColumnKey[] = ['kind', 'name', 'type', 'status', 'size', 'time', 'url'];
// `type` is hidden by default — the Kind column's colored badge already conveys the
// operation type (query/mutation/subscription) and HTTP method. It stays toggleable
// via the Columns dropdown.
export const DEFAULT_COLUMNS: ColumnKey[] = ['kind', 'name', 'status', 'size', 'time', 'url'];

const KEY_THEME = 'querio-plus:theme';
const KEY_COLUMNS = 'querio-plus:columns';
const KEY_COLUMN_WIDTHS = 'querio-plus:column-widths';
const KEY_SPLIT = 'querio-plus:split-ratio';

/** Default pixel width per column (used until the user drags a column border). */
export const DEFAULT_COLUMN_WIDTHS: Record<ColumnKey, number> = {
  kind: 72,
  name: 260,
  type: 90,
  status: 70,
  size: 80,
  time: 70,
  url: 320,
};

export const MIN_COLUMN_WIDTH = 48;

// Module-level mirror of preserve-log so the (non-React) capture listener can read it
// synchronously. The toolbar toggle updates it via setPreserveLog.
let preserveLog = false;
export function getPreserveLog(): boolean {
  return preserveLog;
}
export function setPreserveLog(value: boolean): void {
  preserveLog = value;
}

function hasStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;
}

export async function loadTheme(): Promise<ThemeSetting> {
  if (!hasStorage()) return 'system';
  return new Promise((resolve) => {
    chrome.storage.local.get(KEY_THEME, (res) => {
      const v = res[KEY_THEME] as ThemeSetting | undefined;
      resolve(v ?? 'system');
    });
  });
}

export function saveTheme(value: ThemeSetting): void {
  if (hasStorage()) chrome.storage.local.set({ [KEY_THEME]: value });
}

export async function loadColumns(): Promise<ColumnKey[]> {
  if (!hasStorage()) return [...DEFAULT_COLUMNS];
  return new Promise((resolve) => {
    chrome.storage.local.get(KEY_COLUMNS, (res) => {
      const v = res[KEY_COLUMNS] as ColumnKey[] | undefined;
      if (!Array.isArray(v) || v.length === 0) {
        resolve([...DEFAULT_COLUMNS]);
        return;
      }
      // Migrate sessions saved before a column existed: keep the user's order and
      // selection, but surface any newly-added default columns they've never seen.
      const known = new Set(ALL_COLUMNS);
      const cleaned = v.filter((c) => known.has(c));
      const result = [...cleaned];
      DEFAULT_COLUMNS.forEach((col, i) => {
        if (result.includes(col)) return;
        // Slot the new column after the nearest preceding default column the user has.
        let at = 0;
        for (let j = i - 1; j >= 0; j--) {
          const pos = result.indexOf(DEFAULT_COLUMNS[j]);
          if (pos !== -1) {
            at = pos + 1;
            break;
          }
        }
        result.splice(at, 0, col);
      });
      resolve(result);
    });
  });
}

export function saveColumns(value: ColumnKey[]): void {
  if (hasStorage()) chrome.storage.local.set({ [KEY_COLUMNS]: value });
}

export async function loadColumnWidths(): Promise<Record<ColumnKey, number>> {
  if (!hasStorage()) return { ...DEFAULT_COLUMN_WIDTHS };
  return new Promise((resolve) => {
    chrome.storage.local.get(KEY_COLUMN_WIDTHS, (res) => {
      const v = res[KEY_COLUMN_WIDTHS] as Partial<Record<ColumnKey, number>> | undefined;
      resolve({ ...DEFAULT_COLUMN_WIDTHS, ...(v ?? {}) });
    });
  });
}

export function saveColumnWidths(value: Record<ColumnKey, number>): void {
  if (hasStorage()) chrome.storage.local.set({ [KEY_COLUMN_WIDTHS]: value });
}

export async function loadSplitRatio(): Promise<number> {
  if (!hasStorage()) return 0.46;
  return new Promise((resolve) => {
    chrome.storage.local.get(KEY_SPLIT, (res) => {
      const v = res[KEY_SPLIT] as number | undefined;
      resolve(typeof v === 'number' && v > 0.15 && v < 0.85 ? v : 0.46);
    });
  });
}

export function saveSplitRatio(value: number): void {
  if (hasStorage()) chrome.storage.local.set({ [KEY_SPLIT]: value });
}

/** Resolve the effective theme: 'system' maps to the panel's own themeName fallback. */
export function resolveSystemTheme(): 'light' | 'dark' {
  try {
    return typeof chrome !== 'undefined' &&
      chrome.devtools &&
      chrome.devtools.panels &&
      chrome.devtools.panels.themeName === 'dark'
      ? 'dark'
      : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(setting: ThemeSetting): void {
  const effective = setting === 'system' ? resolveSystemTheme() : setting;
  document.documentElement.setAttribute('data-theme', effective);
}
