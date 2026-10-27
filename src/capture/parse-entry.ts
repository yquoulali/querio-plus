import type {
  CapturedEntry,
  HarEntry,
  HeaderPair,
  RequestTimings,
} from '../types';
import type { BatchInputOperation, SplitOperation } from './batch-split';
import type { DetectableRequest, GraphQLOperationMeta } from './graphql-detect';
import { detectGraphQL } from './graphql-detect';
import { splitBatch } from './batch-split';
import { isContentType, getParamValue } from './content-type';
import { statusLabel } from './status-map';

const HTTP_RESOURCE_TYPES = ['xhr', 'fetch', 'preflight'];

export type Classification =
  | { kind: 'graphql' }
  | { kind: 'http' }
  | { kind: 'ignored' };

/** Decode a single param value exactly once (matches reference getQueryValue). */
function decodeOnce(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    // Malformed percent-encoding: keep the raw value rather than throwing.
    return value;
  }
}

function decodeParams(
  params: ReadonlyArray<{ name: string; value: string }> | undefined,
): ReadonlyArray<{ name: string; value: string }> {
  if (!params) return [];
  return params.map(({ name, value }) => ({ name, value: decodeOnce(value) ?? '' }));
}

/** Build a DetectableRequest, parsing a JSON POST body exactly once into parsedBody. */
function buildDetectable(entry: HarEntry): {
  detectable: DetectableRequest;
  parsedBody: unknown;
  parsedBodyOk: boolean;
} {
  const { method, headers, queryString, postData } = entry.request;
  const decodedQuery = decodeParams(queryString);

  let parsedBody: unknown;
  let parsedBodyOk = false;
  const bodyText = postData?.text;

  if (
    method === 'POST' &&
    bodyText !== undefined &&
    isContentType(headers, 'application/json')
  ) {
    try {
      parsedBody = JSON.parse(bodyText);
      parsedBodyOk = true;
    } catch {
      parsedBodyOk = false;
    }
  }

  const formParams = postData?.params ? decodeParams(postData.params) : undefined;

  // For multipart/form-data, HAR stores parts as postData.params[].
  // Each param has { name, value } where value is the text content of that part.
  // This is how Chrome DevTools exposes multipart data in HAR format.
  const multipartParts = isContentType(headers, 'multipart/form-data')
    ? formParams
    : undefined;

  const detectable: DetectableRequest = {
    method,
    headers,
    queryParams: decodedQuery,
    bodyText,
    parsedBody: parsedBodyOk ? parsedBody : undefined,
    formParams,
    multipartParts,
    operationName:
      decodeOnce(getParamValue('operationName', decodedQuery)) ??
      (formParams ? decodeOnce(getParamValue('operationName', formParams)) : undefined),
  };

  return { detectable, parsedBody: parsedBodyOk ? parsedBody : undefined, parsedBodyOk };
}

/** Classify a finished HAR entry (GraphQL wins; else HTTP gated on resourceType; else ignored). */
export function classifyEntry(entry: HarEntry): Classification {
  const { detectable } = buildDetectable(entry);
  if (detectGraphQL(detectable).isGraphQL) return { kind: 'graphql' };
  if (HTTP_RESOURCE_TYPES.includes(entry._resourceType ?? '')) return { kind: 'http' };
  return { kind: 'ignored' };
}

/** Decode a getContent() result, un-base64-ing binary bodies into a UTF-8 string. */
function decodeContent(content: string, encoding: string): string {
  if (encoding !== 'base64') return content;
  try {
    const binary = atob(content);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    // Not decodable as UTF-8 text (truly binary); return as-is.
    return content;
  }
}

