import type { CapturedEntry, HeaderPair, RequestTimings } from '../types';

/**
 * HAR-like export shape. We keep a `log.entries[]` envelope so it reads like a HAR file,
 * and stash Querio+'s normalized fields under `_querioPlus` on each entry so import can
 * round-trip losslessly (bodies inlined so imported entries need no getContent).
 */
export interface SessionEntryExport {
  _querioPlus: {
    id: string;
    kind: 'graphql' | 'http';
    method: string;
    url: string;
    name: string;
    requestHeaders: HeaderPair[];
    requestMimeType?: string;
    requestBody?: string;
    operationName?: string;
    query?: string;
    variables?: unknown;
    correlation?: 'identity' | 'position';
    batch?: { count: number; length: number };
    status: number;
    statusText?: string;
    mimeType?: string;
    time: number;
    size: number | undefined;
    errorState: 'error' | 'ok' | 'pending';
    errorCount?: number;
    responseBody?: unknown;
    operation?: CapturedEntry['operation'];
    // Timing data for waterfall visualization
    startedDateTime?: string;
    timings?: RequestTimings;
  };
}

export interface SessionExport {
  log: {
    version: '1.2';
    creator: { name: 'Querio+'; version: string };
    entries: SessionEntryExport[];
  };
}

const CREATOR_VERSION = '0.1.0';

/** Serialize all captured entries to a HAR-like JSON object (I6). Pure. */
export function exportSession(entries: ReadonlyArray<CapturedEntry>): SessionExport {
  return buildExport(entries);
}

/**
 * Like exportSession, but first resolves response bodies that were never loaded so the
 * export carries them. A body that fails to load is exported as absent.
 */
export async function exportSessionWithBodies(
  entries: ReadonlyArray<CapturedEntry>,
): Promise<SessionExport> {
  const resolved = await Promise.all(
    entries.map(async (e) => {
      if (e.responseBody !== undefined) return e;
      try {
        return { ...e, responseBody: await e.getResponseBody() };
      } catch {
        return e;
      }
    }),
  );
  return buildExport(resolved);
}

function buildExport(entries: ReadonlyArray<CapturedEntry>): SessionExport {
  return {
    log: {
      version: '1.2',
      creator: { name: 'Querio+', version: CREATOR_VERSION },
      entries: entries.map((e) => ({
        _querioPlus: {
          id: e.id,
          kind: e.kind,
          method: e.method,
          url: e.url,
          name: e.name,
          requestHeaders: [...e.requestHeaders],
          requestMimeType: e.requestMimeType,
          requestBody: e.requestBody,
          operationName: e.operationName,
          query: e.query,
          variables: e.variables,
          correlation: e.correlation,
          batch: e.batch,
          status: e.status,
          statusText: e.statusText,
          mimeType: e.mimeType,
          time: e.time,
          size: e.size,
          errorState: e.errorState,
          errorCount: e.errorCount,
          responseBody: e.responseBody,
          operation: e.operation,
          startedDateTime: e.startedDateTime,
          timings: e.timings,
        },
      })),
    },
  };
}

/** Reconstruct CapturedEntry[] from an exported session (I6). Bodies inlined. Pure. */
export function importSession(json: unknown): CapturedEntry[] {
  const parsed = json as Partial<SessionExport> | null;
  const rawEntries = parsed?.log?.entries;
  if (!Array.isArray(rawEntries)) return [];

  return rawEntries
    .map((raw): CapturedEntry | undefined => {
      const q = (raw as SessionEntryExport)._querioPlus;
      if (!q || typeof q.url !== 'string') return undefined;
      const body = q.responseBody;
      // Harden against malformed/hand-edited imports: coerce critical fields to safe
      // types so downstream filtering/rendering can't break on bad input.
      const kind: 'graphql' | 'http' = q.kind === 'graphql' ? 'graphql' : 'http';
      const status = typeof q.status === 'number' && Number.isFinite(q.status) ? q.status : 0;
      const time = typeof q.time === 'number' && Number.isFinite(q.time) ? q.time : 0;
      const size =
        typeof q.size === 'number' && Number.isFinite(q.size) && q.size >= 0 ? q.size : undefined;
      // Nothing resolves 'pending' after an import, so settle it from status/body now.
      const bodyErrors =
        typeof body === 'object' &&
        body !== null &&
        Array.isArray((body as { errors?: unknown }).errors)
          ? (body as { errors: unknown[] }).errors.length
          : 0;
      const errorState: 'error' | 'ok' =
        q.errorState === 'error' ||
        (q.errorState === 'pending' && (status >= 400 || status === 0 || bodyErrors > 0))
          ? 'error'
          : 'ok';
      const requestHeaders = Array.isArray(q.requestHeaders)
        ? q.requestHeaders.filter(
            (h): h is HeaderPair =>
              !!h && typeof h.name === 'string' && typeof h.value === 'string',
          )
        : [];
      return {
        id: typeof q.id === 'string' && q.id ? q.id : crypto.randomUUID(),
        kind,
        method: typeof q.method === 'string' ? q.method : 'GET',
        url: q.url,
        name: typeof q.name === 'string' ? q.name : q.url,
        requestHeaders,
        requestMimeType: q.requestMimeType,
        requestBody: typeof q.requestBody === 'string' ? q.requestBody : undefined,
        operation: q.operation,
        query: q.query,
        variables: q.variables,
        operationName: q.operationName,
        batch: q.batch,
        correlation: q.correlation,
        status,
        statusText: q.statusText,
        mimeType: q.mimeType,
        time,
        size,
        errorState,
        errorCount:
          typeof q.errorCount === 'number' && Number.isFinite(q.errorCount)
            ? q.errorCount
            : undefined,
        // imported bodies are inlined: getResponseBody resolves without getContent.
        responseBody: body,
        getResponseBody: () => Promise.resolve(body),
        // Timing data for waterfall
        startedDateTime: typeof q.startedDateTime === 'string' ? q.startedDateTime : undefined,
        timings: parseImportedTimings(q.timings),
      };
    })
    .filter((e): e is CapturedEntry => e !== undefined);
}

/** Safely parse timing data from import, validating each field */
function parseImportedTimings(timings: unknown): RequestTimings | undefined {
  if (!timings || typeof timings !== 'object') return undefined;
  const t = timings as Record<string, unknown>;
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  // At least one timing field must be valid
  if (
    !isNum(t.blocked) &&
    !isNum(t.dns) &&
    !isNum(t.connect) &&
    !isNum(t.ssl) &&
    !isNum(t.send) &&
    !isNum(t.wait) &&
    !isNum(t.receive)
  ) {
    return undefined;
  }
  return {
    blocked: isNum(t.blocked) ? t.blocked : -1,
    dns: isNum(t.dns) ? t.dns : -1,
    connect: isNum(t.connect) ? t.connect : -1,
    ssl: isNum(t.ssl) ? t.ssl : -1,
    send: isNum(t.send) ? t.send : -1,
    wait: isNum(t.wait) ? t.wait : -1,
    receive: isNum(t.receive) ? t.receive : -1,
  };
}
