/**
 * WebSocket capture integration for the panel.
 *
 * Connects to the background service worker to receive WebSocket frames
 * and converts them into CapturedEntry objects for the store.
 */

import type { CapturedEntry, ErrorState } from '../types';
import type { GraphQLOperationMeta } from './graphql-detect';
import {
  parseWsFrame,
  isGraphQLWebSocketUrl,
  type WsSubscriptionStart,
  type WsSubscriptionData,
  type WsSubscriptionError,
  type WsProtocol,
} from './ws-graphql';

// ============================================================================
// Types for background script messages
// ============================================================================

interface WsFrameMessage {
  type: 'ws-frame';
  tabId: number;
  requestId: string;
  timestamp: number;
  direction: 'sent' | 'received';
  opcode: number;
  mask: boolean;
  payloadData: string;
  url?: string;
}

interface WsCreatedMessage {
  type: 'ws-created';
  tabId: number;
  requestId: string;
  url: string;
}

interface WsClosedMessage {
  type: 'ws-closed';
  tabId: number;
  requestId: string;
  timestamp: number;
}

type BackgroundMessage = WsFrameMessage | WsCreatedMessage | WsClosedMessage;

// ============================================================================
// Subscription State Tracking
// ============================================================================

interface ActiveSubscription {
  id: string; // GraphQL operation id (from the protocol message)
  requestId: string; // WebSocket connection id (from Chrome debugger)
  url: string;
  protocol: WsProtocol;
  query: string;
  operationName?: string;
  variables?: Record<string, unknown>;
  operation?: GraphQLOperationMeta;
  startTime: number;
  /** Messages received for this subscription */
  messageCount: number;
  /** Last received data (for display in detail view) */
  lastData?: unknown;
  /** Accumulated errors */
  errors: Array<{ message: string; [key: string]: unknown }>;
  /** Whether subscription is still active */
  active: boolean;
}

// Track active subscriptions by their protocol-level id
const activeSubscriptions = new Map<string, ActiveSubscription>();
// Track WebSocket URLs by requestId
const wsConnections = new Map<string, string>();
// Track which tabs we're monitoring
let monitoredTabId: number | undefined;
// Callback for new entries
let onEntryCallback: ((entry: CapturedEntry) => void) | undefined;
// Callback for entry updates
let onUpdateCallback: ((id: string, update: Partial<CapturedEntry>) => void) | undefined;

// ============================================================================
// Public API
// ============================================================================

/**
 * Start capturing WebSocket traffic for the given tab.
 * Returns true if capture was started, false if already running or failed.
 */
export async function startWsCapture(tabId: number): Promise<boolean> {
  if (monitoredTabId === tabId) {
    return true; // Already monitoring this tab
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'ws-attach',
      tabId,
    }) as { success: boolean; error?: string };

    if (!response.success) {
      console.warn('Failed to attach WebSocket debugger:', response.error);
      return false;
    }

    monitoredTabId = tabId;
    return true;
  } catch (err) {
    console.warn('Failed to start WebSocket capture:', err);
    return false;
  }
}

/**
 * Stop capturing WebSocket traffic.
 */
export async function stopWsCapture(): Promise<void> {
  if (monitoredTabId === undefined) return;

  try {
    await chrome.runtime.sendMessage({
      type: 'ws-detach',
      tabId: monitoredTabId,
    });
  } catch {
    // Ignore errors on detach
  }

  monitoredTabId = undefined;
  activeSubscriptions.clear();
  wsConnections.clear();
}

/**
 * Register callbacks for WebSocket-captured entries.
 */
export function setWsCaptureCallbacks(
  onEntry: (entry: CapturedEntry) => void,
  onUpdate: (id: string, update: Partial<CapturedEntry>) => void,
): void {
  onEntryCallback = onEntry;
  onUpdateCallback = onUpdate;
}

/**
 * Clear WebSocket capture state (e.g., on navigation).
 */
export function clearWsState(): void {
  activeSubscriptions.clear();
  wsConnections.clear();
}

/**
 * Get the currently monitored tab ID.
 */
export function getMonitoredTabId(): number | undefined {
  return monitoredTabId;
}

// ============================================================================
// Message Handler
// ============================================================================

function handleBackgroundMessage(message: BackgroundMessage): void {
  // Only process messages for our monitored tab
  if (message.tabId !== monitoredTabId) return;

  switch (message.type) {
    case 'ws-created':
      handleWsCreated(message);
      break;
    case 'ws-frame':
      handleWsFrame(message);
      break;
    case 'ws-closed':
      handleWsClosed(message);
      break;
  }
}

function handleWsCreated(msg: WsCreatedMessage): void {
  wsConnections.set(msg.requestId, msg.url);
}

function handleWsFrame(msg: WsFrameMessage): void {
  // Only process text frames (opcode 1)
  if (msg.opcode !== 1) return;

  const url = msg.url ?? wsConnections.get(msg.requestId) ?? '';

  // Skip non-GraphQL WebSockets unless they send GraphQL-looking messages
  if (!isGraphQLWebSocketUrl(url)) {
    // Still parse to check if it's a GraphQL message
    const parsed = parseWsFrame(msg.payloadData);
    if (!parsed || parsed.kind === 'unknown' || parsed.kind === 'connection') {
      return;
    }
  }

  const parsed = parseWsFrame(msg.payloadData);
  if (!parsed) return;

  // Handle different message types
  switch (parsed.kind) {
    case 'subscription-start':
      handleSubscriptionStart(parsed, msg, url);
      break;
    case 'subscription-data':
      handleSubscriptionData(parsed, msg);
      break;
    case 'subscription-error':
      handleSubscriptionError(parsed);
      break;
    case 'subscription-complete':
      handleSubscriptionComplete(parsed);
      break;
    // Ignore connection messages and unknown
  }
}

