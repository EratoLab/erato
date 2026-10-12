import { afterEach, describe, expect, it, vi } from "vitest";

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
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
} from "../wordDocumentXml";
import {
  ALL_WORD_IN_PLACE_CAPABILITIES,
  wordInPlaceCapabilities,
} from "../wordInPlaceCapabilities";
import {
  routeWordDocumentPlan,
  wordPlanPassages,
  wordPlanReadScope,
  wordRouteGroup,
  wordWholeDocumentWrite,
} from "../wordInPlaceRoute";

import type { WordWholeDocumentImport } from "../wordApplyPolicy";
import type { WordHostPlatform } from "../wordHostPlatform";
import type { WordPlanRoute } from "../wordInPlaceRoute";
import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordReadScope,
} from "@erato/frontend/word-review";

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

  it("writes in place when a plan only restates the captured sections", () => {
    const snapshot = realisticSnapshot(realisticWordPackageXml());
    const route = (layout?: { orientation: "landscape" }) => {
      const plan: WordDocumentPlan = {
        ...statusRewritePlan(snapshot, "Status: revised."),
        sections: [
          { id: "final", source: "section-1", ...(layout ? { layout } : {}) },
        ],
      };
      const compiled = captureWordAuthoringSnapshot(
        compileWordDocumentPlan(plan, snapshot),
        snapshot.identity,
        "Off",
        true,
        "verify",
      );
      return routeWordDocumentPlan(plan, snapshot, ON, caps, compiled);
    };
    expect(route()).toMatchObject({ route: "in-place" });
    expect(route({ orientation: "landscape" })).toEqual({
      route: "import",
      reason: "sections",
    });
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

describe("wordInPlaceCapabilities", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const enabled = (platform: WordHostPlatform) =>
    Object.entries(wordInPlaceCapabilities(platform))
      .filter(([, on]) => on)
      .map(([mechanism]) => mechanism);

  it("writes only text and cell in place on Word for the web, even where the bidirectional setters exist", () => {
    vi.stubGlobal("Office", {
      context: { requirements: { isSetSupported: () => true } },
    });
    expect(enabled("OfficeOnline")).toEqual(["text", "cell"]);
    expect(enabled("Mac")).toEqual(["text", "cell"]);
    expect(enabled("PC")).toEqual([
      "text",
      "cell",
      "marks",
      "delete",
      "insert",
      "split",
      "restyle",
    ]);
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
      disabled: "unavailable",
      latched: "unavailable",
      "host-sets": "unavailable",
      "no-paragraph-ids": "unavailable",
      "no-package": "unavailable",
      "host-error": "unavailable",
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

describe("wordWholeDocumentWrite", () => {
  /** A status rewrite submitted under a live scoped read of `kind`, or under the complete read. */
  function planFrom(kind?: WordReadScope["kind"]): {
    plan: WordDocumentPlan;
    snapshot: WordAuthoringSnapshot;
  } {
    const snapshot = realisticSnapshot(realisticWordPackageXml());
    const plan = statusRewritePlan(snapshot, "Status: revised.");
    if (!kind) return { plan, snapshot };
    const owner = {
      snapshot: snapshot.token,
      identity: snapshot.identity,
      fingerprint: snapshot.fingerprint,
    };
    snapshot.readScopes = new Map([
      [
        "scoped-read",
        kind === "objects"
          ? { kind, ...owner, targets: [], plans: new Set<string>() }
          : {
              kind,
              ...owner,
              sourceRef: "b1",
              rowIndex: 1,
              cellIndex: 1,
              expectedText: "42",
            },
      ],
    ]);
    return { plan: { ...plan, readToken: "scoped-read" }, snapshot };
  }
  const ROUTES: WordPlanRoute[] = [
    { route: "in-place", ops: [], tracked: false },
    { route: "blocked", reason: "sections" },
    { route: "import", reason: "sections" },
    { route: "body" },
  ];
  const POLICIES: WordWholeDocumentImport[] = ["allowed", "confirm", "off"];
  const decide = (
    route: WordPlanRoute,
    kind: WordReadScope["kind"] | undefined,
    wholeDocumentImport: WordWholeDocumentImport,
  ) => {
    const { plan, snapshot } = planFrom(kind);
    return wordWholeDocumentWrite(route, plan, snapshot, {
      wholeDocumentImport,
    });
  };

  it("never touches routes that write in place or are blocked by Track Changes", () => {
    for (const route of ROUTES.slice(0, 2))
      for (const kind of [undefined, "objects", "table-cell"] as const)
        for (const policy of POLICIES)
          expect(decide(route, kind, policy)).toEqual({ write: "none" });
  });

  it("follows the host's import policy for the import and the body route", () => {
    for (const route of ROUTES.slice(2)) {
      expect(decide(route, undefined, "allowed")).toEqual({
        write: "allowed",
      });
      expect(decide(route, undefined, "confirm")).toEqual({
        write: "confirm",
      });
      expect(decide(route, undefined, "off")).toEqual({
        write: "refuse",
        reason: "import-disabled",
      });
    }
  });

  it("refuses scoped plans whenever the policy is not allowed, confirmed or not", () => {
    for (const route of ROUTES.slice(2))
      for (const kind of ["objects", "table-cell"] as const) {
        expect(decide(route, kind, "allowed")).toEqual({ write: "allowed" });
        for (const policy of ["confirm", "off"] as const)
          expect(decide(route, kind, policy)).toEqual({
            write: "refuse",
            reason: "scoped-needs-in-place",
          });
      }
  });

  it("only counts a scope that is still live for this capture", () => {
    const complete = planFrom();
    expect(wordPlanReadScope(complete.plan, complete.snapshot)).toBe(undefined);
    const cell = planFrom("table-cell");
    expect(wordPlanReadScope(cell.plan, cell.snapshot)).toBe("table-cell");
    const objects = planFrom("objects");
    objects.snapshot.fingerprint = "changed";
    expect(wordPlanReadScope(objects.plan, objects.snapshot)).toBe(undefined);
  });
});
