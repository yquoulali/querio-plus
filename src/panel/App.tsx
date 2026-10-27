import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import Toolbar from '../components/Toolbar';
import RequestList from '../components/RequestList';
import RequestDetail from '../components/RequestDetail';
import DiffModal from '../components/DiffModal';
import WaterfallView from '../components/WaterfallView';
import { getSnapshot, subscribe, clear, replaceAll } from '../capture/store';
import { resetSeenEntries } from '../capture/dedup';
import { applyFilter, emptyFilter, type FilterState } from '../features/filter';
import { searchIds } from '../features/search';
import { exportSessionWithBodies, importSession } from '../features/session';
import {
  applyTheme,
  loadColumns,
  loadColumnWidths,
  loadSplitRatio,
  loadTheme,
  loadViewMode,
  loadWsCapture,
  saveColumns,
  saveColumnWidths,
  saveSplitRatio,
  saveTheme,
  saveViewMode,
  saveWsCapture,
  setPreserveLog as setPreserveLogGlobal,
  DEFAULT_COLUMNS,
  DEFAULT_COLUMN_WIDTHS,
  type ColumnKey,
  type ThemeSetting,
  type ViewMode,
} from '../settings';
import type { CapturedEntry } from '../types';

/** State for the diff comparison feature */
interface DiffState {
  /** First request selected for comparison */
  left: CapturedEntry | null;
  /** When true, user is selecting the second request */
  selecting: boolean;
}

