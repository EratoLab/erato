import { powerpointHostLimits } from "./powerpointReads";
import { powerpointErrorText, runPowerPoint } from "./powerpointRun";
import { advertisedFacetArgs } from "../../core/clientActions/actionFacetArgs";

import type { PowerPointReadSupport } from "./powerpointReadSupport";
import type { ActionFacetRequest } from "@erato/frontend/library";

export const POWERPOINT_PRESENTATION_FACET_ID = "powerpoint_presentation";

const SELECTION_SUMMARY_TIMEOUT_MS = 1500;
const MAX_LISTED_SHAPES = 12;

/** The file name without its folder or extension, as the user knows the deck. */
export function powerpointPresentationName(url: string | undefined): string {
  const file = (url ?? "").split(/[\\/]/).pop()?.split("?")[0] ?? "";
  let name = file;
  try {
    name = decodeURIComponent(file);
  } catch {
    // Keep the raw name.
  }
  return name.replace(/\.(pptx|pptm|ppt|potx|ppsx)$/i, "") || "Presentation";
}

export function currentPowerPointPresentationName(): string {
  return powerpointPresentationName(globalThis.Office?.context?.document?.url);
}

/**
 * One line on what is selected, so a request like "shorten this" needs no read first. Only ids,
 * positions and shape names: the content stays behind the read tools.
 */
export async function readPowerPointSelectionSummary(
  support: PowerPointReadSupport,
): Promise<string> {
  if (!support.selection) return "Not readable in this PowerPoint version.";
  const read = runPowerPoint(async (context) => {
    const { presentation } = context;
    const all = presentation.slides.load("items/id");
    const slides = presentation.getSelectedSlides().load("items/id");
    const shapes = presentation.getSelectedShapes().load("items/id,items/name");
    await context.sync();
    const order = new Map(all.items.map((slide, i) => [slide.id, i + 1]));
    const slideText = slides.items
      .map((slide) => `${order.get(slide.id) ?? "?"} (id ${slide.id})`)
      .join(", ");
    const listed = shapes.items
      .slice(0, MAX_LISTED_SHAPES)
      .map((shape) => `"${shape.name}" (id ${shape.id})`);
    const more = shapes.items.length - listed.length;
    const shapeText = listed.length
      ? `; selected shapes: ${listed.join(", ")}${more > 0 ? ` and ${more} more` : ""}`
      : "";
    return slideText
      ? `Selected slides: ${slideText}${shapeText}.`
      : "Nothing is selected.";
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(
      () => resolve("Unknown: PowerPoint did not answer in time."),
      SELECTION_SUMMARY_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([read, timeout]);
  } catch (error) {
    return `Unknown: ${powerpointErrorText(error)}`;
  } finally {
    clearTimeout(timer);
  }
}

export function powerpointTierText(support: PowerPointReadSupport): string {
  const limits = powerpointHostLimits(support);
  const version = support.highestVersion
    ? `PowerPointApi ${support.highestVersion}`
    : "below PowerPointApi 1.3";
  return limits.length
    ? `${support.tier} (${version}); this host cannot read ${limits.join(", ")}`
    : `${support.tier} (${version})`;
}

export function resolvePowerPointFacet(input: {
  support: PowerPointReadSupport;
  presentationName: string;
  selectionSummary: string;
  availableFacetIds: ReadonlySet<string>;
  availableFacetArgs: ReadonlyMap<string, ReadonlySet<string>>;
}): ActionFacetRequest | undefined {
  if (!input.availableFacetIds.has(POWERPOINT_PRESENTATION_FACET_ID))
    return undefined;
  return {
    id: POWERPOINT_PRESENTATION_FACET_ID,
    args: advertisedFacetArgs(
      {
        presentation_name: input.presentationName,
        read_tier: powerpointTierText(input.support),
        selection_summary: input.selectionSummary,
      },
      input.availableFacetArgs.get(POWERPOINT_PRESENTATION_FACET_ID),
    ),
  };
}
