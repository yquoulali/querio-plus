import React, { useEffect, useState } from 'react';
import type { CapturedEntry } from '../types';
import JsonTree from './JsonTree';
import GraphQLView from './GraphQLView';
import { patch } from '../capture/store';
import { toCurl, copyOperation, copyResponse } from '../features/copy';

type Tab = 'general' | 'headers' | 'query' | 'response';

function formatSize(size: number | undefined): string {
  if (size === undefined) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function writeClipboard(text: string): void {
  try {
    void navigator.clipboard.writeText(text);
  } catch {
    /* clipboard unavailable */
  }
}

/** Collapsible section with a header that toggles content visibility */
function CollapsibleSection({
  title,
  defaultOpen = true,
  badge,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{ marginBottom: 12 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '8px 0',
          border: 'none',
          background: 'transparent',
          color: 'var(--text)',
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 600,
          textAlign: 'left',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 16,
            height: 16,
            fontSize: 10,
            color: 'var(--text-muted)',
            transition: 'transform 0.15s',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        >
          ▶
        </span>
        <span>{title}</span>
        {badge}
      </button>
      {open && <div style={{ marginLeft: 24 }}>{children}</div>}
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 14px',
        border: 'none',
        borderBottom: active ? '2px solid var(--color-brand)' : '2px solid transparent',
        background: 'transparent',
        color: active ? 'var(--text)' : 'var(--text-muted)',
        cursor: 'pointer',
        fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
}

function CopyButton({ label, text }: { label: string; text: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      className="btn btn-sm"
      onClick={() => {
        writeClipboard(text);
        setCopied(true);
      }}
      style={copied ? { borderColor: 'var(--color-success)', color: 'var(--color-success)' } : undefined}
    >
      {copied ? '✓ copied' : label}
    </button>
  );
}

function statusTone(status: number): string {
  if (status === 0 || status >= 500) return 'var(--color-error)';
  if (status >= 400) return 'var(--color-warning)';
  if (status >= 300) return 'var(--color-info)';
  if (status >= 200) return 'var(--color-success)';
  return 'var(--text-muted)';
}

function isPlainObject(v: unknown): boolean {
  return typeof v === 'object' && v !== null;
}

export default function RequestDetail({
  entry,
  onClose,
  onCompare,
}: {
  entry: CapturedEntry;
  onClose?: () => void;
  onCompare?: () => void;
}): React.ReactElement {
  const [tab, setTab] = useState<Tab>('general');
  const [body, setBody] = useState<unknown>(entry.responseBody);
  const [bodyLoaded, setBodyLoaded] = useState(entry.responseBody !== undefined);
  const [bodyError, setBodyError] = useState(false);

  // Reset only when a different row is selected; a store patch of the same row (e.g. the
  // body being written back) must not bounce the user off the tab they are on.
  useEffect(() => {
    setTab('general');
    setBodyError(false);
  }, [entry.id]);

  useEffect(() => {
    setBody(entry.responseBody);
    setBodyLoaded(entry.responseBody !== undefined);
  }, [entry.id, entry.responseBody]);

  useEffect(() => {
    if (tab !== 'response' || bodyLoaded || bodyError) return;
    let active = true;
    entry.getResponseBody().then(
      (b) => {
        if (!active) return;
        setBody(b);
        setBodyLoaded(true);
        // Write the body back so search and session export can see it.
        if (b !== undefined) patch(entry.id, { responseBody: b });
      },
      () => {
        if (active) setBodyError(true);
      },
    );
    return () => {
      active = false;
    };
  }, [tab, bodyLoaded, bodyError, entry]);

  const variablesIsRawString = typeof entry.variables === 'string';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-subtle)',
          minWidth: 0,
        }}
      >
        <span
          style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={entry.name}
        >
          {entry.name}
        </span>
        <span className="pill" style={{ color: statusTone(entry.status), flex: '0 0 auto' }}>
          {entry.status === 0 ? 'failed' : `${entry.status} ${entry.statusText ?? ''}`.trim()}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 11, flex: '0 0 auto' }}>
          {entry.time.toFixed(0)} ms · {formatSize(entry.size)}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flex: '0 0 auto' }}>
          {onCompare && (
            <button
              className="btn btn-sm"
              onClick={onCompare}
              title="Compare response with another request"
            >
              Compare
            </button>
          )}
          {onClose && (
            <button
              className="btn btn-sm"
              onClick={onClose}
              aria-label="Close details"
              title="Close details"
            >
              ×
            </button>
          )}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg)',
        }}
      >
        <TabButton label="General" active={tab === 'general'} onClick={() => setTab('general')} />
        <TabButton
          label="Request headers"
          active={tab === 'headers'}
          onClick={() => setTab('headers')}
        />
        {entry.kind === 'graphql' && (
          <TabButton
            label="Query / Variables"
            active={tab === 'query'}
            onClick={() => setTab('query')}
          />
        )}
        <TabButton label="Response" active={tab === 'response'} onClick={() => setTab('response')} />
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
        {tab === 'general' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px' }}>
            <span style={{ color: 'var(--text-muted)' }}>Name</span>
            <span>{entry.name}</span>
            <span style={{ color: 'var(--text-muted)' }}>Method</span>
            <span>{entry.method}</span>
            <span style={{ color: 'var(--text-muted)' }}>URL</span>
            <span className="mono" style={{ wordBreak: 'break-all' }}>
              {entry.url}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>Status</span>
            <span>
              {entry.status} {entry.statusText}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>Type</span>
            <span>{entry.kind === 'graphql' ? entry.operation?.type ?? 'query' : 'http'}</span>
            {entry.batch && (
              <>
                <span style={{ color: 'var(--text-muted)' }}>Batch</span>
                <span>
                  {entry.batch.count}/{entry.batch.length} in Batch{' '}
                  {entry.correlation === 'position' && (
                    <span style={{ color: 'var(--color-warning)' }}>(positional match)</span>
                  )}
                </span>
              </>
            )}
            <span style={{ color: 'var(--text-muted)' }}>Time</span>
            <span>{entry.time.toFixed(1)} ms</span>
            <span style={{ color: 'var(--text-muted)' }}>Size</span>
            <span>{formatSize(entry.size)}</span>
            <span style={{ color: 'var(--text-muted)' }}>Copy</span>
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <CopyButton label="as cURL" text={toCurl(entry)} />
              {entry.kind === 'graphql' && (
                <CopyButton label="operation" text={copyOperation(entry)} />
              )}
            </span>
          </div>
        )}

        {tab === 'headers' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px' }}>
            {entry.requestHeaders.map((h, i) => (
              <React.Fragment key={i}>
                <span className="mono" style={{ color: 'var(--text-muted)' }}>
                  {h.name}
                </span>
                <span className="mono" style={{ wordBreak: 'break-all' }}>
                  {h.value}
                </span>
              </React.Fragment>
            ))}
          </div>
        )}

        {tab === 'query' && entry.kind === 'graphql' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {entry.query && (
              <CollapsibleSection title="Query" defaultOpen={true}>
                <GraphQLView query={entry.query} />
              </CollapsibleSection>
            )}
            <CollapsibleSection
              title="Variables"
              defaultOpen={true}
              badge={
                variablesIsRawString ? (
                  <span style={{ color: 'var(--color-warning)', fontSize: 11, fontWeight: 400 }}>
                    could not parse
                  </span>
                ) : undefined
              }
            >
              {entry.variables === undefined ? (
                <span style={{ color: 'var(--text-muted)' }}>—</span>
              ) : (
                <JsonTree value={entry.variables} />
              )}
            </CollapsibleSection>
          </div>
        )}

        {tab === 'response' && (
          <div>
            {bodyError ? (
              <span style={{ color: 'var(--text-muted)' }}>Could not load the response body.</span>
            ) : !bodyLoaded ? (
              <span style={{ color: 'var(--text-muted)' }}>Loading response…</span>
            ) : (
              <>
                {typeof body === 'string' &&
                  body.trim() !== '' &&
                  entry.mimeType?.includes('json') && (
                    <div style={{ color: 'var(--color-warning)', fontSize: 11, marginBottom: 8 }}>
                      Response is labeled JSON but could not be parsed — showing raw body.
                    </div>
                  )}
                {typeof body === 'string' && body.trim() === '' && (
                  <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 8 }}>
                    (empty response body)
                  </div>
                )}
                <div style={{ marginBottom: 8 }}>
                  <CopyButton label="copy response" text={copyResponse(body)} />
                </div>
                {isPlainObject(body) ? (
                  <JsonTree value={body} />
                ) : (
                  <pre
                    className="mono"
                    style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
                  >
                    {String(body ?? '')}
                  </pre>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
