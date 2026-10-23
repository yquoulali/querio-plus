import { describe, it, expect, beforeEach, vi } from 'vitest';
import { add, clear, getSnapshot, patch, queuePatch, replaceAll, subscribe, MAX_ENTRIES } from '../src/capture/store';
import type { CapturedEntry } from '../src/types';

function mk(id: string): CapturedEntry {
  return {
    id,
    kind: 'http',
    method: 'GET',
    url: `https://api/${id}`,
    name: `/${id}`,
    requestHeaders: [],
    status: 200,
    time: 1,
    size: undefined,
    errorState: 'ok',
    getResponseBody: () => Promise.resolve(undefined),
  };
}

describe('capture store', () => {
  beforeEach(() => clear());

  it('adds and snapshots entries by reference change', () => {
    const before = getSnapshot();
    add(mk('a'), mk('b'));
    const after = getSnapshot();
    expect(after).not.toBe(before);
    expect(after.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('patches an entry by id and emits a new reference', () => {
    add(mk('a'));
    const before = getSnapshot();
    patch('a', { errorState: 'error', errorCount: 2 });
    const after = getSnapshot();
    expect(after).not.toBe(before);
    expect(after[0].errorState).toBe('error');
    expect(after[0].errorCount).toBe(2);
  });

  it('is a no-op patch for an unknown id', () => {
    add(mk('a'));
    const before = getSnapshot();
    patch('missing', { errorState: 'error' });
    expect(getSnapshot()).toBe(before);
  });

  it('caps retained entries at MAX_ENTRIES (drops oldest)', () => {
    const batch = Array.from({ length: MAX_ENTRIES + 10 }, (_, i) => mk(`e${i}`));
    add(...batch);
    const snap = getSnapshot();
    expect(snap).toHaveLength(MAX_ENTRIES);
    // oldest dropped: first retained is e10, last is e(MAX_ENTRIES+9)
    expect(snap[0].id).toBe('e10');
    expect(snap[snap.length - 1].id).toBe(`e${MAX_ENTRIES + 9}`);
  });

  it('caps replaceAll (import) at MAX_ENTRIES (keeps newest)', () => {
    replaceAll(Array.from({ length: MAX_ENTRIES + 10 }, (_, i) => mk(`i${i}`)));
    expect(getSnapshot()).toHaveLength(MAX_ENTRIES);
    expect(getSnapshot()[0].id).toBe('i10');
    expect(getSnapshot()[MAX_ENTRIES - 1].id).toBe(`i${MAX_ENTRIES + 9}`);
  });

  it('queuePatch coalesces several patches into a single emit', () => {
    vi.useFakeTimers();
    try {
      clear();
      add(mk('q1'), mk('q2'));
      let emits = 0;
      const unsub = subscribe(() => emits++);
      queuePatch('q1', { errorState: 'error' });
      queuePatch('q2', { errorCount: 3 });
      queuePatch('q1', { errorCount: 1 });
      expect(emits).toBe(0);
      vi.advanceTimersByTime(100);
      unsub();
      expect(emits).toBe(1);
      const snap = getSnapshot();
      expect(snap[0]).toMatchObject({ errorState: 'error', errorCount: 1 });
      expect(snap[1].errorCount).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
