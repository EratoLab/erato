import { describe, expect, it } from "vitest";

import { parseWordDocumentPlan } from "../wordDocumentPlan";
import { wordPlanText } from "../wordPlanReview";

import type { WordAuthoringSnapshot } from "../wordDocumentPlan";

const snapshot = {
  token: "snap",
  identity: "",
  ooxml: "",
  fingerprint: "",
  styles: [],
  assets: [],
  imageAssetIssues: [],
  read: new Set(["b1", "b2"]),
  blocks: [
    {
      ref: "b1",
      type: "paragraph",
      text: "Intro",
      protected: false,
      xml: "",
    },
    {
      ref: "b2",
      type: "native",
      nativeKind: "table",
      text: "Team\tHours\nOps\t4",
      protected: false,
      xml: "",
      content: {
        columns: [2000, 2000],
        format: {},
        sourcePatchSupported: true,
        rows: [
          {
            sourceIndex: 0,
            format: {},
            cells: [
              { sourceIndex: 0, text: "Team" },
              { sourceIndex: 1, text: "Hours" },
            ],
          },
          {
            sourceIndex: 1,
            format: {},
            cells: [
              { sourceIndex: 0, text: "Ops" },
              { sourceIndex: 1, text: "4" },
            ],
          },
        ],
      },
    },
  ],
} as unknown as WordAuthoringSnapshot;

const plan = parseWordDocumentPlan(
  JSON.stringify({
    version: 1,
    snapshot: "snap",
    readToken: "read",
    scope: "body",
    deleted: [],
    entries: [
      { kind: "keep", source: ["b1"] },
      {
        kind: "replace",
        source: ["b2"],
        blocks: [
          {
            id: "t",
            type: "table",
            text: "",
            sourceRef: "b2",
            rows: [
              {
                sourceIndex: 0,
                cells: [{ sourceIndex: 0 }, { sourceIndex: 1 }],
              },
              {
                sourceIndex: 1,
                cells: [
                  { sourceIndex: 0 },
                  {
                    sourceIndex: 1,
                    blocks: [{ id: "h", type: "paragraph", text: "6" }],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        kind: "insert",
        contextRefs: ["b2"],
        blocks: [
          {
            id: "l1",
            type: "list-item",
            list: "L",
            ordered: true,
            level: 0,
            text: "Plan",
          },
          {
            id: "l2",
            type: "list-item",
            list: "L",
            ordered: true,
            level: 1,
            text: "Staff",
          },
          {
            id: "l3",
            type: "list-item",
            list: "L",
            ordered: true,
            level: 0,
            text: "Ship",
          },
          {
            id: "u1",
            type: "list-item",
            list: "U",
            ordered: false,
            level: 0,
            text: "Note",
          },
        ],
      },
    ],
  }),
)!;

describe("the plain text a read-only Word proposal copies", () => {
  it("keeps the cells a table retains from the document, row by row", () => {
    expect(wordPlanText(plan, snapshot)).toBe(
      [
        "Intro",
        "Team\tHours",
        "Ops\t6",
        "1. Plan",
        "  1. Staff",
        "2. Ship",
        "• Note",
      ].join("\n"),
    );
  });

  it("copies only the new blocks without the document", () => {
    expect(wordPlanText(plan).split("\n").slice(0, 3)).toEqual([
      "\t",
      "\t6",
      "1. Plan",
    ]);
  });
});
