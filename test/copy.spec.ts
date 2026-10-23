import { describe, it, expect } from 'vitest';
import { toCurl, copyResponse } from '../src/features/copy';
import type { CapturedEntry } from '../src/types';

function mk(over: Partial<CapturedEntry>): CapturedEntry {
  return {
    id: 'x',
    kind: 'http',
    method: 'POST',
    url: 'https://api/x',
    name: '/x',
    requestHeaders: [],
    status: 200,
    time: 1,
    size: 1,
    errorState: 'ok',
    getResponseBody: () => Promise.resolve(undefined),
    ...over,
  };
}

describe('toCurl', () => {
  it('drops pseudo-headers and content-length, keeps the rest', () => {
    const out = toCurl(
      mk({
        requestHeaders: [
          { name: ':authority', value: 'api' },
          { name: 'Content-Length', value: '99' },
          { name: 'x-a', value: '1' },
        ],
      }),
    );
    expect(out).toContain("'x-a: 1'");
    expect(out).not.toContain(':authority');
    expect(out.toLowerCase()).not.toContain('content-length');
  });

  it('replays the raw request body verbatim (http rows, batches)', () => {
    const body = '[{"query":"query A { a }"},{"query":"query B { b }"}]';
    expect(toCurl(mk({ kind: 'graphql', query: 'query A { a }', requestBody: body }))).toContain(
      `--data-raw '${body}'`,
    );
  });

  it('does not attach a body to a GET (would turn it into a POST)', () => {
    expect(toCurl(mk({ method: 'GET', kind: 'graphql', query: 'query Q { me }' }))).not.toContain(
      '--data-raw',
    );
  });
});

describe('copyResponse', () => {
  it('returns an empty string for undefined instead of the text "undefined"', () => {
    expect(copyResponse(undefined)).toBe('');
  });
});
