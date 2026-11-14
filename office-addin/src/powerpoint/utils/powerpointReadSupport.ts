/** `Office.context.requirements.isSetSupported`, passed in so the table needs no Office host. */
export type PowerPointRequirementCheck = (
  name: string,
  minVersion?: string,
) => boolean;

export const POWERPOINT_API_VERSIONS = [
  "1.3",
  "1.4",
  "1.5",
  "1.8",
  "1.10",
] as const;
export type PowerPointApiVersion = (typeof POWERPOINT_API_VERSIONS)[number];

/**
 * "full" needs PowerPointApi 1.10 (Microsoft 365 on Windows, Mac and the web); "basic" is anything
 * from 1.3 below that, in practice Office LTSC 2024 at 1.5; "none" cannot read slides at all.
 */
export type PowerPointReadTier = "full" | "basic" | "none";

/** Each read feature has its own switch, so a host never gets offered a read it cannot do. */
export interface PowerPointReadSupport {
  tier: PowerPointReadTier;
  /** The highest of POWERPOINT_API_VERSIONS the host reports, or null below 1.3. */
  highestVersion: PowerPointApiVersion | null;
  /** Slides in order with id, layout and master names, shapes with id, name, type, box and text. */
  slides: boolean;
  /** getSelectedSlides, getSelectedShapes, getSelectedTextRange. */
  selection: boolean;
  /** placeholderFormat.type and containedType: title, body, subtitle… */
  placeholderRole: boolean;
  /** shape.getTable().values. */
  tables: boolean;
  /** shape.group.shapes, parentGroup and level. */
  groups: boolean;
  /** shape.zOrderPosition and slide.index. */
  zOrder: boolean;
  /** altTextTitle, altTextDescription, isDecorative, rotation, visible. */
  shapeDetails: boolean;
  /** getTextFrameOrNullObject, so shapes of any type can be asked for text safely. */
  safeTextFrame: boolean;
  /** Per paragraph indentLevel and bullet type and style. */
  bulletLevels: boolean;
  /** presentation.pageSetup.slideWidth and slideHeight. */
  slideSize: boolean;
}

const has = (
  isSetSupported: PowerPointRequirementCheck,
  version: PowerPointApiVersion,
) => {
  try {
    return isSetSupported("PowerPointApi", version) === true;
  } catch {
    return false;
  }
};

export function powerpointReadSupport(
  isSetSupported: PowerPointRequirementCheck,
): PowerPointReadSupport {
  const supported = new Set(
    POWERPOINT_API_VERSIONS.filter((version) => has(isSetSupported, version)),
  );
  const highestVersion =
    [...POWERPOINT_API_VERSIONS].reverse().find((v) => supported.has(v)) ??
    null;
  // TextFrame and shape types arrived in 1.4; slides with layout names in 1.3.
  const slides = supported.has("1.3") && supported.has("1.4");
  const v18 = slides && supported.has("1.8");
  const v110 = v18 && supported.has("1.10");
  return {
    tier: v110 ? "full" : slides ? "basic" : "none",
    highestVersion,
    slides,
    selection: slides && supported.has("1.5"),
    placeholderRole: v18,
    tables: v18,
    groups: v18,
    zOrder: v18,
    shapeDetails: v110,
    safeTextFrame: v110,
    bulletLevels: v110,
    slideSize: v110,
  };
}

export function currentPowerPointReadSupport(): PowerPointReadSupport {
  const requirements = globalThis.Office?.context?.requirements;
  return powerpointReadSupport(
    (name, version) => requirements?.isSetSupported(name, version) ?? false,
  );
}

let logged = false;

/** Once per pane session, so the console shows which PowerPoint builds people run. */
export function logPowerPointReadSupport(support: PowerPointReadSupport) {
  if (logged) return;
  logged = true;
  const diagnostics = globalThis.Office?.context?.diagnostics;
  console.info("PowerPoint read support", {
    tier: support.tier,
    highestVersion: support.highestVersion,
    host: diagnostics?.host,
    platform: diagnostics?.platform,
    version: diagnostics?.version,
  });
}

export function resetPowerPointReadSupportLogForTests() {
  logged = false;
}