function handleWsClosed(msg: WsClosedMessage): void {
  wsConnections.delete(msg.requestId);

  // Mark all subscriptions on this connection as complete
  for (const [, sub] of activeSubscriptions) {
    if (sub.requestId === msg.requestId && sub.active) {
      sub.active = false;
      // Update the entry to show it's complete
      const entryId = makeEntryId(sub.id, sub.requestId);
      onUpdateCallback?.(entryId, {
        errorState: sub.errors.length > 0 ? 'error' : 'ok',
      });
    }
  }
}

// ============================================================================
// Subscription Handlers
// ============================================================================

function makeEntryId(subscriptionId: string, requestId: string): string {
  return `ws-${requestId}-${subscriptionId}`;
}

function handleSubscriptionStart(
  parsed: WsSubscriptionStart,
  msg: WsFrameMessage,
  url: string,
): void {
  const subKey = `${msg.requestId}-${parsed.id}`;

  const subscription: ActiveSubscription = {
    id: parsed.id,
    requestId: msg.requestId,
    url,
    protocol: parsed.protocol,
    query: parsed.query,
    operationName: parsed.operationName,
    variables: parsed.variables,
    operation: parsed.operation,
    startTime: msg.timestamp,
    messageCount: 0,
    errors: [],
    active: true,
  };

  activeSubscriptions.set(subKey, subscription);

  // Create an entry for the store
  const entry = createSubscriptionEntry(subscription);
  onEntryCallback?.(entry);
}

function handleSubscriptionData(
  parsed: WsSubscriptionData,
  msg: WsFrameMessage,
): void {
  const subKey = `${msg.requestId}-${parsed.id}`;
  const subscription = activeSubscriptions.get(subKey);

  if (!subscription) {
    // Data for unknown subscription - might have started before we attached
    return;
  }

  subscription.messageCount++;
  subscription.lastData = parsed.data;

  if (parsed.hasErrors && parsed.errors) {
    subscription.errors.push(...parsed.errors);
  }

  // Update the entry with new data
  const entryId = makeEntryId(subscription.id, subscription.requestId);
  const update: Partial<CapturedEntry> = {
    responseBody: {
      messageCount: subscription.messageCount,
      lastData: subscription.lastData,
      errors: subscription.errors.length > 0 ? subscription.errors : undefined,
    },
    errorState: subscription.errors.length > 0 ? 'error' : 'ok',
    errorCount: subscription.errors.length > 0 ? subscription.errors.length : undefined,
    // Update time to reflect latest message
    time: (msg.timestamp - subscription.startTime) * 1000, // Convert to ms
  };

  onUpdateCallback?.(entryId, update);
}

function handleSubscriptionError(parsed: WsSubscriptionError): void {
  // Find the subscription by iterating (we don't have requestId in the error)
  for (const [, subscription] of activeSubscriptions) {
    if (subscription.id === parsed.id && subscription.active) {
      subscription.errors.push(...parsed.errors);
      subscription.active = false;

      const entryId = makeEntryId(subscription.id, subscription.requestId);
      onUpdateCallback?.(entryId, {
        errorState: 'error',
        errorCount: subscription.errors.length,
        responseBody: {
          messageCount: subscription.messageCount,
          lastData: subscription.lastData,
          errors: subscription.errors,
        },
      });
      break;
    }
  }
}

function handleSubscriptionComplete(parsed: { id: string }): void {
  for (const [, subscription] of activeSubscriptions) {
    if (subscription.id === parsed.id && subscription.active) {
      subscription.active = false;

      const entryId = makeEntryId(subscription.id, subscription.requestId);
      onUpdateCallback?.(entryId, {
        errorState: subscription.errors.length > 0 ? 'error' : 'ok',
      });
      break;
    }
  }
}

// ============================================================================
// Entry Creation
// ============================================================================

function createSubscriptionEntry(sub: ActiveSubscription): CapturedEntry {
  const name =
    sub.operation?.name ??
    sub.operationName ??
    sub.operation?.rootFields?.[0] ??
    'Subscription';

  const entry: CapturedEntry = {
    id: makeEntryId(sub.id, sub.requestId),
    kind: 'graphql',
    method: 'WS', // Special method to indicate WebSocket
    url: sub.url,
    name,
    requestHeaders: [],
    requestMimeType: 'application/json',
    requestBody: JSON.stringify({
      query: sub.query,
      operationName: sub.operationName,
      variables: sub.variables,
    }),
    operation: sub.operation ?? {
      type: 'subscription',
      name: sub.operationName,
      rootFields: [],
    },
    query: sub.query,
    variables: sub.variables,
    operationName: sub.operationName,
    status: 101, // WebSocket upgrade status
    statusText: 'Switching Protocols',
    mimeType: 'application/json',
    time: 0,
    size: undefined,
    errorState: 'pending' as ErrorState,
    getResponseBody: async () => ({
      messageCount: sub.messageCount,
      lastData: sub.lastData,
      errors: sub.errors.length > 0 ? sub.errors : undefined,
    }),
  };

  return entry;
}

// ============================================================================
// Initialize Message Listener
// ============================================================================

// Listen for messages from the background script
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message: BackgroundMessage) => {
    // Check if this is a WebSocket message from our background script
    if (message.type === 'ws-frame' || message.type === 'ws-created' || message.type === 'ws-closed') {
      handleBackgroundMessage(message);
    }
    return false; // No async response needed
  });
}
