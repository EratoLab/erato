import { useState } from "react";

import { Button } from "../../components/ui/Controls/Button";
import { WordPartsReview } from "../../components/ui/WordReview/WordPartsReview";
import { WordReviewCard } from "../../components/ui/WordReview/WordReviewCardParts";

import type { WordPartsLeftOut } from "../../components/ui/WordReview/WordPartsReview";
import type {
  WordPartsProgress,
  WordPartsRowState,
} from "../../lib/wordReview/wordPartsProgress";
import type { Meta, StoryObj } from "@storybook/react";

const TITLES = [
  "§ 1 Gegenstand des Vertrags",
  "§ 2 Begriffsbestimmungen",
  "§ 3 Lieferung und Versand an die Standorte Halden und Ostrup",
  "§ 4 Lagerung",
  "§ 5 Abnahme",
  "§ 6 Preise und Zahlungsbedingungen",
  "§ 7 Haftung",
  "§ 8 Gewährleistung",
  "§ 9 Qualitätssicherung",
  "§ 10 Notfall- und Eskalationsmanagement",
  "§ 11 Gewährleistung für Ersatzteile",
  "§ 12 Datenschutz und Informationssicherheit",
  "§ 13 Geheimhaltung",
  "§ 14 Versicherung",
  "§ 15 Höhere Gewalt",
  "§ 16 Laufzeit und Kündigung",
  "§ 17 Abtretung",
  "§ 18 Anwendbares Recht",
  "§ 19 Gerichtsstand",
  "§ 20 Schlussbestimmungen",
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
      moves: [
        {
          row: 5,
          title: "§ 6 Preise und Zahlungsbedingungen",
          after: "§ 3 Lieferung und Versand an die Standorte Halden und Ostrup",
        },
        { row: 6, title: "§ 4 Lagerung", after: "§ 5 Abnahme" },
      ],
      merges: [],
      renames: [
        {
          row: 5,
          title: "§ 6 Preise und Zahlungsbedingungen",
          newTitle: "§ 4 Preise und Zahlungsbedingungen",
        },
      ],
    },
    finishing: false,
    stopped: false,
    ...extra,
  };
}

function PartsCard({
  value,
  editable = false,
}: {
  value: WordPartsProgress;
  editable?: boolean;
}) {
  const [leftOut, setLeftOut] = useState<WordPartsLeftOut>({
    rows: new Set(),
    structure: false,
  });
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
            value.finished ? "Changes in 20 sections" : "Writing the changes"
          }
          top={
            value.finished && (
              <Button type="button" variant="primary">
                Apply changes
              </Button>
            )
          }
          leftOut={editable ? leftOut : undefined}
          onLeaveOut={
            editable
              ? (target, out) =>
                  setLeftOut((prev) =>
                    target === "structure"
                      ? { ...prev, structure: out }
                      : {
                          ...prev,
                          rows: new Set(
                            out
                              ? [...prev.rows, target]
                              : [...prev.rows].filter((row) => row !== target),
                          ),
                        },
                  )
              : undefined
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
          "A large Word change written in parts, in the 360 px pane: the section plan's rows from the first minute, filling as Erato writes; after the finish, Apply on top and Leave out per row and for the reordering.",
      },
    },
  },
} satisfies Meta<typeof PartsCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const WRITING: WordPartsRowState[] = [
  "ready",
  "ready",
  "writing",
  ...Array.from({ length: 17 }, () => "waiting" as const),
];

export const TwentyRowsWhileWriting: Story = {
  args: { value: progress(WRITING) },
};

export const TwentyRowsFinished: Story = {
  args: {
    value: progress(
      TITLES.map((_, k) =>
        k === 10 ? "not-written" : k === 4 ? "changed-in-word" : "ready",
      ),
      { finished: "finish" },
    ),
    editable: true,
  },
};
