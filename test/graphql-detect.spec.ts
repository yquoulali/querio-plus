import { describe, it, expect } from 'vitest';
import { detectGraphQL, type DetectableRequest } from '../src/capture/graphql-detect';

const jsonHeaders = [{ name: 'Content-Type', value: 'application/json' }];
const formHeaders = [
  { name: 'content-type', value: 'application/x-www-form-urlencoded; charset=utf-8' },
];

function post(body: unknown, headers = jsonHeaders): DetectableRequest {
  return { method: 'POST', headers, parsedBody: body };
}

describe('detectGraphQL', () => {
  it('1. JSON POST query -> isGraphQL, type query, name from AST, rootFields, reason', () => {
    const d = detectGraphQL(post({ query: 'query Q { me { id } }' }));
    expect(d.isGraphQL).toBe(true);
    expect(d.operation?.type).toBe('query');
    expect(d.operation?.name).toBe('Q');
    expect(d.operation?.rootFields).toEqual(['me']);
    expect(d.reason).toBe('json-post-query');
  });

  it('2. JSON POST mutation -> type mutation', () => {
    const d = detectGraphQL(post({ query: 'mutation M { doIt }' }));
    expect(d.operation?.type).toBe('mutation');
  });

  it('3. JSON POST subscription -> type subscription', () => {
    const d = detectGraphQL(post({ query: 'subscription S { onEvent }' }));
    expect(d.operation?.type).toBe('subscription');
  });

  it('4. JSON POST array (batch) -> isGraphQL, isBatch, reason json-post-batch', () => {
    const d = detectGraphQL(
      post([{ query: 'query A { a }' }, { query: 'query B { b }' }]),
    );
    expect(d.isGraphQL).toBe(true);
    expect(d.isBatch).toBe(true);
    expect(d.reason).toBe('json-post-batch');
    expect(d.operation?.name).toBe('A');
  });

  it('5. JSON GET with ?query -> isGraphQL, reason json-get-query', () => {
    const d = detectGraphQL({
      method: 'GET',
      headers: jsonHeaders,
      queryParams: [{ name: 'query', value: 'query Q { me { id } }' }],
    });
    expect(d.isGraphQL).toBe(true);
    expect(d.reason).toBe('json-get-query');
  });

  it('6. form-urlencoded with query param -> reason form-urlencoded-query', () => {
    const d = detectGraphQL({
      method: 'POST',
      headers: formHeaders,
      formParams: [{ name: 'query', value: 'query Q { me { id } }' }],
    });
    expect(d.isGraphQL).toBe(true);
    expect(d.reason).toBe('form-urlencoded-query');
  });

  it('7. JSON POST without query field -> not graphql, reason no-query-field', () => {
    const d = detectGraphQL(post({ data: { foo: 1 } }));
    expect(d.isGraphQL).toBe(false);
    expect(d.reason).toBe('no-query-field');
  });

  it('8. JSON POST invalid graphql -> not graphql, reason invalid-graphql', () => {
    const d = detectGraphQL(post({ query: 'this is not graphql {{{' }));
    expect(d.isGraphQL).toBe(false);
    expect(d.reason).toBe('invalid-graphql');
  });

  it('9. text/plain content-type -> not graphql, reason not-json-content-type', () => {
    const d = detectGraphQL({
      method: 'POST',
      headers: [{ name: 'content-type', value: 'text/plain' }],
      parsedBody: { query: 'query Q { me }' },
    });
    expect(d.isGraphQL).toBe(false);
    expect(d.reason).toBe('not-json-content-type');
  });

  it('10. malformed JSON body (bodyText only) -> not graphql, reason invalid-json, no throw', () => {
    const d = detectGraphQL({ method: 'POST', headers: jsonHeaders, bodyText: '{bad json' });
    expect(d.isGraphQL).toBe(false);
    expect(d.reason).toBe('invalid-json');
  });

  it('11. (Querio+ improvement) anonymous query -> name falls back to first root field', () => {
    const d = detectGraphQL(post({ query: '{ me { id } }' }));
    expect(d.isGraphQL).toBe(true);
    expect(d.operation?.name).toBe('me'); // Querio would yield undefined; Querio+ adds the label
  });

  it('12. aliased field -> rootFields keep the alias form', () => {
    const d = detectGraphQL(post({ query: '{ viewer: me { id } }' }));
    expect(d.operation?.rootFields).toEqual(['viewer: me']);
  });

  it('13. transport operationName wins over the AST definition name', () => {
    const d = detectGraphQL(post({ operationName: 'A', query: 'query B { me { id } }' }));
    expect(d.operation?.name).toBe('A');
  });

  it('14. GET value is read verbatim (already decoded by caller)', () => {
    const d = detectGraphQL({
      method: 'GET',
      headers: jsonHeaders,
      queryParams: [{ name: 'query', value: '{ me { id } }' }],
    });
    expect(d.isGraphQL).toBe(true);
    expect(d.reason).toBe('json-get-query');
  });
});

describe('detectGraphQL GET without Content-Type', () => {
  it('detects a GET ?query= even though browsers send no Content-Type on GET', () => {
    const d = detectGraphQL({
      method: 'GET',
      headers: [],
      queryParams: [{ name: 'query', value: 'query Q { me }' }],
    });
    expect(d.isGraphQL).toBe(true);
    expect(d.operation?.name).toBe('Q');
  });
});