function download(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function App(): React.ReactElement {
  const entries = useSyncExternalStore(subscribe, getSnapshot);

  const [filter, setFilter] = useState<FilterState>(emptyFilter);
  const [search, setSearch] = useState('');
  const [theme, setTheme] = useState<ThemeSetting>('system');
  const [preserveLog, setPreserveLog] = useState(false);
  const [wsCapture, setWsCapture] = useState(false);
  const [columns, setColumns] = useState<ColumnKey[]>(DEFAULT_COLUMNS);
  const [columnWidths, setColumnWidths] =
    useState<Record<ColumnKey, number>>(DEFAULT_COLUMN_WIDTHS);
  const [splitRatio, setSplitRatio] = useState(0.46);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [diffState, setDiffState] = useState<DiffState>({ left: null, selecting: false });
  const [diffRight, setDiffRight] = useState<CapturedEntry | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const splitContainerRef = useRef<HTMLDivElement>(null);

  // Load persisted settings once on mount; apply stored theme over the inline bootstrap (P8).
  useEffect(() => {
    void loadTheme().then((t) => {
      setTheme(t);
      applyTheme(t);
    });
    void loadColumns().then(setColumns);
    void loadColumnWidths().then(setColumnWidths);
    void loadSplitRatio().then(setSplitRatio);
    void loadWsCapture().then(setWsCapture);
    void loadViewMode().then(setViewMode);
  }, []);

  const onColumnWidthChange = useCallback((col: ColumnKey, width: number) => {
    setColumnWidths((prev) => {
      const next = { ...prev, [col]: width };
      saveColumnWidths(next);
      return next;
    });
  }, []);

  // Drag the gutter between the list and the detail pane; persist the ratio.
  const onGutterPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const ratio = (ev.clientX - rect.left) / rect.width;
      const clamped = Math.min(0.85, Math.max(0.15, ratio));
      setSplitRatio(clamped);
    };
    const up = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      setSplitRatio((r) => {
        saveSplitRatio(r);
        return r;
      });
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  }, []);

  const onThemeChange = (next: ThemeSetting) => {
    setTheme(next);
    applyTheme(next);
    saveTheme(next);
  };

  const onColumnsChange = (next: ColumnKey[]) => {
    setColumns(next);
    saveColumns(next);
  };

  const onPreserveLogChange = (next: boolean) => {
    setPreserveLog(next);
    setPreserveLogGlobal(next);
  };

  const onWsCaptureChange = (next: boolean) => {
    setWsCapture(next);
    saveWsCapture(next);
    // Notify main.tsx to start/stop WebSocket capture
    window.dispatchEvent(new CustomEvent('querio-ws-capture-change', { detail: next }));
  };

  const onViewModeChange = (next: ViewMode) => {
    setViewMode(next);
    saveViewMode(next);
  };

  // Full-text search (F7): match already-cached response bodies (resolved cache value
  // on the entry) + request-side text; never fetches here.
  const searchMatchIds = useMemo(() => {
    if (!search.trim()) return undefined;
    return searchIds(entries, search, (e) => e.responseBody);
  }, [entries, search]);

  const filtered = useMemo(() => {
    let rows = applyFilter(entries, filter);
    if (searchMatchIds) rows = rows.filter((e) => searchMatchIds.has(e.id));
    return rows;
  }, [entries, filter, searchMatchIds]);

  const selected = filtered.find((e) => e.id === selectedId) ?? entries.find((e) => e.id === selectedId);

  /** Start diff comparison mode with the currently selected request */
  const onStartCompare = useCallback((entry: CapturedEntry) => {
    setDiffState({ left: entry, selecting: true });
  }, []);

  /** Handle clicking a row while in diff selection mode */
  const onSelectForDiff = useCallback(
    (id: string) => {
      if (!diffState.selecting || !diffState.left) {
        setSelectedId(id);
        return;
      }
      // Don't compare the same request
      if (id === diffState.left.id) return;
      const right = entries.find((e) => e.id === id);
      if (right) {
        setDiffRight(right);
        setDiffState({ left: diffState.left, selecting: false });
      }
    },
    [diffState, entries],
  );

  /** Cancel diff selection mode */
  const onCancelDiffSelect = useCallback(() => {
    setDiffState({ left: null, selecting: false });
  }, []);

  /** Close the diff modal */
  const onCloseDiff = useCallback(() => {
    setDiffRight(null);
    setDiffState({ left: null, selecting: false });
  }, []);

  const onExport = () => {
    void exportSessionWithBodies(entries).then((session) =>
      download('querio-plus-session.json', JSON.stringify(session, null, 2)),
    );
  };

  const onImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const imported: CapturedEntry[] = importSession(parsed);
        replaceAll(imported);
        setSelectedId(undefined);
        resetSeenEntries();
      } catch {
        /* ignore malformed import */
      }
    };
    reader.readAsText(file);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', minHeight: 0 }}>
      <Toolbar
        filter={filter}
        onFilterChange={setFilter}
        search={search}
        onSearchChange={setSearch}
        theme={theme}
        onThemeChange={onThemeChange}
        preserveLog={preserveLog}
        onPreserveLogChange={onPreserveLogChange}
        wsCapture={wsCapture}
        onWsCaptureChange={onWsCaptureChange}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        columns={columns}
        onColumnsChange={onColumnsChange}
        onClear={() => {
          clear();
          resetSeenEntries();
          setSelectedId(undefined);
          setDiffState({ left: null, selecting: false });
        }}
        onExport={onExport}
        onImport={onImport}
        shownCount={filtered.length}
        totalCount={entries.length}
      />

      {/* Diff selection banner */}
      {diffState.selecting && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: '10px 16px',
            background: 'var(--color-info)',
            color: '#fff',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          <span>
            Select another request to compare with <strong>{diffState.left?.name}</strong>
          </span>
          <button
            className="btn btn-sm"
            onClick={onCancelDiffSelect}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              color: '#fff',
            }}
          >
            Cancel
          </button>
        </div>
      )}

      <div ref={splitContainerRef} style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div
          style={{
            flex: selected && viewMode === 'list' ? `0 0 ${(splitRatio * 100).toFixed(2)}%` : '1 1 100%',
            minWidth: 0,
          }}
        >
          {viewMode === 'list' ? (
            <RequestList
              entries={filtered}
              columns={columns}
              columnWidths={columnWidths}
              onColumnWidthChange={onColumnWidthChange}
              selectedId={selectedId}
              onSelect={onSelectForDiff}
              totalCount={entries.length}
              diffSelectingId={diffState.selecting ? diffState.left?.id : undefined}
            />
          ) : (
            <WaterfallView
              entries={filtered}
              selectedId={selectedId}
              onSelect={onSelectForDiff}
              diffSelectingId={diffState.selecting ? diffState.left?.id : undefined}
            />
          )}
        </div>
        {selected && !diffState.selecting && viewMode === 'list' && (
          <>
            <div
              onPointerDown={onGutterPointerDown}
              style={{
                flex: '0 0 auto',
                width: 6,
                cursor: 'col-resize',
                background: 'var(--border)',
                touchAction: 'none',
                transition: 'background 0.12s',
              }}
              title="Drag to resize"
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <RequestDetail
                entry={selected}
                onClose={() => setSelectedId(undefined)}
                onCompare={() => onStartCompare(selected)}
              />
            </div>
          </>
        )}
      </div>

      {/* Diff modal */}
      {diffState.left && diffRight && (
        <DiffModal left={diffState.left} right={diffRight} onClose={onCloseDiff} />
      )}
    </div>
  );
}
