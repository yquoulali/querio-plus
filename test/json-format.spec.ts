import { describe, it, expect } from 'vitest';
import {
  buildTree,
  formatJson,
  MAX_CHILDREN,
  MAX_DEPTH,
} from '../src/format/json-format';

describe('buildTree', () => {
  it('builds leaves for primitives (never iterated as objects)', () => {
    expect(buildTree('raw string').type).toBe('string');
    expect(buildTree(42).type).toBe('number');
    expect(buildTree(true).type).toBe('boolean');
    expect(buildTree(null).type).toBe('null');
  });

  it('builds object/array branches with childCount', () => {
    const obj = buildTree({ a: 1, b: 2 });
    expect(obj.type).toBe('object');
    expect(obj.childCount).toBe(2);
    expect(obj.children).toHaveLength(2);

    const arr = buildTree([1, 2, 3]);
    expect(arr.type).toBe('array');
    expect(arr.childCount).toBe(3);
  });

  it('caps a very wide branch at MAX_CHILDREN and flags truncated', () => {
    const wide = Array.from({ length: MAX_CHILDREN + 500 }, (_, i) => i);
    const node = buildTree(wide);
    expect(node.childCount).toBe(MAX_CHILDREN + 500); // real size preserved
    expect(node.children).toHaveLength(MAX_CHILDREN); // rendered children capped
    expect(node.truncated).toBe(true);
  });

  it('stops recursing past MAX_DEPTH without blowing the stack', () => {
    // Build a chain deeper than MAX_DEPTH.
    let deep: unknown = 'leaf';
    for (let i = 0; i < MAX_DEPTH + 50; i++) deep = { next: deep };
    // Must not throw (RangeError: Maximum call stack) and must mark the cut branch.
    const node = buildTree(deep);
    let cur = node;
    let depth = 0;
    while (cur.children && cur.children[0]) {
      cur = cur.children[0];
      depth++;
      if (depth > MAX_DEPTH + 10) break;
    }
    expect(depth).toBeLessThanOrEqual(MAX_DEPTH);
    expect(cur.truncated).toBe(true);
  });
});

describe('formatJson', () => {
  it('returns strings verbatim and pretty-prints objects', () => {
    expect(formatJson('hi')).toBe('hi');
    expect(formatJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it('never throws on circular structures', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => formatJson(circular)).not.toThrow();
  });
});
