import { describe, it, expect } from 'vitest';
import {
  classifyEntry,
  parseGqlEntries,
  parseHttpEntry,
  resolveGraphqlError,
} from '../src/capture/parse-entry';
import type { HarEntry } from '../src/types';

function makeEntry(partial: {
  method: string;
  url: string;
  reqHeaders?: { name: string; value: string }[];
  queryString?: { name: string; value: string }[];
  postData?: { mimeType?: string; text?: string; params?: { name: string; value: string }[] };
  resourceType?: string;
  status?: number;
  respHeaders?: { name: string; value: string }[];
  contentMime?: string;
  contentSize?: number;
  responseBody?: string;
}): HarEntry {
  return {
    _resourceType: partial.resourceType ?? 'fetch',
    time: 12.5,
    startedDateTime: '2024-01-01T00:00:00.000Z',
    request: {
      method: partial.method,
      url: partial.url,
      headers: partial.reqHeaders ?? [],
      queryString: partial.queryString,
      postData: partial.postData,
    },
    response: {
      status: partial.status ?? 200,
      headers: partial.respHeaders ?? [{ name: 'content-type', value: 'application/json' }],
      content: {
        status: undefined,
        mimeType: partial.contentMime ?? 'application/json',
        size: partial.contentSize ?? 0,
      } as HarEntry['response']['content'],
    },
    getContent: () =>
      Promise.resolve([partial.responseBody ?? '{"data":{}}', 'utf8'] as [string, string]),
  };
}

const jsonHeaders = [{ name: 'content-type', value: 'application/json' }];

describe('parse-entry seam', () => {
  it('classifies a JSON POST GraphQL request as graphql', () => {
    const entry = makeEntry({
      method: 'POST',
      url: 'https://api/graphql',
      reqHeaders: jsonHeaders,
      postData: { mimeType: 'application/json', text: JSON.stringify({ query: 'query Q { me }' }) },
    });
    expect(classifyEntry(entry).kind).toBe('graphql');
  });

  it('classifies a plain XHR as http', () => {
    const entry = makeEntry({
      method: 'GET',
      url: 'https://api/users',
      reqHeaders: jsonHeaders,
      resourceType: 'xhr',
    });
    expect(classifyEntry(entry).kind).toBe('http');
  });

  it('single-parse flow: array POST produces one CapturedEntry per op with batch meta', () => {
    const entry = makeEntry({
      method: 'POST',
      url: 'https://api/graphql',
      reqHeaders: jsonHeaders,
      postData: {
        mimeType: 'application/json',
        text: JSON.stringify([
          { query: 'query A { a }', operationName: 'A' },
          { query: 'query B { b }', operationName: 'B' },
        ]),
      },
    });
    const captured = parseGqlEntries(entry);
    expect(captured).toHaveLength(2);
    expect(captured[0].batch).toEqual({ count: 1, length: 2 });
    expect(captured[1].batch).toEqual({ count: 2, length: 2 });
    expect(captured[0].kind).toBe('graphql');
  });

  it('non-batch GraphQL op has batch === undefined (F6)', () => {
    const entry = makeEntry({
      method: 'POST',
      url: 'https://api/graphql',
      reqHeaders: jsonHeaders,
      postData: { mimeType: 'application/json', text: JSON.stringify({ query: 'query Q { me }' }) },
    });
    const [captured] = parseGqlEntries(entry);
    expect(captured.batch).toBeUndefined();
  });

  it('GET payload build: reads decoded query/variables/operationName from queryString', () => {
    const entry = makeEntry({
      method: 'GET',
      url: 'https://api/graphql?query=...',
      reqHeaders: jsonHeaders,
      queryString: [
        { name: 'query', value: 'query%20Q%20%7B%20me%20%7D' },
        { name: 'variables', value: '%7B%22id%22%3A1%7D' },
      ],
    });
    const [captured] = parseGqlEntries(entry);
    expect(captured.query).toBe('query Q { me }');
    expect(captured.variables).toEqual({ id: 1 });
  });

  it('decode path: a percent-encoded query is decoded EXACTLY once', () => {
    const entry = makeEntry({
      method: 'GET',
      url: 'https://api/graphql',
      reqHeaders: jsonHeaders,
      queryString: [{ name: 'query', value: '%7B%20me%20%7B%20id%20%7D%20%7D' }],
    });
    const [captured] = parseGqlEntries(entry);
    expect(captured.query).toBe('{ me { id } }');
  });

  it('decode path: no double-decode (%2525 -> %25, never %)', () => {
    // %2525 decoded once -> %25 ; decoded twice -> %. Build a form value to prove single decode.
    const entry = makeEntry({
      method: 'POST',
      url: 'https://api/graphql',
      reqHeaders: [{ name: 'content-type', value: 'application/x-www-form-urlencoded' }],
      postData: {
        mimeType: 'application/x-www-form-urlencoded',
        params: [
          { name: 'query', value: 'query%20Q%20%7B%20me%20%7D' },
          { name: 'variables', value: '%7B%22note%22%3A%22%2525%22%7D' },
        ],
      },
    });
    const [captured] = parseGqlEntries(entry);
    expect(captured.query).toBe('query Q { me }');
    expect(captured.variables).toEqual({ note: '%25' });
  });

  it('http entry resolves error state synchronously from status', () => {
    const entry = makeEntry({
      method: 'GET',
      url: 'https://api/x',
      reqHeaders: jsonHeaders,
      resourceType: 'xhr',
      status: 500,
    });
    const captured = parseHttpEntry(entry);
    expect(captured.errorState).toBe('error');
    expect(captured.statusText).toBe('Internal Server Error');
  });

  it('status map: mapped (404) labeled, unmapped (418) empty label, 0 -> (failed)', () => {
    const mapped = parseHttpEntry(
      makeEntry({ method: 'GET', url: 'https://a/x', resourceType: 'xhr', status: 404 }),
    );
    expect(mapped.statusText).toBe('Not Found');
    const unmapped = parseHttpEntry(
      makeEntry({ method: 'GET', url: 'https://a/y', resourceType: 'xhr', status: 418 }),
    );
    expect(unmapped.statusText).toBe('');
    const failed = parseHttpEntry(
      makeEntry({ method: 'GET', url: 'https://a/z', resourceType: 'xhr', status: 0 }),
    );
    expect(failed.statusText).toBe('(failed)');
  });

  it('resolveGraphqlError flips a pending GraphQL row to error on a non-empty errors[]', async () => {
    const entry = makeEntry({
      method: 'POST',
      url: 'https://api/graphql',
      reqHeaders: jsonHeaders,
      postData: { mimeType: 'application/json', text: JSON.stringify({ query: 'query Q { me }' }) },
      responseBody: JSON.stringify({ data: null, errors: [{ message: 'boom' }] }),
    });
    const [captured] = parseGqlEntries(entry);
    expect(captured.errorState).toBe('pending');
    const update = await resolveGraphqlError(captured);
    expect(update.errorState).toBe('error');
    expect(update.errorCount).toBe(1);
  });
});

