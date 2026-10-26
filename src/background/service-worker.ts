/**
 * Background service worker for WebSocket capture.
 *
 * The devtools panel cannot directly use chrome.debugger, so this background
 * script attaches to inspected tabs and forwards WebSocket frames to the panel.
 *
 * Architecture:
 * 1. Panel sends 'ws-attach' message with tabId when it opens
 * 2. Service worker attaches debugger to the tab and enables Network domain
 * 3. Service worker listens for webSocketFrameReceived/webSocketFrameSent events
 * 4. Frames are forwarded to the panel via chrome.runtime.sendMessage
 * 5. Panel sends 'ws-detach' when it closes
 */

interface AttachRequest {
  type: 'ws-attach';
  tabId: number;
}

interface DetachRequest {
  type: 'ws-detach';
  tabId: number;
}

interface WebSocketFrame {
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

interface WebSocketCreated {
  type: 'ws-created';
  tabId: number;
  requestId: string;
  url: string;
  initiator?: {
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
}

interface WebSocketClosed {
  type: 'ws-closed';
  tabId: number;
  requestId: string;
  timestamp: number;
}

type Message = AttachRequest | DetachRequest;
type OutboundMessage = WebSocketFrame | WebSocketCreated | WebSocketClosed;

// Track which tabs have debugger attached
const attachedTabs = new Set<number>();
// Track WebSocket URLs by requestId for each tab
const wsUrls = new Map<number, Map<string, string>>();

// Handle messages from the panel
chrome.runtime.onMessage.addListener(
  (
    message: Message,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: { success: boolean; error?: string }) => void,
  ) => {
    if (message.type === 'ws-attach') {
      attachDebugger(message.tabId)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: String(err) }));
      return true; // Keep channel open for async response
    }

    if (message.type === 'ws-detach') {
      detachDebugger(message.tabId)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: String(err) }));
      return true;
    }

    return false;
  },
);

async function attachDebugger(tabId: number): Promise<void> {
  if (attachedTabs.has(tabId)) {
    // Already attached
    return;
  }

  try {
    // Attach debugger to the tab
    await chrome.debugger.attach({ tabId }, '1.3');
    attachedTabs.add(tabId);
    wsUrls.set(tabId, new Map());

    // Enable Network domain to receive WebSocket events
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable', {});
  } catch (err) {
    attachedTabs.delete(tabId);
    wsUrls.delete(tabId);
    throw err;
  }
}

async function detachDebugger(tabId: number): Promise<void> {
  if (!attachedTabs.has(tabId)) {
    return;
  }

  try {
    await chrome.debugger.detach({ tabId });
  } finally {
    attachedTabs.delete(tabId);
    wsUrls.delete(tabId);
  }
}

// Handle debugger events
chrome.debugger.onEvent.addListener(
  (source: chrome.debugger.Debuggee, method: string, params?: object) => {
    const tabId = source.tabId;
    if (tabId === undefined || !attachedTabs.has(tabId)) {
      return;
    }

    const p = params as Record<string, unknown> | undefined;

    switch (method) {
      case 'Network.webSocketCreated': {
        const requestId = p?.requestId as string;
        const url = p?.url as string;
        const initiator = p?.initiator as WebSocketCreated['initiator'];

        // Store URL for this requestId
        const tabUrls = wsUrls.get(tabId);
        if (tabUrls) {
          tabUrls.set(requestId, url);
        }

        broadcast({
          type: 'ws-created',
          tabId,
          requestId,
          url,
          initiator,
        });
        break;
      }

      case 'Network.webSocketFrameReceived': {
        const requestId = p?.requestId as string;
        const timestamp = p?.timestamp as number;
        const response = p?.response as {
          opcode: number;
          mask: boolean;
          payloadData: string;
        };

        const tabUrls = wsUrls.get(tabId);
        const url = tabUrls?.get(requestId);

        broadcast({
          type: 'ws-frame',
          tabId,
          requestId,
          timestamp,
          direction: 'received',
          opcode: response.opcode,
          mask: response.mask,
          payloadData: response.payloadData,
          url,
        });
        break;
      }

      case 'Network.webSocketFrameSent': {
        const requestId = p?.requestId as string;
        const timestamp = p?.timestamp as number;
        const response = p?.response as {
          opcode: number;
          mask: boolean;
          payloadData: string;
        };

        const tabUrls = wsUrls.get(tabId);
        const url = tabUrls?.get(requestId);

        broadcast({
          type: 'ws-frame',
          tabId,
          requestId,
          timestamp,
          direction: 'sent',
          opcode: response.opcode,
          mask: response.mask,
          payloadData: response.payloadData,
          url,
        });
        break;
      }

      case 'Network.webSocketClosed': {
        const requestId = p?.requestId as string;
        const timestamp = p?.timestamp as number;

        // Clean up URL tracking
        const tabUrls = wsUrls.get(tabId);
        if (tabUrls) {
          tabUrls.delete(requestId);
        }

        broadcast({
          type: 'ws-closed',
          tabId,
          requestId,
          timestamp,
        });
        break;
      }
    }
  },
);

// Handle debugger detach (e.g., user closed DevTools, tab closed)
chrome.debugger.onDetach.addListener(
  (source: chrome.debugger.Debuggee, _reason: string) => {
    const tabId = source.tabId;
    if (tabId !== undefined) {
      attachedTabs.delete(tabId);
      wsUrls.delete(tabId);
    }
  },
);

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId: number) => {
  if (attachedTabs.has(tabId)) {
    attachedTabs.delete(tabId);
    wsUrls.delete(tabId);
  }
});

function broadcast(message: OutboundMessage): void {
  // Send to all extension contexts (panels, popups)
  chrome.runtime.sendMessage(message).catch(() => {
    // Ignore errors when no listeners are connected
  });
}

export {};
