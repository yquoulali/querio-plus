import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '../styles/index.css';
import { classifyEntry, parseGqlEntries, parseHttpEntry, resolveGraphqlError } from '../capture/parse-entry';
import { add, clear, queuePatch } from '../capture/store';
import { markSeen, resetSeenEntries } from '../capture/dedup';
import { getPreserveLog, applyTheme } from '../settings';
import type { HarEntry } from '../types';

// Flash-avoidance (P8), CSP-compliant: this external module script runs before React
// paints, so apply the 'system' theme (the DevTools panel's own themeName) synchronously
// here. App.tsx then overrides it with the stored setting once chrome.storage resolves.
// This replaces the old inline <script>, which MV3's CSP (script-src 'self') blocked.
applyTheme('system');

/**
 * Register the single network listener (P2). This is the only place that touches
 * chrome.devtools.network. Each finished request is classified and parsed into the
 * store; GraphQL rows then resolve their tri-state error flag asynchronously (I2) and
 * patch the store so the list/detail re-render (F2: errorState/size re-emit from store).
 */
/**
 * Adapt the raw Chrome HAR entry so `getContent()` always returns a Promise.
 *
 * Chrome's `Request.getContent` is callback-based and returns `void`
 * (`getContent((content, encoding) => ...)`). The capture pipeline expects a
 * `Promise<[content, encoding]>`, so wrap the callback here, at the single
 * boundary that touches the real devtools object. Everything downstream then
 * has one contract and never sees the callback form.
 */
function normalizeHarEntry(entry: HarEntry): HarEntry {
  const rawGetContent = entry.getContent?.bind(entry);
  return {
    ...entry,
    getContent: () =>
      new Promise<[string, string]>((resolve) => {
        if (typeof rawGetContent !== 'function') {
          resolve(['', '']);
          return;
        }
        try {
          const maybePromise = rawGetContent((content: string, encoding: string) => {
            resolve([content ?? '', encoding ?? '']);
          });
          // Defensive: if a host ever returns a promise instead of using the
          // callback, honor it too.
          if (maybePromise && typeof (maybePromise as Promise<unknown>).then === 'function') {
            void (maybePromise as Promise<[string, string]>).then(
              (res) => resolve(Array.isArray(res) ? res : ['', '']),
              () => resolve(['', '']),
            );
          }
        } catch {
          resolve(['', '']);
        }
      }),
  };
}

/**
 * Register the capture listener so it can NEVER stack, even across JS realms.
 *
 * A module-level boolean only guards within one realm; if the panel page is
 * instantiated twice (a reload creating a second realm), each realm's module runs
 * its own `addListener` and the request stream is captured twice. To prevent that we
 * stash our listener on the shared `chrome.devtools.network` object (one object for the
 * panel's lifetime, visible to every realm) and remove any previously-registered
 * instance before adding the current one.
 */
interface CaptureCarrier {
  __querioPlusListener?: (harEntry: unknown) => void;
}

function registerCapture(): void {
  if (
    typeof chrome === 'undefined' ||
    !chrome.devtools ||
    !chrome.devtools.network ||
    !chrome.devtools.network.onRequestFinished
  ) {
    return;
  }

  const net = chrome.devtools.network as unknown as CaptureCarrier;
  // Remove a listener left behind by a previous realm/instance, so only one is ever active.
  if (net.__querioPlusListener) {
    try {
      chrome.devtools.network.onRequestFinished.removeListener(net.__querioPlusListener);
    } catch {
      /* ignore */
    }
  }

  const listener = (harEntry: unknown): void => {
    // Robustness: a single malformed entry must never kill the listener or drop
    // every subsequent request. Catch per-entry parse failures and skip that one.
    try {
      const entry = normalizeHarEntry(harEntry as HarEntry);

      // Collapse Chrome's double delivery of a finished request (two near-identical HAR
      // entries ~1ms apart); a genuine repeat the page sends later is kept. See dedup.ts.
      if (!markSeen(entry)) return;

      const cls = classifyEntry(entry);
      if (cls.kind === 'graphql') {
        const captured = parseGqlEntries(entry);
        add(...captured);
        // Opportunistic body fetch for GraphQL rows to resolve the errors[] half of I2.
        for (const e of captured) {
          void resolveGraphqlError(e)
            .then((update) => queuePatch(e.id, update))
            // Body unavailable: fall back to the HTTP status rather than hiding a failed call.
            .catch(() =>
              queuePatch(e.id, {
                errorState: e.status >= 400 || e.status === 0 ? 'error' : 'ok',
              }),
            );
        }
      } else if (cls.kind === 'http') {
        add(parseHttpEntry(entry));
      }
    } catch {
      // Drop the unparseable entry; keep capturing the rest.
    }
  };

  chrome.devtools.network.onRequestFinished.addListener(listener);
  net.__querioPlusListener = listener;

  // I7: clear on navigation unless preserve-log is on. Guard this one too so it can't stack.
  const navNet = chrome.devtools.network as unknown as {
    __querioPlusNavRegistered?: boolean;
  };
  if (chrome.devtools.network.onNavigated && !navNet.__querioPlusNavRegistered) {
    navNet.__querioPlusNavRegistered = true;
    chrome.devtools.network.onNavigated.addListener(() => {
      if (!getPreserveLog()) {
        clear();
        resetSeenEntries();
      }
    });
  }
}

registerCapture();

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
