import { pane } from "./composerContextStoryKit";
import { WordCommentStoryComposer } from "./composerContextWordCommentFixtures";

import type { WordCommentStoryName } from "./composerContextWordCommentScenarios";
import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta = {
  title: "Chat/ComposerContextWordComments",
  // The width follows the viewport, so one story serves the 340 px pane and
  // the 480 px breakpoint.
  decorators: [pane()],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The Word add-in's comment chips and one-off send prompts in the composer: one chip for the comment at the cursor or the one you chose, \"Cursor is in N comments\" as a choice, \"Open comments (N)\" while the document is off, a passage's or the document's comments on the selection or document chip, and the prompts in the notice slot above them. Every state and every gesture one or two steps from it come from the add-in's own resolvers (office-addin/src/word/utils/__tests__/wordCommentStoryParity.test.ts writes composerContextWordComments.generated.json); a gesture the file does not reach is logged and changes nothing. The picker is a stand-in that lists the comments this story reaches.",
      },
    },
  },
};

export default meta;
type Story = StoryObj;

const story = (name: WordCommentStoryName): Story => ({
  render: () => <WordCommentStoryComposer story={name} />,
});

export const CursorComment = story("CursorComment");
export const CursorCommentOff = story("CursorCommentOff");
export const PickedComment = story("PickedComment");
export const PickedWithPassage = story("PickedWithPassage");
export const PickedGone = story("PickedGone");
export const CursorInThreeComments = story("CursorInThreeComments");
export const CursorInThreeOff = story("CursorInThreeOff");
export const PassageWithComment = story("PassageWithComment");
export const PassageCommentsOff = story("PassageCommentsOff");
export const PassageTwoComments = story("PassageTwoComments");
export const PassageDefaultComment = story("PassageDefaultComment");
export const DocumentWithMap = story("DocumentWithMap");
export const DocumentMapOff = story("DocumentMapOff");
export const OpenCommentsNew = story("OpenCommentsNew");
export const OpenCommentsIncluded = story("OpenCommentsIncluded");
export const OpenCommentsOff = story("OpenCommentsOff");
export const OpenCommentsOffForMessage = story("OpenCommentsOffForMessage");
export const OpenCommentsReplaced = story("OpenCommentsReplaced");
export const OpenCommentsCursorInThree = story("OpenCommentsCursorInThree");
export const OpenCommentsLocked = story("OpenCommentsLocked");
export const NoThreadFacet = story("NoThreadFacet");
export const NoticeChooseComment = story("NoticeChooseComment");
export const NoticePickedGone = story("NoticePickedGone");
export const NoticeCommentsReadFailed = story("NoticeCommentsReadFailed");
export const NoticeSlowCapture = story("NoticeSlowCapture");
export const NoticeCommentProgress = story("NoticeCommentProgress");
export const NoticeSelectionReadFailed = story("NoticeSelectionReadFailed");
export const NoticePreviousCapture = story("NoticePreviousCapture");
export const NoticeNotIncluded = story("NoticeNotIncluded");
export const NoticeBudget = story("NoticeBudget");
export const Busy = story("Busy");
export const Interactive = story("Interactive");
