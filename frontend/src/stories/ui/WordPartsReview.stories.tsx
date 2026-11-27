import { useState } from "react";

import { Button } from "../../components/ui/Controls/Button";
import {
  WordPartsReview,
  wordPartsPlanningText,
  wordPartsReorderingText,
  wordPartsTitleText,
} from "../../components/ui/WordReview/WordPartsReview";
import {
  WordReviewCard,
  WordReviewDetailsToggle,
  WordReviewGenerating,
} from "../../components/ui/WordReview/WordReviewCardParts";

import type {
  WordPartsProgress,
  WordPartsRowState,
} from "../../lib/wordReview/wordPartsProgress";
import type { Meta, StoryObj } from "@storybook/react";

const TITLES = [
  "§ 3 Lieferung und Versand an die Standorte Halden und Ostrup",
  "§ 5 Abnahme",
  "§ 6 Preise und Zahlungsbedingungen",
  "§ 7 Haftung, § 8 Gewährleistung",
  "§ 11 Gewährleistung für Ersatzteile",
  "§ 14 Versicherung",
];

function progress(
  states: WordPartsRowState[],
  extra: Partial<WordPartsProgress> = {},
): WordPartsProgress {
  return {
    key: "",
    callId: "plan",
    draftId: "draft",
    intent:
      "Plain wording for warehouse staff; § 4 and § 6 swap places, § 7 and § 8 become one.",
    rows: states.map((state, k) => ({
      row: k + 2,
      action: "rewrite",
      title: TITLES[k],
      state,
    })),
    structure: { moved: [4], merged: [5], renamed: [] },
    stopped: false,
    ...extra,
  };
}

const READY = TITLES.map(() => "ready" as const);

const LABEL = "Document changes in parts";

/**
 * The card in the 360 px pane, Apply on top once Erato finished: in the chat's decision place, or
 * in the answer where the server makes no apply call.
 */
function PartsCard({
  value,
  planning = false,
}: {
  value: WordPartsProgress;
  planning?: boolean;
}) {
  if (planning)
    return (
      <div style={{ width: 360 }}>
        <WordReviewGenerating label={wordPartsPlanningText()} />
      </div>
    );
  return (
    <div style={{ width: 360 }}>
      <WordReviewCard
        label={LABEL}
        testId="word-parts-story"
        collapsed={false}
        detailsId="word-parts-story-details"
        footer={null}
      >
        <WordPartsReview
          progress={value}
          title={wordPartsTitleText(value) ?? LABEL}
          top={
            value.finished && (
              <>
                <p className="word-review__hint">{wordPartsReorderingText()}</p>
                <Button type="button" variant="primary">
                  Apply changes
                </Button>
              </>
            )
          }
        />
      </WordReviewCard>
    </div>
  );
}

const meta = {
  title: "UI/Word parts card",
  component: PartsCard,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "A large Word change written in parts, in the 360 px pane: one line while Erato plans it, then one heading, the intent, how many sections are ready and each section's title marked writing or ready; after the finish, the same heading and intent, Apply on top, one line for what stays as it was and only the sections that change. Apply sits on the card in the chat's decision place; the card in the answer has it only where the server makes no apply call.",
      },
    },
  },
} satisfies Meta<typeof PartsCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Planning: Story = {
  args: { value: progress([]), planning: true },
};

export const WritingThreeOfSix: Story = {
  args: {
    value: progress([
      "ready",
      "ready",
      "ready",
      "writing",
      "writing",
      "writing",
    ]),
  },
};

export const Ready: Story = {
  args: { value: progress(READY, { finished: "finish" }) },
};

export const ReadyWithNotChanged: Story = {
  args: {
    value: progress(
      READY.map((state, k) =>
        k === 1 ? "changed-in-word" : k === 4 ? "not-written" : state,
      ),
      { finished: "finish" },
    ),
  },
};

/** Every card but the newest open proposal folds to its one line, also after a reload. */
function FoldedCards() {
  const [open, setOpen] = useState<string>();
  const ready = progress(READY, { finished: "finish" });
  const cards = [
    { id: "older", line: "Proposed: Changes in 6 sections" },
    { id: "applied", line: "Applied: Change 3 paragraphs" },
    { id: "undone", line: "Undone: Change 3 paragraphs" },
  ];
  return (
    <div style={{ width: 360, display: "grid", gap: 12 }}>
      {cards.map(({ id, line }) => {
        const collapsed = open !== id;
        const details = `word-parts-story-${id}`;
        return (
          <WordReviewCard
            key={id}
            label="Proposed document changes"
            testId={`word-parts-story-${id}`}
            collapsed={collapsed}
            detailsId={details}
            receipt={
              <div className="word-review__receipt" role="status">
                <strong>{line}</strong>
              </div>
            }
            footer={
              <div className="word-review__actions">
                <WordReviewDetailsToggle
                  collapsed={collapsed}
                  controls={details}
                  onToggle={() => setOpen(collapsed ? id : undefined)}
                />
              </div>
            }
          >
            <WordPartsReview
              progress={ready}
              title={wordPartsTitleText(ready) ?? LABEL}
            />
          </WordReviewCard>
        );
      })}
    </div>
  );
}

export const FoldedOlderCards: StoryObj<typeof FoldedCards> = {
  render: () => <FoldedCards />,
};
