import "@testing-library/jest-dom/vitest";

// Node 25 ships an experimental top-level `localStorage` that vitest enables
// via `--localstorage-file`, but without a valid path it surfaces an object
// whose methods aren't callable. Replace with a deterministic in-memory
// implementation before any module-load side effects run (zustand stores in
// the library read `localStorage` during import).
{
  const store = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: stub,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: stub,
    });
  }
}

/**
 * Minimal Office.js global stub for unit tests.
 *
 * Provides only shared enums and a bare context object.
 * Host-specific context (e.g. `context.mailbox` for Outlook,
 * `context.workbook` for Excel) should be wired up by
 * host-specific mock factories or individual tests.
 */
const officeMock = {
  CoercionType: {
    Text: "text",
    Html: "html",
  },
  AsyncResultStatus: {
    Succeeded: "succeeded",
    Failed: "failed",
  },
  EventType: {
    ItemChanged: "itemChanged",
    OfficeThemeChanged: "officeThemeChanged",
  },
  context: {} as Record<string, unknown>,
};

(globalThis as Record<string, unknown>).Office = officeMock;
