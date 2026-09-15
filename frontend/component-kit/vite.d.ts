/** All bare specifiers that component-kit bundles must leave external. */
export const eratoComponentKitExternals: readonly string[];

/** Packages a kit's test build must resolve to a single copy (vitest `resolve.dedupe`). */
export const eratoComponentKitTestDedupe: readonly string[];
