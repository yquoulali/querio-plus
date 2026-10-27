import React, { useMemo, useRef, useEffect, useState } from 'react';
import type { CapturedEntry, RequestTimings } from '../types';

/**
 * Timing phase configuration for waterfall visualization.
 * Each phase has a color and label for the legend/tooltip.
 */
const TIMING_PHASES = [
  { key: 'blocked', color: '#a1a1aa', label: 'Blocked' },     // gray
  { key: 'dns', color: '#22c55e', label: 'DNS' },             // green
  { key: 'connect', color: '#f97316', label: 'Connect' },     // orange
  { key: 'ssl', color: '#a855f7', label: 'SSL' },             // purple
  { key: 'send', color: '#eab308', label: 'Send' },           // yellow
  { key: 'wait', color: '#3b82f6', label: 'Wait (TTFB)' },    // blue
  { key: 'receive', color: '#10b981', label: 'Receive' },     // emerald
] as const;

type TimingKey = (typeof TIMING_PHASES)[number]['key'];

interface WaterfallViewProps {
  entries: ReadonlyArray<CapturedEntry>;
  selectedId?: string;
  onSelect: (id: string) => void;
  diffSelectingId?: string;
}

/** Format milliseconds for display */
function formatTime(ms: number): string {
  if (ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Calculate the sum of positive timing phases */
function sumTimings(timings: RequestTimings | undefined): number {
  if (!timings) return 0;
  return TIMING_PHASES.reduce((sum, phase) => {
    const val = timings[phase.key as TimingKey];
    return sum + (val > 0 ? val : 0);
  }, 0);
}

/** Get timing value, treating -1 as 0 for display */
function getTimingValue(timings: RequestTimings | undefined, key: TimingKey): number {
  if (!timings) return 0;
  const val = timings[key];
  return val > 0 ? val : 0;
}

/** Method/kind badge (same as RequestList) */
function badgeFor(entry: CapturedEntry): { label: string; color: string } {
  if (entry.kind === 'graphql') {
    const type = entry.operation?.type ?? 'query';
    if (entry.method === 'WS' || type === 'subscription') {
      return { label: 'GQL·SUB', color: 'var(--gql-subscription)' };
    }
    const color = type === 'mutation' ? 'var(--gql-mutation)' : 'var(--gql-query)';
    const short = type === 'mutation' ? 'MUT' : 'QRY';
    return { label: `GQL·${short}`, color };
  }
  const method = entry.method.toUpperCase();
  const colorByMethod: Record<string, string> = {
    GET: 'var(--method-get)',
    POST: 'var(--method-post)',
    PUT: 'var(--method-put)',
    PATCH: 'var(--method-patch)',
    DELETE: 'var(--method-delete)',
  };
  return { label: method, color: colorByMethod[method] ?? 'var(--method-other)' };
}

/** Status dot color */
function statusColor(status: number): string {
  if (status === 0) return 'var(--color-error)';
  if (status >= 500) return 'var(--color-error)';
  if (status >= 400) return 'var(--color-warning)';
  if (status >= 300) return 'var(--color-info)';
  if (status >= 200) return 'var(--color-success)';
  return 'var(--text-muted)';
}

/** Timing breakdown tooltip content */
function TimingTooltip({ timings, total }: { timings: RequestTimings | undefined; total: number }) {
  if (!timings) {
    return (
      <div style={{ padding: '8px 12px', fontSize: 11 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Total: {formatTime(total)}</div>
        <div style={{ color: 'var(--text-muted)' }}>Timing breakdown not available</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 12px', fontSize: 11, minWidth: 180 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Total: {formatTime(total)}</div>
      {TIMING_PHASES.map(({ key, color, label }) => {
        const val = getTimingValue(timings, key);
        if (val <= 0) return null;
        return (
          <div
            key={key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 2,
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: color,
                flex: '0 0 auto',
              }}
            />
            <span style={{ flex: 1 }}>{label}</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
              {formatTime(val)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Single waterfall bar with timing segments */
function WaterfallBar({
  entry,
  startTime,
  endTime,
  width,
}: {
  entry: CapturedEntry;
  startTime: number;
  endTime: number;
  width: number;
}) {
  const entryStart = entry.startedDateTime ? new Date(entry.startedDateTime).getTime() : startTime;
  const duration = entry.time;
  const totalRange = endTime - startTime;

  // Calculate position and width as percentages
  const leftPercent = totalRange > 0 ? ((entryStart - startTime) / totalRange) * 100 : 0;
  const widthPercent = totalRange > 0 ? (duration / totalRange) * 100 : 100;

  // Calculate segment widths within the bar
  const segments: Array<{ color: string; widthPercent: number; key: string }> = [];
  const timingsSum = sumTimings(entry.timings);

  if (entry.timings && timingsSum > 0) {
    let accumulated = 0;
    for (const phase of TIMING_PHASES) {
      const val = getTimingValue(entry.timings, phase.key);
      if (val > 0) {
        segments.push({
          key: phase.key,
          color: phase.color,
          widthPercent: (val / timingsSum) * 100,
        });
        accumulated += val;
      }
    }
  } else {
    // No timing breakdown, show single bar
    segments.push({
      key: 'total',
      color: entry.errorState === 'error' ? 'var(--color-error)' : 'var(--color-info)',
      widthPercent: 100,
    });
  }

  return (
    <div
      style={{
        position: 'relative',
        height: 12,
        width,
        background: 'var(--bg-subtle)',
        borderRadius: 2,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: `${leftPercent}%`,
          width: `${Math.max(widthPercent, 0.5)}%`,
          height: '100%',
          display: 'flex',
          borderRadius: 2,
          overflow: 'hidden',
          minWidth: 2,
        }}
      >
        {segments.map((seg) => (
          <div
            key={seg.key}
            style={{
              width: `${seg.widthPercent}%`,
              height: '100%',
              background: seg.color,
              minWidth: seg.widthPercent > 0 ? 1 : 0,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** Time ruler with tick marks */
function TimeRuler({ startTime, endTime, width }: { startTime: number; endTime: number; width: number }) {
  const duration = endTime - startTime;
  if (duration <= 0) return null;

  // Calculate nice tick intervals
  const targetTicks = Math.floor(width / 100); // ~100px between ticks
  const rawInterval = duration / Math.max(targetTicks, 1);
  
  // Round to nice intervals (1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, ...)
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)));
  const normalized = rawInterval / magnitude;
  let niceInterval: number;
  if (normalized <= 1) niceInterval = 1 * magnitude;
  else if (normalized <= 2) niceInterval = 2 * magnitude;
  else if (normalized <= 5) niceInterval = 5 * magnitude;
  else niceInterval = 10 * magnitude;

  // Generate ticks
  const ticks: Array<{ position: number; label: string }> = [];
  const firstTick = Math.ceil(0 / niceInterval) * niceInterval;
  for (let t = firstTick; t <= duration; t += niceInterval) {
    ticks.push({
      position: (t / duration) * 100,
      label: formatTime(t),
    });
  }

  return (
    <div
      style={{
        position: 'relative',
        height: 20,
        width,
        borderBottom: '1px solid var(--border)',
        fontSize: 10,
        color: 'var(--text-muted)',
      }}
    >
      {ticks.map((tick, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: `${tick.position}%`,
            top: 0,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <span style={{ whiteSpace: 'nowrap', transform: 'translateX(-50%)' }}>{tick.label}</span>
          <div
            style={{
              width: 1,
              flex: 1,
              background: 'var(--border)',
            }}
          />
        </div>
      ))}
    </div>
  );
}

/** Legend showing timing phase colors */
function WaterfallLegend() {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '12px 16px',
        padding: '8px 12px',
        borderBottom: '1px solid var(--border)',
        fontSize: 11,
        color: 'var(--text-muted)',
      }}
    >
      {TIMING_PHASES.map(({ key, color, label }) => (
        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 12,
              height: 8,
              borderRadius: 2,
              background: color,
            }}
          />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

export default function WaterfallView({
  entries,
  selectedId,
  onSelect,
  diffSelectingId,
}: WaterfallViewProps): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // Calculate time range across all entries
  const { startTime, endTime } = useMemo(() => {
    if (entries.length === 0) {
      return { startTime: 0, endTime: 0 };
    }

    let minStart = Infinity;
    let maxEnd = -Infinity;

    for (const entry of entries) {
      const entryStart = entry.startedDateTime
        ? new Date(entry.startedDateTime).getTime()
        : 0;
      const entryEnd = entryStart + entry.time;

      if (entryStart > 0 && entryStart < minStart) minStart = entryStart;
      if (entryEnd > maxEnd) maxEnd = entryEnd;
    }

    // Fallback if no valid timestamps
    if (minStart === Infinity) {
      minStart = 0;
      maxEnd = entries.reduce((max, e) => Math.max(max, e.time), 0);
    }

    return { startTime: minStart, endTime: maxEnd };
  }, [entries]);

  // Keep selected row visible
  useEffect(() => {
    if (!selectedId) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(selectedId)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const handleMouseEnter = (entry: CapturedEntry, e: React.MouseEvent) => {
    setHoveredId(entry.id);
    setTooltipPos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseLeave = () => {
    setHoveredId(null);
    setTooltipPos(null);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (hoveredId) {
      setTooltipPos({ x: e.clientX, y: e.clientY });
    }
  };

  const hoveredEntry = hoveredId ? entries.find((e) => e.id === hoveredId) : null;

  const BAR_WIDTH = 300; // Fixed width for waterfall bars

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        fontSize: 12,
      }}
    >
      {/* Legend */}
      <WaterfallLegend />

      {/* Scrollable content */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
        }}
        onMouseMove={handleMouseMove}
      >
        {entries.length === 0 ? (
          <div style={{ padding: 28, color: 'var(--text-muted)', textAlign: 'center' }}>
            <div style={{ fontWeight: 600, color: 'var(--text)' }}>No requests to display</div>
            <div>Trigger traffic in the inspected page to see the waterfall.</div>
          </div>
        ) : (
          <div style={{ minWidth: 'fit-content' }}>
            {/* Header row */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                height: 30,
                position: 'sticky',
                top: 0,
                background: 'var(--bg-subtle)',
                borderBottom: '1px solid var(--border)',
                zIndex: 2,
                fontWeight: 600,
                fontSize: 11,
                letterSpacing: 0.3,
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
              }}
            >
              <div style={{ width: 70, padding: '0 10px', flex: '0 0 70px' }}>Kind</div>
              <div style={{ width: 200, padding: '0 10px', flex: '0 0 200px' }}>Name</div>
              <div style={{ width: 60, padding: '0 10px', flex: '0 0 60px', textAlign: 'center' }}>Status</div>
              <div style={{ width: 70, padding: '0 10px', flex: '0 0 70px', textAlign: 'right' }}>Time</div>
              <div style={{ flex: '1 1 auto', minWidth: BAR_WIDTH, padding: '0 10px' }}>
                <TimeRuler startTime={startTime} endTime={endTime} width={BAR_WIDTH} />
              </div>
            </div>

            {/* Rows */}
            {entries.map((entry, i) => {
              const isSelected = entry.id === selectedId;
              const isDiffBase = entry.id === diffSelectingId;
              const isError = entry.errorState === 'error';
              const { label, color } = badgeFor(entry);

              return (
                <div
                  key={entry.id}
                  data-id={entry.id}
                  onClick={() => onSelect(entry.id)}
                  onMouseEnter={(e) => handleMouseEnter(entry, e)}
                  onMouseLeave={handleMouseLeave}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    minHeight: 32,
                    cursor: 'pointer',
                    borderBottom: '1px solid var(--border)',
                    borderLeft: `3px solid ${isDiffBase ? 'var(--color-info)' : isSelected ? 'var(--color-brand)' : 'transparent'}`,
                    background: isDiffBase
                      ? 'rgba(59, 130, 246, 0.15)'
                      : i % 2 === 1
                        ? 'var(--bg-subtle)'
                        : 'transparent',
                    boxShadow: isError
                      ? 'inset 0 0 0 9999px color-mix(in srgb, var(--color-error) 6%, transparent)'
                      : undefined,
                    color: isError ? 'var(--color-error)' : 'var(--text)',
                  }}
                >
                  {/* Kind badge */}
                  <div style={{ width: 70, padding: '0 10px', flex: '0 0 70px' }}>
                    <span
                      style={{
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
                  </div>

                  {/* Name */}
                  <div
                    style={{
                      width: 200,
                      padding: '0 10px',
                      flex: '0 0 200px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={entry.name}
                  >
                    {entry.name}
                  </div>

                  {/* Status */}
                  <div
                    style={{
                      width: 60,
                      padding: '0 10px',
                      flex: '0 0 60px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: statusColor(entry.status),
                      }}
                    />
                    {entry.status === 0 ? '—' : entry.status}
                  </div>

                  {/* Time */}
                  <div
                    style={{
                      width: 70,
                      padding: '0 10px',
                      flex: '0 0 70px',
                      textAlign: 'right',
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                    }}
                  >
                    {formatTime(entry.time)}
                  </div>

                  {/* Waterfall bar */}
                  <div style={{ flex: '1 1 auto', minWidth: BAR_WIDTH, padding: '0 10px' }}>
                    <WaterfallBar
                      entry={entry}
                      startTime={startTime}
                      endTime={endTime}
                      width={BAR_WIDTH}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Tooltip */}
      {hoveredEntry && tooltipPos && (
        <div
          style={{
            position: 'fixed',
            left: tooltipPos.x + 10,
            top: tooltipPos.y + 10,
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000,
            pointerEvents: 'none',
          }}
        >
          <TimingTooltip timings={hoveredEntry.timings} total={hoveredEntry.time} />
        </div>
      )}
    </div>
  );
}
