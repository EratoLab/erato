import { Alert, GroupedFileAttachmentsPreview } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useEffect } from "react";

import type {
  OutlookAttachmentChipModel,
  OutlookAttachmentsGroupModel,
  OutlookContextNote,
  OutlookDetailField,
  OutlookDraftChipModel,
  OutlookDropChipModel,
  OutlookSelectionChipModel,
  OutlookThreadChipModel,
} from "../utils/outlookContextChips";
import type { FileAttachmentGroup } from "@erato/frontend/library";

/** How often an open draft detail re-reads the draft. */
export const DRAFT_DETAIL_REFRESH_MS = 2_000;

// Read with the detail when it opens; a live role would announce it again.
function DetailNote({ note }: { note: OutlookContextNote }) {
  return (
    <div data-ui="outlook-context-detail-note" data-tone={note.tone}>
      <Alert role="none" type={note.tone}>
        {note.title ? (
          <>
            <strong className="block font-semibold">{note.title}</strong>{" "}
            {note.text}
          </>
        ) : (
          note.text
        )}
      </Alert>
    </div>
  );
}

function Notes({ notes }: { notes: OutlookContextNote[] }) {
  return (
    <>
      {notes.map((note) => (
        <DetailNote key={note.text} note={note} />
      ))}
    </>
  );
}

function Lifetime({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <p
      className="text-xs text-theme-fg-secondary"
      data-ui="outlook-context-detail-lifetime"
    >
      {text}
    </p>
  );
}

function Fields({ fields }: { fields: OutlookDetailField[] }) {
  if (fields.length === 0) return null;
  return (
    <dl
      data-ui="outlook-context-detail-fields"
      className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm"
    >
      {fields.map((field) => (
        <div key={field.label} className="contents">
          <dt className="text-theme-fg-secondary">{field.label}</dt>
          <dd className="min-w-0 break-words text-theme-fg-primary">
            {field.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A long text scrolls on its own, so the notes below stay in reach. */
function Quote({ label, text }: { label: string; text: string }) {
  return (
    <blockquote
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scroll region must take focus to scroll by keyboard
      tabIndex={0}
      aria-label={label}
      data-ui="outlook-context-detail-quote"
      className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-r-[var(--theme-radius-control)] border-l-2 border-theme-border bg-theme-bg-secondary py-2 pl-3 pr-2 text-sm text-theme-fg-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus"
    >
      {text}
    </blockquote>
  );
}

function Checklist({
  group,
  disabled,
}: {
  group: FileAttachmentGroup;
  disabled: boolean;
}) {
  return (
    <div data-ui="outlook-context-detail-checklist">
      <GroupedFileAttachmentsPreview
        groups={[group]}
        disabled={disabled}
        showFileTypes={true}
        showFileSizes={true}
        // The detail is the expanded view and scrolls on its own; folding
        // rows behind "Show more" would hide what is unticked.
        defaultVisibleItems={Number.POSITIVE_INFINITY}
      />
    </div>
  );
}

export function OutlookSelectionDetail({
  model,
}: {
  model: OutlookSelectionChipModel;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Quote label={model.title} text={model.text} />
      <Notes notes={model.notes} />
      <Lifetime text={model.lifetime} />
    </div>
  );
}

export function OutlookDraftDetail({
  model,
  refresh,
}: {
  model: OutlookDraftChipModel;
  /** Re-reads the draft the next send would read; the model follows it. */
  refresh?: () => unknown;
}) {
  useEffect(() => {
    if (!refresh) return;
    refresh();
    // The user can type in the item with the detail still open beside it.
    const timer = window.setInterval(refresh, DRAFT_DETAIL_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);
  return (
    <div className="flex flex-col gap-3">
      <Notes notes={model.notes} />
      <Fields fields={model.fields} />
      {model.body ? (
        <Quote
          label={t({
            id: "officeAddin.outlook.context.draft.detail.bodyLabel",
            message: "Draft text",
          })}
          text={model.body}
        />
      ) : null}
      {model.replyNote ? (
        <p className="text-xs text-theme-fg-secondary">{model.replyNote}</p>
      ) : null}
      <Lifetime text={model.lifetime} />
    </div>
  );
}

export function OutlookThreadDetail({
  model,
  group,
  disabled,
}: {
  model: OutlookThreadChipModel;
  group: FileAttachmentGroup | null;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {model.intro ? (
        <p className="text-sm text-theme-fg-secondary">{model.intro}</p>
      ) : null}
      <Notes notes={model.notes} />
      {model.checklist && group ? (
        <Checklist group={group} disabled={disabled} />
      ) : null}
      <Lifetime text={model.lifetime} />
    </div>
  );
}

export function OutlookDropDetail({
  model,
  group,
  disabled,
}: {
  model: OutlookDropChipModel;
  group: FileAttachmentGroup;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Notes notes={model.notes} />
      <Checklist group={group} disabled={disabled} />
    </div>
  );
}

export function OutlookAttachmentDetail({
  model,
}: {
  model: OutlookAttachmentChipModel;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Fields fields={model.fields} />
      <Notes notes={model.notes} />
      <Lifetime text={model.lifetime} />
    </div>
  );
}

export function OutlookAttachmentsDetail({
  model,
  group,
  disabled,
}: {
  model: OutlookAttachmentsGroupModel;
  group: FileAttachmentGroup;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Notes notes={model.notes} />
      <Checklist group={group} disabled={disabled} />
      <Lifetime text={model.lifetime} />
    </div>
  );
}
