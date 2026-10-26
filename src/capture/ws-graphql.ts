/**
 * GraphQL-over-WebSocket protocol parser.
 *
 * Supports two protocols:
 * 1. graphql-ws (modern): https://github.com/enisdenjo/graphql-ws/blob/master/PROTOCOL.md
 * 2. subscriptions-transport-ws (legacy): https://github.com/apollographql/subscriptions-transport-ws/blob/master/PROTOCOL.md
 *
 * Both protocols use JSON messages with a type field. This parser extracts
 * GraphQL operations and their responses from WebSocket frames.
 */

import type { GraphQLOperationMeta, GraphQLOperationType } from './graphql-detect';
import { parse, type DocumentNode, type OperationDefinitionNode, type FieldNode, Kind } from 'graphql';

// ============================================================================
// Protocol Message Types (for documentation reference)
// ============================================================================

// graphql-ws (modern) uses: connection_init, ping, pong, subscribe, complete (client)
//                          connection_ack, ping, pong, next, error, complete (server)
// subscriptions-transport-ws (legacy) uses: connection_init, start, stop, connection_terminate (client)
//                                          connection_ack, connection_error, connection_keep_alive, data, error, complete (server)

/** Common payload structure for GraphQL operations */
interface GraphQLPayload {
  query?: string;
  operationName?: string;
  variables?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

// ============================================================================
// Parsed Output Types
// ============================================================================

export type WsProtocol = 'graphql-ws' | 'subscriptions-transport-ws' | 'unknown';

export interface WsSubscriptionStart {
  kind: 'subscription-start';
  protocol: WsProtocol;
  id: string;
  query: string;
  operationName?: string;
  variables?: Record<string, unknown>;
  operation?: GraphQLOperationMeta;
}

export interface WsSubscriptionData {
  kind: 'subscription-data';
  protocol: WsProtocol;
  id: string;
  data?: unknown;
  errors?: Array<{ message: string; [key: string]: unknown }>;
  hasErrors: boolean;
}

export interface WsSubscriptionError {
  kind: 'subscription-error';
  protocol: WsProtocol;
  id: string;
  errors: Array<{ message: string; [key: string]: unknown }>;
}

export interface WsSubscriptionComplete {
  kind: 'subscription-complete';
  protocol: WsProtocol;
  id: string;
}

export interface WsConnectionMessage {
  kind: 'connection';
  protocol: WsProtocol;
  messageType: string;
}

export interface WsUnknownMessage {
  kind: 'unknown';
  raw: string;
}

export type ParsedWsMessage =
  | WsSubscriptionStart
  | WsSubscriptionData
  | WsSubscriptionError
  | WsSubscriptionComplete
  | WsConnectionMessage
  | WsUnknownMessage;

// ============================================================================
// Parser Implementation
// ============================================================================

function parseOperationMeta(query: string, operationName?: string): GraphQLOperationMeta | undefined {
  let doc: DocumentNode;
  try {
    doc = parse(query, { noLocation: true });
  } catch {
    return undefined;
  }

  const ops = doc.definitions.filter(
    (d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION,
  );

  // Find the operation by name, or use the first one
  let target = ops[0];
  if (operationName) {
    const named = ops.find((o) => o.name?.value === operationName);
    if (named) target = named;
  }

  if (!target) return undefined;

  const type = target.operation as GraphQLOperationType;
  const name = operationName ?? target.name?.value;
  const rootFields = target.selectionSet.selections
    .filter((s): s is FieldNode => s.kind === Kind.FIELD)
    .map((f) => (f.alias ? `${f.alias.value}: ${f.name.value}` : f.name.value));

  return { type, name, rootFields };
}

function detectProtocol(type: string): WsProtocol {
  // graphql-ws uses: subscribe, next, error, complete
  // subscriptions-transport-ws uses: start, data, error, complete
  if (type === 'subscribe' || type === 'next') return 'graphql-ws';
  if (type === 'start' || type === 'data') return 'subscriptions-transport-ws';
  // Both use these, so we can't distinguish:
  if (type === 'error' || type === 'complete') return 'unknown';
  // Connection messages
  if (type === 'connection_init' || type === 'connection_ack') return 'unknown';
  return 'unknown';
}

/**
 * Parse a WebSocket frame payload into a structured GraphQL message.
 * Returns undefined if the frame is not a text frame or not valid JSON.
 */
export function parseWsFrame(payloadData: string): ParsedWsMessage | undefined {
  if (!payloadData || payloadData.trim() === '') {
    return undefined;
  }

  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(payloadData) as Record<string, unknown>;
  } catch {
    return { kind: 'unknown', raw: payloadData };
  }

  const type = msg.type as string | undefined;
  if (!type) {
    return { kind: 'unknown', raw: payloadData };
  }

  const protocol = detectProtocol(type);

  // Connection-level messages
  if (
    type === 'connection_init' ||
    type === 'connection_ack' ||
    type === 'connection_error' ||
    type === 'connection_keep_alive' ||
    type === 'connection_terminate' ||
    type === 'ping' ||
    type === 'pong'
  ) {
    return { kind: 'connection', protocol, messageType: type };
  }

  const id = msg.id as string | undefined;
  if (!id) {
    return { kind: 'unknown', raw: payloadData };
  }

  // Subscription start (subscribe / start)
  if (type === 'subscribe' || type === 'start') {
    const payload = msg.payload as GraphQLPayload | undefined;
    if (!payload?.query) {
      return { kind: 'unknown', raw: payloadData };
    }
    return {
      kind: 'subscription-start',
      protocol: type === 'subscribe' ? 'graphql-ws' : 'subscriptions-transport-ws',
      id,
      query: payload.query,
      operationName: payload.operationName,
      variables: payload.variables,
      operation: parseOperationMeta(payload.query, payload.operationName),
    };
  }

  // Subscription data (next / data)
  if (type === 'next' || type === 'data') {
    const payload = msg.payload as { data?: unknown; errors?: Array<{ message: string }> } | undefined;
    const errors = payload?.errors;
    return {
      kind: 'subscription-data',
      protocol: type === 'next' ? 'graphql-ws' : 'subscriptions-transport-ws',
      id,
      data: payload?.data,
      errors,
      hasErrors: Array.isArray(errors) && errors.length > 0,
    };
  }

  // Subscription error
  if (type === 'error') {
    const payload = msg.payload;
    // graphql-ws: payload is array of errors
    // subscriptions-transport-ws: payload is single error object
    const errors = Array.isArray(payload)
      ? (payload as Array<{ message: string }>)
      : payload
        ? [payload as { message: string }]
        : [{ message: 'Unknown error' }];
    return {
      kind: 'subscription-error',
      protocol,
      id,
      errors,
    };
  }

  // Subscription complete
  if (type === 'complete') {
    return {
      kind: 'subscription-complete',
      protocol,
      id,
    };
  }

  return { kind: 'unknown', raw: payloadData };
}

/**
 * Check if a URL looks like a GraphQL WebSocket endpoint.
 * Common patterns: /graphql, /subscriptions, /ws, wss://
 */
export function isGraphQLWebSocketUrl(url: string): boolean {
  const lower = url.toLowerCase();
  // Must be a WebSocket URL
  if (!lower.startsWith('ws://') && !lower.startsWith('wss://')) {
    return false;
  }
  // Common GraphQL WS endpoint patterns
  return (
    lower.includes('/graphql') ||
    lower.includes('/subscriptions') ||
    lower.includes('/gql') ||
    lower.includes('graphql') // domain or path contains graphql
  );
}

/**
 * Determine if a frame is likely GraphQL based on its content.
 * Returns true if it looks like a graphql-ws or subscriptions-transport-ws message.
 */
export function isGraphQLWsFrame(payloadData: string): boolean {
  const parsed = parseWsFrame(payloadData);
  if (!parsed) return false;
  if (parsed.kind === 'unknown') return false;
  return true;
}
