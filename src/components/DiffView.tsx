import React, { useState, useMemo } from 'react';
import { buildDiff, summarizeDiff, type DiffNode, type DiffType } from '../features/diff';

const DIFF_COLORS: Record<DiffType, { bg: string; text: string; border: string }> = {
  added: {
    bg: 'rgba(16, 185, 129, 0.15)',
    text: 'var(--color-success)',
    border: 'var(--color-success)',
  },
  removed: {
    bg: 'rgba(239, 68, 68, 0.15)',
    text: 'var(--color-error)',
    border: 'var(--color-error)',
  },
  changed: {
    bg: 'rgba(245, 158, 11, 0.15)',
    text: 'var(--color-warning)',
    border: 'var(--color-warning)',
  },
  unchanged: {
    bg: 'transparent',
    text: 'var(--text)',
    border: 'transparent',
  },
};

const TYPE_COLORS: Record<string, string> = {
  string: 'var(--color-success)',
  number: 'var(--color-info)',
  boolean: 'var(--color-warning)',
  null: 'var(--text-muted)',
};

function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'undefined') return 'undefined';
  if (typeof value === 'object') {
    try {
      const str = JSON.stringify(value);
      return str.length > 50 ? str.slice(0, 47) + '...' : str;
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function getValueColor(value: unknown): string {
  if (value === null) return TYPE_COLORS.null;
  const t = typeof value;
  return TYPE_COLORS[t] ?? 'var(--text)';
}

function DiffBadge({ type }: { type: DiffType }): React.ReactElement | null {
  if (type === 'unchanged') return null;
  const labels: Record<DiffType, string> = {
    added: '+',
    removed: '−',
    changed: '~',
    unchanged: '',
  };
  return (
    <span
      style={{
        display: 'inline-block',
        width: 16,
        height: 16,
        lineHeight: '16px',
        textAlign: 'center',
        borderRadius: 3,
        fontSize: 12,
        fontWeight: 700,
        background: DIFF_COLORS[type].bg,
        color: DIFF_COLORS[type].text,
        border: `1px solid ${DIFF_COLORS[type].border}`,
        marginRight: 6,
        flexShrink: 0,
      }}
    >
      {labels[type]}
    </span>
  );
}

function DiffNodeRow({
  node,
  depth,
  defaultOpen,
  showUnchanged,
}: {
  node: DiffNode;
  depth: number;
  defaultOpen: boolean;
  showUnchanged: boolean;
}): React.ReactElement | null {
  const [open, setOpen] = useState(defaultOpen && (node.changeCount ?? 0) > 0);
  const indent = { paddingLeft: `${depth * 16}px` };

  // Skip unchanged nodes when hiding them (unless they have changed children)
  if (!showUnchanged && node.type === 'unchanged' && !node.isContainer) {
    return null;
  }

  // For containers with no changes, show collapsed summary
  if (node.isContainer && node.changeCount === 0 && !showUnchanged) {
    return null;
  }

  const colors = DIFF_COLORS[node.type];

  // Leaf node (primitive value)
  if (!node.isContainer) {
    return (
      <div
        className="mono diff-row"
        style={{
          ...indent,
          lineHeight: '1.7',
          display: 'flex',
          alignItems: 'center',
          background: colors.bg,
          borderLeft: `3px solid ${colors.border}`,
          paddingRight: 8,
        }}
      >
        <DiffBadge type={node.type} />
        {node.key !== undefined && (
          <span style={{ color: 'var(--text-muted)' }}>{node.key}: </span>
        )}
        {node.type === 'changed' ? (
          <span>
            <span style={{ color: getValueColor(node.left), textDecoration: 'line-through', opacity: 0.7 }}>
              {formatValue(node.left)}
            </span>
            <span style={{ color: 'var(--text-muted)', margin: '0 6px' }}>→</span>
            <span style={{ color: getValueColor(node.right) }}>{formatValue(node.right)}</span>
          </span>
        ) : node.type === 'added' ? (
          <span style={{ color: getValueColor(node.right) }}>{formatValue(node.right)}</span>
        ) : node.type === 'removed' ? (
          <span style={{ color: getValueColor(node.left), textDecoration: 'line-through', opacity: 0.7 }}>
            {formatValue(node.left)}
          </span>
        ) : (
          <span style={{ color: getValueColor(node.left) }}>{formatValue(node.left)}</span>
        )}
      </div>
    );
  }

  // Container node (object/array)
  const openBracket = node.containerType === 'array' ? '[' : '{';
  const closeBracket = node.containerType === 'array' ? ']' : '}';
  const visibleChildren = showUnchanged
    ? node.children
    : node.children?.filter(
        (c) => c.type !== 'unchanged' || c.isContainer && (c.changeCount ?? 0) > 0,
      );

  return (
    <div>
      <div
        className="mono diff-row"
        style={{
          ...indent,
          cursor: 'pointer',
          lineHeight: '1.7',
          display: 'flex',
          alignItems: 'center',
          background: node.type !== 'unchanged' ? colors.bg : undefined,
          borderLeft: node.type !== 'unchanged' ? `3px solid ${colors.border}` : '3px solid transparent',
        }}
        onClick={() => setOpen((v) => !v)}
      >
        <span style={{ color: 'var(--text-muted)', userSelect: 'none', width: 14 }}>
          {open ? '▾' : '▸'}
        </span>
        {node.type !== 'unchanged' && <DiffBadge type={node.type} />}
        {node.key !== undefined && (
          <span style={{ color: 'var(--text-muted)' }}>{node.key}: </span>
        )}
        <span>{openBracket}</span>
        {!open && (
          <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
            {node.children?.length ?? 0} items
            {(node.changeCount ?? 0) > 0 && (
              <span style={{ color: 'var(--color-warning)', marginLeft: 6 }}>
                ({node.changeCount} change{node.changeCount === 1 ? '' : 's'})
              </span>
            )}
            {' '}{closeBracket}
          </span>
        )}
      </div>
      {open && (
        <div>
          {visibleChildren?.map((child, i) => (
            <DiffNodeRow
              key={child.path + i}
              node={child}
              depth={depth + 1}
              defaultOpen={depth < 2}
              showUnchanged={showUnchanged}
            />
          ))}
          {!showUnchanged && (node.children?.length ?? 0) > (visibleChildren?.length ?? 0) && (
            <div
              className="mono"
              style={{
                paddingLeft: `${(depth + 1) * 16}px`,
                color: 'var(--text-muted)',
                lineHeight: '1.7',
              }}
            >
              … {(node.children?.length ?? 0) - (visibleChildren?.length ?? 0)} unchanged
            </div>
          )}
          <div className="mono" style={indent}>
            {closeBracket}
          </div>
        </div>
      )}
    </div>
  );
}

interface DiffViewProps {
  left: unknown;
  right: unknown;
  leftLabel?: string;
  rightLabel?: string;
}

export default function DiffView({
  left,
  right,
  leftLabel = 'Left',
  rightLabel = 'Right',
}: DiffViewProps): React.ReactElement {
  const [showUnchanged, setShowUnchanged] = useState(false);

  const diff = useMemo(() => buildDiff(left, right), [left, right]);
  const summary = useMemo(() => summarizeDiff(diff), [diff]);

  const totalChanges = summary.added + summary.removed + summary.changed;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header with summary */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-subtle)',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Comparing:{' '}
            <strong style={{ color: 'var(--text)' }}>{leftLabel}</strong>
            {' → '}
            <strong style={{ color: 'var(--text)' }}>{rightLabel}</strong>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, fontSize: 11 }}>
            {summary.added > 0 && (
              <span style={{ color: 'var(--color-success)' }}>+{summary.added} added</span>
            )}
            {summary.removed > 0 && (
              <span style={{ color: 'var(--color-error)' }}>−{summary.removed} removed</span>
            )}
            {summary.changed > 0 && (
              <span style={{ color: 'var(--color-warning)' }}>~{summary.changed} changed</span>
            )}
            {totalChanges === 0 && (
              <span style={{ color: 'var(--text-muted)' }}>No differences</span>
            )}
          </div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              color: 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={showUnchanged}
              onChange={(e) => setShowUnchanged(e.target.checked)}
              style={{ margin: 0 }}
            />
            Show unchanged
          </label>
        </div>
      </div>

      {/* Diff tree */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px', fontSize: 12 }}>
        {totalChanges === 0 && !showUnchanged ? (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>
            Responses are identical. Check "Show unchanged" to see the full structure.
          </div>
        ) : (
          <DiffNodeRow node={diff} depth={0} defaultOpen showUnchanged={showUnchanged} />
        )}
      </div>
    </div>
  );
}
