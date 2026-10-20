import { describe, expect, it } from "vitest";

import { findComposerSendLimit } from "../composerSendLimit";

const limits = { maxBytes: 100, maxFormatted: "100 B", maxFiles: 3 };

const staged = (filename: string, size?: number) => ({
  filename,
  ...(size === undefined ? {} : { size }),
});

describe("findComposerSendLimit", () => {
  it("passes when every part fits and the count is within the cap", () => {
    expect(
      findComposerSendLimit(
        [{ name: "thread.eml", size: 100 }],
        [staged("a.pdf", 10), staged("b.pdf")],
        limits,
      ),
    ).toBeNull();
  });

  it("names every oversized upload and staged file, per file not summed", () => {
    expect(
      findComposerSendLimit(
        [
          { name: "thread.eml", size: 60 },
          { name: "drop.eml", size: 101 },
        ],
        [staged("big.pdf", 150), staged("small.pdf", 60)],
        limits,
      ),
    ).toEqual({
      names: ["drop.eml", "big.pdf"],
      formatted: "100 B",
      kind: "size",
    });
  });

  it("reports the count cap once every part fits", () => {
    expect(
      findComposerSendLimit(
        [
          { name: "thread.eml", size: 1 },
          { name: "drop.eml", size: 1 },
        ],
        [staged("a.pdf", 1), staged("b.pdf", 1)],
        limits,
      ),
    ).toEqual({ names: [], formatted: "3", kind: "count" });
  });

  it("prefers the size verdict over the count verdict", () => {
    expect(
      findComposerSendLimit(
        [{ name: "drop.eml", size: 101 }],
        [staged("a.pdf"), staged("b.pdf"), staged("c.pdf")],
        limits,
      )?.kind,
    ).toBe("size");
  });

  it("counts staged files alone against the cap", () => {
    expect(
      findComposerSendLimit(
        [],
        [staged("a.pdf"), staged("b.pdf"), staged("c.pdf"), staged("d.pdf")],
        limits,
      ),
    ).toEqual({ names: [], formatted: "3", kind: "count" });
  });
});
