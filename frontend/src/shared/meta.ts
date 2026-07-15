// Import-map expose entry: re-exports the app-bundle module instance.
// Kits resolve this specifier via the server-emitted import map — do not
// import this file from app code.
// Version handshake for the shared host surface. Bump on breaking changes
// to any shared specifier; kits compare and warn loudly on mismatch.
export const ERATO_SHARED_SURFACE_VERSION = 1;
