import { describe, expect, it } from "vitest";

import {
  examplePlan,
  readySnapshot,
} from "../../../test/mocks/word/authoringFixtures";
import {
  realisticSnapshot,
  realisticWordPackageXml,
  statusRewritePlan,
} from "../../../test/mocks/word/realisticWordFixtures";
import { WORD_ROUTE_REASONS } from "../wordApplyDiagnostics";
import {
  ALL_WORD_IN_PLACE_CAPABILITIES,
  wordInPlaceCapabilities,
} from "../wordInPlaceCapabilities";
import {
  routeWordDocumentPlan,
  wordPlanPassages,
  wordRouteGroup,
} from "../wordInPlaceRoute";

import type { WordDocumentPlan } from "../wordDocumentPlan";

const ON = { enabled: true } as const;
const caps = wordInPlaceCapabilities("PC");

describe("routeWordDocumentPlan", () => {
  it("keeps captures without the complete package on the body path", () => {
    const snapshot = readySnapshot();
    expect(
      routeWordDocumentPlan(examplePlan(snapshot.token), snapshot, ON, caps),
    ).toEqual({ route: "body" });
  });

  it("writes an eligible rewrite in place, tracked when the capture was", () => {
    const snapshot = realisticSnapshot(realisticWordPackageXml());
    const route = routeWordDocumentPlan(
      statusRewritePlan(snapshot, "Status: revised."),
      snapshot,
      ON,
      caps,
    );
    expect(route).toMatchObject({ route: "in-place", tracked: false });
    expect(route.route === "in-place" && route.ops).toHaveLength(1);

    const tracked = realisticSnapshot(
      realisticWordPackageXml(),
      "message-A",
      "TrackAll",
    );
    expect(
      routeWordDocumentPlan(
        statusRewritePlan(tracked, "Status: revised."),
        tracked,
        ON,
        ALL_WORD_IN_PLACE_CAPABILITIES,
      ),
    ).toMatchObject({ route: "in-place", tracked: true });
  });

  it("names why a plan needs the import, and blocks it under Track Changes", () => {
    const snapshot = realisticSnapshot(realisticWordPackageXml());
    const plan: WordDocumentPlan = {
      ...statusRewritePlan(snapshot, "Status: revised."),
      sections: [{ id: "final", source: "section-1" }],
    };
    expect(routeWordDocumentPlan(plan, snapshot, ON, caps)).toEqual({
      route: "import",
      reason: "sections",
    });
    expect(
      routeWordDocumentPlan(
        statusRewritePlan(snapshot, "Status: revised."),
        snapshot,
        { enabled: false, reason: "setting" },
        caps,
      ),
    ).toEqual({ route: "import", reason: "setting" });

    const tracked = realisticSnapshot(
      realisticWordPackageXml(),
      "message-A",
      "TrackAll",
    );
    expect(
      routeWordDocumentPlan(
        { ...plan, snapshot: tracked.token },
        tracked,
        ON,
        ALL_WORD_IN_PLACE_CAPABILITIES,
      ),
    ).toEqual({ route: "blocked", reason: "sections" });
    expect(
      routeWordDocumentPlan(
        statusRewritePlan(tracked, "Status: revised."),
        tracked,
        { enabled: false, reason: "latched" },
        ALL_WORD_IN_PLACE_CAPABILITIES,
      ),
    ).toEqual({ route: "blocked", reason: "latched" });
  });

  it("sends a plan the classifier cannot read to the import instead of failing", () => {
    const snapshot = realisticSnapshot(realisticWordPackageXml());
    const plan = {
      ...statusRewritePlan(snapshot, "Status: revised."),
      entries: null,
    } as unknown as WordDocumentPlan;
    expect(routeWordDocumentPlan(plan, snapshot, ON, caps)).toEqual({
      route: "import",
      reason: "program-mismatch",
    });
  });
});

describe("route wording", () => {
  it("groups every route reason, with a general group for the rest", () => {
    const groups = Object.fromEntries(
      WORD_ROUTE_REASONS.map((reason) => [reason, wordRouteGroup(reason)]),
    );
    expect(groups).toMatchObject({
      sections: "sections",
      stories: "stories",
      "story-text": "stories",
      moved: "moves",
      "native-target": "objects",
      "rich-block": "objects",
      format: "formatting",
      "run-format": "formatting",
      "inherited-format": "formatting",
      restyle: "formatting",
      list: "lists",
      "new-list": "lists",
      insert: "paragraphs",
      delete: "paragraphs",
      split: "paragraphs",
      setting: "setting",
      disabled: "other",
      latched: "other",
      "source-shape": "other",
      "program-mismatch": "other",
    });
  });

  it("counts replaced and inserted runs, removals and story changes as passages", () => {
    const snapshot = realisticSnapshot(realisticWordPackageXml());
    const plan = statusRewritePlan(snapshot, "Status: revised.");
    expect(wordPlanPassages(plan)).toBe(1);
    expect(
      wordPlanPassages({
        ...plan,
        deleted: [{ source: ["b99"], reason: "Obsolete." }],
        stories: [{ kind: "delete", type: "footer", id: "footer1" }],
      }),
    ).toBe(3);
  });
});
