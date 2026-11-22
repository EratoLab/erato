import { registerClientToolExecutor } from "@erato/frontend/library";

import {
  readPowerPointPresentation,
  readPowerPointSelection,
  readPowerPointSlide,
} from "./powerpointReads";
import { slidePictureTool } from "./powerpointViewSlide";

import type { PowerPointReadSupport } from "./powerpointReadSupport";
import type { SlidePictureLimits } from "./powerpointViewSlide";
import type {
  ClientToolExecutionResult,
  ClientToolExecutor,
} from "@erato/frontend/library";

/** Model-facing names: frozen once a configuration package references them. */
export const POWERPOINT_READ_PRESENTATION_TOOL = "powerpoint_read_presentation";
export const POWERPOINT_READ_SLIDE_TOOL = "powerpoint_read_slide";
export const POWERPOINT_READ_SELECTION_TOOL = "powerpoint_read_selection";
export const POWERPOINT_VIEW_SLIDE_TOOL = "powerpoint_view_slide";

const inclusionOff = (): Promise<ClientToolExecutionResult> =>
  Promise.resolve({ ok: false, error: "Presentation inclusion is off." });

/** One per pane, so a turn's picture count and its replays outlive a remount of the composer. */
const viewSlide = slidePictureTool();

/**
 * The PowerPoint pane's tools: three reads and, given `view`, the slide picture. A tool is
 * registered only where the host can do it, and listed to the server only for a send that included
 * the presentation. It stays listed for the rest of that turn, so a call made after the user turned
 * inclusion off is answered that inclusion is off instead of failing as unknown.
 */
export function registerPowerPointClientTools({
  support,
  readEnabled,
  listed,
  view,
}: {
  support: PowerPointReadSupport;
  /** The presentation is included right now. */
  readEnabled: () => boolean;
  /** The last send included the presentation, or it is included now. */
  listed: () => boolean;
  /**
   * The slide picture, at the full tier only. `listed` is like the reads' and also needs a model
   * that takes pictures and uploads on.
   */
  view?: { listed: () => boolean; limits: () => SlidePictureLimits };
}): () => void {
  const tools: [string, boolean, ClientToolExecutor][] = [
    [
      POWERPOINT_READ_PRESENTATION_TOOL,
      support.slides,
      (input) => readPowerPointPresentation(support, input),
    ],
    [
      POWERPOINT_READ_SLIDE_TOOL,
      support.slides,
      (input) => readPowerPointSlide(support, input),
    ],
    [
      POWERPOINT_READ_SELECTION_TOOL,
      support.selection,
      () => readPowerPointSelection(support),
    ],
  ];
  const unregister = tools
    .filter(([, hostCan]) => hostCan)
    .map(([name, , read]) =>
      registerClientToolExecutor(
        name,
        (input) => (readEnabled() ? read(input) : inclusionOff()),
        listed,
      ),
    );
  if (support.slidePicture && view)
    unregister.push(
      registerClientToolExecutor(
        POWERPOINT_VIEW_SLIDE_TOOL,
        (input, context) =>
          readEnabled()
            ? viewSlide(input, context, view.limits())
            : inclusionOff(),
        view.listed,
      ),
    );
  return () => unregister.forEach((stop) => stop());
}
