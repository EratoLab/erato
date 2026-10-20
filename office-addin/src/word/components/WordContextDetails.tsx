import { Alert, CopyErrorButton } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";

import type {
  WordContextNote,
  WordDocumentChipModel,
  WordSelectionChipModel,
} from "../utils/wordContextChips";
import type { ReactNode } from "react";

// Read with the detail when it opens; a live role would announce it again.
function DetailNote({ note }: { note: WordContextNote }) {
  return (
    <div data-ui="word-context-detail-note" data-tone={note.tone}>
      <Alert role="none" type={note.tone} data-testid={note.testId}>
        {note.text}
      </Alert>
    </div>
  );
}

function DetailSection({
  title,
  dataUi,
  children,
}: {
  title: string;
  dataUi: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1" data-ui={dataUi}>
      <h3 className="text-xs font-semibold text-theme-fg-secondary">{title}</h3>
      {children}
    </section>
  );
}

function Lifetime({ text }: { text: string }) {
  return (
    <p
      className="text-xs text-theme-fg-secondary"
      data-ui="word-context-detail-lifetime"
    >
      {text}
    </p>
  );
}

export function WordSelectionDetail({
  model,
}: {
  model: WordSelectionChipModel;
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* A long passage scrolls on its own, so the notes below stay in reach. */}
      <blockquote
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scroll region must take focus to scroll by keyboard
        tabIndex={0}
        aria-label={t({
          id: "officeAddin.word.context.selection.quoteLabel",
          message: "Selected text",
        })}
        data-ui="word-context-detail-quote"
        className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-r-[var(--theme-radius-control)] border-l-2 border-theme-border bg-theme-bg-secondary py-2 pl-3 pr-2 text-sm text-theme-fg-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus"
      >
        {model.cut ? `${model.text}…` : model.text}
      </blockquote>
      <p className="text-xs text-theme-fg-secondary">{model.paragraphs}</p>
      {model.notes.map((note) => (
        <DetailNote key={note.text} note={note} />
      ))}
      <Lifetime text={model.lifetime} />
    </div>
  );
}

export function WordDocumentDetail({
  model,
  reportOptions,
}: {
  model: WordDocumentChipModel;
  reportOptions?: { chatId: string | null };
}) {
  return (
    <div className="flex flex-col gap-3">
      {model.notes.map((note) => (
        <DetailNote key={note.text} note={note} />
      ))}
      {model.coverage && (
        <DetailSection
          title={model.coverage.heading}
          dataUi="word-context-detail-coverage"
        >
          {/* The hint explains the first line, so it follows it, before any later line. */}
          {model.coverage.lines.slice(0, 1).map((line) => (
            <p key={line}>{line}</p>
          ))}
          {model.coverage.hint && (
            <p
              className="text-xs text-theme-fg-secondary"
              data-testid="word-document-coverage-hint"
            >
              {model.coverage.hint}
            </p>
          )}
          {model.coverage.lines.slice(1).map((line) => (
            <p key={line} className="text-xs text-theme-fg-secondary">
              {line}
            </p>
          ))}
        </DetailSection>
      )}
      {model.comments.length > 0 && (
        <DetailSection
          title={t({
            id: "officeAddin.word.context.document.commentsHeading",
            message: "Comments",
          })}
          dataUi="word-context-detail-comments"
        >
          {model.comments.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </DetailSection>
      )}
      {model.readReport && (
        <CopyErrorButton
          error={model.readReport}
          reportOptions={reportOptions}
        />
      )}
      <Lifetime text={model.lifetime} />
    </div>
  );
}
