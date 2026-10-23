import type { HarEntry } from '../types';

/**
 * Collapse Chrome's DOUBLE delivery of a finished request without hiding a genuine
 * duplicate the page really sent twice.
 *
 * Observed on real traffic: `onRequestFinished` fires TWICE for each finished request —
 * two HAR entries that are identical except one carries `_connectionId` and the other
 * does not, with `startedDateTime` differing by ~1 ms and `time` by <1 ms. There is no
 * `_requestId` to key on. So we treat two entries as the SAME delivery when they share
 * method + url + request-body-length + response status AND their `startedDateTime` are
 * within a small window (DUP_WINDOW_MS). A request the page genuinely repeats arrives
 * with a `startedDateTime` separated by real time (far more than the window), so it is
 * KEPT as a separate row.
 *
 * Tradeoff (accepted): if a page fired the byte-identical request twice within the window
 * we would merge them. That is rare and strictly preferable to showing every request
 * doubled. The window is small enough that normal repeats (user clicks, retries) differ
 * by far more.
 */
const DUP_WINDOW_MS = 150;

interface SeenRecord {
  started: number; // startedDateTime as epoch ms
}

// identity (method|url|bodyLen|status) -> recent start timestamps
const seen = new Map<string, SeenRecord[]>();
const SEEN_CAP = 20000;
// Records older than this (relative to the newest start for a key) can never match again.
const RECORD_TTL_MS = 60_000;

function identityOf(entry: HarEntry): string {
  const method = entry.request?.method ?? '';
  const url = entry.request?.url ?? '';
  const bodyLen = entry.request?.postData?.text?.length ?? 0;
  const status = entry.response?.status ?? 0;
  return `${method}|${url}|${bodyLen}|${status}`;
}

function startedMs(entry: HarEntry): number {
  const t = entry.startedDateTime ? Date.parse(entry.startedDateTime) : NaN;
  return Number.isFinite(t) ? t : NaN;
}

/**
 * Returns true the FIRST time a request is seen (process it); false when it is a
 * re-delivery of a request already seen within DUP_WINDOW_MS (drop it). A genuine
 * repeat (distinct start time outside the window) returns true and is kept.
 */
export function markSeen(entry: HarEntry): boolean {
  const key = identityOf(entry);
  const started = startedMs(entry);

  // If we can't read a timestamp, don't dedup — showing a real request beats hiding one.
  if (Number.isNaN(started)) return true;

  const records = seen.get(key);
  if (records) {
    for (const r of records) {
      if (Math.abs(r.started - started) <= DUP_WINDOW_MS) {
        return false; // same request re-delivered within the window -> drop
      }
    }
    // Evict stale records so a repeating request does not grow the list without bound.
    const live = records.filter((r) => started - r.started <= RECORD_TTL_MS);
    live.push({ started });
    seen.set(key, live);
  } else {
    if (seen.size >= SEEN_CAP) seen.clear();
    seen.set(key, [{ started }]);
  }
  return true;
}

/** Reset the guard — called when the user clears the list or the page navigates. */
export function resetSeenEntries(): void {
  seen.clear();
}
