import { Alert, Button } from "@erato/frontend/library";
import { plural, t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  wordEditCounts,
  WordEditOutcome,
  WordEditStatus,
} from "../utils/wordEditPlan";

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

export function isRevertedOutcome(
  status: WordEditStatus | undefined,
  reverted: boolean,
): boolean {
  return reverted && (status === "applied" || status === "failed");
}

export function wordRevertedLabel(): string {
  return t({ id: "officeAddin.word.review.reverted", message: "Reverted" });
}

export function wordEditTargetLabel(target: {
  paragraph: number;
  through?: number;
}): string {
  return target.through === undefined || target.through === target.paragraph
    ? t({
        id: "officeAddin.word.report.paragraph",
        message: `Paragraph ${target.paragraph}`,
      })
    : t({
        id: "officeAddin.word.report.paragraphRange",
        message: `Paragraphs ${target.paragraph}-${target.through}`,
      });
}

export function wordEditsTitleText(paragraphs: number): string {
  return t({
    id: "officeAddin.word.review.changeParagraphs",
    message: plural(paragraphs, {
      one: "Change # paragraph",
      other: "Change # paragraphs",
    }),
  });
}

export function wordEditsAppliedText(applied: number): string {
  return applied === 1
    ? t({ id: "officeAddin.word.review.oneApplied", message: "1 edit applied" })
    : t({
        id: "officeAddin.word.review.appliedCount",
        message: `${applied} edits applied`,
      });
}

/** The applied count is already the title, so only what did not apply is listed. */
export function wordEditExceptionsText({
  skipped,
  failed,
}: ReturnType<typeof wordEditCounts>): string {
  return [
    skipped &&
      t({
        id: "officeAddin.word.review.skippedCount",
        message: `${skipped} skipped`,
      }),
    failed &&
      t({
        id: "officeAddin.word.review.failedCount",
        message: `${failed} failed`,
      }),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function formatWordEditReport(
  outcomes: readonly WordEditOutcome[],
  reverted = false,
): string {
  return outcomes
    .map(
      (outcome) =>
        `${wordEditTargetLabel(outcome)}: ${isRevertedOutcome(outcome.status, reverted) ? wordRevertedLabel() : statusLabel(outcome.status)}${
          outcome.excerpt ? ` — ${outcome.excerpt}` : ""
        }`,
    )
    .join("\n");
}

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
                {wordEditTargetLabel(outcome)}
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
        <Alert type="error">
          {t({
            id: "officeAddin.word.report.copyFailed",
            message: "The report could not be copied. Try again.",
          })}
        </Alert>
      )}
    </div>
  );
}
