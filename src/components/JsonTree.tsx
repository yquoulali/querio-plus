import React, { useState } from 'react';
import { buildTree, type JsonTreeNode } from '../format/json-format';

const LEAF_COLORS: Record<string, string> = {
  string: 'var(--color-success)',
  number: 'var(--color-info)',
  boolean: 'var(--color-warning)',
  null: 'var(--text-muted)',
};

function Leaf({ node }: { node: JsonTreeNode }): React.ReactElement {
  const color = LEAF_COLORS[node.type] ?? 'var(--text)';
  const display =
    node.type === 'string' ? JSON.stringify(node.value) : String(node.value);
  return (
    <span className="mono" style={{ color }}>
      {display}
    </span>
  );
}

function TreeNode({
  node,
  depth,
  defaultOpen,
}: {
  node: JsonTreeNode;
  depth: number;
  defaultOpen: boolean;
}): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  const isBranch = node.type === 'object' || node.type === 'array';
  const indent = { paddingLeft: `${depth * 14}px` };

  if (!isBranch) {
    return (
      <div className="mono json-row" style={{ ...indent, lineHeight: '1.6' }}>
        {node.key !== undefined && (
          <span style={{ color: 'var(--text-muted)' }}>{node.key}: </span>
        )}
        <Leaf node={node} />
      </div>
    );
  }

  const open_b = node.type === 'array' ? '[' : '{';
  const close_b = node.type === 'array' ? ']' : '}';

  return (
    <div>
      <div
        className="mono json-row"
        style={{ ...indent, cursor: 'pointer', lineHeight: '1.6' }}
        onClick={() => setOpen((v) => !v)}
      >
        <span style={{ color: 'var(--text-muted)', userSelect: 'none' }}>
          {open ? '▾ ' : '▸ '}
        </span>
        {node.key !== undefined && (
          <span style={{ color: 'var(--text-muted)' }}>{node.key}: </span>
        )}
        <span>{open_b}</span>
        {!open && (
          <span style={{ color: 'var(--text-muted)' }}>
            {' '}
            {node.childCount} {node.childCount === 1 ? 'item' : 'items'} {close_b}
          </span>
        )}
      </div>
      {open && (
        <div>
          {node.children?.map((child, i) => (
            <TreeNode key={i} node={child} depth={depth + 1} defaultOpen={depth < 1} />
          ))}
          {node.truncated && (
            <div
              className="mono"
              style={{ paddingLeft: `${(depth + 1) * 14}px`, color: 'var(--text-muted)' }}
            >
              {node.children
                ? `… ${(node.childCount ?? 0) - node.children.length} more (truncated for display)`
                : `… ${node.childCount ?? 0} items (depth limit)`}
            </div>
          )}
          <div className="mono" style={indent}>
            {close_b}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Collapsible JSON tree (I4). A non-object/primitive value (incl. a kept-raw invalid
 * variables string) renders as a single leaf — never iterated as if it had keys.
 */
export default function JsonTree({ value }: { value: unknown }): React.ReactElement {
  const root = buildTree(value);
  return (
    <div style={{ overflow: 'auto', fontSize: '12px' }}>
      <TreeNode node={root} depth={0} defaultOpen />
    </div>
  );
}
