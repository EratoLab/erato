import { action } from "@storybook/addon-actions";

import { ChatInput } from "@/components/ui/Chat/ChatInput";

import { AnnouncementLog, pane, stagedFile } from "./composerContextStoryKit";
import { useWordStoryResolver } from "./composerContextWordFixtures";

import type { WordStorySeed } from "./composerContextWordFixtures";
import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta = {
  title: "Chat/ComposerContextWord",
  // The width follows the viewport, so one story serves the 340 px pane and
  // the 480 px breakpoint.
  decorators: [pane()],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The Word add-in's selection and document chips in the composer's lane, one story per state. The story plays the add-in's resolver (office-addin/src/word/utils/wordContextChips.ts) from data, so (x), +, “Send this instead” and “Try again” behave and announce as in the add-in.",
      },
    },
  },
};

export default meta;
type Story = StoryObj;

const BUSY_FILES = [
  stagedFile("f1", "Pricing schedule.pdf"),
  stagedFile("f2", "Delivery terms.pdf"),
  stagedFile("f3", "Signed NDA.pdf"),
  stagedFile("f4", "Audit report 2025.pdf"),
  stagedFile("f5", "Insurance certificate.pdf"),
];

const WordComposer = ({
  seed,
  files = [],
  simulations = false,
}: {
  seed: WordStorySeed;
  files?: typeof BUSY_FILES;
  simulations?: boolean;
}) => {
  const { items, simulate } = useWordStoryResolver(seed);
  return (
    <>
      <ChatInput
        onSendMessage={action("onSendMessage")}
        handleFileAttachments={action("handleFileAttachments")}
        initialFiles={files}
        contextItems={items}
        maxFiles={20}
        showControls
      />
      {simulations ? (
        <div
          role="group"
          aria-label="Simulate"
          className="mt-3 flex flex-wrap gap-2 text-xs"
        >
          {(
            [
              ["Select a passage", simulate.selectPassage],
              ["Erato shows a passage", simulate.eratoShowsPassage],
              ["Clear the selection", simulate.clearSelection],
              ["Edit the document", simulate.editDocument],
              ["Toggle Track Changes", simulate.toggleTrackChanges],
              ["Make the next read fail", simulate.failNextRead],
            ] as const
          ).map(([label, run]) => (
            <button
              key={label}
              type="button"
              onClick={run}
              className="border border-theme-border px-2 py-1 text-theme-fg-primary"
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      <AnnouncementLog />
    </>
  );
};

const story = (
  seed: WordStorySeed,
  options: { files?: typeof BUSY_FILES; simulations?: boolean } = {},
): Story => ({
  render: () => <WordComposer seed={seed} {...options} />,
});

export const Included = story({});
export const ShortDocumentName = story({ name: "Memo.docx" });
export const BeforeFirstRead = story({ status: "unknown" });
export const DocumentOff = story({ documentOff: true });
export const Reading = story({ status: "reading" });
export const ReadError = story({ status: "error" });
export const ReadErrorAgain = story({ status: "error", retryLandsOn: "error" });
export const NotSentHere = story({ status: "noFacet" });
export const NotSentHereEmpty = story({ status: "noFacetEmpty" });
export const NewDocument = story({ status: "empty" });
export const ChangedLongDocument = story({
  changed: true,
  coverage: { sent: 120, total: 300 },
});
export const BeginningOnly = story({
  partialParagraph: true,
  coverage: { sent: 1, total: 1 },
});
export const TrackChanges = story({ track: true });
export const ReadInParts = story({
  readInParts: true,
  coverage: { sent: 120, total: 1590 },
});
export const BodyOnly = story({ bodyOnly: true });
export const ReadOnlyFallback = story({
  readOnly: true,
  coverage: { sent: 453, total: 1590 },
});
export const CannotEdit = story({ cannotEdit: true });
export const Locked = story({ locked: true });
export const DocumentReplacedByComment = story({ commentReplaces: true });

export const SelectionReplacesDocument = story({ selection: "user" });
export const SelectionDismissed = story({
  selection: "user",
  selectionOff: true,
});
export const EratoPassage = story({ selection: "erato" });
export const TooLongSelection = story({ selection: "user", long: true });
export const SelectionReadFailed = story({
  selection: "user",
  selectionFailed: true,
});
export const ReplacedByComment = story({
  selection: "user",
  commentReplaces: true,
});

export const Busy = story({ selection: "user" }, { files: BUSY_FILES });
export const Interactive = story({}, { simulations: true });
