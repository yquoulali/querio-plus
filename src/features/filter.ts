import type { CapturedEntry, GraphQLOperationType } from '../types';

export type TypeFilter = GraphQLOperationType | 'http';

export interface FilterState {
  /** operation name substring (case-insensitive) */
  name: string;
  /** operation type(s): query/mutation/subscription/http. Empty = all. */
  types: ReadonlyArray<TypeFilter>;
  /** HTTP status: exact code (e.g. '404') or class ('2xx','4xx','5xx'). Empty = all. */
  status: string;
  /** URL substring (case-insensitive) */
  url: string;
  /** when true, only error rows (I2 predicate) pass */
  errorsOnly: boolean;
}

export const emptyFilter: FilterState = {
  name: '',
  types: [],
  status: '',
  url: '',
  errorsOnly: false,
};

function entryType(entry: CapturedEntry): TypeFilter {
  if (entry.kind === 'http') return 'http';
  return entry.operation?.type ?? 'query';
}

function matchesStatus(status: number, filter: string): boolean {
  const f = filter.trim().toLowerCase();
  if (!f) return true;
  if (/^[1-5]xx$/.test(f)) {
    return Math.floor(status / 100) === Number(f[0]);
  }
  const code = Number(f);
  return Number.isFinite(code) ? status === code : true;
}

/** A row is an error when its resolved tri-state errorState is 'error' (I2). */
export function isErrorRow(entry: CapturedEntry): boolean {
  return entry.errorState === 'error';
}

/** Build a single pure predicate from filter state (AND semantics; empty = pass-through). */
export function makeFilter(state: FilterState): (entry: CapturedEntry) => boolean {
  const name = state.name.trim().toLowerCase();
  const url = state.url.trim().toLowerCase();
  const typeSet = new Set(state.types);

  return (entry) => {
    if (name && !entry.name.toLowerCase().includes(name)) return false;
    if (typeSet.size > 0 && !typeSet.has(entryType(entry))) return false;
    if (!matchesStatus(entry.status, state.status)) return false;
    if (url && !entry.url.toLowerCase().includes(url)) return false;
    if (state.errorsOnly && !isErrorRow(entry)) return false;
    return true;
  };
}

/** Apply a filter state to a list of entries. */
export function applyFilter(
  entries: ReadonlyArray<CapturedEntry>,
  state: FilterState,
): CapturedEntry[] {
  return entries.filter(makeFilter(state));
}
