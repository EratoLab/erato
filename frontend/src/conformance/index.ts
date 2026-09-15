/**
 * `@erato/frontend/conformance` — host-authored contract tests a component kit
 * runs against its own overrides.
 *
 * Its own package export rather than a corner of `@erato/frontend/shared`,
 * because everything on that surface is an app-bundle entry every end user
 * downloads, and this is test infrastructure. A kit's test resolves the
 * specifier to the built library, never to the running host, so nothing is
 * lost by keeping it off the import map.
 */
export {
  chatHistoryListConformanceFailures,
  type ChatHistoryConformanceHarness,
} from "./chatHistoryList";
