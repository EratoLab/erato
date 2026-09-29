import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readComposeRecipients,
  serializeComposeRecipients,
} from "../outlookComposeRecipients";

function field(displayName: string, emailAddress: string) {
  return {
    getAsync: vi.fn((callback) =>
      callback({
        status: Office.AsyncResultStatus.Succeeded,
        value: [{ displayName, emailAddress }],
      }),
    ),
  };
}

afterEach(() => vi.useRealTimers());

describe("compose recipient context", () => {
  it("reads fresh names and addresses grouped by role", async () => {
    const item = {
      to: field("Mark", "mark@example.com"),
      cc: field("Sue", "sue@example.com"),
      bcc: field("Pat", "pat@example.com"),
    };
    expect(
      await readComposeRecipients(item as unknown as Office.MessageCompose),
    ).toEqual({
      to: [{ displayName: "Mark", emailAddress: "mark@example.com" }],
      cc: [{ displayName: "Sue", emailAddress: "sue@example.com" }],
      bcc: [{ displayName: "Pat", emailAddress: "pat@example.com" }],
    });
    item.to = field("Jane", "jane@example.com");
    expect(
      (await readComposeRecipients(item as unknown as Office.MessageCompose))
        ?.to?.[0].displayName,
    ).toBe("Jane");
  });
  it("distinguishes an empty field from failed or unsupported fields", async () => {
    const item = {
      to: {
        getAsync: (callback: (result: unknown) => void) =>
          callback({ status: Office.AsyncResultStatus.Succeeded, value: [] }),
      },
      cc: {
        getAsync: (callback: (result: unknown) => void) =>
          callback({ status: Office.AsyncResultStatus.Failed }),
      },
    };
    expect(
      await readComposeRecipients(item as unknown as Office.MessageCompose),
    ).toEqual({ to: [] });
    expect(
      await readComposeRecipients({} as Office.MessageCompose),
    ).toBeUndefined();
  });
  it("bounds dropped callbacks and retains successful fields", async () => {
    vi.useFakeTimers();
    const item = {
      to: field("Mark", "mark@example.com"),
      cc: { getAsync: vi.fn() },
      bcc: {
        getAsync: () => {
          throw new Error("Unsupported");
        },
      },
    };
    const result = readComposeRecipients(
      item as unknown as Office.MessageCompose,
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toEqual({
      to: [{ displayName: "Mark", emailAddress: "mark@example.com" }],
    });
  });
  it("omits context that would exceed the server byte limit", () => {
    expect(serializeComposeRecipients(undefined)).toBeUndefined();
    expect(serializeComposeRecipients({ to: [] })).toBe('{"to":[]}');
    expect(
      serializeComposeRecipients({
        to: [
          { displayName: "ü".repeat(40000), emailAddress: "mark@example.com" },
        ],
      }),
    ).toBeUndefined();
  });
});
