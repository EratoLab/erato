/**
 * `@erato/frontend/conformance` — host-authored contract tests a component kit
 * runs against its own overrides. Its own package export, not a corner of
 * `@erato/frontend/shared`: everything on that surface is an app-bundle entry
 * every end user downloads, and a kit's test resolves this specifier to the
 * built library either way, so the split costs nothing.
 */
export {
  chatHistoryListConformanceFailures,
  type ChatHistoryConformanceHarness,
} from "./chatHistoryList";
