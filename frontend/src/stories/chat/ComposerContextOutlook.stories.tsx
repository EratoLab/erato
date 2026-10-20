import { action } from "@storybook/addon-actions";

import { ChatInput } from "@/components/ui/Chat/ChatInput";

import {
  BUDGET_DROP,
  CLOUD_FILE,
  CONTRACT,
  OFFSITE_DROP,
  PRICING,
  SCHEDULE,
  useOutlookStoryResolver,
} from "./composerContextOutlookFixtures";
import { AnnouncementLog, pane, stagedFile } from "./composerContextStoryKit";

import type {
  OutlookStorySeed,
  OutlookStorySimulations,
} from "./composerContextOutlookFixtures";
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
          "The Outlook add-in's chips in the composer's lane: the compose selection, the draft or appointment, the open thread, the item's attachments and dropped emails, with the scheduling mode next to +. The story plays the add-in's resolvers (office-addin/src/outlook/utils/outlookSendFiles.ts and outlookContextChips.ts) from data, so (x), +, the detail actions and the checklists behave and announce as in the add-in.",
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

const PARTIAL = {
  untickedMessages: ["m2", "m5"],
  untickedAttachments: ["m3:a1"],
};
const EVERY_MESSAGE_OFF = {
  untickedMessages: ["m1", "m2", "m3", "m4", "m5"],
};

// Read: the open email.
export const ThreadIncluded = story({});
export const ThreadPartial = story(PARTIAL);
export const ThreadLoading = story({ threadStatus: "loading" });
export const ThreadError = story({ threadStatus: "error" });
export const ThreadErrorAgain = story({
  threadStatus: "error",
  retryLandsOn: "error",
});
export const ThreadSignIn = story({ threadStatus: "error", signIn: "sign-in" });
export const ThreadConsent = story({
  threadStatus: "error",
  signIn: "consent",
});
export const ThreadSigningIn = story({
  threadStatus: "loading",
  signingIn: true,
});
export const ThreadOff = story({ ...PARTIAL, threadChoice: "excluded" });
export const ThreadFollowUp = story({ freshChat: false });
export const ThreadFollowUpLoading = story({
  freshChat: false,
  threadStatus: "loading",
});
export const ThreadNothingChosen = story(EVERY_MESSAGE_OFF);
export const ThreadTrimFailed = story({
  untickedAttachments: ["m4:a1"],
  trimBlocked: "m4:a1",
});
export const ThreadSentInChat = story({
  freshChat: false,
  threadSentInChat: true,
});
export const ThreadDroppedAsEmail = story({
  openEmailDropped: true,
  drops: [OFFSITE_DROP],
});
export const Drops = story({ drops: [OFFSITE_DROP, BUDGET_DROP] });
export const DropTrimFailed = story({
  drops: [{ ...OFFSITE_DROP, trimBlocked: "att-1" }],
  dismissedDropAttachments: { [OFFSITE_DROP.key]: ["att-1"] },
});
export const Dropping = story({ dropProgress: "Reading email 1 of 2…" });
export const MailAttachmentsNoGraph = story({
  threadStatus: "none",
  attachments: [CONTRACT, PRICING],
});
export const MailAttachmentsWithDrop = story({
  threadStatus: "none",
  attachments: [CONTRACT],
  drops: [OFFSITE_DROP],
});
export const ReadScheduling = story({ scheduling: true });

// Compose: the draft or appointment and what rides with it.
const COMPOSE: OutlookStorySeed = {
  host: "compose",
  threadStatus: "none",
  attachments: [CONTRACT, PRICING],
};
export const Draft = story(COMPOSE);
export const DraftNewMessage = story({
  ...COMPOSE,
  reply: false,
  attachments: [],
});
export const DraftUnchanged = story({
  ...COMPOSE,
  freshChat: false,
  draft: "unchanged",
  sentAttachmentIds: [CONTRACT.id, PRICING.id],
});
export const DraftOff = story({ ...COMPOSE, draftOff: true });
export const Selection = story({ ...COMPOSE, selection: "active" });
export const SelectionDismissed = story({
  ...COMPOSE,
  selection: "dismissed",
});
export const SelectionNoDraft = story({
  ...COMPOSE,
  draft: "none",
  attachments: [],
  selection: "active",
});
export const Appointment = story({
  ...COMPOSE,
  itemKind: "appointment",
  attachments: [],
});
export const AppointmentSelection = story({
  ...COMPOSE,
  itemKind: "appointment",
  attachments: [],
  selection: "active",
});
export const AttachmentsGroup = story({
  ...COMPOSE,
  attachments: [CONTRACT, PRICING, SCHEDULE],
});
export const AttachmentsGroupPartial = story({
  ...COMPOSE,
  attachments: [CONTRACT, PRICING, SCHEDULE],
  dismissedAttachments: [PRICING.id],
});
export const AttachmentsGroupOff = story({
  ...COMPOSE,
  attachments: [CONTRACT, PRICING, SCHEDULE],
  attachmentsGroupOff: true,
});
export const AttachmentsFollowUp = story({
  ...COMPOSE,
  freshChat: false,
  draft: "unchanged",
  sentAttachmentIds: [CONTRACT.id],
});
export const AttachmentsSentEarlier = story({
  ...COMPOSE,
  freshChat: false,
  draft: "unchanged",
  attachments: [CONTRACT, PRICING, SCHEDULE],
  sentAttachmentIds: [CONTRACT.id, PRICING.id, SCHEDULE.id],
});
export const CloudAttachment = story({
  ...COMPOSE,
  attachments: [CONTRACT, CLOUD_FILE],
});
export const AttachmentsWithDrop = story({
  ...COMPOSE,
  drops: [OFFSITE_DROP],
});
export const Scheduling = story({ ...COMPOSE, scheduling: true });
export const Sending = story({
  ...COMPOSE,
  scheduling: true,
  drops: [OFFSITE_DROP],
  sending: true,
});

export const Busy = story(
  {
    ...COMPOSE,
    selection: "active",
    attachments: [CONTRACT, PRICING, SCHEDULE],
    drops: [OFFSITE_DROP, BUDGET_DROP],
  },
  { files: BUSY_FILES },
);
export const InteractiveRead = story({}, { simulations: true });
export const InteractiveCompose = story(COMPOSE, { simulations: true });
