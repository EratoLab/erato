import { wordHostPlatform } from "./wordHostPlatform";

import type { WordHostPlatform } from "./wordHostPlatform";

export const WORD_IN_PLACE_MECHANISMS_LIST = [
  "text",
  "cell",
  "marks",
  "delete",
  "insert",
  "split",
  "restyle",
  "list",
  "span",
  "tracked",
  "trackedStructure",
  "storyText",
  "scriptText",
] as const;
export type WordInPlaceMechanism =
  (typeof WORD_IN_PLACE_MECHANISMS_LIST)[number];
export type WordInPlaceCapabilities = Record<WordInPlaceMechanism, boolean>;
export type WordInPlaceProbeId =
  | "P1"
  | "P2"
  | "P3"
  | "P4"
  | "P5"
  | "P6"
  | "P7"
  | "P8"
  | "P9"
  | "P10"
  | "P11"
  | "P12"
  | "P13";
/** The production targeted-edit path, which writes text and cell rewrites with insertText. */
type WordInPlaceEvidence = WordInPlaceProbeId | "targeted-edit";
/** A mechanism is on for a platform only when its forward write and its Revert each passed a
 * native probe there; otherwise the gate names the probe still to pass. */
export type WordInPlaceGate =
  | { forward: WordInPlaceEvidence; revert: WordInPlaceEvidence }
  | { pending: WordInPlaceProbeId; forward?: WordInPlaceEvidence };

const TARGETED_EDIT = {
  forward: "targeted-edit",
  revert: "targeted-edit",
} as const;
const PENDING: Record<
  Exclude<WordInPlaceMechanism, "text" | "cell">,
  WordInPlaceGate
> = {
  marks: { pending: "P4" },
  delete: { pending: "P8" },
  insert: { pending: "P5" },
  split: { pending: "P5" },
  restyle: { pending: "P7" },
  list: { pending: "P6" },
  span: { pending: "P10" },
  tracked: { pending: "P9" },
  trackedStructure: { pending: "P13" },
  storyText: { pending: "P11" },
  scriptText: { pending: "P2" },
};

/**
 * Per platform, the native evidence for each mechanism. text and cell use the insertText primitives
 * the targeted-edit path already runs in production, both ways. Whether a host writes in place at
 * all is the deployment's call (wordApplyPolicy).
 */
export const WORD_IN_PLACE_MECHANISMS: Record<
  WordHostPlatform,
  Record<WordInPlaceMechanism, WordInPlaceGate>
> = {
  // Word PC 16.0.20326: P4 (marks), P5 (insert, split), P7 (restyle) and P8 (delete, and the Revert
  // of an insert or split) passed both ways; its Paragraph.getOoxml carries w:pPr, so P7's inverse
  // saw the style. P2 showed East Asian text and emoji written in font-association runs (scriptText).
  PC: {
    text: TARGETED_EDIT,
    cell: TARGETED_EDIT,
    ...PENDING,
    marks: { forward: "P4", revert: "P4" },
    insert: { forward: "P5", revert: "P8" },
    split: { forward: "P5", revert: "P8" },
    restyle: { forward: "P7", revert: "P7" },
    delete: { forward: "P8", revert: "P8" },
  },
  Mac: { text: TARGETED_EDIT, cell: TARGETED_EDIT, ...PENDING },
  // Word for the web: P7 passed forward (ERMAIN-961, 2026-10-12) and, read back through the
  // paragraph's properties and the exported package, back (ERMAIN-967, 2026-10-13). Its
  // Paragraph.getOoxml carries no w:pPr, so the signature alone could not show either.
  OfficeOnline: {
    text: TARGETED_EDIT,
    cell: TARGETED_EDIT,
    ...PENDING,
    restyle: { forward: "P7", revert: "P7" },
  },
  unknown: { text: TARGETED_EDIT, cell: TARGETED_EDIT, ...PENDING },
};

/** On only with native evidence for both the forward write and its Revert. */
export function wordInPlaceMechanismsFromGates(
  gates: Record<WordInPlaceMechanism, WordInPlaceGate>,
): WordInPlaceCapabilities {
  return Object.fromEntries(
    WORD_IN_PLACE_MECHANISMS_LIST.map((mechanism) => {
      const gate = gates[mechanism];
      return [
        mechanism,
        "revert" in gate &&
          (mechanism !== "marks" || wordComplexScriptMarkSetters()),
      ];
    }),
  ) as WordInPlaceCapabilities;
}

/** Word PC's bold/italic setters write no complex-script twin (probe P2), while Word's own formatting
 * writes both; only the bidirectional setters can restore such a run exactly. */
export function wordComplexScriptMarkSetters(): boolean {
  return !!globalThis.Office?.context?.requirements?.isSetSupported(
    "WordApiDesktop",
    "1.3",
  );
}

let override: WordInPlaceCapabilities | undefined;

export function wordInPlaceCapabilities(
  platform: WordHostPlatform = wordHostPlatform(),
): WordInPlaceCapabilities {
  if (override) return { ...override };
  return wordInPlaceMechanismsFromGates(WORD_IN_PLACE_MECHANISMS[platform]);
}

/** Every mechanism on, as the native probes would confirm them. */
export const ALL_WORD_IN_PLACE_CAPABILITIES: WordInPlaceCapabilities =
  Object.fromEntries(
    WORD_IN_PLACE_MECHANISMS_LIST.map((mechanism) => [mechanism, true]),
  ) as WordInPlaceCapabilities;

/**
 * Under Track Changes a mechanism also needs its tracked behaviour confirmed. P9 covers text and
 * cell rewrites; inserting, deleting, splitting, restyling and relisting need P13, which measures
 * paragraph membership, formatting revisions and reject-exactness for each of them.
 */
export function wordTrackedInPlaceCapabilities(
  caps: WordInPlaceCapabilities,
): WordInPlaceCapabilities {
  const structure = caps.tracked && caps.trackedStructure;
  return {
    ...caps,
    insert: caps.insert && structure,
    delete: caps.delete && structure,
    split: caps.split && structure,
    restyle: caps.restyle && structure,
    list: caps.list && structure,
  };
}

export function setWordInPlaceCapabilitiesForTests(
  capabilities: WordInPlaceCapabilities | undefined,
): void {
  override = capabilities;
}
