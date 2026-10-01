export const WORD_IN_PLACE_MECHANISMS_LIST = [
  "text",
  "cell",
  "delete",
  "insert",
  "split",
  "restyle",
  "list",
  "span",
  "tracked",
  "trackedStructure",
  "storyText",
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
type WordInPlacePlatform = "PC" | "Mac" | "OfficeOnline" | "unknown";
type WordInPlaceGate = true | { probe: WordInPlaceProbeId };

const PENDING: Record<
  Exclude<WordInPlaceMechanism, "text" | "cell">,
  { probe: WordInPlaceProbeId }
> = {
  delete: { probe: "P8" },
  insert: { probe: "P5" },
  split: { probe: "P5" },
  restyle: { probe: "P7" },
  list: { probe: "P6" },
  span: { probe: "P10" },
  tracked: { probe: "P9" },
  trackedStructure: { probe: "P13" },
  storyText: { probe: "P11" },
};

/**
 * A mechanism is enabled on a platform only after its native probe passed there. text and cell
 * use the insertText primitives the targeted-edit path already runs in production; production
 * builds keep the kill switch on (see injectFrontendEnv) until P1-P4 pass.
 */
export const WORD_IN_PLACE_MECHANISMS: Record<
  WordInPlacePlatform,
  Record<WordInPlaceMechanism, WordInPlaceGate>
> = {
  PC: { text: true, cell: true, ...PENDING },
  Mac: { text: true, cell: true, ...PENDING },
  OfficeOnline: { text: true, cell: true, ...PENDING },
  unknown: { text: true, cell: true, ...PENDING },
};

function currentPlatform(): WordInPlacePlatform {
  const platform = String(
    globalThis.Office?.context?.diagnostics?.platform ?? "",
  );
  return platform === "PC" || platform === "Mac" || platform === "OfficeOnline"
    ? platform
    : "unknown";
}

let override: WordInPlaceCapabilities | undefined;

export function wordInPlaceCapabilities(
  platform: WordInPlacePlatform = currentPlatform(),
): WordInPlaceCapabilities {
  if (override) return { ...override };
  const gates = WORD_IN_PLACE_MECHANISMS[platform];
  return Object.fromEntries(
    WORD_IN_PLACE_MECHANISMS_LIST.map((mechanism) => [
      mechanism,
      gates[mechanism] === true,
    ]),
  ) as WordInPlaceCapabilities;
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
