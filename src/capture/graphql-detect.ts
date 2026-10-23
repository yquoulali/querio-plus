import {
  Kind,
  parse,
  type DefinitionNode,
  type DocumentNode,
  type FieldNode,
  type InlineFragmentNode,
  type OperationDefinitionNode,
  type SelectionNode,
} from 'graphql';
import { isContentType, getParamValue } from './content-type';

export type GraphQLOperationType = 'query' | 'mutation' | 'subscription';

export interface GraphQLOperationMeta {
  /**
   * Operation name, resolved in this precedence:
   *   1. the request's transport-level `operationName` field, when supplied and non-empty;
   *   2. else the named operation definition in the parsed query AST (OperationDefinition.name.value);
   *   3. else the first root field name;
   *   4. else undefined.
   *
   * Steps 1-2 MATCH Querio exactly (reference resolves `operationName || name`, where `name`
   * is the AST operation-definition name only; anonymous ops are therefore `undefined`).
   * Step 3 (first root field for an anonymous op) is a DECLARED Querio+ improvement, not parity.
   */
  name: string | undefined;
  type: GraphQLOperationType;
  /** root field / selection names of the first operation definition */
  rootFields: string[];
}

export interface DetectableRequest {
  method: string;
  headers: ReadonlyArray<{ name: string; value: string }>;
  /** URL query params, ALREADY DECODED by the caller. detectGraphQL reads verbatim. */
  queryParams?: ReadonlyArray<{ name: string; value: string }>;
  /** raw request body text (POST) */
  bodyText?: string;
  /**
   * Body already JSON-parsed by the caller (parse-entry.ts). When present, detectGraphQL
   * uses it and does NOT call JSON.parse again — the single-parse invariant.
   */
  parsedBody?: unknown;
  /** form params when content-type is x-www-form-urlencoded (already decoded by caller) */
  formParams?: ReadonlyArray<{ name: string; value: string }>;
  /** transport-level operationName sibling of query; second-precedence name source */
  operationName?: string;
}

export type DetectReason =
  | 'json-get-query'
  | 'json-post-query'
  | 'json-post-batch'
  | 'form-urlencoded-query'
  | 'not-json-content-type'
  | 'no-query-field'
  | 'invalid-json'
  | 'invalid-graphql'
  | 'empty';

export interface GraphQLDetection {
  isGraphQL: boolean;
  operation?: GraphQLOperationMeta;
  /** true when the POST body is a JSON array (batch) */
  isBatch?: boolean;
  reason: DetectReason;
}

function isOperationDefinition(node: DefinitionNode): node is OperationDefinitionNode {
  return node.kind === Kind.OPERATION_DEFINITION;
}

function isField(node: SelectionNode): node is FieldNode {
  return node.kind === Kind.FIELD;
}

function isInlineFragment(node: SelectionNode): node is InlineFragmentNode {
  return node.kind === Kind.INLINE_FRAGMENT;
}

function selectionName(node: SelectionNode): string {
  if (isInlineFragment(node) && node.typeCondition)
    return `InlineFragment if ${node.typeCondition.name.value}`;
  if (isField(node))
    return node.alias ? `${node.alias.value}: ${node.name.value}` : node.name.value;
  return 'Anonymous';
}

function parseQuery(query: string): DocumentNode | undefined {
  try {
    return parse(query, { noLocation: true });
  } catch {
    return undefined;
  }
}

function buildMeta(
  doc: DocumentNode,
  transportOperationName: string | undefined,
): GraphQLOperationMeta {
  const first = doc.definitions.find(isOperationDefinition);
  const type: GraphQLOperationType = (first?.operation ?? 'query') as GraphQLOperationType;
  const rootFields = first
    ? first.selectionSet.selections.map(selectionName)
    : [];
  // name precedence: transport operationName -> AST definition name -> first root field -> undefined
  const astName = first?.name?.value;
  const name =
    (transportOperationName && transportOperationName.length > 0
      ? transportOperationName
      : undefined) ??
    astName ??
    rootFields[0] ??
    undefined;
  return { name, type, rootFields };
}

function result(
  reason: DetectReason,
  query?: string,
  transportOperationName?: string,
  isBatch?: boolean,
): GraphQLDetection {
  if (!query) return { isGraphQL: false, reason };
  const doc = parseQuery(query);
  if (!doc) return { isGraphQL: false, reason: 'invalid-graphql' };
  return {
    isGraphQL: true,
    operation: buildMeta(doc, transportOperationName),
    isBatch,
    reason,
  };
}

/**
 * Detect whether a request carries a GraphQL operation (RE §4). Pure: no chrome APIs,
 * no getContent, no network. Never throws. Extraction depends on content-type/method:
 *   - application/json + GET  -> queryParams.query
 *   - application/json + POST -> parsedBody (if supplied) else JSON.parse(bodyText);
 *                                array -> [0].query (isBatch), else .query
 *   - x-www-form-urlencoded   -> formParams.query
 * isGraphQL is true iff a non-empty query exists AND graphql.parse(query,{noLocation})
 * does not throw.
 */
export function detectGraphQL(request: DetectableRequest): GraphQLDetection {
  const { method, headers } = request;

  // Browsers send no Content-Type on a GET, so GET detection must not depend on it.
  if (method === 'GET') {
    const query = getParamValue('query', request.queryParams);
    if (!query) {
      return {
        isGraphQL: false,
        reason: isContentType(headers, 'application/json')
          ? 'no-query-field'
          : 'not-json-content-type',
      };
    }
    const opName =
      request.operationName ?? getParamValue('operationName', request.queryParams);
    return result('json-get-query', query, opName);
  }

  if (isContentType(headers, 'application/json')) {
    if (method === 'POST') {
      let parsed: unknown = request.parsedBody;
      if (parsed === undefined) {
        if (request.bodyText === undefined) return { isGraphQL: false, reason: 'empty' };
        try {
          parsed = JSON.parse(request.bodyText);
        } catch {
          return { isGraphQL: false, reason: 'invalid-json' };
        }
      }

      if (Array.isArray(parsed)) {
        const first = parsed[0] as { query?: string; operationName?: string } | undefined;
        if (!first || typeof first.query !== 'string')
          return { isGraphQL: false, reason: 'no-query-field' };
        return result('json-post-batch', first.query, first.operationName, true);
      }

      const body = parsed as { query?: unknown; operationName?: unknown } | null;
      const query = body && typeof body.query === 'string' ? body.query : undefined;
      if (!query) return { isGraphQL: false, reason: 'no-query-field' };
      const opName =
        request.operationName ??
        (body && typeof body.operationName === 'string' ? body.operationName : undefined);
      return result('json-post-query', query, opName);
    }

    return { isGraphQL: false, reason: 'no-query-field' };
  }

  if (isContentType(headers, 'application/x-www-form-urlencoded')) {
    const query = getParamValue('query', request.formParams);
    if (!query) return { isGraphQL: false, reason: 'no-query-field' };
    const opName =
      request.operationName ?? getParamValue('operationName', request.formParams);
    return result('form-urlencoded-query', query, opName);
  }

  return { isGraphQL: false, reason: 'not-json-content-type' };
}
