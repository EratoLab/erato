import { describe, expect, it } from "vitest";

import { applyWordDraftPatches } from "../wordDocumentDrafts";
import { MAX_PLAN_BYTES } from "../wordDocumentPlan";

describe("Word draft patch protocol", () => {
  const plan = {
    version: 1,
    snapshot: "snapshot",
    readToken: "read",
    scope: "body",
    entries: [{ kind: "keep", source: ["b1"] }],
  };
  it("applies ordered array edits without changing its input", () => {
    const result = applyWordDraftPatches(plan, [
      {
        op: "add",
        path: "/entries/-",
        value: { kind: "keep", source: ["b2"] },
      },
      { op: "replace", path: "/entries/0/source/0", value: "b3" },
      { op: "remove", path: "/entries/1" },
    ]);
    expect(result.entries).toEqual([{ kind: "keep", source: ["b3"] }]);
    expect(plan.entries[0].source).toEqual(["b1"]);
  });
  it.each([
    "/snapshot",
    "/readToken",
    "/version",
    "",
    "/entries/-",
    "/entries/01",
    "/entries/length",
    "/entries/0/__proto__/polluted",
    "/entries/0/constructor/prototype/x",
    "/entries/99",
    "/entries/0/bad~escape",
    "/deleted/0",
  ])("rejects invalid or immutable path %s", (path) => {
    expect(() =>
      applyWordDraftPatches(plan, [{ op: "replace", path, value: true }]),
    ).toThrow();
    expect(Object.prototype).not.toHaveProperty("polluted");
  });
  it("supports escaped JSON Pointer segments", () => {
    const input = { ...plan, entries: [{ "a/b~c": 1 }] };
    expect(
      applyWordDraftPatches(input, [
        { op: "replace", path: "/entries/0/a~1b~0c", value: 2 },
      ]).entries,
    ).toEqual([{ "a/b~c": 2 }]);
  });

  it("can address a leaf through deeply nested table structures", () => {
    let nested: unknown = { text: "before" };
    for (let depth = 0; depth < 12; depth++)
      nested = { rows: [{ cells: [{ blocks: [nested] }] }] };
    const input = { ...plan, entries: [nested] };
    const path = `/entries/0${"/rows/0/cells/0/blocks/0".repeat(12)}/text`;
    const output = applyWordDraftPatches(input, [
      { op: "replace", path, value: "after" },
    ]);
    expect(JSON.stringify(output)).toContain('"text":"after"');
    expect(JSON.stringify(input)).toContain('"text":"before"');
  });
  it("bounds patch counts, values and accepted operations", () => {
    for (const patches of [
      [],
      Array(33).fill({ op: "remove", path: "/entries/0" }),
      [{ op: "copy", from: "/entries/0", path: "/entries/1" }],
      [{ op: "add", path: "/entries/-" }],
      [{ op: "remove", path: "/entries/0", value: null }],
      [{ op: "add", path: "/entries/-", value: "x".repeat(MAX_PLAN_BYTES) }],
    ])
      expect(() => applyWordDraftPatches(plan, patches)).toThrow();
  });
});
