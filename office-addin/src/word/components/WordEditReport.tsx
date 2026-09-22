import { Button } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";

import type { WordEditOutcome, WordEditStatus } from "../utils/wordEditPlan";

/** One line's status word. Localized here; the plan layer stays pure. */
export function statusLabel(status: WordEditStatus): string {
  switch (status) {
    case "applied":
      return t({
        id: "officeAddin.word.report.status.applied",
        message: "Applied",
      });
    case "changed":
      return t({
        id: "officeAddin.word.report.status.changed",
        message: "Skipped - the paragraph changed since you asked",
      });
    case "unknown-ordinal":
      return t({
        id: "officeAddin.word.report.status.unknownOrdinal",
        message: "Skipped - that paragraph was not part of what was sent",
      });
    case "partial-ordinal":
      return t({
        id: "officeAddin.word.report.status.partialOrdinal",
        message:
          "Skipped - that paragraph was only partly sent, so it cannot be replaced",
      });
    case "overlapping":
      return t({
        id: "officeAddin.word.report.status.overlapping",
        message: "Skipped - another change in this batch already covers it",
      });
    case "failed":
      return t({
        id: "officeAddin.word.report.status.failed",
        message: "Failed - Word rejected the change",
      });
  }
}

/** "Paragraph 12" or "Paragraphs 18-20". */
function targetLabel(outcome: WordEditOutcome): string {
  return outcome.through === undefined
    ? t({
        id: "officeAddin.word.report.paragraph",
        message: `Paragraph ${outcome.paragraph}`,
      })
    : t({
        id: "officeAddin.word.report.paragraphRange",
        message: `Paragraphs ${outcome.paragraph}-${outcome.through}`,
      });
}

/** The plain-text form the Copy button puts on the clipboard. */
export function formatWordEditReport(
  outcomes: readonly WordEditOutcome[],
  reverted = false,
): string {
  return outcomes
    .map(
      (outcome) =>
        `${targetLabel(outcome)}: ${reverted && (outcome.status === "applied" || outcome.status === "failed") ? t({ id: "officeAddin.word.review.reverted", message: "Reverted" }) : statusLabel(outcome.status)}${
          outcome.excerpt ? ` — ${outcome.excerpt}` : ""
        }`,
    )
    .join("\n");
}

/**
 * Inline outcomes for both explicit approval and standing grants. Automatic
 * application also needs a visible report of skipped or failed edits.
 */
export function WordEditReport({
  outcomes,
  compact = false,
  note = "",
  reverted = false,
}: {
  outcomes: readonly WordEditOutcome[];
  compact?: boolean;
  note?: string;
  reverted?: boolean;
}) {
  const [copyFailed, setCopyFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (resetRef.current) clearTimeout(resetRef.current);
    },
    [],
  );

  const handleCopy = useCallback(() => {
    setCopied(false);
    setCopyFailed(false);
    if (resetRef.current) clearTimeout(resetRef.current);
    if (!navigator.clipboard) {
      setCopyFailed(true);
      return;
    }
    void navigator.clipboard
      .writeText(
        [note, formatWordEditReport(outcomes, reverted)]
          .filter(Boolean)
          .join("\n"),
      )
      .then(() => {
        setCopied(true);
        if (resetRef.current) clearTimeout(resetRef.current);
        // The add-in's success idiom: a transient label swap, never a toast.
        resetRef.current = setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        setCopied(false);
        setCopyFailed(true);
      });
  }, [outcomes, note, reverted]);

  if (outcomes.length === 0) return null;

  return (
    <div
      className={compact ? "space-y-1" : "mt-2 space-y-1"}
      data-testid={compact ? undefined : "word-edit-report"}
    >
      {!compact && (
        <ul className="space-y-0.5 text-xs text-theme-fg-secondary">
          {outcomes.map((outcome) => (
            <li key={outcome.index} data-status={outcome.status}>
              <span className="font-medium text-theme-fg-primary">
                {targetLabel(outcome)}
              </span>
              {": "}
              {statusLabel(outcome.status)}
              {outcome.excerpt ? (
                <span className="text-theme-fg-muted">
                  {" "}
                  — {outcome.excerpt}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Button type="button" onClick={handleCopy} variant="secondary">
        {copied
          ? t({ id: "officeAddin.word.report.copied", message: "Copied!" })
          : t({ id: "officeAddin.word.report.copy", message: "Copy report" })}
      </Button>
      {copyFailed && (
        <p role="status" className="text-sm text-theme-error-fg">
          {t({
            id: "officeAddin.word.report.copyFailed",
            message: "The report could not be copied. Try again.",
          })}
        </p>
      )}
    </div>
  );
}
