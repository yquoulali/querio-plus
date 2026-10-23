import type { CapturedEntry } from '../types';
import { formatJson } from '../format/json-format';
import { printGraphQL } from '../format/graphql-print';

function shellQuote(value: string): string {
  // Single-quote for POSIX shells; escape embedded single quotes.
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build a copy-as-cURL string (I5). Pure string builder — no clipboard, no chrome APIs.
 * Includes method, URL, request headers, and the request body (GraphQL query+variables
 * as JSON for GraphQL rows, raw request mime otherwise).
 */
export function toCurl(entry: CapturedEntry): string {
  const parts: string[] = [`curl ${shellQuote(entry.url)}`];
  if (entry.method && entry.method !== 'GET') parts.push(`-X ${entry.method}`);

  for (const h of entry.requestHeaders) {
    // HTTP/2 pseudo-headers are invalid for curl; content-length is recomputed from the body.
    if (h.name.startsWith(':') || h.name.toLowerCase() === 'content-length') continue;
    parts.push(`-H ${shellQuote(`${h.name}: ${h.value}`)}`);
  }

  if (entry.requestBody !== undefined && entry.method !== 'GET') {
    // Replay exactly what was sent (covers http rows, batches and form-urlencoded).
    parts.push(`--data-raw ${shellQuote(entry.requestBody)}`);
  } else if (entry.kind === 'graphql' && entry.query !== undefined && entry.method !== 'GET') {
    // No raw body (e.g. imported session): rebuild a single-operation JSON body.
    const body = JSON.stringify({
      query: entry.query,
      ...(entry.variables !== undefined ? { variables: entry.variables } : {}),
      ...(entry.operationName ? { operationName: entry.operationName } : {}),
    });
    parts.push(`--data-raw ${shellQuote(body)}`);
  }

  return parts.join(' \\\n  ');
}

/** Copy the operation (query + variables) as a readable block (I5). */
export function copyOperation(entry: CapturedEntry): string {
  const printed = entry.query ? printGraphQL(entry.query) : '';
  const vars =
    entry.variables !== undefined ? `\n\n# Variables\n${formatJson(entry.variables)}` : '';
  return `${printed}${vars}`;
}

/** Copy a response body as formatted text (I5). */
export function copyResponse(body: unknown): string {
  return formatJson(body);
}
