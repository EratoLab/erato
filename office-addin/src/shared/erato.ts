// Import-map expose entry: re-exports the add-in-bundle module instance.
// Kits loaded in the add-in resolve this specifier via the import map the
// backend injects into add-in HTML.
// Same compilation as the library the add-in app runs on: `shared.mjs` and
// `library.mjs` are sibling entries sharing chunk module instances.
export * from "@erato/frontend/shared";
