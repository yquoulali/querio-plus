import React, { useMemo } from 'react';
import { printGraphQL } from '../format/graphql-print';

/** Pretty-printed GraphQL query display (P4; graphql.print, declared non-byte-identical). */
export default function GraphQLView({ query }: { query: string }): React.ReactElement {
  const printed = useMemo(() => printGraphQL(query), [query]);
  return (
    <pre
      className="mono"
      style={{
        margin: 0,
        padding: '10px 12px',
        background: 'var(--bg-subtle)',
        borderRadius: 6,
        overflow: 'auto',
        fontSize: '12px',
        whiteSpace: 'pre',
      }}
    >
      {printed}
    </pre>
  );
}