/** Lazy, memoized body reader. Parses JSON only when the response is application/json. */
function makeBodyCache(entry: HarEntry): () => Promise<unknown> {
  let cached: Promise<unknown> | undefined;
  return () => {
    if (cached) return cached;
    cached = (async () => {
      const result = await entry.getContent();
      const [content, encoding] = Array.isArray(result) ? result : ['', ''];
      const raw = decodeContent(content ?? '', encoding ?? '');
      if (!isContentType(entry.response.headers ?? [], 'application/json')) return raw;
      if (raw === '') return raw;
      try {
        return JSON.parse(raw);
      } catch {
        // RE improvement #5: surface the raw body instead of throwing a hard error.
        return raw;
      }
    })();
    // A failed fetch must not be cached forever: clear it so the next call retries.
    cached.catch(() => {
      cached = undefined;
    });
    return cached;
  };
}

function sizeFrom(entry: HarEntry): number | undefined {
  const s = entry.response.content.size;
  // content.size <= 0 (0 or -1) is treated as absent.
  return typeof s === 'number' && s > 0 ? s : undefined;
}

/** Extract timing breakdown from HAR entry for waterfall visualization. */
function parseTimings(entry: HarEntry): RequestTimings | undefined {
  const t = entry.timings;
  if (!t) return undefined;
  return {
    blocked: typeof t.blocked === 'number' ? t.blocked : -1,
    dns: typeof t.dns === 'number' ? t.dns : -1,
    connect: typeof t.connect === 'number' ? t.connect : -1,
    ssl: typeof t.ssl === 'number' ? t.ssl : -1,
    send: typeof t.send === 'number' ? t.send : -1,
    wait: typeof t.wait === 'number' ? t.wait : -1,
    receive: typeof t.receive === 'number' ? t.receive : -1,
  };
}

function urlPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function errorCountOf(body: unknown): number {
  if (
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as { errors?: unknown }).errors)
  ) {
    return ((body as { errors: unknown[] }).errors).length;
  }
  return 0;
}

/** Build the one-element-or-array BatchInputOperation[] from the parsed body / decoded params. */
function buildBatchInput(
  entry: HarEntry,
  parsedBody: unknown,
  parsedBodyOk: boolean,
  rootFields: string[],
): BatchInputOperation[] {
  const { method, headers, queryString, postData } = entry.request;

  // GET or form-urlencoded: single op from decoded params.
  if (
    method === 'GET' ||
    isContentType(headers, 'application/x-www-form-urlencoded')
  ) {
    const params =
      method === 'GET' ? decodeParams(queryString) : decodeParams(postData?.params);
    return [
      {
        query: getParamValue('query', params) ?? '',
        variables: getParamValue('variables', params),
        operationName: getParamValue('operationName', params),
        rootFields,
      },
    ];
  }

  // JSON POST: array -> element-wise; single object -> wrapped one-element.
  if (parsedBodyOk && Array.isArray(parsedBody)) {
    return (parsedBody as Array<Record<string, unknown>>).map((el, i) => ({
      query: typeof el.query === 'string' ? el.query : '',
      variables: el.variables,
      operationName: typeof el.operationName === 'string' ? el.operationName : undefined,
      // F3: only element 0 gets rootFields (detectGraphQL parsed element 0 only).
      rootFields: i === 0 ? rootFields : undefined,
    }));
  }

  const obj = (parsedBodyOk ? parsedBody : {}) as Record<string, unknown>;
  return [
    {
      query: typeof obj.query === 'string' ? obj.query : '',
      variables: obj.variables,
      operationName: typeof obj.operationName === 'string' ? obj.operationName : undefined,
      rootFields,
    },
  ];
}

/** Detect operation meta for one split batch element (elements > 0 are not covered by the request-level detection). */
function detectOperationFor(op: SplitOperation): GraphQLOperationMeta | undefined {
  if (!op.query) return undefined;
  return detectGraphQL({
    method: 'POST',
    headers: [{ name: 'content-type', value: 'application/json' }],
    queryParams: [],
    parsedBody: { query: op.query, operationName: op.operationName },
  }).operation;
}

