import { action } from "@storybook/addon-actions";

import { ChatInput } from "@/components/ui/Chat/ChatInput";

import { hostScenarios } from "./composerContextHostFixtures";
import { AnnouncementLog, pane, useResolved } from "./composerContextStoryKit";

import type { HostScenarioName } from "./composerContextHostFixtures";
import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta = {
  title: "Chat/ComposerContextHosts",
  // The width follows the viewport, so one story serves the 340 px pane and
  // the 480 px breakpoint.
  decorators: [pane()],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Each host's context as the lane will show it, from data only: Word, Outlook (reading and composing) and Teams, one story per state of the target prototype. The story plays the host resolver, so (x), + and their announcements behave as the host will.",
      },
    },
  },
};

export default meta;
type Story = StoryObj;

const HostComposer = ({ scenario }: { scenario: HostScenarioName }) => {
  const { items: seed, ...rest } = hostScenarios[scenario];
  const items = useResolved(seed);
  return (
    <>
      <ChatInput
        onSendMessage={action("onSendMessage")}
        handleFileAttachments={action("handleFileAttachments")}
        initialFiles={"files" in rest ? rest.files : []}
        contextItems={items}
        composerNotice={"notice" in rest ? rest.notice : null}
        maxFiles={20}
        showControls
      />
      <AnnouncementLog />
    </>
  );
};

const story = (scenario: HostScenarioName): Story => ({
  render: () => <HostComposer scenario={scenario} />,
});

export const WordDocument = story("wordDocument");
export const WordSelection = story("wordSelection");
export const WordSuggestedSelection = story("wordSuggestedSelection");
export const WordDocumentOff = story("wordDocumentOff");
export const WordReading = story("wordReading");
export const WordError = story("wordError");
export const WordErrorAgain = story("wordErrorAgain");
export const WordCursorInComments = story("wordCursorInComments");
export const WordBusy = story("wordBusy");
export const WordSelectionFailed = story("wordSelectionFailed");
export const WordChanged = story("wordChanged");

export const OutlookReadThread = story("outlookReadThread");
export const OutlookReadPartial = story("outlookReadPartial");
export const OutlookReadLoading = story("outlookReadLoading");
export const OutlookReadError = story("outlookReadError");
export const OutlookReadErrorAgain = story("outlookReadErrorAgain");
export const OutlookReadSignIn = story("outlookReadSignIn");
export const OutlookReadFollowUp = story("outlookReadFollowUp");
export const OutlookReadDrops = story("outlookReadDrops");
export const OutlookReadDropping = story("outlookReadDropping");

export const OutlookComposeDraft = story("outlookComposeDraft");
export const OutlookComposeUnchanged = story("outlookComposeUnchanged");
export const OutlookComposeDismissed = story("outlookComposeDismissed");
export const OutlookComposeScheduling = story("outlookComposeScheduling");
export const OutlookComposeAttachments = story("outlookComposeAttachments");
export const OutlookComposeSelection = story("outlookComposeSelection");

export const TeamsTranscript = story("teamsTranscript");
export const TeamsWithFiles = story("teamsWithFiles");
export const TeamsPreparing = story("teamsPreparing");
