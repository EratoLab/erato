import { useState } from "react";

import { Button } from "../../components/ui/Controls/Button";
import {
  WordPartsReview,
  wordPartsPlanningText,
  wordPartsReorderingText,
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
    structure: {
      moves: [{ row: 4, title: "§ 6 Preise und Zahlungsbedingungen" }],
      merges: [{ row: 5, title: "§ 7 Haftung, § 8 Gewährleistung" }],
      renames: [],
    },
    stopped: false,
    ...extra,
  };
}

const READY = TITLES.map(() => "ready" as const);

/** The card in the 360 px pane, Apply on top once Erato finished. */
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
        label="Document changes in parts"
        testId="word-parts-story"
        collapsed={false}
        detailsId="word-parts-story-details"
        footer={null}
      >
        <WordPartsReview
          progress={value}
          title={
            value.finished ? "Changes in 6 sections" : "Writing the changes"
          }
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
          "A large Word change written in parts, in the 360 px pane: one line while Erato plans it, then the intent, how many sections are ready and each section's title marked writing or ready; after the finish, Apply on top and one line for what stays as it was.",
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
  const cards = [
    { id: "older", line: "Proposed: Changes in 6 sections" },
    { id: "applied", line: "Applied: Change 3 paragraphs" },
    { id: "declined", line: "Proposal declined. Nothing was written." },
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
              progress={progress(READY, { finished: "finish" })}
              title="Changes in 6 sections"
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
