export type JsonNodeType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

export interface JsonTreeNode {
  /** key within the parent (object key or array index); undefined for the root */
  key?: string;
  type: JsonNodeType;
  /** for primitive leaves: the primitive value; for object/array: undefined */
  value?: string | number | boolean | null;
  /** child nodes for object/array */
  children?: JsonTreeNode[];
  /** number of children (for collapsed-node display) */
  childCount?: number;
  /**
   * Set when this branch was truncated for safety: `childCount` reflects the real
   * size but `children` holds only the first `MAX_CHILDREN` (or is omitted past
   * `MAX_DEPTH`). The UI shows a "… N more" / "(depth limit)" marker.
   */
  truncated?: boolean;
}

/**
 * Safety bounds so a huge or deeply-nested response cannot freeze the panel or blow the
 * stack. Real-world GraphQL responses fit well under these; pathological payloads are
 * capped with a visible marker instead of hanging the UI.
 */
export const MAX_DEPTH = 100;
export const MAX_CHILDREN = 1000;

function typeOf(value: unknown): JsonNodeType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'object') return 'object';
  if (t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  return 'string';
}

/**
 * Build a collapsible-tree node model (I4). A non-object/primitive value (incl. a
 * kept-raw invalid-variables string per core #2) becomes a single leaf — it is NEVER
 * iterated as if it had keys.
 */
export function buildTree(value: unknown, key?: string, depth = 0): JsonTreeNode {
  const type = typeOf(value);

  if (type === 'array' || type === 'object') {
    // Depth guard: stop recursing past MAX_DEPTH; show the branch collapsed with its
    // real size, but don't build its subtree (prevents deep-recursion stack blowups).
    const entriesArr: Array<[string, unknown]> =
      type === 'array'
        ? (value as unknown[]).map((v, i) => [String(i), v])
        : Object.keys(value as Record<string, unknown>).map((k) => [
            k,
            (value as Record<string, unknown>)[k],
          ]);

    const childCount = entriesArr.length;

    if (depth >= MAX_DEPTH) {
      return { key, type, childCount, truncated: true };
    }

    const limited = entriesArr.slice(0, MAX_CHILDREN);
    const truncated = childCount > MAX_CHILDREN;
    return {
      key,
      type,
      children: limited.map(([k, v]) => buildTree(v, k, depth + 1)),
      childCount,
      truncated,
    };
  }

  // primitive / string leaf
  return { key, type, value: value as string | number | boolean | null };
}

/**
 * Format a value for raw-text display: 2-space JSON for objects/arrays, the string
 * itself for a string, String(value) otherwise. Never throws (P6).
 */
export function formatJson(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    // JSON.stringify returns undefined for undefined/functions; never leak that.
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return String(value);
  }
}
