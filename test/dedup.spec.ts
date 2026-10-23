import { describe, it, expect, beforeEach } from 'vitest';
import { markSeen, resetSeenEntries } from '../src/capture/dedup';
import type { HarEntry } from '../src/types';

function har(over: { started?: string; time?: number; url?: string; body?: string } = {}): HarEntry {
  return {
    _resourceType: 'fetch',
    time: over.time ?? 100,
    startedDateTime: over.started ?? '2026-10-23T12:00:00.000Z',
    request: {
      method: 'POST',
      url: over.url ?? 'https://api/graphql',
      headers: [{ name: 'content-type', value: 'application/json' }],
      postData: {
        mimeType: 'application/json',
        text: over.body ?? '{"query":"mutation M { m }"}',
      },
    },
    response: { status: 200, headers: [], content: { size: 10, mimeType: 'application/json' } },
    getContent: () => Promise.resolve(['', '']),
  };
}

describe('capture dedup (time-windowed re-delivery collapse)', () => {
  beforeEach(() => resetSeenEntries());

  it('drops Chromes double delivery (same request, startedDateTime ~1ms apart)', () => {
    // The real observed case: two entries, startedDateTime differing by 1ms.
    expect(markSeen(har({ started: '2026-10-23T12:00:00.575Z' }))).toBe(true);
    expect(markSeen(har({ started: '2026-10-23T12:00:00.574Z' }))).toBe(false);
  });

  it('keeps a genuine repeat the page sent later (startedDateTime well outside the window)', () => {
    expect(markSeen(har({ started: '2026-10-23T12:00:00.000Z' }))).toBe(true);
    // ~1 second later = a real second request -> kept
    expect(markSeen(har({ started: '2026-10-23T12:00:01.000Z' }))).toBe(true);
  });

  it('keeps distinct requests (different url) even at the same instant', () => {
    expect(markSeen(har({ started: '2026-10-23T12:00:00.100Z', url: 'https://api/a' }))).toBe(true);
    expect(markSeen(har({ started: '2026-10-23T12:00:00.100Z', url: 'https://api/b' }))).toBe(true);
  });

  it('keeps requests with different bodies at the same instant', () => {
    expect(markSeen(har({ started: '2026-10-23T12:00:00.100Z', body: '{"query":"a"}' }))).toBe(
      true,
    );
    expect(markSeen(har({ started: '2026-10-23T12:00:00.100Z', body: '{"query":"bb"}' }))).toBe(
      true,
    );
  });

  it('never dedups when startedDateTime is unparseable (fail open)', () => {
    expect(markSeen(har({ started: 'not-a-date' }))).toBe(true);
    expect(markSeen(har({ started: 'not-a-date' }))).toBe(true);
  });

  it('re-captures after a reset (clear/navigate)', () => {
    expect(markSeen(har({ started: '2026-10-23T12:00:00.500Z' }))).toBe(true);
    expect(markSeen(har({ started: '2026-10-23T12:00:00.500Z' }))).toBe(false);
    resetSeenEntries();
    expect(markSeen(har({ started: '2026-10-23T12:00:00.500Z' }))).toBe(true);
  });
});