/** Parse a GraphQL entry into one CapturedEntry per split operation. */
export function parseGqlEntries(entry: HarEntry): CapturedEntry[] {
  const { detectable, parsedBody, parsedBodyOk } = buildDetectable(entry);
  const detection = detectGraphQL(detectable);
  const rootFields = detection.operation?.rootFields ?? [];

  const batchInput = buildBatchInput(entry, parsedBody, parsedBodyOk, rootFields);
  const ops: SplitOperation[] = splitBatch(
    batchInput.length === 1 ? batchInput[0] : batchInput,
  );

  const getContent = makeBodyCache(entry);
  const status = entry.response.status;
  const baseSize = sizeFrom(entry);

  const requestBody = entry.request.postData?.text;

  return ops.map((op) => {
    // detectGraphQL only parses batch element 0, so every other batch element needs its
    // own meta; reusing element 0's would mislabel name/type/rootFields.
    const operation =
      op.isBatch && op.index > 0 ? detectOperationFor(op) : detection.operation;
    const getResponseBody = async () => {
      const full = await getContent();
      return op.responseFor(full);
    };
    return {
      id: crypto.randomUUID(),
      kind: 'graphql' as const,
      method: entry.request.method,
      url: entry.request.url,
      name: op.isBatch
        ? (op.operationName ?? operation?.name ?? urlPathname(entry.request.url))
        : (operation?.name ?? op.operationName ?? urlPathname(entry.request.url)),
      requestHeaders: entry.request.headers,
      requestMimeType: entry.request.postData?.mimeType,
      requestBody,
      operation,
      query: op.query,
      variables: op.variables,
      operationName: op.operationName,
      // F6: batch present only when it actually came from a batch array.
      batch: op.isBatch ? { count: op.count, length: op.length } : undefined,
      correlation: op.correlation,
      status,
      statusText: statusLabel(status),
      mimeType: entry.response.content.mimeType,
      time: entry.time,
      size: baseSize,
      errorState: 'pending' as const,
      startedDateTime: entry.startedDateTime,
      timings: parseTimings(entry),
      getResponseBody,
    } satisfies CapturedEntry;
  });
}

/** Parse a non-GraphQL HTTP entry into a single CapturedEntry (errorState resolved synchronously). */
export function parseHttpEntry(entry: HarEntry): CapturedEntry {
  const getContent = makeBodyCache(entry);
  const status = entry.response.status;
  const isError = status >= 400 || status === 0;
  return {
    id: crypto.randomUUID(),
    kind: 'http',
    method: entry.request.method,
    url: entry.request.url,
    name: urlPathname(entry.request.url),
    requestHeaders: entry.request.headers,
    requestMimeType: entry.request.postData?.mimeType,
    requestBody: entry.request.postData?.text,
    status,
    statusText: statusLabel(status),
    mimeType: entry.response.content.mimeType,
    time: entry.time,
    size: sizeFrom(entry),
    errorState: isError ? 'error' : 'ok',
    startedDateTime: entry.startedDateTime,
    timings: parseTimings(entry),
    getResponseBody: getContent,
  };
}

/** Resolve a GraphQL entry's tri-state error flag once its body is available (I2). */
export async function resolveGraphqlError(
  entry: CapturedEntry,
): Promise<{
  errorState: 'error' | 'ok';
  errorCount?: number;
  size?: number;
  responseBody?: unknown;
}> {
  const body = await entry.getResponseBody();
  const gqlErrors = errorCountOf(body);
  const httpError = entry.status >= 400 || entry.status === 0;
  const isError = httpError || gqlErrors > 0;
  const update: {
    errorState: 'error' | 'ok';
    errorCount?: number;
    size?: number;
    responseBody?: unknown;
  } = {
    errorState: isError ? 'error' : 'ok',
    // Write the resolved body back so search and session export can see it.
    responseBody: body,
  };
  if (gqlErrors > 0) update.errorCount = gqlErrors;
  // Backfill size from body byte length when the HAR content.size was absent.
  if (entry.size === undefined && body !== undefined) {
    try {
      update.size = new Blob([typeof body === 'string' ? body : JSON.stringify(body)]).size;
    } catch {
      /* ignore size backfill failure */
    }
  }
  return update;
}

export type { HeaderPair };
