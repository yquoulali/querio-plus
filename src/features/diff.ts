/**
 * JSON diff utility for comparing two response bodies.
 * Produces a structural diff that can be rendered with additions/removals/changes.
 */

export type DiffType = 'added' | 'removed' | 'changed' | 'unchanged';

export interface DiffNode {
  path: string;
  key?: string;
  type: DiffType;
  /** Value from left (old) side; undefined for 'added' nodes */
  left?: unknown;
  /** Value from right (new) side; undefined for 'removed' nodes */
  right?: unknown;
  /** Child diffs for nested objects/arrays */
  children?: DiffNode[];
  /** True if this is an object or array container */
  isContainer?: boolean;
  /** Container type when isContainer is true */
  containerType?: 'object' | 'array';
  /** Number of changes within this subtree (for summary) */
  changeCount?: number;
}

export interface DiffSummary {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/**
 * Deep equality check for JSON values.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeOf(a) !== typeOf(b)) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
  }

  return false;
}

/**
 * Build a diff tree comparing two JSON values.
 * @param left The "old" or "baseline" value
 * @param right The "new" or "comparison" value
 * @param path Current JSON path (for display)
 * @param key The key name within parent (for display)
 */
export function buildDiff(
  left: unknown,
  right: unknown,
  path = '$',
  key?: string,
): DiffNode {
  // Both undefined/missing -> unchanged (shouldn't happen at root)
  if (left === undefined && right === undefined) {
    return { path, key, type: 'unchanged', left, right };
  }

  // Added: only in right
  if (left === undefined) {
    return {
      path,
      key,
      type: 'added',
      right,
      changeCount: 1,
    };
  }

  // Removed: only in left
  if (right === undefined) {
    return {
      path,
      key,
      type: 'removed',
      left,
      changeCount: 1,
    };
  }

  // Fast path: deep equal -> unchanged
  if (deepEqual(left, right)) {
    return { path, key, type: 'unchanged', left, right, changeCount: 0 };
  }

  // Type mismatch -> changed (whole subtree replaced)
  const leftType = typeOf(left);
  const rightType = typeOf(right);
  if (leftType !== rightType) {
    return {
      path,
      key,
      type: 'changed',
      left,
      right,
      changeCount: 1,
    };
  }

  // Both are arrays
  if (Array.isArray(left) && Array.isArray(right)) {
    const children: DiffNode[] = [];
    const maxLen = Math.max(left.length, right.length);
    let changeCount = 0;

    for (let i = 0; i < maxLen; i++) {
      const childPath = `${path}[${i}]`;
      const childDiff = buildDiff(left[i], right[i], childPath, String(i));
      children.push(childDiff);
      changeCount += childDiff.changeCount ?? (childDiff.type !== 'unchanged' ? 1 : 0);
    }

    return {
      path,
      key,
      type: changeCount > 0 ? 'changed' : 'unchanged',
      isContainer: true,
      containerType: 'array',
      children,
      changeCount,
    };
  }

  // Both are objects
  if (isPlainObject(left) && isPlainObject(right)) {
    const children: DiffNode[] = [];
    const allKeys = new Set([...Object.keys(left), ...Object.keys(right)]);
    let changeCount = 0;

    // Sort keys for stable output
    const sortedKeys = Array.from(allKeys).sort();

    for (const k of sortedKeys) {
      const childPath = `${path}.${k}`;
      const childDiff = buildDiff(left[k], right[k], childPath, k);
      children.push(childDiff);
      changeCount += childDiff.changeCount ?? (childDiff.type !== 'unchanged' ? 1 : 0);
    }

    return {
      path,
      key,
      type: changeCount > 0 ? 'changed' : 'unchanged',
      isContainer: true,
      containerType: 'object',
      children,
      changeCount,
    };
  }

  // Primitives that differ
  return {
    path,
    key,
    type: 'changed',
    left,
    right,
    changeCount: 1,
  };
}

/**
 * Count changes by type across a diff tree.
 */
export function summarizeDiff(node: DiffNode): DiffSummary {
  const summary: DiffSummary = { added: 0, removed: 0, changed: 0, unchanged: 0 };

  function walk(n: DiffNode): void {
    if (n.children) {
      // For containers, recurse into children
      for (const child of n.children) {
        walk(child);
      }
    } else {
      // Leaf node: count it
      summary[n.type]++;
    }
  }

  walk(node);
  return summary;
}

/**
 * Flatten a diff tree into a list of changed paths (for quick overview).
 */
export function getChangedPaths(node: DiffNode): Array<{ path: string; type: DiffType }> {
  const result: Array<{ path: string; type: DiffType }> = [];

  function walk(n: DiffNode): void {
    if (n.children) {
      for (const child of n.children) {
        walk(child);
      }
    } else if (n.type !== 'unchanged') {
      result.push({ path: n.path, type: n.type });
    }
  }

  walk(node);
  return result;
}
