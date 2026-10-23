import type { CapturedEntry } from '../types';

type Listener = () => void;

/**
 * Module-level capture store exposed for React's useSyncExternalStore. A snapshot is
 * an immutable array reference that changes whenever entries are added, patched, or
 * cleared — so size/errorState backfills (F2: transitions re-emit from the store, the
 * same mechanism as size) trigger a re-render.
 */
let entries: ReadonlyArray<CapturedEntry> = [];
const listeners = new Set<Listener>();

/**
 * Cap retained entries so a long-running session on a chatty page cannot grow panel
 * memory without bound (each entry may inline a fetched response body). When the cap
 * is exceeded the oldest entries are dropped (ring-buffer semantics), matching the
 * built-in Network panel's bounded log. Generous enough to keep a normal session whole.
 */
export const MAX_ENTRIES = 5000;

const pendingPatches = new Map<string, Partial<CapturedEntry>>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;
const FLUSH_MS = 50;

function emit(): void {
  for (const l of listeners) l();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): ReadonlyArray<CapturedEntry> {
  return entries;
}

export function add(...toAdd: CapturedEntry[]): void {
  if (toAdd.length === 0) return;
  const next = [...entries, ...toAdd];
  // Ring-buffer: drop oldest entries beyond the cap.
  entries = next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
  emit();
}

export function clear(): void {
  pendingPatches.clear();
  if (entries.length === 0) return;
  entries = [];
  emit();
}

export function replaceAll(next: CapturedEntry[]): void {
  // Same ring-buffer policy as add(): keep the newest entries.
  entries = next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
  pendingPatches.clear();
  emit();
}

/**
 * Patch one entry by id (F2: errorState/size transitions re-emit from the store). The
 * entry object is replaced so React sees a new reference.
 */
export function patch(id: string, update: Partial<CapturedEntry>): void {
  applyPatches(new Map([[id, update]]));
}

function applyPatches(updates: ReadonlyMap<string, Partial<CapturedEntry>>): void {
  if (updates.size === 0) return;
  let changed = false;
  const next = entries.map((e) => {
    const update = updates.get(e.id);
    if (!update) return e;
    changed = true;
    return { ...e, ...update };
  });
  if (!changed) return;
  entries = next;
  emit();
}

/**
 * Coalesced patch: queues the update and applies every queued update in ONE pass /
 * ONE emit after a short delay, so a burst of resolving bodies costs one re-filter
 * instead of one per request. Use for background backfills; use patch() when the
 * caller needs the change applied synchronously.
 */
export function queuePatch(id: string, update: Partial<CapturedEntry>): void {
  pendingPatches.set(id, { ...pendingPatches.get(id), ...update });
  if (flushTimer !== undefined) return;
  flushTimer = setTimeout(flushPatches, FLUSH_MS);
}

export function flushPatches(): void {
  if (flushTimer !== undefined) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  if (pendingPatches.size === 0) return;
  const updates = new Map(pendingPatches);
  pendingPatches.clear();
  applyPatches(updates);
}
