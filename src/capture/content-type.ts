import type { HeaderPair } from '../types';

/**
 * True when `headers` contains a `content-type` whose first `;`-split segment equals
 * `contentType` (both compared case-insensitively). Mirrors the reference `isContentType`
 * (RE §4): `name.toLowerCase() === 'content-type' && value.split(';')[0].toLowerCase() === ct`.
 * Pure — no chrome APIs.
 */
export function isContentType(
  headers: ReadonlyArray<HeaderPair>,
  contentType: string,
): boolean {
  const target = contentType.toLowerCase();
  return headers.some(
    ({ name, value }) =>
      name.toLowerCase() === 'content-type' &&
      value.split(';')[0]?.trim().toLowerCase() === target,
  );
}

/**
 * Read a param value by name from a `{name,value}[]` list, VERBATIM — no decoding.
 * Decoding is parse-entry.ts's single responsibility; these helpers read raw.
 */
export function getParamValue(
  name: string,
  params: ReadonlyArray<{ name: string; value: string }> = [],
): string | undefined {
  return params.find((p) => p.name === name)?.value;
}
