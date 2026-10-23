import { describe, it, expect } from 'vitest';
import { exportSession, importSession } from '../src/features/session';
import type { CapturedEntry } from '../src/types';

function entry(over: Partial<CapturedEntry>): CapturedEntry {
  return {
    id: 'id-1',
    kind: 'graphql',
    method: 'POST',
    url: 'https://api/graphql',
    name: 'GetUser',
    requestHeaders: [{ name: 'content-type', value: 'application/json' }],
    operation: { name: 'GetUser', type: 'query', rootFields: ['user'] },
    query: 'query GetUser { user { id } }',
    variables: { id: 1 },
    status: 200,
    statusText: 'OK',
    time: 10,
    size: 42,
    errorState: 'ok',
    getResponseBody: () => Promise.resolve({ data: { user: { id: 1 } } }),
    ...over,
  };
}

describe('session export/import', () => {
  it('round-trips entries and inlines the response body', async () => {
    const original = [
      entry({ id: 'a', responseBody: { data: { user: { id: 1 } } } }),
      entry({ id: 'b', kind: 'http', operation: undefined, query: undefined, variables: undefined, name: '/x', responseBody: { ok: true } }),
    ];
    const exported = exportSession(original);
    expect(exported.log.entries).toHaveLength(2);
    expect(exported.log.creator.name).toBe('Querio+');

    const imported = importSession(exported);
    expect(imported).toHaveLength(2);
    expect(imported[0].id).toBe('a');
    expect(imported[0].name).toBe('GetUser');
    expect(imported[0].query).toBe('query GetUser { user { id } }');
    // imported body resolves without any getContent
    await expect(imported[0].getResponseBody()).resolves.toEqual({ data: { user: { id: 1 } } });
    expect(imported[1].kind).toBe('http');
  });

  it('round-trips through JSON.stringify/parse', () => {
    const exported = exportSession([entry({ id: 'c', responseBody: { v: 1 } })]);
    const roundTripped = importSession(JSON.parse(JSON.stringify(exported)));
    expect(roundTripped).toHaveLength(1);
    expect(roundTripped[0].id).toBe('c');
  });

  it('returns [] for malformed input', () => {
    expect(importSession(null)).toEqual([]);
    expect(importSession({})).toEqual([]);
    expect(importSession({ log: { entries: 'nope' } })).toEqual([]);
  });

  it('coerces malformed per-entry fields to safe types', () => {
    const malformed = {
      log: {
        entries: [
          {
            _querioPlus: {
              url: 'https://api/x',
              // deliberately wrong types:
              kind: 'weird',
              status: 'not-a-number',
              time: null,
              size: -5,
              errorState: 'bogus',
              method: 123,
              name: 456,
              requestHeaders: [{ name: 'ok', value: 'v' }, { bad: true }, null],
              errorCount: 'nope',
            },
          },
        ],
      },
    };
    const [e] = importSession(malformed);
    expect(e.kind).toBe('http'); // unknown kind -> http
    expect(e.status).toBe(0); // non-number -> 0
    expect(e.time).toBe(0);
    expect(e.size).toBeUndefined(); // negative -> undefined
    expect(e.errorState).toBe('ok'); // unknown -> ok
    expect(e.method).toBe('GET'); // non-string -> GET
    expect(e.name).toBe('https://api/x'); // non-string name -> url
    expect(e.requestHeaders).toEqual([{ name: 'ok', value: 'v' }]); // bad headers dropped
    expect(e.errorCount).toBeUndefined();
  });

  it('skips entries without a valid url but keeps the rest', () => {
    const mixed = {
      log: {
        entries: [
          { _querioPlus: { url: 'https://api/good', kind: 'http', status: 200 } },
          { _querioPlus: { kind: 'http' } }, // no url -> skipped
          { notQuerio: true }, // no envelope -> skipped
        ],
      },
    };
    const out = importSession(mixed);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe('https://api/good');
  });
});
