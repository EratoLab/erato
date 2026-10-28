import { action } from "@storybook/addon-actions";

import { ChatInput } from "@/components/ui/Chat/ChatInput";

import { useOutlookStoryResolver } from "./composerContextOutlookFixtures";
import { OUTLOOK_STORIES } from "./composerContextOutlookScenarios";
import { AnnouncementLog, pane, stagedFile } from "./composerContextStoryKit";

import type { OutlookStorySimulations } from "./composerContextOutlookFixtures";
import type { OutlookStorySeed } from "./composerContextOutlookScenarios";
import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta = {
  title: "Chat/ComposerContextOutlook",
  // The width follows the viewport, so one story serves the 340 px pane and
  // the 480 px breakpoint.
  decorators: [pane()],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The Outlook add-in's chips in the composer's lane: the compose selection, the draft or appointment, the open thread, the item's attachments and dropped emails, with the scheduling mode next to +. The story plays the add-in's resolvers (office-addin/src/outlook/utils/outlookSendFiles.ts and outlookContextChips.ts) from data, so (x), +, the detail actions and the checklists behave and announce as in the add-in; the add-in's parity test writes the chips each story must draw, and the Storybook spec holds the stories to it.",
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
];

const SIMULATIONS: Record<
  "read" | "compose",
  [string, keyof OutlookStorySimulations][]
> = {
  read: [
    ["Thread finishes loading", "threadLoads"],
    ["Thread fails to load", "threadFails"],
    ["Erato reads the calendar", "readCalendar"],
    ["Drop 2 emails", "dropTwoEmails"],
    ["Send", "send"],
    ["Switch mail item", "switchMailItem"],
  ],
  compose: [
    ["Select text", "selectText"],
    ["Clear the selection", "clearSelection"],
    ["Edit the draft", "editDraft"],
    ["Erato reads the calendar", "readCalendar"],
    ["Drop 2 emails", "dropTwoEmails"],
    ["Send", "send"],
    ["Switch mail item", "switchMailItem"],
  ],
};

const OutlookComposer = ({
  seed,
  files = [],
  simulations = false,
}: {
  seed: OutlookStorySeed;
  files?: typeof BUSY_FILES;
  simulations?: boolean;
}) => {
  const { items, modes, composerDisabled, simulate } =
    useOutlookStoryResolver(seed);
  return (
    <>
      <ChatInput
        onSendMessage={action("onSendMessage")}
        handleFileAttachments={action("handleFileAttachments")}
        initialFiles={files}
        contextItems={items}
        composerModes={modes}
        disabled={composerDisabled}
        maxFiles={20}
        showControls
      />
      {simulations ? (
        <div
          role="group"
          aria-label="Simulate"
          className="mt-3 flex flex-wrap gap-2 text-xs"
        >
          {SIMULATIONS[seed.host ?? "read"].map(([label, key]) => (
            <button
              key={label}
              type="button"
              onClick={simulate[key]}
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
  seed: OutlookStorySeed,
  options: { files?: typeof BUSY_FILES; simulations?: boolean } = {},
): Story => ({
  render: () => <OutlookComposer seed={seed} {...options} />,
});

// Read: the open email.
export const ThreadIncluded = story(OUTLOOK_STORIES.ThreadIncluded);
export const ThreadPartial = story(OUTLOOK_STORIES.ThreadPartial);
export const ThreadLoading = story(OUTLOOK_STORIES.ThreadLoading);
export const ThreadError = story(OUTLOOK_STORIES.ThreadError);
export const ThreadErrorAgain = story(OUTLOOK_STORIES.ThreadErrorAgain);
export const ThreadSignIn = story(OUTLOOK_STORIES.ThreadSignIn);
export const ThreadConsent = story(OUTLOOK_STORIES.ThreadConsent);
export const ThreadSigningIn = story(OUTLOOK_STORIES.ThreadSigningIn);
export const ThreadOff = story(OUTLOOK_STORIES.ThreadOff);
export const ThreadFollowUp = story(OUTLOOK_STORIES.ThreadFollowUp);
export const ThreadFollowUpLoading = story(
  OUTLOOK_STORIES.ThreadFollowUpLoading,
);
export const ThreadFollowUpError = story(OUTLOOK_STORIES.ThreadFollowUpError);
export const ThreadNothingChosen = story(OUTLOOK_STORIES.ThreadNothingChosen);
export const ThreadTrimFailed = story(OUTLOOK_STORIES.ThreadTrimFailed);
export const ThreadSentInChat = story(OUTLOOK_STORIES.ThreadSentInChat);
export const ThreadDroppedAsEmail = story(OUTLOOK_STORIES.ThreadDroppedAsEmail);
export const Drops = story(OUTLOOK_STORIES.Drops);
export const DropTrimFailed = story(OUTLOOK_STORIES.DropTrimFailed);
export const Dropping = story(OUTLOOK_STORIES.Dropping);
export const MailAttachmentsNoGraph = story(
  OUTLOOK_STORIES.MailAttachmentsNoGraph,
);
export const MailAttachmentsWithDrop = story(
  OUTLOOK_STORIES.MailAttachmentsWithDrop,
);
export const ReadScheduling = story(OUTLOOK_STORIES.ReadScheduling);

// Compose: the draft or appointment and what rides with it.
export const Draft = story(OUTLOOK_STORIES.Draft);
export const DraftNewMessage = story(OUTLOOK_STORIES.DraftNewMessage);
export const DraftUnchanged = story(OUTLOOK_STORIES.DraftUnchanged);
export const DraftOff = story(OUTLOOK_STORIES.DraftOff);
export const Selection = story(OUTLOOK_STORIES.Selection);
export const SelectionDismissed = story(OUTLOOK_STORIES.SelectionDismissed);
export const SelectionNoDraft = story(OUTLOOK_STORIES.SelectionNoDraft);
export const SelectionDraftUnchanged = story(
  OUTLOOK_STORIES.SelectionDraftUnchanged,
);
export const Appointment = story(OUTLOOK_STORIES.Appointment);
export const AppointmentSelection = story(OUTLOOK_STORIES.AppointmentSelection);
export const AttachmentsGroup = story(OUTLOOK_STORIES.AttachmentsGroup);
export const AttachmentsGroupPartial = story(
  OUTLOOK_STORIES.AttachmentsGroupPartial,
);
export const AttachmentsGroupOff = story(OUTLOOK_STORIES.AttachmentsGroupOff);
export const AttachmentsGroupCloud = story(
  OUTLOOK_STORIES.AttachmentsGroupCloud,
);
export const AttachmentsFollowUp = story(OUTLOOK_STORIES.AttachmentsFollowUp);
export const AttachmentsSentEarlier = story(
  OUTLOOK_STORIES.AttachmentsSentEarlier,
);
export const CloudAttachment = story(OUTLOOK_STORIES.CloudAttachment);
export const AttachmentsWithDrop = story(OUTLOOK_STORIES.AttachmentsWithDrop);
export const Scheduling = story(OUTLOOK_STORIES.Scheduling);
export const SchedulingUnchanged = story(OUTLOOK_STORIES.SchedulingUnchanged);
export const Sending = story(OUTLOOK_STORIES.Sending);

export const Busy = story(OUTLOOK_STORIES.Busy, { files: BUSY_FILES });
export const InteractiveRead = story(OUTLOOK_STORIES.InteractiveRead, {
  simulations: true,
});
export const InteractiveCompose = story(OUTLOOK_STORIES.InteractiveCompose, {
  simulations: true,
});
