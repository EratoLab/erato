// Import-map expose entry: re-exports the add-in-bundle module instance.
// Kits loaded in the add-in resolve this specifier via the import map the
// backend injects into add-in HTML.
export * from "@tanstack/react-query";
