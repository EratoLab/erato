import { describe, expect, it } from "vitest";

import {
  examplePlan,
  readySnapshot,
} from "../../../test/mocks/word/authoringFixtures";
import {
  parseWordDocumentPlan,
  validateWordDocumentPlan,
  wordPlanOutput,
} from "../wordDocumentPlan";

describe("structural plan ownership and schema", () => {
  it("supports reordered nonadjacent merges, splits and explicit removal", () => {
    const s = readySnapshot();
    const p = examplePlan(s.token);
    expect(validateWordDocumentPlan(p, s)).toBeNull();
    expect(wordPlanOutput(p, s).map((x) => x.block.text)).toEqual([
      "Recommendation",
      "Pilot in October. Retain support.",
      "Context",
      "Background",
      "Two regions.",
      "Review at month end.",
    ]);
    expect(parseWordDocumentPlan(JSON.stringify(p))).toEqual(p);
  });
  it.each(["missing", "duplicate", "unknown"])(
    "rejects %s source ownership",
    (kind) => {
      const s = readySnapshot();
      const p = examplePlan(s.token);
      if (kind === "missing") p.deleted = [];
      if (kind === "duplicate")
        p.entries.push({ kind: "keep", source: ["b1"] });
      if (kind === "unknown") p.deleted[0].source = ["b99"];
      expect(validateWordDocumentPlan(p, s)).toBe("invalid");
    },
  );
  it("requires completed reads and the proof returned to the model", () => {
    const s = readySnapshot();
    const p = examplePlan(s.token);
    s.read.delete("b6");
    expect(validateWordDocumentPlan(p, s)).toBe("incomplete");
    s.read.add("b6");
    p.readToken = "invented";
    expect(validateWordDocumentPlan(p, s)).toBe("incomplete");
  });
  it("rejects a reused, revoked or wrong snapshot", () => {
    const s = readySnapshot();
    const p = examplePlan(s.token);
    s.used = true;
    expect(validateWordDocumentPlan(p, s)).toBe("expired");
    s.used = false;
    s.revoked = true;
    expect(validateWordDocumentPlan(p, s)).toBe("expired");
    s.revoked = false;
    p.snapshot = "another";
    expect(validateWordDocumentPlan(p, s)).toBe("expired");
  });
  it("allows explicit replacement or removal of native source fragments", () => {
    const s = readySnapshot();
    const p = examplePlan(s.token);
    s.blocks[2].protected = true;
    expect(validateWordDocumentPlan(p, s)).toBeNull();
    p.deleted = [];
    p.entries.push({ kind: "keep", source: ["b3"] });
    expect(validateWordDocumentPlan(p, s)).toBeNull();
  });
  it.each([
    { id: "n9", type: "paragraph", text: "two\nparagraphs" },
    { id: "n9", type: "heading", level: 10, text: "Bad" },
    { id: "n9", type: "list-item", level: 0, text: "Missing list semantics" },
    { id: "n9", type: "paragraph", text: "A", runs: [{ text: "B" }] },
    { id: "n9", type: "paragraph", text: "Text", html: "<script/>" },
  ])("rejects unsupported output blocks", (block) => {
    const p = examplePlan("snap");
    const raw = { ...p, entries: [{ kind: "insert", blocks: [block] }] };
    expect(parseWordDocumentPlan(JSON.stringify(raw))).toBeNull();
  });
  it("rejects duplicate output IDs and made-up styles", () => {
    const s = readySnapshot();
    const p = examplePlan(s.token);
    p.entries.push({
      kind: "insert",
      blocks: [{ id: "n1", type: "paragraph", text: "Another" }],
    });
    expect(validateWordDocumentPlan(p, s)).toBe("invalid");
    p.entries.pop();
    p.entries.push({
      kind: "insert",
      blocks: [
        { id: "new", type: "paragraph", styleRef: "invented", text: "Another" },
      ],
    });
    expect(validateWordDocumentPlan(p, s)).toBe("invalid");
  });
});
