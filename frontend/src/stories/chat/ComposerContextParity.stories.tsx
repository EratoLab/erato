import { useOutlookStoryResolver } from "./composerContextOutlookFixtures";
import { OUTLOOK_STORIES } from "./composerContextOutlookScenarios";
import {
  dropItem,
  EditStory,
  LONG_TOOL,
  SentStory,
  STORY_TOOLS,
  ToolComposer,
  userFile,
} from "./composerContextParityFixtures";
import { pane, useResolved } from "./composerContextStoryKit";

import type {
  ParityEditStoryName,
  ParitySentStoryName,
} from "./composerContextParityScenarios";
import type { StoryContextItem } from "./composerContextStoryKit";
import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta = {
  title: "Chat/ComposerContextParity",
  // The width follows the viewport, so one story serves the 340 px pane, the
  // 480 px breakpoint and the full-width web app.
  decorators: [pane()],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          'Composer context after the send. "Sent with": a sent user message names the context its facet carried, as read-only chips under its text, through the real MessageItem and ChatMessage; the chips are what the add-in\'s own descriptors wrote for each facet (office-addin/src/test/__tests__/sentWithStoryParity.test.ts writes composerContextParity.generated.json). "Edit": the real MessageEditor on the shared lane, with a Teams transcript read from its stored file, the stored facet as a locked chip and the files through the attachment slot. "Tools": selected tools as chips next to + in the real ChatInput wherever the unified menu is used, and the send gate the composer runs on items whose estimate is an upload.',
      },
    },
  },
};

export default meta;
type Story = StoryObj;

const sent = (name: ParitySentStoryName): Story => ({
  render: () => <SentStory name={name} />,
});

export const SentWithWordDocument = sent("SentWithWordDocument");
export const SentWithWordTrackChanges = sent("SentWithWordTrackChanges");
export const SentWithWordAuthoring = sent("SentWithWordAuthoring");
export const SentWithWordNewDocument = sent("SentWithWordNewDocument");
export const SentWithWordSelection = sent("SentWithWordSelection");
export const SentWithWordSelectionTooLong = sent(
  "SentWithWordSelectionTooLong",
);
export const SentWithWordSelectionComment = sent(
  "SentWithWordSelectionComment",
);
export const SentWithWordComment = sent("SentWithWordComment");
export const SentWithWordOpenComments = sent("SentWithWordOpenComments");
export const SentWithOutlookDraft = sent("SentWithOutlookDraft");
export const SentWithOutlookAppointment = sent("SentWithOutlookAppointment");
export const SentWithOutlookSelection = sent("SentWithOutlookSelection");
export const SentWithOutlookScheduling = sent("SentWithOutlookScheduling");
export const SentWithUnregistered = sent("SentWithUnregistered");
export const SentWithLongNames = sent("SentWithLongNames");

const edit = (name: ParityEditStoryName): Story => ({
  render: () => <EditStory name={name} />,
});

export const EditTeamsTranscript = edit("EditTeamsTranscript");
export const EditTeamsReading = edit("EditTeamsReading");
export const EditTeamsUnreadable = edit("EditTeamsUnreadable");
export const EditWordSelection = edit("EditWordSelection");
export const EditWordDocument = edit("EditWordDocument");
export const EditOutlookDraft = edit("EditOutlookDraft");
export const EditFacetUnavailable = edit("EditFacetUnavailable");
export const EditKitOverride = edit("EditKitOverride");
export const EditManyFiles = edit("EditManyFiles");

/**
 * Two tools. Below 768 px the composer uses the unified "+" menu and draws
 * them as chips; wider, the web composer keeps its Tools dropdown.
 */
export const ToolChipsPane: Story = {
  render: () => <ToolComposer />,
};

/** Wide, with add-menu content registered as the Outlook and Teams add-ins do. */
export const ToolChipsWide: Story = {
  render: () => <ToolComposer addMenuContent />,
};

export const ToolChipsNone: Story = {
  render: () => <ToolComposer selected={[]} />,
};

export const ToolChipsLocked: Story = {
  render: () => <ToolComposer enforce />,
};

export const ToolChipsLongName: Story = {
  render: () => (
    <ToolComposer
      tools={[LONG_TOOL, ...STORY_TOOLS]}
      selected={[LONG_TOOL.id, STORY_TOOLS[0].id]}
    />
  ),
};

const OutlookScheduling = () => {
  const { items, modes } = useOutlookStoryResolver(
    OUTLOOK_STORIES.ReadScheduling,
  );
  return (
    <ToolComposer
      addMenuContent
      selected={[STORY_TOOLS[0].id]}
      contextItems={items}
      modes={modes}
    />
  );
};

/** Outlook's sticky scheduling mode chip, then a tool chip, after +. */
export const ToolChipsWithMode: Story = {
  render: () => <OutlookScheduling />,
};

const MB = 1024 * 1024;

const GateComposer = ({
  seed,
  files = [],
  maxFiles,
}: {
  seed: StoryContextItem[];
  files?: string[];
  maxFiles?: number;
}) => {
  const items = useResolved(seed);
  return (
    <ToolComposer
      addMenuContent
      selected={[]}
      contextItems={items}
      initialFiles={files.map((name, index) =>
        userFile(`staged-${index + 1}`, name),
      )}
      maxFiles={maxFiles}
    />
  );
};

const OVERSIZED_DROP = [
  dropItem("offsite", "Re: Offsite agenda", "Lena Hoffmann", 60 * MB),
];

/** A dropped email over the upload limit blocks Send until its chip leaves. */
export const SendGateSize: Story = {
  render: () => <GateComposer seed={OVERSIZED_DROP} />,
};

const SMALL_DROPS = [
  dropItem("offsite", "Re: Offsite agenda", "Lena Hoffmann", 2 * MB),
  dropItem("budget", "Budget 2027 draft", "Tom Fischer", 1 * MB),
];

/** Dropped emails and staged files together past the per-message count. */
export const SendGateCount: Story = {
  render: () => (
    <GateComposer
      seed={SMALL_DROPS}
      files={["pricing-sheet.pdf", "contract-v3.pdf"]}
      maxFiles={3}
    />
  ),
};
