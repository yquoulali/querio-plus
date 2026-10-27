import type {
  DetectableRequest,
  GraphQLDetection,
  GraphQLOperationMeta,
  GraphQLOperationType,
} from './capture/graphql-detect';
import type { BatchInputOperation, SplitOperation } from './capture/batch-split';

export type {
  DetectableRequest,
  GraphQLDetection,
  GraphQLOperationMeta,
  GraphQLOperationType,
  BatchInputOperation,
  SplitOperation,
};

export interface HeaderPair {
  name: string;
  value: string;
}

/**
 * Tri-state error flag (design I2):
 * - 'ok'      — not an error.
 * - 'error'   — HTTP status >= 400 / status === 0, or a non-empty GraphQL `errors[]`.
 * - 'pending' — a GraphQL row whose body is being fetched; never used for HTTP rows.
 */
export type ErrorState = 'error' | 'ok' | 'pending';

/**
 * HAR timing breakdown for waterfall visualization.
 * Values are in milliseconds. -1 means "not applicable" (e.g., DNS reused from cache).
 */
export interface RequestTimings {
  blocked: number;  // Time spent in browser queue
  dns: number;      // DNS lookup
  connect: number;  // TCP connection
  ssl: number;      // SSL/TLS handshake
  send: number;     // Sending request
  wait: number;     // TTFB (time to first byte)
  receive: number;  // Downloading response
}

/**
 * The single normalized shape that flows out of parse-entry.ts into the store and
 * drives the whole UI. GraphQL-only fields are `undefined` when kind === 'http'.
 */
export interface CapturedEntry {
  id: string; // crypto.randomUUID(), unique per entry (one per split op)
  kind: 'graphql' | 'http';

  // --- request ---
  method: string;
  url: string;
  name: string; // display name: GraphQL op name, or URL pathname for http
  requestHeaders: ReadonlyArray<HeaderPair>;
  requestMimeType?: string;
  /** Raw request body text (postData.text) as sent; used to replay the request faithfully. */
  requestBody?: string;

  // --- graphql-only (undefined when kind === 'http') ---
  operation?: GraphQLOperationMeta;
  query?: string;
  variables?: unknown;
  operationName?: string;
  /**
   * F6: present only when the op came from a JSON-array batch (SplitOperation.isBatch
   * === true); `undefined` for a non-batch GraphQL op (never {1,1}). `index` is NOT
   * carried onto CapturedEntry — it lives only inside the responseFor closure that
   * getResponseBody wraps.
   */
  batch?: { count: number; length: number };
  correlation?: 'identity' | 'position';

  // --- response (status/time/size/mime available immediately from the HAR entry) ---
  status: number;
  statusText?: string; // display-only; unmapped code -> empty label; status 0 -> '(failed)'
  mimeType?: string;
  time: number; // ms, HAR-standard
  size: number | undefined; // content.size when > 0, else body byte length, else undefined

  // --- error state (tri-state; I2) ---
  errorState: ErrorState;
  errorCount?: number; // number of GraphQL errors[], undefined for HTTP-only errors (badge '!')

  // --- timing data for waterfall visualization ---
  startedDateTime?: string; // ISO 8601 timestamp of request start
  timings?: RequestTimings; // Detailed timing breakdown

  // --- lazy body access ---
  getResponseBody: () => Promise<unknown>; // cached per id
  responseBody?: unknown; // inlined for imported entries + resolved cache value
}

/** Plain HAR-ish shapes used by parse-entry.ts (a subset of har-format + devtools extras). */
export interface HarContent {
  size?: number;
  mimeType?: string;
  text?: string;
}

export interface HarPostData {
  mimeType?: string;
  text?: string;
  params?: ReadonlyArray<{ name: string; value: string }>;
}

export interface HarRequest {
  method: string;
  url: string;
  headers: ReadonlyArray<HeaderPair>;
  queryString?: ReadonlyArray<{ name: string; value: string }>;
  postData?: HarPostData;
}

export interface HarResponse {
  status: number;
  headers?: ReadonlyArray<HeaderPair>;
  content: HarContent;
}

/**
 * HAR timing object as provided by Chrome DevTools.
 */
export interface HarTimings {
  blocked?: number;
  dns?: number;
  connect?: number;
  ssl?: number;
  send?: number;
  wait?: number;
  receive?: number;
  _blocked_queueing?: number;
}

export interface HarEntry {
  _resourceType?: string;
  /**
   * Chrome's internal unique id for the actual network request. Two DELIVERIES of the
   * same request share this id; two genuinely separate requests (even byte-identical,
   * started in the same millisecond) get different ids. Used as the ONLY reliable dedup
   * key. May be absent on non-Chrome hosts or older builds — when absent, do not dedup.
   */
  _requestId?: string | number;
  time: number;
  startedDateTime?: string;
  timings?: HarTimings;
  request: HarRequest;
  response: HarResponse;
  /**
   * Returns the response body as `[content, encoding]`.
   *
   * The real Chrome API (`chrome.devtools.network.Request.getContent`) is
   * CALLBACK-based and returns `void`: `getContent((content, encoding) => ...)`,
   * where `encoding` is `''` for text or `'base64'` for binary. The capture
   * boundary (panel/main.tsx `normalizeHarEntry`) adapts that callback into the
   * promise form below so the rest of the pipeline has a single contract.
   * Imported sessions also provide the promise form directly.
   */
  getContent: (
    callback?: (content: string, encoding: string) => void,
  ) => Promise<[string, string]> | void;
}

export type { BatchInputOperation as _BatchInputOperation };
