import { describe, it, expect } from 'vitest';
import { splitBatch, type BatchInputOperation } from '../src/capture/batch-split';

describe('splitBatch', () => {
  it('1. single object -> length 1, count 1, isBatch false, responseFor identity', () => {
    const [op] = splitBatch({ query: 'query Q { me }' });
    expect(op.length).toBe(1);
    expect(op.count).toBe(1);
    expect(op.isBatch).toBe(false);
    expect(op.correlation).toBe('position');
    const r = { data: { me: 1 } };
    expect(op.responseFor(r)).toBe(r);
  });

  it('2. array of 3 named ops -> counts 1/2/3, length 3, identity', () => {
    const input: BatchInputOperation[] = [
      { query: 'query A { a }', operationName: 'A' },
      { query: 'query B { b }', operationName: 'B' },
      { query: 'query C { c }', operationName: 'C' },
    ];
    const ops = splitBatch(input);
    expect(ops.map((o) => o.count)).toEqual([1, 2, 3]);
    expect(ops.every((o) => o.length === 3 && o.isBatch)).toBe(true);
    expect(ops.every((o) => o.correlation === 'identity')).toBe(true);
  });

  it('3. responseFor positional for anonymous batch of 2', () => {
    const ops = splitBatch([{ query: '{ a }' }, { query: '{ b }' }]);
    expect(ops[0].responseFor(['a', 'b'])).toBe('a');
    expect(ops[1].responseFor(['a', 'b'])).toBe('b');
  });

  it('4. responseFor identity probe (a): reordered response matched by operationName', () => {
    const ops = splitBatch([
      { query: 'query A { a }', operationName: 'A' },
      { query: 'query B { b }', operationName: 'B' },
    ]);
    const response = [
      { operationName: 'B', data: { b: 2 } },
      { operationName: 'A', data: { a: 1 } },
    ];
    expect(ops[0].responseFor(response)).toEqual({ operationName: 'A', data: { a: 1 } });
  });

  it('4b. responseFor identity probe (b): single-key data reordered + skip variant', () => {
    const ops = splitBatch([
      { query: 'query A { a }', operationName: 'A', rootFields: ['a'] },
      { query: 'query B { b }', operationName: 'B', rootFields: ['b'] },
    ]);
    const response = [{ data: { b: 2 } }, { data: { a: 1 } }];
    expect(ops[0].responseFor(response)).toEqual({ data: { a: 1 } });

    // variant: rootFields omitted -> probe (b) skipped -> positional fallback
    const noFields = splitBatch([
      { query: 'query A { a }', operationName: 'A' },
      { query: 'query B { b }', operationName: 'B' },
    ]);
    expect(noFields[0].responseFor(response)).toEqual({ data: { b: 2 } }); // full[0]
  });

  it('4c. responseFor identity fallback to positional; correlation stays identity', () => {
    const ops = splitBatch([
      { query: 'query A { a b }', operationName: 'A', rootFields: ['a', 'b'] },
      { query: 'query B { c d }', operationName: 'B', rootFields: ['c', 'd'] },
    ]);
    // responses expose neither operationName nor a matchable single-key data
    const response = [{ data: { x: 1, y: 2 } }, { data: { z: 3, w: 4 } }];
    expect(ops[0].responseFor(response)).toEqual({ data: { x: 1, y: 2 } }); // full[0]
    expect(ops[0].correlation).toBe('identity');
  });

  it('5. variables as JSON string -> normalized to object', () => {
    const [op] = splitBatch({ query: '{ a }', variables: '{"id":1}' });
    expect(op.variables).toEqual({ id: 1 });
  });

  it('6. variables as malformed string -> kept raw, no throw', () => {
    const [op] = splitBatch({ query: '{ a }', variables: '{bad' });
    expect(op.variables).toBe('{bad');
  });

  it('7. duplicate operationName in a batch -> correlation position', () => {
    const ops = splitBatch([
      { query: 'query A { a }', operationName: 'DUP' },
      { query: 'query B { b }', operationName: 'DUP' },
    ]);
    expect(ops.every((o) => o.correlation === 'position')).toBe(true);
  });

  it('8. non-array response for an array request -> index 0 object, index 1 undefined', () => {
    const ops = splitBatch([{ query: '{ a }' }, { query: '{ b }' }]);
    const r = { data: { a: 1 } };
    expect(ops[0].responseFor(r)).toBe(r);
    expect(ops[1].responseFor(r)).toBeUndefined();
  });

  it('9. mixed named/anonymous batch -> correlation position', () => {
    const ops = splitBatch([
      { query: 'query A { a }', operationName: 'A' },
      { query: '{ b }' },
    ]);
    expect(ops.every((o) => o.correlation === 'position')).toBe(true);
  });
});
