import { afterEach, describe, expect, it, vi } from "vitest";

import { readWordCoauthoring } from "../wordCoauthoring";

/** Word.Coauthoring as Office.js exposes it: values are readable only after the batch syncs. */
function installCoauthoring({
  supported = true,
  authors = 1,
  pendingUpdates = false,
  failSync = false,
}: {
  supported?: boolean;
  authors?: number;
  pendingUpdates?: boolean;
  failSync?: boolean;
} = {}) {
  const isSetSupported = vi.fn(
    (name: string, version?: string) =>
      supported && name === "WordApiDesktop" && version === "1.4",
  );
  vi.stubGlobal("Office", { context: { requirements: { isSetSupported } } });
  const loads: string[] = [];
  let synced = false;
  const notLoaded = () => {
    throw new Error("PropertyNotLoaded");
  };
  const coauthoring = {
    get pendingUpdates() {
      return synced ? pendingUpdates : notLoaded();
    },
    load: (property: string) => loads.push(`coauthoring:${property}`),
    authors: {
      get items() {
        return synced
          ? Array.from({ length: authors }, (_, i) => ({ id: `author-${i}` }))
          : notLoaded();
      },
      load: (property: string) => loads.push(`authors:${property}`),
    },
  };
  const run = vi.fn(
    async (callback: (context: unknown) => Promise<unknown>) =>
      await callback({
        document: { coauthoring },
        sync: async () => {
          if (failSync) throw new Error("GeneralException");
          synced = true;
        },
      }),
  );
  vi.stubGlobal("Word", { run });
  return { isSetSupported, run, loads };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readWordCoauthoring", () => {
  it("is undefined without WordApiDesktop 1.4, and never asks Word", async () => {
    const host = installCoauthoring({ supported: false, authors: 2 });
    await expect(readWordCoauthoring()).resolves.toBeUndefined();
    expect(host.isSetSupported).toHaveBeenCalledWith("WordApiDesktop", "1.4");
    expect(host.run).not.toHaveBeenCalled();
  });

  it("is undefined when Word fails the read", async () => {
    installCoauthoring({ authors: 2, failSync: true });
    await expect(readWordCoauthoring()).resolves.toBeUndefined();
  });

  it("is undefined outside an Office host", async () => {
    vi.stubGlobal("Office", undefined);
    await expect(readWordCoauthoring()).resolves.toBeUndefined();
  });

  it("reports others editing when Word lists a second author, in one batch", async () => {
    const host = installCoauthoring({ authors: 2 });
    await expect(readWordCoauthoring()).resolves.toEqual({
      authors: 2,
      pendingUpdates: false,
      othersEditing: true,
    });
    expect(host.run).toHaveBeenCalledOnce();
    expect(host.loads).toEqual([
      "coauthoring:pendingUpdates",
      "authors:items/id",
    ]);
  });

  it("reports others editing when their changes are waiting to merge", async () => {
    installCoauthoring({ authors: 1, pendingUpdates: true });
    await expect(readWordCoauthoring()).resolves.toMatchObject({
      othersEditing: true,
    });
  });

  it("reports nobody else when the user is the only author", async () => {
    installCoauthoring({ authors: 1 });
    await expect(readWordCoauthoring()).resolves.toEqual({
      authors: 1,
      pendingUpdates: false,
      othersEditing: false,
    });
  });
});
