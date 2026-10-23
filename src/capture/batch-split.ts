export interface BatchInputOperation {
  query: string;
  /** object or JSON string; normalized to object (or kept raw string on parse failure) */
  variables?: unknown;
  operationName?: string;
  /**
   * Root field / selection names supplied by the CALLER (parse-entry.ts, from
   * detectGraphQL's rootFields). splitBatch does NOT parse GraphQL — it consumes these
   * verbatim for identity probe (b). May be omitted; probe (b) is then skipped.
   *
   * F3: only the FIRST batch element carries rootFields (detectGraphQL parses element 0).
   * Elements 1..n omit rootFields, so probe (b) is skipped for them and they degrade to
   * positional correlation — which is Querio parity.
   */
  rootFields?: string[];
}

export interface SplitOperation {
  index: number; // 0-based position in the batch
  count: number; // 1-based (index + 1), for the "count/length in Batch" badge
  length: number; // batch size (1 for non-batch)
  isBatch: boolean;
  query: string;
  variables: unknown; // normalized object, kept-raw string, or undefined
  operationName: string | undefined;
  correlation: 'identity' | 'position';
  /** given the full parsed response, return the response slice for THIS operation */
  responseFor: (fullResponse: unknown) => unknown;
}

function normalizeVariables(variables: unknown): unknown {
  if (typeof variables !== 'string') return variables;
  try {
    return JSON.parse(variables);
  } catch {
    // Declared divergence from the reference (which drops the whole item with `return []`):
    // keep the operation AND the raw invalid-JSON string so the row still appears.
    return variables;
  }
}

function hasData(value: unknown): value is { data: Record<string, unknown> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    typeof (value as { data: unknown }).data === 'object' &&
    (value as { data: unknown }).data !== null
  );
}

function singleDataKey(value: unknown): string | undefined {
  if (!hasData(value)) return undefined;
  const keys = Object.keys(value.data);
  return keys.length === 1 ? keys[0] : undefined;
}

/** Strip an alias prefix ("alias: field" -> "field") for root-field matching. */
function bareFieldName(rootField: string): string {
  const idx = rootField.indexOf(':');
  return idx >= 0 ? rootField.slice(idx + 1).trim() : rootField.trim();
}

/**
 * Split a GraphQL request payload into individual operations correlated to responses
 * (RE §5 positional + improvement #1 hybrid identity-first-with-positional-fallback).
 * Pure: does NOT import or call `graphql` — all parsing happened once in detectGraphQL.
 */
export function splitBatch(
  requestPayload: BatchInputOperation | BatchInputOperation[],
): SplitOperation[] {
  if (!Array.isArray(requestPayload)) {
    const op = requestPayload;
    return [
      {
        index: 0,
        count: 1,
        length: 1,
        isBatch: false,
        query: op.query,
        variables: normalizeVariables(op.variables),
        operationName: op.operationName,
        correlation: 'position',
        responseFor: (full) => full,
      },
    ];
  }

  const length = requestPayload.length;
  const names = requestPayload.map((o) => o.operationName);
  const allDistinctNamed =
    length > 0 &&
    names.every((n) => typeof n === 'string' && n.length > 0) &&
    new Set(names).size === length;
  const mode: 'identity' | 'position' = allDistinctNamed ? 'identity' : 'position';

  return requestPayload.map((op, index) => {
    const operationName = op.operationName;
    const rootFields = op.rootFields;

    const positional = (full: unknown): unknown =>
      Array.isArray(full) ? full[index] : index === 0 ? full : undefined;

    const responseFor =
      mode === 'identity'
        ? (full: unknown): unknown => {
            if (Array.isArray(full)) {
              // probe (a): match response.operationName
              const byName = full.find(
                (r) =>
                  typeof r === 'object' &&
                  r !== null &&
                  (r as { operationName?: unknown }).operationName === operationName,
              );
              if (byName !== undefined) return byName;
              // probe (b): single-key response.data whose key matches a root field
              if (rootFields && rootFields.length > 0) {
                const bare = new Set(rootFields.map(bareFieldName));
                const byField = full.find((r) => {
                  const key = singleDataKey(r);
                  return key !== undefined && bare.has(key);
                });
                if (byField !== undefined) return byField;
              }
              // fallback: positional (correlation value stays 'identity')
              return full[index];
            }
            return index === 0 ? full : undefined;
          }
        : positional;

    return {
      index,
      count: index + 1,
      length,
      isBatch: true,
      query: op.query,
      variables: normalizeVariables(op.variables),
      operationName,
      correlation: mode,
      responseFor,
    };
  });
}
