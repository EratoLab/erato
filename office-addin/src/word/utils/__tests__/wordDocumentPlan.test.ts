import {
  parseWordDocumentPlan,
  validateWordDocumentPlan,
  wordPlanOutput,
} from "@erato/frontend/word-review";
import { describe, expect, it } from "vitest";

import {
  examplePlan,
  readySnapshot,
} from "../../../test/mocks/word/authoringFixtures";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
  verifyWordPlanOutput,
} from "../wordDocumentXml";

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

describe("new blocks without ids (ERMAIN-1194)", () => {
  // The production slip: every inserted block had only type, text, level, list and ordered.
  const unnamed = () => [
    { type: "heading", level: 2, text: "Next steps" },
    {
      type: "list-item",
      text: "Call the vendor",
      level: 0,
      list: "steps",
      ordered: true,
    },
    {
      type: "list-item",
      text: "Book the room",
      level: 0,
      list: "steps",
      ordered: true,
    },
    {
      type: "content-control",
      control: {
        lock: "none",
        appearance: "bounding-box",
        children: [{ type: "paragraph", text: "Inside" }],
      },
    },
    {
      type: "bookmark",
      bookmark: {
        name: "Marked",
        children: [{ type: "paragraph", text: "Held" }],
      },
    },
  ];
  const ids = (value: unknown) =>
    [...JSON.stringify(value).matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);

  it("get unique ids that every parse of the same arguments repeats", () => {
    const s = readySnapshot();
    const p = examplePlan(s.token);
    const content = JSON.stringify({
      ...p,
      entries: [...p.entries, { kind: "insert", blocks: unnamed() }],
    });
    const plan = parseWordDocumentPlan(content)!;
    expect(plan).not.toBeNull();
    expect(validateWordDocumentPlan(plan, s)).toBeNull();
    expect(parseWordDocumentPlan(content)).toEqual(plan);
    expect(ids(plan.entries)).toEqual([
      "n1",
      "n2",
      "n3",
      "n4",
      "new_block_1",
      "new_block_2",
      "new_block_3",
      "new_block_4",
      "new_block_5",
      "new_block_6",
      "new_block_7",
    ]);
    const after = captureWordAuthoringSnapshot(
      compileWordDocumentPlan(plan, s),
      s.identity,
      "Off",
      s.fullDocument,
    );
    expect(verifyWordPlanOutput(plan, s, after)).toBe(true);
    expect(after.blocks.map((b) => b.text)).toEqual(
      expect.arrayContaining([
        "Next steps",
        "Call the vendor",
        "Book the room",
      ]),
    );
  });

  it("skip every id the plan already uses", () => {
    const s = readySnapshot();
    const p = examplePlan(s.token);
    p.entries[0] = {
      kind: "insert",
      contextRefs: ["b4"],
      blocks: [
        {
          id: "new_block_1",
          type: "heading",
          level: 1,
          text: "Recommendation",
        },
      ],
    };
    const plan = parseWordDocumentPlan(
      JSON.stringify({
        ...p,
        entries: [
          ...p.entries,
          { kind: "insert", blocks: [{ type: "paragraph", text: "Added" }] },
        ],
      }),
    )!;
    expect(ids(plan.entries).slice(-2)).toEqual(["n4", "new_block_2"]);
    expect(validateWordDocumentPlan(plan, s)).toBeNull();
  });

  it.each([7, "", "two words", null])(
    "still reject an id that is given but not an identifier: %j",
    (id) => {
      const p = examplePlan("snap");
      const raw = {
        ...p,
        entries: [
          { kind: "insert", blocks: [{ id, type: "paragraph", text: "A" }] },
        ],
      };
      expect(parseWordDocumentPlan(JSON.stringify(raw))).toBeNull();
    },
  );
});
