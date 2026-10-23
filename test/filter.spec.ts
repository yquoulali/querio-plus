import { describe, it, expect } from 'vitest';
import { applyFilter, emptyFilter, makeFilter } from '../src/features/filter';
import type { CapturedEntry } from '../src/types';

function entry(over: Partial<CapturedEntry>): CapturedEntry {
  return {
    id: Math.random().toString(36),
    kind: 'graphql',
    method: 'POST',
    url: 'https://api/graphql',
    name: 'GetUser',
    requestHeaders: [],
    operation: { name: 'GetUser', type: 'query', rootFields: ['user'] },
    status: 200,
    time: 1,
    size: undefined,
    errorState: 'ok',
    getResponseBody: () => Promise.resolve(undefined),
    ...over,
  };
}

describe('filter', () => {
  const rows: CapturedEntry[] = [
    entry({ name: 'GetUser', operation: { name: 'GetUser', type: 'query', rootFields: [] } }),
    entry({ name: 'SaveUser', operation: { name: 'SaveUser', type: 'mutation', rootFields: [] } }),
    entry({ kind: 'http', operation: undefined, name: '/health', status: 404, errorState: 'error', url: 'https://api/health' }),
  ];

  it('empty filter passes everything through', () => {
    expect(applyFilter(rows, emptyFilter)).toHaveLength(3);
  });

  it('name substring (case-insensitive)', () => {
    const out = applyFilter(rows, { ...emptyFilter, name: 'user' });
    expect(out.map((e) => e.name).sort()).toEqual(['GetUser', 'SaveUser']);
  });

  it('type filter: mutation only', () => {
    const out = applyFilter(rows, { ...emptyFilter, types: ['mutation'] });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('SaveUser');
  });

  it('type filter: http only', () => {
    const out = applyFilter(rows, { ...emptyFilter, types: ['http'] });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('http');
  });

  it('status class 4xx', () => {
    const out = applyFilter(rows, { ...emptyFilter, status: '4xx' });
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe(404);
  });

  it('exact status code', () => {
    expect(applyFilter(rows, { ...emptyFilter, status: '404' })).toHaveLength(1);
    expect(applyFilter(rows, { ...emptyFilter, status: '200' })).toHaveLength(2);
  });

  it('url substring', () => {
    const out = applyFilter(rows, { ...emptyFilter, url: 'health' });
    expect(out).toHaveLength(1);
  });

  it('errors-only toggle', () => {
    const out = applyFilter(rows, { ...emptyFilter, errorsOnly: true });
    expect(out).toHaveLength(1);
    expect(out[0].errorState).toBe('error');
  });

  it('AND combination of multiple filters', () => {
    const pred = makeFilter({ ...emptyFilter, name: 'user', types: ['query'] });
    expect(rows.filter(pred).map((e) => e.name)).toEqual(['GetUser']);
  });
});
