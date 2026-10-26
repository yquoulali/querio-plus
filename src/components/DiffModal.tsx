import React, { useEffect, useState, useMemo } from 'react';
import DiffView from './DiffView';
import type { CapturedEntry } from '../types';
import { patch } from '../capture/store';

type DiffTab = 'response' | 'query' | 'variables' | 'headers';

interface DiffModalProps {
  left: CapturedEntry;
  right: CapturedEntry;
  onClose: () => void;
}

async function loadBody(entry: CapturedEntry): Promise<unknown> {
  if (entry.responseBody !== undefined) {
    return entry.responseBody;
  }
  const body = await entry.getResponseBody();
  if (body !== undefined) {
    patch(entry.id, { responseBody: body });
  }
  return body;
}

function TabButton({
  label,
  active,
  onClick,
  disabled,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '8px 14px',
        border: 'none',
        borderBottom: active ? '2px solid var(--color-brand)' : '2px solid transparent',
        background: 'transparent',
        color: disabled ? 'var(--text-muted)' : active ? 'var(--text)' : 'var(--text-muted)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontWeight: active ? 600 : 400,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}

/** Convert headers array to an object for diffing */
function headersToObject(
  headers: ReadonlyArray<{ name: string; value: string }>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const h of headers) {
    result[h.name] = h.value;
  }
  return result;
}

export default function DiffModal({ left, right, onClose }: DiffModalProps): React.ReactElement {
  const [tab, setTab] = useState<DiffTab>('response');
  const [leftBody, setLeftBody] = useState<unknown>(left.responseBody);
  const [rightBody, setRightBody] = useState<unknown>(right.responseBody);
  const [loading, setLoading] = useState(
    left.responseBody === undefined || right.responseBody === undefined,
  );
  const [error, setError] = useState<string | null>(null);

  // Check if both entries are GraphQL (for Query/Variables tabs)
  const bothGraphQL = left.kind === 'graphql' && right.kind === 'graphql';

  useEffect(() => {
    let active = true;

    Promise.all([loadBody(left), loadBody(right)])
      .then(([l, r]) => {
        if (!active) return;
        setLeftBody(l);
        setRightBody(r);
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          setError('Failed to load one or both response bodies');
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [left, right]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Memoize headers objects for diffing
  const leftHeaders = useMemo(() => headersToObject(left.requestHeaders), [left.requestHeaders]);
  const rightHeaders = useMemo(() => headersToObject(right.requestHeaders), [right.requestHeaders]);

  // Determine what to diff based on tab
  const getDiffData = (): { left: unknown; right: unknown; leftLabel: string; rightLabel: string } => {
    switch (tab) {
      case 'query':
        return {
          left: left.query ?? '(no query)',
          right: right.query ?? '(no query)',
          leftLabel: `${left.name} — Query`,
          rightLabel: `${right.name} — Query`,
        };
      case 'variables':
        return {
          left: left.variables ?? {},
          right: right.variables ?? {},
          leftLabel: `${left.name} — Variables`,
          rightLabel: `${right.name} — Variables`,
        };
      case 'headers':
        return {
          left: leftHeaders,
          right: rightHeaders,
          leftLabel: `${left.name} — Headers`,
          rightLabel: `${right.name} — Headers`,
        };
      case 'response':
      default:
        return {
          left: leftBody,
          right: rightBody,
          leftLabel: `${left.name} — Response`,
          rightLabel: `${right.name} — Response`,
        };
    }
  };

  const diffData = getDiffData();

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: 'var(--bg)',
          borderRadius: 8,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
          width: '90vw',
          maxWidth: 1000,
          height: '80vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Modal header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-subtle)',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
            Compare Requests
          </h2>
          <button
            className="btn btn-sm"
            onClick={onClose}
            aria-label="Close diff"
            title="Close (Esc)"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg)',
          }}
        >
          <TabButton label="Response" active={tab === 'response'} onClick={() => setTab('response')} />
          <TabButton
            label="Query"
            active={tab === 'query'}
            onClick={() => setTab('query')}
            disabled={!bothGraphQL}
          />
          <TabButton
            label="Variables"
            active={tab === 'variables'}
            onClick={() => setTab('variables')}
            disabled={!bothGraphQL}
          />
          <TabButton label="Headers" active={tab === 'headers'} onClick={() => setTab('headers')} />
        </div>

        {/* Modal content */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {tab === 'response' && loading ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: 'var(--text-muted)',
              }}
            >
              Loading responses…
            </div>
          ) : tab === 'response' && error ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: 'var(--color-error)',
              }}
            >
              {error}
            </div>
          ) : tab === 'query' ? (
            // For query strings, show a simple text diff
            <QueryDiff
              left={left.query}
              right={right.query}
              leftLabel={left.name}
              rightLabel={right.name}
            />
          ) : (
            <DiffView
              left={diffData.left}
              right={diffData.right}
              leftLabel={diffData.leftLabel}
              rightLabel={diffData.rightLabel}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Simple side-by-side text diff for GraphQL queries */
function QueryDiff({
  left,
  right,
  leftLabel,
  rightLabel,
}: {
  left: string | undefined;
  right: string | undefined;
  leftLabel: string;
  rightLabel: string;
}): React.ReactElement {
  const leftQuery = left ?? '(no query)';
  const rightQuery = right ?? '(no query)';
  const isIdentical = leftQuery === rightQuery;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-subtle)',
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {isIdentical ? (
            <span style={{ color: 'var(--color-success)' }}>Queries are identical</span>
          ) : (
            <span style={{ color: 'var(--color-warning)' }}>Queries differ</span>
          )}
        </span>
      </div>

      {/* Side-by-side view */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Left panel */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid var(--border)',
            minWidth: 0,
          }}
        >
          <div
            style={{
              padding: '6px 12px',
              background: 'var(--bg-subtle)',
              borderBottom: '1px solid var(--border)',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-muted)',
            }}
          >
            {leftLabel}
          </div>
          <pre
            className="mono"
            style={{
              flex: 1,
              margin: 0,
              padding: 12,
              overflow: 'auto',
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {leftQuery}
          </pre>
        </div>

        {/* Right panel */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
          }}
        >
          <div
            style={{
              padding: '6px 12px',
              background: 'var(--bg-subtle)',
              borderBottom: '1px solid var(--border)',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-muted)',
            }}
          >
            {rightLabel}
          </div>
          <pre
            className="mono"
            style={{
              flex: 1,
              margin: 0,
              padding: 12,
              overflow: 'auto',
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {rightQuery}
          </pre>
        </div>
      </div>
    </div>
  );
}
