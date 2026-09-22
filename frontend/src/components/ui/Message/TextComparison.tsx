import { t } from "@lingui/core/macro";
import { useId, useMemo, useState } from "react";

import { textDiff } from "@/utils/textDiff";

import { TabRail } from "../Controls/TabRail";

export type TextComparisonView = "changes" | "original" | "proposed";

function TextWithBreaks({ text }: { text: string }) {
  return text.split(/(\r\n|\n|\r)/u).map((part, index) =>
    /[\r\n]/u.test(part) ? (
      <span key={index}>
        <span className="text-comparison__break" aria-hidden="true">
          ↵
        </span>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function ExactText({ text }: { text: string }) {
  return (
    <div className="text-comparison__text">
      {text === "" ? (
        <em>{t({ id: "textComparison.empty", message: "Empty text" })}</em>
      ) : (
        <TextWithBreaks text={text} />
      )}
    </div>
  );
}

export function TextComparison({
  original,
  proposed,
  view: controlledView,
  onViewChange,
}: {
  original: string | null;
  proposed: string;
  view?: TextComparisonView;
  onViewChange?: (view: TextComparisonView) => void;
}) {
  const id = useId();
  // eslint-disable-next-line lingui/no-unlocalized-strings -- DOM relationship, not copy
  const panelId = `${id}-panel`;
  const [localView, setLocalView] = useState<TextComparisonView>("changes");
  const view = controlledView ?? localView;
  const setView = (next: TextComparisonView) => {
    setLocalView(next);
    onViewChange?.(next);
  };
  const diff = useMemo(
    () => (original === null ? null : textDiff(original, proposed)),
    [original, proposed],
  );
  const tabs = [
    {
      value: "changes" as const,
      label: t({ id: "textComparison.changes", message: "Changes" }),
    },
    {
      value: "original" as const,
      label: t({ id: "textComparison.original", message: "Original" }),
    },
    {
      value: "proposed" as const,
      label: t({ id: "textComparison.proposed", message: "Proposed" }),
    },
  ];
  const shown = original === null ? "proposed" : view;
  return (
    <div className="text-comparison" data-ui="text-comparison">
      <TabRail
        value={shown}
        onChange={setView}
        options={tabs.map((tab) => ({
          ...tab,
          id: `${id}-${tab.value}`,
          panelId,
          disabled: original === null && tab.value !== "proposed",
        }))}
        aria-label={t({
          id: "textComparison.textViews",
          message: "Text comparison",
        })}
        className="flex-wrap"
      />
      <div
        role="tabpanel"
        className="focus-ring"
        id={panelId}
        aria-labelledby={`${id}-${shown}`}
        tabIndex={0}
      >
        {shown === "changes" && diff ? (
          <>
            <p className="text-comparison__legend">
              <span className="text-comparison__removed">
                {t({
                  id: "textComparison.removed",
                  message: "− Removed",
                })}
              </span>
              <span className="text-comparison__added">
                {t({ id: "textComparison.added", message: "+ Added" })}
              </span>
            </p>
            <p className="text-comparison__hint">
              {t({
                id: "textComparison.whitespace",
                message: "· space · ↵ paragraph break · ⇥ tab when changed",
              })}
            </p>
            <div
              className="text-comparison__text"
              data-testid="text-comparison-diff"
            >
              {diff.map((change, index) => {
                if (change.kind === "same")
                  return <TextWithBreaks key={index} text={change.text} />;
                const Tag = change.kind === "removed" ? "del" : "ins";
                return (
                  <Tag key={index} data-exact-text={change.text}>
                    {change.text
                      .replace(/ /gu, "·")
                      .replace(/\t/gu, "⇥")
                      .replace(/\r\n|[\r\n]/gu, "↵\n")}
                  </Tag>
                );
              })}
            </div>
          </>
        ) : shown === "changes" ? (
          <>
            <p className="text-comparison__hint">
              {t({
                id: "textComparison.fullComparison",
                message: "Showing the complete texts for this large change.",
              })}
            </p>
            <h4>{tabs[1].label}</h4>
            <ExactText text={original ?? ""} />
            <h4>{tabs[2].label}</h4>
            <ExactText text={proposed} />
          </>
        ) : (
          <ExactText
            text={shown === "original" ? (original ?? "") : proposed}
          />
        )}
      </div>
    </div>
  );
}
