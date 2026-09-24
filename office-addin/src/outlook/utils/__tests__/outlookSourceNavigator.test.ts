import { afterEach, describe, expect, it, vi } from "vitest";

import { createOutlookSourceNavigator } from "../outlookSourceNavigator";

const reference = {
  external_ids: [{ key: "ews_id", value: "AaM+opaque/id==" }],
};
function setup(asyncSupported = true) {
  const displayMessageForm = vi.fn();
  const displayMessageFormAsync = vi.fn(
    (_id: string, callback: (result: { status: string }) => void) =>
      callback({ status: "succeeded" }),
  );
  vi.stubGlobal("Office", {
    AsyncResultStatus: { Failed: "failed" },
    context: {
      mailbox: { displayMessageForm, displayMessageFormAsync },
      requirements: {
        isSetSupported: (_set: string, version: string) =>
          version === "1.1" || asyncSupported,
      },
    },
  });
  return { displayMessageForm, displayMessageFormAsync };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Outlook Office.js source navigator", () => {
  it("opens genuine EWS IDs unchanged with the async API", async () => {
    const api = setup();
    await createOutlookSourceNavigator()!.open(reference);
    expect(api.displayMessageFormAsync).toHaveBeenCalledWith(
      reference.external_ids[0].value,
      expect.any(Function),
    );
    expect(api.displayMessageForm).not.toHaveBeenCalled();
  });
  it("uses Mailbox 1.1 on older Exchange SE hosts", async () => {
    const api = setup(false);
    await createOutlookSourceNavigator()!.open(reference);
    expect(api.displayMessageForm).toHaveBeenCalledWith(
      reference.external_ids[0].value,
    );
    expect(api.displayMessageFormAsync).not.toHaveBeenCalled();
  });
  it("never converts local or Internet message IDs to EWS", () => {
    setup();
    expect(
      createOutlookSourceNavigator()!.canOpen({
        external_ids: [
          { key: "outlook_entry_id", value: "ABCD" },
          { key: "email_message_id", value: "<a@b>" },
        ],
      }),
    ).toBe(false);
  });
  it("propagates async failures without retrying via the sync API", async () => {
    const api = setup();
    api.displayMessageFormAsync.mockImplementation((_id, cb) =>
      cb({ status: "failed" }),
    );
    await expect(
      createOutlookSourceNavigator()!.open(reference),
    ).rejects.toThrow();
    expect(api.displayMessageForm).not.toHaveBeenCalled();
  });
  it("releases the UI if Outlook never invokes the callback", async () => {
    vi.useFakeTimers();
    const api = setup();
    api.displayMessageFormAsync.mockImplementation(() => {});
    const opened = expect(
      createOutlookSourceNavigator()!.open(reference),
    ).rejects.toThrow("Outlook did not respond");
    await vi.advanceTimersByTimeAsync(15_000);
    await opened;
  });
  it("is unavailable without Office.js", () => {
    vi.stubGlobal("Office", undefined);
    expect(createOutlookSourceNavigator()).toBeNull();
  });
});
