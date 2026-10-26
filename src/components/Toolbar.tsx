import React, { useRef } from 'react';
import type { FilterState, TypeFilter } from '../features/filter';
import type { ColumnKey, ThemeSetting } from '../settings';
import { ALL_COLUMNS } from '../settings';

const TYPE_OPTIONS: TypeFilter[] = ['query', 'mutation', 'subscription', 'http'];
const COLUMN_LABELS: Record<ColumnKey, string> = {
  kind: 'Kind',
  name: 'Name',
  type: 'Type',
  status: 'Status',
  size: 'Size',
  time: 'Time',
  url: 'URL',
};

export interface ToolbarProps {
  filter: FilterState;
  onFilterChange: (next: FilterState) => void;
  search: string;
  onSearchChange: (next: string) => void;
  theme: ThemeSetting;
  onThemeChange: (next: ThemeSetting) => void;
  preserveLog: boolean;
  onPreserveLogChange: (next: boolean) => void;
  wsCapture: boolean;
  onWsCaptureChange: (next: boolean) => void;
  columns: ReadonlyArray<ColumnKey>;
  onColumnsChange: (next: ColumnKey[]) => void;
  onClear: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  shownCount: number;
  totalCount: number;
}

export default function Toolbar(props: ToolbarProps): React.ReactElement {
  const { filter, onFilterChange } = props;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toggleType = (t: TypeFilter) => {
    const has = filter.types.includes(t);
    onFilterChange({
      ...filter,
      types: has ? filter.types.filter((x) => x !== t) : [...filter.types, t],
    });
  };

  const toggleColumn = (c: ColumnKey) => {
    const has = props.columns.includes(c);
    const next = has ? props.columns.filter((x) => x !== c) : [...props.columns, c];
    // keep canonical order
    onColumnsChangeOrdered(next);
  };
  const onColumnsChangeOrdered = (cols: ColumnKey[]) =>
    props.onColumnsChange(ALL_COLUMNS.filter((c) => cols.includes(c)));

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'center',
        padding: '8px 10px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-subtle)',
      }}
    >
      <button className="btn" onClick={props.onClear} title="Clear captured requests">
        Clear
      </button>

      <span className="toolbar-sep" />

      <input
        className="field" style={{ width: 130 }}
        placeholder="Filter name"
        value={filter.name}
        onChange={(e) => onFilterChange({ ...filter, name: e.target.value })}
      />
      <input
        className="field" style={{ width: 130 }}
        placeholder="Filter URL"
        value={filter.url}
        onChange={(e) => onFilterChange({ ...filter, url: e.target.value })}
      />
      <input
        className="field" style={{ width: 90 }}
        placeholder="Status"
        value={filter.status}
        onChange={(e) => onFilterChange({ ...filter, status: e.target.value })}
        title="Exact code (404) or class (2xx, 4xx, 5xx)"
      />

      <span className="toolbar-sep" />

      <span style={{ display: 'inline-flex', gap: 4 }}>
        {TYPE_OPTIONS.map((t) => (
          <button
            key={t}
            className="btn"
            aria-pressed={filter.types.includes(t)}
            onClick={() => toggleType(t)}
          >
            {t}
          </button>
        ))}
      </span>

      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
        <input
          type="checkbox"
          checked={filter.errorsOnly}
          onChange={(e) => onFilterChange({ ...filter, errorsOnly: e.target.checked })}
        />
        Errors only
      </label>

      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <input
          className="field"
          style={{ width: 170, paddingRight: props.search ? 22 : 8 }}
          placeholder="Search bodies…"
          value={props.search}
          onChange={(e) => props.onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') props.onSearchChange('');
          }}
        />
        {props.search && (
          <button
            aria-label="Clear search"
            title="Clear search (Esc)"
            onClick={() => props.onSearchChange('')}
            style={{
              position: 'absolute',
              right: 2,
              top: 2,
              bottom: 2,
              width: 20,
              border: 'none',
              background: 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        )}
      </span>

      <span
        className="pill"
        title="Requests shown / captured"
        style={{ color: 'var(--text-muted)' }}
      >
        {props.shownCount === props.totalCount
          ? props.totalCount
          : `${props.shownCount} / ${props.totalCount}`}
      </span>

      <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
        <label
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}
          title="Capture GraphQL subscriptions over WebSocket (requires debugger attachment)"
        >
          <input
            type="checkbox"
            checked={props.wsCapture}
            onChange={(e) => props.onWsCaptureChange(e.target.checked)}
          />
          WS
        </label>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={props.preserveLog}
            onChange={(e) => props.onPreserveLogChange(e.target.checked)}
          />
          Preserve log
        </label>

        <select
          className="field"
          value={props.theme}
          onChange={(e) => props.onThemeChange(e.target.value as ThemeSetting)}
          title="Theme"
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>

        <details style={{ position: 'relative' }}>
          <summary className="btn" style={{ listStyle: 'none' }}>
            Columns ▾
          </summary>
          <div
            style={{
              position: 'absolute',
              right: 0,
              zIndex: 10,
              marginTop: 4,
              padding: 8,
              border: '1px solid var(--border)',
              borderRadius: 6,
              boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
              background: 'var(--bg)',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {ALL_COLUMNS.map((c) => (
              <label key={c} style={{ display: 'flex', gap: 6, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={props.columns.includes(c)}
                  onChange={() => toggleColumn(c)}
                />
                {COLUMN_LABELS[c]}
              </label>
            ))}
          </div>
        </details>

        <button className="btn" onClick={props.onExport} title="Download the session as JSON">
          Export
        </button>
        <button
          className="btn"
          onClick={() => fileInputRef.current?.click()}
          title="Load a previously exported session"
        >
          Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) props.onImport(file);
            e.target.value = '';
          }}
        />
      </span>
    </div>
  );
}
