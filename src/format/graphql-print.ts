import { parse, print } from 'graphql';

/**
 * Pretty-print a GraphQL query with graphql's own parse+print (canonical 2-space output).
 * P4: this is a DECLARED divergence from Querio, which used Prettier's graphql parser —
 * equivalent in intent, NOT byte-identical (no line-width reflow, input field order
 * preserved). On a parse failure the raw query is returned unchanged (never throws).
 */
export function printGraphQL(query: string): string {
  try {
    return print(parse(query, { noLocation: true }));
  } catch {
    return query;
  }
}
