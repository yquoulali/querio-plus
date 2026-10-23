import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CapturedEntry } from '../types';
import { DEFAULT_COLUMN_WIDTHS, MIN_COLUMN_WIDTH, type ColumnKey } from '../settings';

function formatSize(size: number | undefined): string {
  if (size === undefined) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const COLUMN_LABELS: Record<ColumnKey, string> = {
  kind: 'Kind',
  name: 'Name',
  type: 'Type',
  status: 'Status',
  size: 'Size',
  time: 'Time',
  url: 'URL',
};

function typeLabel(entry: CapturedEntry): string {
  if (entry.kind === 'http') return 'http';
  return entry.operation?.type ?? 'query';
}

/** Dot color by HTTP status class. */
function statusColor(status: number): string {
  if (status === 0) return 'var(--color-error)';
  if (status >= 500) return 'var(--color-error)';
  if (status >= 400) return 'var(--color-warning)';
  if (status >= 300) return 'var(--color-info)';
  if (status >= 200) return 'var(--color-success)';
  return 'var(--text-muted)';
}

/** Short label + color for the leading method/operation badge. */
function badgeFor(entry: CapturedEntry): { label: string; color: string; title: string } {
  if (entry.kind === 'graphql') {
    const type = entry.operation?.type ?? 'query';
    const color =
      type === 'mutation'
        ? 'var(--gql-mutation)'
        : type === 'subscription'
          ? 'var(--gql-subscription)'
          : 'var(--gql-query)';
    const short = type === 'mutation' ? 'MUT' : type === 'subscription' ? 'SUB' : 'QRY';
    return { label: `GQL·${short}`, color, title: `GraphQL ${type} (${entry.method})` };
  }
  const method = entry.method.toUpperCase();
  const colorByMethod: Record<string, string> = {
    GET: 'var(--method-get)',
    POST: 'var(--method-post)',
    PUT: 'var(--method-put)',
    PATCH: 'var(--method-patch)',
    DELETE: 'var(--method-delete)',
  };
  return {
    label: method,
    color: colorByMethod[method] ?? 'var(--method-other)',
    title: `${method} request`,
  };
}

function MethodBadge({ entry }: { entry: CapturedEntry }): React.ReactElement {
  const { label, color, title } = badgeFor(entry);
  return (
    <span
      title={title}
      style={{
        flex: '0 0 auto',
        marginRight: 8,
        padding: '1px 5px',
        borderRadius: 4,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: 0.3,
        lineHeight: '14px',
        color: '#fff',
        background: color,
        fontFamily: 'var(--font-mono)',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

function ErrorBadge({ entry }: { entry: CapturedEntry }): React.ReactElement | null {
  if (entry.errorState !== 'error') return null;
  const label = entry.errorCount && entry.errorCount > 0 ? String(entry.errorCount) : '!';
  return (
    <span
      style={{
        marginLeft: 6,
        padding: '0 5px',
        borderRadius: 8,
        background: 'var(--color-error)',
        color: '#fff',
        fontSize: 10,
        fontWeight: 700,
        flex: '0 0 auto',
      }}
    >
      {label}
    </span>
  );
}

function cellValue(entry: CapturedEntry, col: ColumnKey): React.ReactNode {
  switch (col) {
    case 'kind':
      return <MethodBadge entry={entry} />;
    case 'name':
      return (
        <span style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          <span
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={entry.name}
          >
            {entry.name}
          </span>
          {entry.batch && (
            <span
              title={
                entry.correlation === 'position' ? 'matched by position' : 'matched by identity'
              }
              style={{
                marginLeft: 6,
                padding: '0 5px',
                borderRadius: 8,
                background: 'var(--bg-selected)',
                color: 'var(--text-muted)',
                fontSize: 10,
                whiteSpace: 'nowrap',
                flex: '0 0 auto',
              }}
            >
              {entry.batch.count}/{entry.batch.length} in Batch
              {entry.correlation === 'position' ? ' ~' : ''}
            </span>
          )}
          <ErrorBadge entry={entry} />
        </span>
      );
    case 'type':
      return typeLabel(entry);
    case 'status':
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              flex: '0 0 auto',
              background: statusColor(entry.status),
            }}
          />
          {entry.status === 0 ? '(failed)' : entry.status}
        </span>
      );
    case 'size':
      return formatSize(entry.size);
    case 'time':
      return `${entry.time.toFixed(0)} ms`;
    case 'url':
      return (
        <span
          style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={entry.url}
        >
          {entry.url}
        </span>
      );
    default:
      return null;
  }
}

/**
 * A draggable divider on a column's right border. Robust pattern: capture the start X and
 * the start width ONCE at pointer-down, then compute the ABSOLUTE new width from total
 * movement on window-level listeners (so it survives re-renders and never accumulates a
 * stale delta). Double-click resets to a sensible default (auto-fit heuristic).
 */
function ColumnResizer({
  startWidth,
  onResize,
  onReset,
}: {
  startWidth: number;
  onResize: (width: number) => void;
  onReset: () => void;
}): React.ReactElement {
  const [active, setActive] = useState(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const originX = e.clientX;
      const originWidth = startWidth;
      setActive(true);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const move = (ev: PointerEvent) => {
        const next = Math.max(MIN_COLUMN_WIDTH, originWidth + (ev.clientX - originX));
        onResize(next);
      };
      const up = () => {
        setActive(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [startWidth, onResize],
  );

  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onReset();
      }}
      onClick={(e) => e.stopPropagation()}
      title="Drag to resize · double-click to reset"
      style={{
        position: 'absolute',
        top: 0,
        right: -4,
        width: 9,
        height: '100%',
        cursor: 'col-resize',
        zIndex: 3,
        touchAction: 'none',
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: 2,
          height: '100%',
          background: active ? 'var(--color-brand)' : 'transparent',
          transition: 'background 0.12s',
        }}
      />
    </div>
  );
}

const RIGHT_ALIGNED: ReadonlySet<ColumnKey> = new Set<ColumnKey>(['size', 'time']);

function Row({
  entry,
  columns,
  columnWidths,
  isSelected,
  zebra,
  onSelect,
}: {
  entry: CapturedEntry;
  columns: ReadonlyArray<ColumnKey>;
  columnWidths: Record<ColumnKey, number>;
  isSelected: boolean;
  zebra: boolean;
  onSelect: (id: string) => void;
}): React.ReactElement {
  const isError = entry.errorState === 'error';
  const bg = zebra ? 'var(--bg-subtle)' : 'transparent';

  return (
    <div
      className="req-row"
      role="option"
      aria-selected={isSelected}
      data-id={entry.id}
      onClick={() => onSelect(entry.id)}
      style={{
        display: 'flex',
        alignItems: 'center',
        minHeight: 28,
        cursor: 'pointer',
        borderBottom: '1px solid var(--border)',
        borderLeft: `3px solid ${isSelected ? 'var(--color-brand)' : 'transparent'}`,
        background: bg,
        boxShadow: isError ? 'inset 0 0 0 9999px color-mix(in srgb, var(--color-error) 6%, transparent)' : undefined,
        color: isError ? 'var(--color-error)' : 'var(--text)',
      }}
    >
      {columns.map((c, i) => {
        const isLast = i === columns.length - 1;
        return (
          <div
            key={c}
            style={{
              boxSizing: 'border-box',
              flex: isLast ? '1 1 auto' : `0 0 ${columnWidths[c]}px`,
              width: isLast ? undefined : columnWidths[c],
              minWidth: 0,
              padding: '0 10px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              textAlign: RIGHT_ALIGNED.has(c) ? 'right' : 'left',
              color: RIGHT_ALIGNED.has(c) && !isError ? 'var(--text-muted)' : undefined,
            }}
          >
            {cellValue(entry, c)}
          </div>
        );
      })}
    </div>
  );
}

export default function RequestList({
  entries,
  columns,
  columnWidths,
  onColumnWidthChange,
  selectedId,
  onSelect,
  totalCount,
}: {
  totalCount: number;
  entries: ReadonlyArray<CapturedEntry>;
  columns: ReadonlyArray<ColumnKey>;
  columnWidths: Record<ColumnKey, number>;
  onColumnWidthChange: (col: ColumnKey, width: number) => void;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}): React.ReactElement {
  const totalWidth = columns.reduce((sum, c) => sum + columnWidths[c], 0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the selected row visible when it changes (keyboard nav, selection from elsewhere).
  useEffect(() => {
    if (!selectedId) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(selectedId)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (entries.length === 0) return;
    const current = entries.findIndex((x) => x.id === selectedId);
    let next = -1;
    if (e.key === 'ArrowDown') next = current < 0 ? 0 : Math.min(entries.length - 1, current + 1);
    else if (e.key === 'ArrowUp') next = current < 0 ? entries.length - 1 : Math.max(0, current - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = entries.length - 1;
    else return;
    e.preventDefault();
    onSelect(entries[next].id);
  };

  return (
    <div
      ref={scrollRef}
      className="req-list"
      role="listbox"
      aria-label="Captured requests"
      tabIndex={0}
      onKeyDown={onKeyDown}
      style={{ height: '100%', overflow: 'auto', fontSize: 12 }}
    >
      <div style={{ minWidth: totalWidth }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 30,
            position: 'sticky',
            top: 0,
            background: 'var(--bg-subtle)',
            borderBottom: '1px solid var(--border)',
            borderLeft: '3px solid transparent',
            zIndex: 2,
            userSelect: 'none',
          }}
        >
          {columns.map((c, i) => {
            const isLast = i === columns.length - 1;
            return (
              <div
                key={c}
                style={{
                  position: 'relative',
                  boxSizing: 'border-box',
                  flex: isLast ? '1 1 auto' : `0 0 ${columnWidths[c]}px`,
                  width: isLast ? undefined : columnWidths[c],
                  minWidth: 0,
                  padding: '0 10px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  textAlign: RIGHT_ALIGNED.has(c) ? 'right' : 'left',
                  fontWeight: 600,
                  fontSize: 11,
                  letterSpacing: 0.3,
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                }}
              >
                {COLUMN_LABELS[c]}
                {!isLast && (
                  <ColumnResizer
                    startWidth={columnWidths[c]}
                    onResize={(w) => onColumnWidthChange(c, w)}
                    onReset={() => onColumnWidthChange(c, DEFAULT_COLUMN_WIDTHS[c])}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Rows */}
        {entries.length === 0 ? (
          <div style={{ padding: 28, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
            {totalCount > 0 ? (
              <>
                <div style={{ fontWeight: 600, color: 'var(--text)' }}>No requests match</div>
                <div>
                  {totalCount} captured request{totalCount === 1 ? '' : 's'} hidden by the current
                  filters or search.
                </div>
              </>
            ) : (
              <>
                <div style={{ fontWeight: 600, color: 'var(--text)' }}>Waiting for requests…</div>
                <div>Trigger traffic in the inspected page. GraphQL calls appear here.</div>
                <div style={{ marginTop: 6 }}>
                  Tip: use <kbd>↑</kbd> <kbd>↓</kbd> to move through the list.
                </div>
              </>
            )}
          </div>
        ) : (
          entries.map((entry, i) => (
            <Row
              key={entry.id}
              entry={entry}
              columns={columns}
              columnWidths={columnWidths}
              isSelected={entry.id === selectedId}
              zebra={i % 2 === 1}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}
