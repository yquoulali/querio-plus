import { describe, it, expect } from 'vitest';
import { buildDiff, summarizeDiff, getChangedPaths } from '../src/features/diff';

describe('buildDiff', () => {
  it('returns unchanged for identical primitives', () => {
    expect(buildDiff(42, 42)).toMatchObject({ type: 'unchanged' });
    expect(buildDiff('hello', 'hello')).toMatchObject({ type: 'unchanged' });
    expect(buildDiff(true, true)).toMatchObject({ type: 'unchanged' });
    expect(buildDiff(null, null)).toMatchObject({ type: 'unchanged' });
  });

  it('returns changed for different primitives', () => {
    const diff = buildDiff(1, 2);
    expect(diff.type).toBe('changed');
    expect(diff.left).toBe(1);
    expect(diff.right).toBe(2);
  });

  it('returns changed for type mismatch', () => {
    const diff = buildDiff(42, '42');
    expect(diff.type).toBe('changed');
    expect(diff.left).toBe(42);
    expect(diff.right).toBe('42');
  });

  it('detects added in object', () => {
    const diff = buildDiff({ a: 1 }, { a: 1, b: 2 });
    expect(diff.isContainer).toBe(true);
    expect(diff.children).toHaveLength(2);
    
    const addedChild = diff.children?.find(c => c.key === 'b');
    expect(addedChild?.type).toBe('added');
    expect(addedChild?.right).toBe(2);
  });

  it('detects removed from object', () => {
    const diff = buildDiff({ a: 1, b: 2 }, { a: 1 });
    expect(diff.isContainer).toBe(true);
    
    const removedChild = diff.children?.find(c => c.key === 'b');
    expect(removedChild?.type).toBe('removed');
    expect(removedChild?.left).toBe(2);
  });

  it('detects changed in object', () => {
    const diff = buildDiff({ a: 1 }, { a: 2 });
    expect(diff.isContainer).toBe(true);
    
    const changedChild = diff.children?.find(c => c.key === 'a');
    expect(changedChild?.type).toBe('changed');
    expect(changedChild?.left).toBe(1);
    expect(changedChild?.right).toBe(2);
  });

  it('handles deeply nested objects', () => {
    const left = { user: { profile: { name: 'Alice', age: 30 } } };
    const right = { user: { profile: { name: 'Alice', age: 31 } } };
    
    const diff = buildDiff(left, right);
    expect(diff.changeCount).toBe(1);
    
    const paths = getChangedPaths(diff);
    expect(paths).toHaveLength(1);
    expect(paths[0].path).toBe('$.user.profile.age');
    expect(paths[0].type).toBe('changed');
  });

  it('handles identical objects as unchanged', () => {
    const obj = { a: 1, b: { c: 2, d: [1, 2, 3] } };
    const diff = buildDiff(obj, obj);
    expect(diff.type).toBe('unchanged');
    expect(diff.changeCount).toBe(0);
  });

  it('handles arrays - unchanged', () => {
    const diff = buildDiff([1, 2, 3], [1, 2, 3]);
    expect(diff.type).toBe('unchanged');
    expect(diff.changeCount).toBe(0);
  });

  it('handles arrays - element changed', () => {
    const diff = buildDiff([1, 2, 3], [1, 99, 3]);
    expect(diff.isContainer).toBe(true);
    expect(diff.containerType).toBe('array');
    expect(diff.changeCount).toBe(1);
    
    const changedIdx = diff.children?.find(c => c.key === '1');
    expect(changedIdx?.type).toBe('changed');
    expect(changedIdx?.left).toBe(2);
    expect(changedIdx?.right).toBe(99);
  });

  it('handles arrays - length increased', () => {
    const diff = buildDiff([1, 2], [1, 2, 3]);
    expect(diff.changeCount).toBe(1);
    
    const added = diff.children?.find(c => c.key === '2');
    expect(added?.type).toBe('added');
    expect(added?.right).toBe(3);
  });

  it('handles arrays - length decreased', () => {
    const diff = buildDiff([1, 2, 3], [1, 2]);
    expect(diff.changeCount).toBe(1);
    
    const removed = diff.children?.find(c => c.key === '2');
    expect(removed?.type).toBe('removed');
    expect(removed?.left).toBe(3);
  });

  it('handles null vs object', () => {
    const diff = buildDiff(null, { a: 1 });
    expect(diff.type).toBe('changed');
  });

  it('handles object vs null', () => {
    const diff = buildDiff({ a: 1 }, null);
    expect(diff.type).toBe('changed');
  });

  it('handles complex GraphQL-like responses', () => {
    const left = {
      data: {
        user: {
          id: '123',
          name: 'Alice',
          posts: [
            { id: '1', title: 'First post' },
            { id: '2', title: 'Second post' },
          ],
        },
      },
      errors: null,
    };
    
    const right = {
      data: {
        user: {
          id: '123',
          name: 'Alice',
          posts: [
            { id: '1', title: 'First post (updated)' },
            { id: '2', title: 'Second post' },
            { id: '3', title: 'Third post' },
          ],
        },
      },
      errors: null,
    };
    
    const diff = buildDiff(left, right);
    expect(diff.changeCount).toBe(2); // title changed + new post added
    
    const paths = getChangedPaths(diff);
    expect(paths).toHaveLength(2);
    expect(paths.map(p => p.path)).toContain('$.data.user.posts[0].title');
  });
});

describe('summarizeDiff', () => {
  it('counts leaf changes correctly', () => {
    const diff = buildDiff(
      { a: 1, b: 2, c: 3 },
      { a: 1, b: 99, d: 4 },
    );
    const summary = summarizeDiff(diff);
    expect(summary.unchanged).toBe(1); // a
    expect(summary.changed).toBe(1);   // b
    expect(summary.removed).toBe(1);   // c
    expect(summary.added).toBe(1);     // d
  });

  it('returns all zeros for identical values', () => {
    const diff = buildDiff({ x: [1, 2] }, { x: [1, 2] });
    const summary = summarizeDiff(diff);
    expect(summary.added).toBe(0);
    expect(summary.removed).toBe(0);
    expect(summary.changed).toBe(0);
  });
});

describe('getChangedPaths', () => {
  it('returns empty array for identical values', () => {
    const diff = buildDiff({ a: 1 }, { a: 1 });
    expect(getChangedPaths(diff)).toEqual([]);
  });

  it('returns all changed paths with types', () => {
    const diff = buildDiff(
      { a: 1, b: 2, c: 3 },
      { a: 1, b: 99, d: 4 },
    );
    const paths = getChangedPaths(diff);
    
    expect(paths).toContainEqual({ path: '$.b', type: 'changed' });
    expect(paths).toContainEqual({ path: '$.c', type: 'removed' });
    expect(paths).toContainEqual({ path: '$.d', type: 'added' });
    expect(paths).not.toContainEqual(expect.objectContaining({ path: '$.a' }));
  });

  it('includes nested paths', () => {
    const diff = buildDiff(
      { outer: { inner: 1 } },
      { outer: { inner: 2 } },
    );
    const paths = getChangedPaths(diff);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toEqual({ path: '$.outer.inner', type: 'changed' });
  });
});