describe('parse-entry review fixes', () => {
  it('gives each batch element its own name and operation type', () => {
    const entry = makeEntry({
      method: 'POST',
      url: 'https://api/graphql',
      reqHeaders: jsonHeaders,
      postData: {
        mimeType: 'application/json',
        text: JSON.stringify([
          { operationName: 'A', query: 'query A { a }' },
          { operationName: 'B', query: 'mutation B { b }' },
        ]),
      },
      responseBody: JSON.stringify([{ data: {} }, { data: {} }]),
    });
    const [a, b] = parseGqlEntries(entry);
    expect(a.name).toBe('A');
    expect(a.operation?.type).toBe('query');
    expect(b.name).toBe('B');
    expect(b.operation?.type).toBe('mutation');
  });

  it('classifies a GET GraphQL request that has no Content-Type', () => {
    const entry = makeEntry({
      method: 'GET',
      url: 'https://api/graphql?query=%7B%20me%20%7D',
      queryString: [{ name: 'query', value: 'query Q { me }' }],
    });
    expect(classifyEntry(entry).kind).toBe('graphql');
    expect(parseGqlEntries(entry)[0].query).toBe('query Q { me }');
  });

  it('resolveGraphqlError returns the body so it can be written back to the store', async () => {
    const entry = makeEntry({
      method: 'POST',
      url: 'https://api/graphql',
      reqHeaders: jsonHeaders,
      postData: { mimeType: 'application/json', text: JSON.stringify({ query: 'query Q { me }' }) },
      responseBody: '{"data":{"me":1}}',
    });
    const [e] = parseGqlEntries(entry);
    const update = await resolveGraphqlError(e);
    expect(update.responseBody).toEqual({ data: { me: 1 } });
  });

  it('retries a body fetch after a failure instead of caching the rejection', async () => {
    const entry = makeEntry({ method: 'GET', url: 'https://a/x', resourceType: 'xhr' });
    let calls = 0;
    entry.getContent = () =>
      ++calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve(['ok', ''] as [string, string]);
    const e = parseHttpEntry(entry);
    await expect(e.getResponseBody()).rejects.toThrow('boom');
    await expect(e.getResponseBody()).resolves.toBe('ok');
  });
});
