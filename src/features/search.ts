import type { CapturedEntry } from '../types';
import { formatJson } from '../format/json-format';

export type SearchField = 'query' | 'variables' | 'requestBody' | 'responseBody';

export interface SearchMatch {
  id: string;
  fields: SearchField[];
}

/**
 * The response body a search needs, supplied by the caller. F7 policy: full-text
 * search is "match already-cached bodies + fetch-on-demand" — the caller passes the
 * already-resolved/cached response body per entry id (or undefined when not yet
 * fetched). search.ts NEVER fetches; it is pure. The UI lazily fetches on demand when
 * a row is opened and feeds the cached body back in. This preserves the "an HTTP row
 * never opened stays lazy" guarantee: unopened rows contribute only their request-side
 * text (query/variables/request body) to search, not their response body.
 */
export type BodyResolver = (entry: CapturedEntry) => unknown;

function haystackPart(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return formatJson(value);
}

/**
 * Case-insensitive full-text search over request query, variables, request body, and
 * (when available) response body. Returns matching entry ids + which fields matched.
 * Pure — response bodies are supplied via `resolveBody`, never fetched here (F7).
 */
export function searchEntries(
  entries: ReadonlyArray<CapturedEntry>,
  term: string,
  resolveBody?: BodyResolver,
): SearchMatch[] {
  const q = term.trim().toLowerCase();
  if (!q) return [];
  const matches: SearchMatch[] = [];

  for (const entry of entries) {
    const fields: SearchField[] = [];

    if (entry.query && entry.query.toLowerCase().includes(q)) fields.push('query');
    if (haystackPart(entry.variables).toLowerCase().includes(q)) fields.push('variables');

    // Request body text for GraphQL rows is folded into query/variables above; HTTP
    // rows carry no parsed request body in CapturedEntry, so nothing extra to scan.
    const resolved = resolveBody ? resolveBody(entry) : entry.responseBody;
    if (resolved !== undefined && haystackPart(resolved).toLowerCase().includes(q))
      fields.push('responseBody');

    if (fields.length > 0) matches.push({ id: entry.id, fields });
  }

  return matches;
}

/** Convenience: ids only. */
export function searchIds(
  entries: ReadonlyArray<CapturedEntry>,
  term: string,
  resolveBody?: BodyResolver,
): Set<string> {
  return new Set(searchEntries(entries, term, resolveBody).map((m) => m.id));
}
