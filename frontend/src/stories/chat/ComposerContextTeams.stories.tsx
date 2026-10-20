import { pane } from "./composerContextStoryKit";
import { TeamsStoryComposer } from "./composerContextTeamsFixtures";
import { TEAMS_STORIES } from "./composerContextTeamsScenarios";

import type { TeamsStorySeed } from "./composerContextTeamsScenarios";
import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta = {
  title: "Chat/ComposerContextTeams",
  // The width follows the viewport, so one story serves the 340 px pane, the
  // 480 px breakpoint and the full-width Teams tab.
  decorators: [pane()],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The Teams tab's transcript in the composer's lane: one chip per transcript that stands for the transcript upload and every file it brought, a detail with the conversations, the picked messages and the shared files (preview, remove), and the conversation view. The chips come from the library's own useTeamsTranscriptContextItems; the story plays the add-in's picker records and composer bridge from data (office-addin/src/teams/utils/teamsComposerTranscripts.ts, useTeamsComposerBridge.ts). \"Edit selection\" opens a stand-in for the add-in's chat picker in edit mode. The add-in's parity test writes the chips each story must draw, and the Storybook spec holds the stories to it.",
      },
    },
  },
};

export default meta;
type Story = StoryObj;

const story = (
  seed: TeamsStorySeed,
  options: { interactive?: boolean } = {},
): Story => ({
  render: () => <TeamsStoryComposer seed={seed} {...options} />,
});

export const Three = story(TEAMS_STORIES.Three);
export const One = story(TEAMS_STORIES.One);
export const WithFiles = story(TEAMS_STORIES.WithFiles);
export const PickedWithImage = story(TEAMS_STORIES.PickedWithImage);
export const PartialAndSkipped = story(TEAMS_STORIES.PartialAndSkipped);
export const Locked = story(TEAMS_STORIES.Locked);
export const Unreadable = story(TEAMS_STORIES.Unreadable);
export const TwoTranscripts = story(TEAMS_STORIES.TwoTranscripts);
export const Reading = story(TEAMS_STORIES.Reading);
export const NoPicker = story(TEAMS_STORIES.NoPicker);
export const Interactive = story(TEAMS_STORIES.Interactive, {
  interactive: true,
});
