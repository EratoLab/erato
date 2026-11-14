import { t } from "@lingui/core/macro";

import type { PowerPointReadSupport } from "../utils/powerpointReadSupport";
import type { ComposerContextItem } from "@erato/frontend/library";

export const POWERPOINT_PRESENTATION_CHIP_ID = "powerpoint.presentation";

/** What Erato can read of the deck on this host, in the user's terms. */
export function powerpointReadScopeLines(
  support: PowerPointReadSupport,
): string[] {
  return [
    t({
      id: "officeAddin.powerpoint.context.onDemand",
      message:
        "Erato reads slides one at a time, only when your request needs them, and sees which slides and shapes you selected.",
    }),
    support.tier === "full"
      ? t({
          id: "officeAddin.powerpoint.context.full",
          message:
            "It reads slide titles, text with bullet levels, tables, shapes inside groups and alt text.",
        })
      : t({
          id: "officeAddin.powerpoint.context.basic",
          message:
            "This PowerPoint version lets Erato read text boxes and their positions only. Titles, tables and shapes inside groups stay unread.",
        }),
    t({
      id: "officeAddin.powerpoint.context.never",
      message:
        "Speaker notes, comments, chart data and SmartArt text can't be read.",
    }),
  ];
}

export function powerpointPresentationChip(input: {
  name: string;
  included: boolean;
  support: PowerPointReadSupport;
  locked: boolean;
  onInclude: () => void;
  onExclude: () => void;
}): ComposerContextItem {
  return {
    id: POWERPOINT_PRESENTATION_CHIP_ID,
    kind: POWERPOINT_PRESENTATION_CHIP_ID,
    origin: "ambient",
    dismissScope: "chat",
    state: input.included ? "included" : "suggested",
    label: input.name,
    spokenLabel: t({
      id: "officeAddin.powerpoint.chip.spokenLabel",
      message: "Presentation",
    }),
    icon: "document",
    ...(input.included
      ? {
          meta: t({
            id: "officeAddin.powerpoint.chip.onDemand",
            message: "Read when needed",
          }),
        }
      : {}),
    locked: input.locked,
    onRemove: input.onExclude,
    onRestore: input.onInclude,
    removeLabel: t({
      id: "officeAddin.powerpoint.chip.exclude",
      message: "Don't include this presentation",
    }),
    restoreLabel: t({
      id: "officeAddin.powerpoint.chip.include",
      message: "Include this presentation",
    }),
    detail: {
      title: input.name,
      render: () => (
        <div className="space-y-2 text-sm">
          {(input.included
            ? powerpointReadScopeLines(input.support)
            : [
                t({
                  id: "officeAddin.powerpoint.context.off",
                  message:
                    "Left out: Erato doesn't read this presentation in this chat.",
                }),
              ]
          ).map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ),
    },
  };
}
