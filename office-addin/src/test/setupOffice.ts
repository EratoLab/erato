import "@testing-library/jest-dom/vitest";

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
  },
  context: {} as Record<string, unknown>,
};

(globalThis as Record<string, unknown>).Office = officeMock;
