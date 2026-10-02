import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
} from "./wordDocumentXml";
import { wordTrackedInPlaceCapabilities } from "./wordInPlaceCapabilities";
import { classifyWordInPlacePlan } from "./wordInPlacePlan";
import { isWordTrackingMode } from "./wordInPlaceSwitch";

import type { WordRouteReason } from "./wordApplyDiagnostics";
import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
} from "./wordDocumentPlan";
import type { WordInPlaceCapabilities } from "./wordInPlaceCapabilities";
import type { WordInPlaceOp } from "./wordInPlacePlan";
import type { WordInPlaceAvailability } from "./wordInPlaceSwitch";

export type WordPlanRoute =
  /** The capture lacks the complete package, so there is no exact backup to write in place from. */
  | { route: "body" }
  | { route: "in-place"; ops: WordInPlaceOp[]; tracked: boolean }
  | { route: "import"; reason: WordRouteReason }
  /** Track Changes is on and the plan needs the import, which cannot write revisions. */
  | { route: "blocked"; reason: WordRouteReason };

/** A plan may restate the captured sections unchanged; only a real section change needs the import. */
function withoutRestatedSections(
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot,
  compiled: WordAuthoringSnapshot | undefined,
): WordDocumentPlan {
  if (!plan.sections || !compiled) return plan;
  const { sections: _sections, ...without } = plan;
  try {
    const restated = captureWordAuthoringSnapshot(
      compileWordDocumentPlan(without, snapshot),
      snapshot.identity,
      "Off",
      snapshot.fullDocument,
      "verify",
    );
    return !restated.issue && restated.fingerprint === compiled.fingerprint
      ? without
      : plan;
  } catch {
    return plan;
  }
}

/**
 * The routing ladder without host calls, shared by the card's preview and Apply; Apply runs it again
 * with live availability right before writing, so the preview is only a forecast.
 */
export function routeWordDocumentPlan(
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot,
  availability: WordInPlaceAvailability,
  caps: WordInPlaceCapabilities,
  compiled?: WordAuthoringSnapshot,
): WordPlanRoute {
  if (!snapshot.fullDocument) return { route: "body" };
  const tracked = isWordTrackingMode(snapshot.trackingMode);
  const needsImport = (reason: WordRouteReason): WordPlanRoute =>
    tracked ? { route: "blocked", reason } : { route: "import", reason };
  if (!availability.enabled) return needsImport(availability.reason);
  try {
    const classified = classifyWordInPlacePlan(
      withoutRestatedSections(plan, snapshot, compiled),
      snapshot,
      tracked ? wordTrackedInPlaceCapabilities(caps) : caps,
      compiled,
    );
    return "fallback" in classified
      ? needsImport(classified.fallback)
      : { route: "in-place", ops: classified.ops, tracked };
  } catch {
    // A classifier failure must never block the import that worked before.
    return needsImport("program-mismatch");
  }
}

/** Plain-language groups for why a plan replaces the whole document. */
export type WordRouteGroup =
  | "sections"
  | "stories"
  | "moves"
  | "objects"
  | "formatting"
  | "lists"
  | "paragraphs"
  | "setting"
  /** The host or session rules out in-place writing, whatever the change. */
  | "unavailable"
  | "other";

const ROUTE_GROUPS: Partial<Record<WordRouteReason, WordRouteGroup>> = {
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
  "no-package": "unavailable",
  "host-error": "unavailable",
};

export function wordRouteGroup(reason: WordRouteReason): WordRouteGroup {
  return ROUTE_GROUPS[reason] ?? "other";
}

/** Passages as the review lists them: each replaced or inserted run, removal and story change. */
export function wordPlanPassages(plan: WordDocumentPlan): number {
  return (
    plan.entries.filter((entry) => entry.kind !== "keep").length +
    plan.deleted.length +
    (plan.stories?.length ?? 0)
  );
}
